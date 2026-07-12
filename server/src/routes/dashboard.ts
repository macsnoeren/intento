import type { FastifyInstance } from 'fastify';
import { dashboardResponseSchema, type DashboardResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';

export interface DashboardRoutesDeps {
  prisma: PrismaClient;
}

/** Aantal recente sessies dat het dashboard toont (privacy: alleen wie/wanneer/status, geen inhoud). */
const RECENT_ACTIVITY_LIMIT = 10;

/**
 * Beheerdashboard (T7.3, DESIGN §5.2, FR-016).
 *
 * `GET /admin/dashboard` geeft een beknopt overzicht van de **eigen organisatie**: het aantal
 * gebruikers (totaal/actief), het aantal begeleiders en de recente gespreksactiviteit. De tellingen
 * zijn tenant-gefilterd op `organizationId` (T1.2) — een beheerder ziet nooit data van een andere
 * organisatie. Alleen het aantal openstaande AI-conceptvoorstellen is platformbreed: de
 * AAC-bibliotheek en haar voorstellen zijn gedeeld (net als het AAC-beheer, DESIGN §5.2).
 *
 * Privacy by design (DESIGN §6.4, §9.4): de recente activiteit bevat **geen communicatie-inhoud** —
 * alleen de gebruikersnaam, status/modus, het aantal bevestigde boodschappen en het starttijdstip.
 */
export function registerDashboardRoutes(app: FastifyInstance, { prisma }: DashboardRoutesDeps): void {
  app.get(
    '/admin/dashboard',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<DashboardResponse> => {
      const account = requireAccount(request);
      const organizationId = account.organizationId;

      const [userTotal, userActive, caregiverTotal, pendingProposals, sessions] = await Promise.all([
        prisma.user.count({ where: { organizationId } }),
        prisma.user.count({ where: { organizationId, active: true } }),
        prisma.account.count({ where: { organizationId, role: 'CAREGIVER' } }),
        prisma.conceptProposal.count({ where: { status: 'PENDING' } }),
        prisma.conversationSession.findMany({
          where: { user: { organizationId } },
          orderBy: { startedAt: 'desc' },
          take: RECENT_ACTIVITY_LIMIT,
          include: {
            user: { select: { id: true, name: true } },
            // Alleen bevestigde boodschappen tellen (nooit de inhoud); in de MVP hoogstens één.
            messages: { where: { confirmed: true }, select: { id: true } },
          },
        }),
      ]);

      const recentActivity = sessions.map((session) => ({
        sessionId: session.id,
        userId: session.user.id,
        userName: session.user.name,
        status: session.status,
        mode: session.mode,
        messageCount: session.messages.length,
        startedAt: session.startedAt.toISOString(),
      }));

      return dashboardResponseSchema.parse({
        users: { total: userTotal, active: userActive },
        caregivers: { total: caregiverTotal },
        pendingProposals,
        recentActivity,
      });
    },
  );
}
