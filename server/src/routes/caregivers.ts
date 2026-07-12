import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  caregiverListResponseSchema,
  linkCaregiverRequestSchema,
  type CaregiverListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { assertSameTenant } from '../auth/tenant.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface CaregiverRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het gebruikers-id uit het pad. */
const userParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Bouwt de koppelweergave: alle CAREGIVER-accounts van de organisatie met per account of het
 * aan deze gebruiker gekoppeld is. Gedeeld door GET en de response na een POST, zodat de UI
 * na een wijziging meteen de actuele stand krijgt.
 */
async function buildCaregiverList(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<CaregiverListResponse> {
  const caregivers = await prisma.account.findMany({
    where: { organizationId, role: 'CAREGIVER' },
    orderBy: { email: 'asc' },
  });
  const links = await prisma.caregiverAssignment.findMany({ where: { userId } });
  const linkedIds = new Set(links.map((link) => link.accountId));

  return caregiverListResponseSchema.parse({
    caregivers: caregivers.map((caregiver) => ({
      accountId: caregiver.id,
      email: caregiver.email,
      linked: linkedIds.has(caregiver.id),
    })),
  });
}

/**
 * Begeleiders koppelen (T2.2, DESIGN §2, §8.2, FR-017).
 *
 * Een beheerder (ADMIN) bepaalt welke begeleiders (CAREGIVER-accounts) aan een gebruiker
 * gekoppeld zijn. De koppeling stuurt de toegang: een begeleider ziet en beheert alléén
 * gekoppelde gebruikers (afgedwongen via `assertCaregiverAccess` op de gebruiker-routes).
 *
 * Beide endpoints zijn ADMIN-only en volledig tenant-gebonden: de gebruiker moet in de eigen
 * organisatie zitten (`assertSameTenant`) en een te koppelen account moet een CAREGIVER binnen
 * dezelfde organisatie zijn — zo kan een beheerder nooit een gebruiker of begeleider uit een
 * andere organisatie raken (multi-tenant-isolatie, DESIGN §9.4).
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
      if (caregiver.role !== 'CAREGIVER') {
        throw new HttpError(
          400,
          'NOT_A_CAREGIVER',
          'Alleen accounts met de rol CAREGIVER kunnen gekoppeld worden.',
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
}
