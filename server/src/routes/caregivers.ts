import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  caregiverListResponseSchema,
  linkCaregiverRequestSchema,
  userListResponseSchema,
  type CaregiverListResponse,
  type UserListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { userToPublic } from '../users/serialize.js';

export interface CaregiverRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Rollen die begeleider van een gebruiker kunnen zijn. Naast CAREGIVER staat ADMIN in deze lijst:
 * in kleine organisaties (een gezin, een kleine zorglocatie) is de beheerder vaak zélf de begeleider aan
 * tafel, en die hoorde daarvoor een tweede account aan te maken. De rol reist mee naar de UI zodat
 * zichtbaar blijft wie beheerder is. `USER` staat er bewust niet bij: dat is de communicerende persoon.
 */
const CAREGIVER_ELIGIBLE_ROLES = ['ADMIN', 'CAREGIVER'] as const;

/**
 * Bouwt de koppelweergave: alle accounts van de organisatie die begeleider kunnen zijn, met per account
 * of het aan deze gebruiker gekoppeld is. Gedeeld door GET en de response na een POST, zodat de UI
 * na een wijziging meteen de actuele stand krijgt.
 */
async function buildCaregiverList(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<CaregiverListResponse> {
  const caregivers = await prisma.account.findMany({
    where: { organizationId, role: { in: [...CAREGIVER_ELIGIBLE_ROLES] } },
    orderBy: { email: 'asc' },
  });
  const links = await prisma.caregiverAssignment.findMany({ where: { userId } });
  const linkedIds = new Set(links.map((link) => link.accountId));

  return caregiverListResponseSchema.parse({
    caregivers: caregivers.map((caregiver) => ({
      accountId: caregiver.id,
      email: caregiver.email,
      role: caregiver.role,
      linked: linkedIds.has(caregiver.id),
    })),
  });
}

/**
 * Begeleiders koppelen (INTENTO-NEW-DESIGN §49, §51).
 *
 * Een beheerder (ADMIN) bepaalt welke begeleiders (CAREGIVER-accounts) aan een gebruiker
 * gekoppeld zijn. De koppeling stuurt de toegang: een begeleider ziet en beheert alléén
 * gekoppelde gebruikers (afgedwongen via `assertCaregiverAccess` op de gebruiker-routes).
 *
 * Beide endpoints zijn ADMIN-only en volledig tenant-gebonden: de gebruiker moet in de eigen
 * organisatie zitten (`assertSameTenant`) en een te koppelen account moet een CAREGIVER **of ADMIN**
 * binnen dezelfde organisatie zijn (T9.1: een beheerder mag ook begeleider zijn) — zo kan een beheerder
 * nooit een gebruiker of begeleider uit een andere organisatie raken (INTENTO-NEW-DESIGN §53, multi-tenant-isolatie).
 */
export function registerCaregiverRoutes(
  app: FastifyInstance,
  { prisma }: CaregiverRoutesDeps,
): void {
  // Overzicht — ADMIN. Alle CAREGIVER-accounts van de eigen organisatie met per account of
  // het aan deze gebruiker gekoppeld is. Voedt de aan/uit-schakelaars in de beheer-UI.
  app.get(
    '/admin/users/:id/caregivers',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<CaregiverListResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);

      return buildCaregiverList(prisma, account.organizationId, id);
    },
  );

  // Koppelen/ontkoppelen — ADMIN. Idempotent: `linked: true` maakt de koppeling (upsert),
  // `linked: false` verwijdert die (deleteMany, geen fout als er niets stond).
  app.post(
    '/admin/users/:id/caregivers',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<CaregiverListResponse> => {
      const account = requireAccount(request);
      const { id } = userParamsSchema.parse(request.params);
      const { accountId, linked } = linkCaregiverRequestSchema.parse(request.body);

      const user = await prisma.user.findUnique({ where: { id } });
      assertSameTenant(account, user);

      // De te koppelen begeleider moet een CAREGIVER binnen dezelfde organisatie zijn.
      const caregiver = await prisma.account.findUnique({ where: { id: accountId } });
      if (!caregiver || caregiver.organizationId !== account.organizationId) {
        // Zelfde 403 als bij een andere tenant: bestaan van accounts elders lekt niet.
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Geen geldig begeleider-account in deze organisatie.',
        );
      }
      // Een beheerder mag ook begeleider zijn; alleen een USER-account kan het niet zijn.
      if (
        !CAREGIVER_ELIGIBLE_ROLES.includes(
          caregiver.role as (typeof CAREGIVER_ELIGIBLE_ROLES)[number],
        )
      ) {
        throw new HttpError(
          400,
          'NOT_A_CAREGIVER',
          'Alleen accounts met de rol CAREGIVER of ADMIN kunnen als begeleider gekoppeld worden.',
        );
      }

      if (linked) {
        await prisma.caregiverAssignment.upsert({
          where: { userId_accountId: { userId: id, accountId } },
          create: { userId: id, accountId },
          update: {},
        });
      } else {
        await prisma.caregiverAssignment.deleteMany({ where: { userId: id, accountId } });
      }

      await recordAudit(prisma, request, {
        action: linked ? AUDIT_ACTIONS.CAREGIVER_LINK : AUDIT_ACTIONS.CAREGIVER_UNLINK,
        targetType: 'user',
        targetId: id,
        metadata: { caregiverAccountId: accountId },
      });

      return buildCaregiverList(prisma, account.organizationId, id);
    },
  );

  // De eigen gebruikers van een begeleider (N3.4, INTENTO-NEW-DESIGN §49, V7): alleen de gebruikers waaraan
  // dít account gekoppeld is, binnen de eigen organisatie. Ook een beheerder kan begeleider zijn; die
  // ziet hier dan zijn eigen koppelingen (het volledige overzicht staat onder /admin/users).
  app.get(
    '/caregiver/users',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<UserListResponse> => {
      const account = requireAccount(request);
      const users = await prisma.user.findMany({
        where: {
          organizationId: account.organizationId,
          caregiverLinks: { some: { accountId: account.id } },
        },
        orderBy: { name: 'asc' },
        include: { communicationProfile: true },
      });
      return userListResponseSchema.parse({ users: users.map(userToPublic) });
    },
  );
}
