import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogListResponseSchema, type AuditLogListResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuditLogModel } from '../generated/prisma/models.js';
import { authorize, requireAccount } from '../auth/authorize.js';

export interface AuditRoutesDeps {
  prisma: PrismaClient;
}

/** Query: hoeveel regels teruggeven (nieuwste eerst). Begrensd zodat de lijst niet ontploft. */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/**
 * Serialiseert een audit-regel naar de publieke vorm. Bewust **zonder `ip`**: het IP wordt at-rest
 * bewaard voor diagnose, maar niet aan andere beheerders getoond (privacygevoelige herkomstdata).
 * `metadataJson` wordt defensief geparseerd; onleesbare JSON valt terug op `null`.
 */
function auditToPublic(row: AuditLogModel): unknown {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadataJson) {
    try {
      const parsed: unknown = JSON.parse(row.metadataJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    action: row.action,
    outcome: row.outcome,
    accountId: row.accountId,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Audit-log-inzage (T8.2, DESIGN §9.4). `GET /admin/audit-logs` toont het spoor van gevoelige acties
 * van de **eigen organisatie** — ADMIN-only en tenant-gefilterd op `organizationId`, zodat een
 * beheerder nooit het spoor van een andere organisatie ziet (multi-tenant-isolatie). De regels bevatten
 * geen communicatie-inhoud (zie het `AuditLog`-model en `audit/audit.ts`).
 *
 * Let op: pre-auth mislukkingen (mislukte login) hebben géén `organizationId` en verschijnen daarom
 * bewust niet in een tenant-lijst — ze zijn platformbreed diagnostisch (server-log/DB), niet iets dat
 * één organisatie over willekeurige adressen mag inzien.
 */
export function registerAuditRoutes(app: FastifyInstance, { prisma }: AuditRoutesDeps): void {
  app.get(
    '/admin/audit-logs',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AuditLogListResponse> => {
      const account = requireAccount(request);
      const { limit } = listQuerySchema.parse(request.query);

      const rows = await prisma.auditLog.findMany({
        where: { organizationId: account.organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return auditLogListResponseSchema.parse({ entries: rows.map(auditToPublic) });
    },
  );
}
