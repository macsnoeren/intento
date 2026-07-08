import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createUserRequestSchema,
  updateSettingsRequestSchema,
  userListResponseSchema,
  type UserListResponse,
  type UserPublic,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant, tenantScope } from '../auth/tenant.js';
import { assertCaregiverAccess } from '../auth/caregivers.js';
import { userToPublic as toPublic } from '../users/serialize.js';

export interface UserRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameters: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Gebruikersbeheer (T2.1, DESIGN §2, §5.3, §6.2, FR-017).
 *
 * CRUD op gebruikers + hun communicatieprofiel, volledig tenant-gebonden: elke query wordt op
 * `organizationId` gefilterd (`tenantScope`) en directe toegang op id via `assertSameTenant`
 * bewaakt (403 bij een andere organisatie — bestaan lekt niet). Rolverdeling:
 *   - aanmaken/verwijderen: **ADMIN** (beheerderstaak, FR-017);
 *   - bekijken/instellingen aanpassen: **ADMIN + CAREGIVER** (begeleider mag instellingen
 *     beheren, DESIGN §2). Een CAREGIVER ziet en beheert echter alléén de gebruikers waaraan
 *     hij gekoppeld is (`assertCaregiverAccess`, T2.2); een ADMIN alle van de eigen organisatie.
 */
export function registerUserRoutes(app: FastifyInstance, { prisma }: UserRoutesDeps): void {
  // Aanmaken — ADMIN. Het communicatieprofiel wordt meteen met de standaardwaarden aangemaakt.
  app.post(
    '/users',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<UserPublic> => {
      const account = requireAccount(request);
      const { name, active } = createUserRequestSchema.parse(request.body);

      const user = await prisma.user.create({
        data: {
          name,
          active: active ?? true,
          organizationId: account.organizationId,
          communicationProfile: { create: {} },
        },
        include: { communicationProfile: true },
      });

      reply.status(201);
      return toPublic(user);
    },
  );

  // Lijst — ADMIN. Alléén gebruikers binnen de eigen organisatie (tenant-gefilterd).
  app.get(
    '/admin/users',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<UserListResponse> => {
      const account = requireAccount(request);
      const users = await prisma.user.findMany({
        where: { ...tenantScope(account) },
        include: { communicationProfile: true },
        orderBy: { createdAt: 'asc' },
      });
      return userListResponseSchema.parse({ users: users.map(toPublic) });
    },
  );

  // Ophalen — ADMIN + CAREGIVER. `assertSameTenant` weigert een gebruiker uit een andere org.
  app.get(
    '/users/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<UserPublic> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const user = await prisma.user.findUnique({
        where: { id },
        include: { communicationProfile: true },
      });
      const safeUser = assertSameTenant(account, user);
      // Begeleider ziet alléén gekoppelde gebruikers (T2.2); voor ADMIN een no-op.
      await assertCaregiverAccess(prisma, account, id);
      return toPublic(safeUser);
    },
  );

  // Instellingen — ADMIN + CAREGIVER. PUT vervangt het volledige profiel (alle velden verplicht).
  app.put(
    '/users/:id/settings',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<UserPublic> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const settings = updateSettingsRequestSchema.parse(request.body);

      // Eerst de tenant-grens én begeleider-koppeling bewaken, dan pas het profiel schrijven.
      const existing = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, existing);
      await assertCaregiverAccess(prisma, account, id);

      await prisma.userCommunicationProfile.upsert({
        where: { userId: id },
        create: { userId: id, ...settings },
        update: settings,
      });

      const user = await prisma.user.findUnique({
        where: { id },
        include: { communicationProfile: true },
      });
      return toPublic(assertSameTenant(account, user));
    },
  );

  // Verwijderen — ADMIN. Profiel verdwijnt mee (onDelete: Cascade).
  app.delete(
    '/users/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<void> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const existing = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, existing);

      await prisma.user.delete({ where: { id } });
      reply.status(204).send();
    },
  );
}
