import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createWorkerTokenRequestSchema,
  createWorkerTokenResponseSchema,
  workerTokenListResponseSchema,
  type CreateWorkerTokenResponse,
  type WorkerTokenListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { authorize, requirePlatformOrg } from '../auth/authorize.js';
import { createWorkerToken, revokeWorkerToken, workerTokenToPublic } from '../ai/worker-token.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface WorkerTokenRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het worker-token-id uit het pad. */
const idParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Beheer-endpoints voor worker-tokens (T5.8, DESIGN §5.2, §9.4, ADR-0010). Een worker-token is een
 * **platform-/infrastructuur**-credential (los van gebruiker-/device-/sessietokens en niet
 * tenant-gebonden). Beheer is daarom voorbehouden aan een ADMIN van de **platformorganisatie**
 * (`requirePlatformOrg`, `Organization.isPlatform`) — niet aan elke zelf-aangemelde organisatie-ADMIN.
 * Zo kan geen willekeurige familie/zorg-admin infra-credentials munten die jobs van álle tenants
 * zouden verwerken.
 *
 * - `GET  /admin/worker-tokens` — lijst (naam, scopes, `lastSeenAt`, status). Nooit de hash/rauw token.
 * - `POST /admin/worker-tokens` — nieuw token; het **rauwe** token wordt hier één keer teruggegeven.
 * - `POST /admin/worker-tokens/:id/revoke` — intrekken (idempotent); daarna weigert `workerAuthorize` het.
 */
export function registerWorkerTokenRoutes(
  app: FastifyInstance,
  { prisma }: WorkerTokenRoutesDeps,
): void {
  const preHandler = [authorize(prisma, { roles: ['ADMIN'] }), requirePlatformOrg(prisma)];

  app.get(
    '/admin/worker-tokens',
    { preHandler },
    async (): Promise<WorkerTokenListResponse> => {
      const tokens = await prisma.workerToken.findMany({ orderBy: { createdAt: 'desc' } });
      return workerTokenListResponseSchema.parse({ tokens: tokens.map(workerTokenToPublic) });
    },
  );

  app.post(
    '/admin/worker-tokens',
    { preHandler },
    async (request, reply): Promise<CreateWorkerTokenResponse> => {
      const { name, scopes, ttlDays } = createWorkerTokenRequestSchema.parse(request.body ?? {});
      const { record, token } = await createWorkerToken(prisma, { name, scopes, ttlDays });

      // Platform-infra-credential: auditen zonder tenant (worker-tokens zijn niet tenant-gebonden). Nooit
      // het rauwe token/hash — alleen dat er een token is gemunt, met naam/scopes voor herkomst.
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.WORKER_TOKEN_CREATE,
        organizationId: null,
        targetType: 'workerToken',
        targetId: record.id,
        metadata: { name: record.name, scopes: record.scopes },
      });

      reply.status(201);
      return createWorkerTokenResponseSchema.parse({
        workerToken: workerTokenToPublic(record),
        token,
      });
    },
  );

  app.post(
    '/admin/worker-tokens/:id/revoke',
    { preHandler },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = await prisma.workerToken.findUnique({ where: { id } });
      if (!existing) {
        throw new HttpError(404, 'WORKER_TOKEN_NOT_FOUND', 'Worker-token niet gevonden.');
      }
      await revokeWorkerToken(prisma, id);

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.WORKER_TOKEN_REVOKE,
        organizationId: null,
        targetType: 'workerToken',
        targetId: id,
        metadata: { name: existing.name },
      });

      const updated = await prisma.workerToken.findUnique({ where: { id } });
      return workerTokenToPublic(updated ?? existing);
    },
  );
}
