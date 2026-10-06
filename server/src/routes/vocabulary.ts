import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attributionListResponseSchema,
  type AttributionListResponse,
  vocabularyListQuerySchema,
  vocabularyListResponseSchema,
  vocabularyUpdateRequestSchema,
  type VocabularyItemPublic,
  type VocabularyListResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { resolveCallerOrganization } from '../auth/account-or-device.js';
import type { AccountModel, VocabularyItemModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import { availableTo, buildSearchText, parseVocabularyItem } from '../vocabulary/repository.js';
import { vocabularyItemToPublic } from '../vocabulary/serialize.js';

const idParamsSchema = z.object({ id: z.string().min(1).max(200) });

/**
 * Mag dit account dit item beheren? Een item van de eigen organisatie: ja. Een platformitem (de
 * startset): alleen een beheerder van de platformorganisatie. Een item van een andere organisatie of een
 * onbekend id: 403 zonder te verraden welke van de twee (IDOR-mitigatie, ADR-0005).
 */
export async function loadManageableItem(
  prisma: PrismaClient,
  account: AccountModel,
  id: string,
): Promise<VocabularyItemModel> {
  const item = await prisma.vocabularyItem.findUnique({ where: { id } });
  if (item && item.organizationId === account.organizationId) return item;
  if (item && item.organizationId === null) {
    const org = await prisma.organization.findUnique({
      where: { id: account.organizationId },
      select: { isPlatform: true },
    });
    if (org?.isPlatform) return item;
    throw new HttpError(
      403,
      'PLATFORM_ITEM',
      'Dit symbool hoort bij de startset van het platform; alleen de platformbeheerder kan het wijzigen.',
    );
  }
  throw new HttpError(403, 'FORBIDDEN', 'Je hebt geen toegang tot dit symbool.');
}

/** Vraagt deze licentie om naamsvermelding? Alle CC BY-varianten wel; CC0 en eigen afbeeldingen niet. */
export function requiresAttribution(licenseKey: string): boolean {
  return /^CC-BY(?:-|$)/i.test(licenseKey);
}

function linkOrNull(value: string | null): string | null {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

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
 *
 * `PATCH /vocabulary/:id` — labels, concepten, contexten, startconcept en volgorde bewerken. Alleen de
 * beheerder, alleen items van de eigen organisatie; platformitems alleen de platformbeheerder. Een
 * gewijzigd label is daarmee nagekeken (`labelStatus: reviewed`). Geaudit.
 *
 * `GET /vocabulary/attributions` — de bronvermelding: per bron (naam, licentie, maker) de symbolen die
 * deze organisatie gebruikt. Voor iedereen binnen de organisatie, ook de tablet.
 *
 * `POST /vocabulary/:id/retire` en `…/restore` — intrekken en terugzetten, met dezelfde rechten. Een
 * item wordt nooit verwijderd: de provenance kan ernaar verwijzen. Ingetrokken gaat het niet meer naar
 * de agentdienst (`listAvailableVocabulary` neemt alleen `approved`). Geaudit.
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

  app.patch(
    '/vocabulary/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<VocabularyItemPublic> => {
      const account = requireAccount(request);
      const { id } = idParamsSchema.parse(request.params);
      const body = vocabularyUpdateRequestSchema.parse(request.body);
      const current = parseVocabularyItem(await loadManageableItem(prisma, account, id));

      const labels = body.labels ?? current.labels;
      const concepts = body.concepts ?? current.concepts;
      const updated = await prisma.vocabularyItem.update({
        where: { id },
        data: {
          ...(body.labels ? { labels: body.labels, labelStatus: 'reviewed' } : {}),
          ...(body.concepts ? { concepts: body.concepts } : {}),
          ...(body.contexts ? { contexts: body.contexts } : {}),
          ...(body.isStart !== undefined ? { isStart: body.isStart } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          searchText: buildSearchText(labels, concepts),
        },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.VOCABULARY_UPDATE,
        targetType: 'vocabularyItem',
        targetId: id,
        metadata: {
          fields: Object.keys(body),
          scope: current.organizationId ? 'organization' : 'platform',
        },
      });
      return vocabularyItemToPublic(parseVocabularyItem(updated), env);
    },
  );

  for (const [action, status] of [
    ['retire', 'retired'],
    ['restore', 'approved'],
  ] as const) {
    app.post(
      `/vocabulary/:id/${action}`,
      { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
      async (request): Promise<VocabularyItemPublic> => {
        const account = requireAccount(request);
        const { id } = idParamsSchema.parse(request.params);
        const current = await loadManageableItem(prisma, account, id);
        const updated =
          current.status === status
            ? current
            : await prisma.vocabularyItem.update({ where: { id }, data: { status } });
        await recordAudit(prisma, request, {
          action:
            action === 'retire'
              ? AUDIT_ACTIONS.VOCABULARY_RETIRE
              : AUDIT_ACTIONS.VOCABULARY_RESTORE,
          targetType: 'vocabularyItem',
          targetId: id,
          metadata: { scope: current.organizationId ? 'organization' : 'platform' },
        });
        return vocabularyItemToPublic(parseVocabularyItem(updated), env);
      },
    );
  }

  app.get('/vocabulary/attributions', async (request): Promise<AttributionListResponse> => {
    const organizationId = await resolveCallerOrganization(prisma, request);
    const rows = await prisma.vocabularyItem.findMany({
      where: { status: 'approved', ...availableTo(organizationId) },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const groups = new Map<string, AttributionListResponse['sources'][number]>();
    for (const row of rows) {
      const item = parseVocabularyItem(row);
      const sourceName =
        item.source === 'own' ? 'Eigen afbeeldingen' : (item.sourceName ?? 'Onbekende bron');
      const key = `${sourceName}|${item.licenseKey}|${item.author ?? ''}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          sourceName,
          sourceUrl: linkOrNull(item.sourceUrl),
          licenseKey: item.licenseKey,
          licenseUrl: linkOrNull(item.licenseUrl),
          author: item.author,
          authorUrl: linkOrNull(item.authorUrl),
          requiresAttribution: requiresAttribution(item.licenseKey),
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push({ id: item.id, label: item.labels[0] ?? item.id });
    }
    return attributionListResponseSchema.parse({ sources: [...groups.values()] });
  });
}
