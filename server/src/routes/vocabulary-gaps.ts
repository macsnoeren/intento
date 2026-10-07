import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  vocabularyGapListQuerySchema,
  vocabularyGapListResponseSchema,
  vocabularyGapPublicSchema,
  type VocabularyGapListResponse,
  type VocabularyGapPublic,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { signedAssetUrl } from '../vocabulary/assets.js';

/**
 * Ontbrekende woorden voor de beheerder (N9.2, INTENTO-NEW-DESIGN §17, §49).
 *
 * `GET /vocabulary/gaps?status=` — de woorden van de eigen organisatie (standaard `open`), vaakst en
 *   laatst eerst, met het pictogram dat de gebruiker in plaats ervan zag; plus het aantal open woorden.
 * `POST /vocabulary/gaps/:id/resolve` — opgelost (na "Woord toevoegen").
 * `POST /vocabulary/gaps/:id/dismiss` — negeren.
 * `POST /vocabulary/gaps/:id/reopen` — een genegeerd of opgelost woord weer openzetten.
 *
 * Alleen de beheerder, alleen de eigen organisatie: een woord van een andere organisatie of een onbekend
 * id geeft 403 zonder te verraden welke van de twee (IDOR-mitigatie, ADR-0005). Geaudit, zonder het
 * woord zelf.
 */

/** Hooguit zoveel woorden per lijst; de beheerder werkt van boven (vaakst) naar beneden. */
const MAX_GAPS = 200;

const idParamsSchema = z.object({ id: z.string().min(1).max(200) });
const labelsSchema = z.array(z.string());

const gapInclude = {
  bestAvailableItem: { select: { id: true, labels: true, status: true, assetPath: true } },
} satisfies Prisma.VocabularyGapInclude;
type GapRow = Prisma.VocabularyGapGetPayload<{ include: typeof gapInclude }>;

function gapToPublic(
  gap: GapRow,
  env: Pick<Env, 'ASSET_URL_SECRET' | 'ASSET_URL_TTL_SECONDS'>,
  now: Date,
): VocabularyGapPublic {
  const item = gap.bestAvailableItem;
  return vocabularyGapPublicSchema.parse({
    id: gap.id,
    concept: gap.conceptKey,
    label: gap.label,
    context: gap.context,
    occurrences: gap.occurrences,
    firstSeenAt: gap.firstSeenAt.toISOString(),
    lastSeenAt: gap.lastSeenAt.toISOString(),
    status: gap.status,
    bestAvailable: item
      ? {
          id: item.id,
          label: labelsSchema.parse(item.labels)[0] ?? item.id,
          imageUrl:
            item.status === 'approved' && item.assetPath ? signedAssetUrl(env, item, now) : null,
        }
      : null,
  });
}

const ACTIONS = [
  ['resolve', 'resolved', AUDIT_ACTIONS.VOCABULARY_GAP_RESOLVE],
  ['dismiss', 'dismissed', AUDIT_ACTIONS.VOCABULARY_GAP_DISMISS],
  ['reopen', 'open', AUDIT_ACTIONS.VOCABULARY_GAP_REOPEN],
] as const;

export function registerVocabularyGapRoutes(
  app: FastifyInstance,
  { env, prisma }: { env: Env; prisma: PrismaClient },
): void {
  app.get(
    '/vocabulary/gaps',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<VocabularyGapListResponse> => {
      const { organizationId } = requireAccount(request);
      const query = vocabularyGapListQuerySchema.parse(request.query);
      const [rows, open] = await Promise.all([
        prisma.vocabularyGap.findMany({
          where: { organizationId, status: query.status },
          include: gapInclude,
          orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }, { id: 'asc' }],
          take: MAX_GAPS,
        }),
        prisma.vocabularyGap.count({ where: { organizationId, status: 'open' } }),
      ]);
      const now = new Date();
      return vocabularyGapListResponseSchema.parse({
        items: rows.map((row) => gapToPublic(row, env, now)),
        open,
      });
    },
  );

  for (const [action, status, auditAction] of ACTIONS) {
    app.post(
      `/vocabulary/gaps/:id/${action}`,
      { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
      async (request): Promise<VocabularyGapPublic> => {
        const { organizationId } = requireAccount(request);
        const { id } = idParamsSchema.parse(request.params);
        const current = await prisma.vocabularyGap.findUnique({ where: { id } });
        if (current?.organizationId !== organizationId) {
          throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot dit woord.');
        }
        const updated = await prisma.vocabularyGap.update({
          where: { id },
          data: { status },
          include: gapInclude,
        });
        await recordAudit(prisma, request, {
          action: auditAction,
          targetType: 'vocabularyGap',
          targetId: id,
        });
        return gapToPublic(updated, env, new Date());
      },
    );
  }
}
