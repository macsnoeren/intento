import type { FastifyInstance } from 'fastify';
import { accountListResponseSchema, type AccountListResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { accountToPublic as toPublic } from '../auth/serialize.js';
import { tenantScope } from '../auth/tenant.js';

export interface AccountRoutesDeps {
  prisma: PrismaClient;
}

/**
 * Account-routes (T1.2, DESIGN §2, §9.4). Representatief tenant-gebonden, rol-beperkt
 * endpoint dat de autorisatie-middleware en tenant-isolatie in de praktijk toont:
 *
 * `GET /admin/accounts` — alleen voor ADMIN; lijst van logins **binnen de eigen organisatie**.
 * De query wordt via `tenantScope(account)` op `organizationId` gefilterd, dus een beheerder
 * ziet nooit accounts van een andere organisatie.
 */
export function registerAccountRoutes(app: FastifyInstance, { prisma }: AccountRoutesDeps): void {
  app.get(
    '/admin/accounts',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AccountListResponse> => {
      const account = requireAccount(request);
      const accounts = await prisma.account.findMany({
        where: { ...tenantScope(account) },
        orderBy: { createdAt: 'asc' },
      });
      return accountListResponseSchema.parse({ accounts: accounts.map(toPublic) });
    },
  );
}
