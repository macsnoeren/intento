import type { FastifyInstance } from 'fastify';
import {
  vocabularyListQuerySchema,
  vocabularyListResponseSchema,
  type VocabularyListResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { availableTo, parseVocabularyItem } from '../vocabulary/repository.js';
import { vocabularyItemToPublic } from '../vocabulary/serialize.js';

export interface VocabularyRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

/**
 * Vocabulary in de beheeromgeving (INTENTO-NEW-DESIGN §15, §49).
 *
 * `GET /vocabulary` — de items die voor de eigen organisatie beschikbaar zijn (platform + eigen),
 * gepagineerd en doorzoekbaar, met ondertekende afbeeldings-URL's. Lezen mag de beheerder én de
 * begeleider; een tablet (apparaatsessie) niet. Ingetrokken items alleen met `status=retired`.
 */
export function registerVocabularyRoutes(
  app: FastifyInstance,
  { env, prisma }: VocabularyRoutesDeps,
): void {
  app.get(
    '/vocabulary',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<VocabularyListResponse> => {
      const { organizationId } = requireAccount(request);
      const query = vocabularyListQuerySchema.parse(request.query);
      const where = {
        ...availableTo(organizationId),
        status: query.status,
        ...(query.labelStatus ? { labelStatus: query.labelStatus } : {}),
        ...(query.q ? { searchText: { contains: query.q.toLowerCase() } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.vocabularyItem.count({ where }),
        prisma.vocabularyItem.findMany({
          where,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      const now = new Date();
      return vocabularyListResponseSchema.parse({
        items: rows.map((row) => vocabularyItemToPublic(parseVocabularyItem(row), env, now)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      });
    },
  );
}
