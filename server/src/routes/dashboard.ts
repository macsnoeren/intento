import type { FastifyInstance } from 'fastify';
import { dashboardResponseSchema, type DashboardResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';

export interface DashboardRoutesDeps {
  prisma: PrismaClient;
}

/**
 * Beheerdashboard.
 *
 * `GET /admin/dashboard` geeft een beknopt overzicht van de **eigen organisatie**: het aantal
 * gebruikers (totaal/actief) en het aantal begeleiders. De tellingen zijn tenant-gefilterd op
 * `organizationId` — een beheerder ziet nooit data van een andere organisatie. De gespreksactiviteit
 * van de oude flow is weg (N0.4); de nieuwe beheerschermen (berichten, ontbrekende woorden) hebben
 * een eigen pagina.
 */
export function registerDashboardRoutes(
  app: FastifyInstance,
  { prisma }: DashboardRoutesDeps,
): void {
  app.get(
    '/admin/dashboard',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<DashboardResponse> => {
      const { organizationId } = requireAccount(request);

      const [userTotal, userActive, caregiverTotal] = await Promise.all([
        prisma.user.count({ where: { organizationId } }),
        prisma.user.count({ where: { organizationId, active: true } }),
        prisma.account.count({ where: { organizationId, role: 'CAREGIVER' } }),
      ]);

      return dashboardResponseSchema.parse({
        users: { total: userTotal, active: userActive },
        caregivers: { total: caregiverTotal },
      });
    },
  );
}
