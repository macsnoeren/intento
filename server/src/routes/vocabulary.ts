import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  attributionListResponseSchema,
  type AttributionListResponse,
  vocabularyListQuerySchema,
  vocabularyListResponseSchema,
  vocabularyUpdateRequestSchema,
  vocabularyUploadFieldsSchema,
  externalImportRequestSchema,
  externalSearchQuerySchema,
  externalSearchResponseSchema,
  type ExternalSearchResponse,
  type VocabularyItemPublic,
  type VocabularyListResponse,
} from '@intento/shared';
import type { Env } from '../env.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { authorize, requireAccount } from '../auth/authorize.js';
import { resolveCallerOrganization } from '../auth/account-or-device.js';
import type { AccountModel, VocabularyItemModel } from '../generated/prisma/models.js';
import { HttpError } from '../errors.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';
import {
  availableTo,
  exactLabelWhere,
  parseVocabularyItem,
  searchFields,
  searchWhere,
} from '../vocabulary/repository.js';
import { vocabularyItemToPublic } from '../vocabulary/serialize.js';
import { checkImage } from '../vocabulary/image-check.js';
import { writeStoredFile } from '../storage/files.js';
import { assertSafeImageUrl, type OpenSymbolsClient } from '../vocabulary/opensymbols.js';
import { isLicenseAllowed, normalizeLicense } from '../vocabulary/licenses.js';

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
  openSymbols: OpenSymbolsClient;
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
 * `GET /vocabulary/external/search?q=` — zoeken in OpenSymbols, met per resultaat de licentiesleutel en
 *   of die toegestaan is. Alleen de beheerder.
 * `POST /vocabulary/import` — een extern symbool overnemen: licentie en afbeelding opnieuw bij de bron
 *   opgehaald, alleen een toegestane licentie, https van een bekende host, groottelimiet, typecontrole.
 * `POST /vocabulary/upload` — eigen afbeelding + woord (multipart; alleen PNG/JPEG/WebP op inhoud,
 *   groottelimiet, verplicht vinkje voor de rechten, licentie `own`). Alleen de beheerder. Geaudit.
 * `POST /vocabulary/:id/retire` en `…/restore` — intrekken en terugzetten, met dezelfde rechten. Een
 * item wordt nooit verwijderd: de provenance kan ernaar verwijzen. Ingetrokken gaat het niet meer naar
 * de agentdienst (`listAvailableVocabulary` neemt alleen `approved`). Geaudit.
 */
/** Hooguit zoveel resultaten uit een externe bron per zoekopdracht. */
const MAX_EXTERNAL_RESULTS = 50;

export function registerVocabularyRoutes(
  app: FastifyInstance,
  { env, prisma, openSymbols }: VocabularyRoutesDeps,
): void {
  const orderBy = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];

  /**
   * Eén pagina, met bij een zoekterm de exacte labeltreffers vooraan (N2.15): wie "oma" zoekt, wil het
   * symbool "oma" zien vóór "aroma". De pagina's lopen over beide groepen heen door.
   */
  async function listPage(
    where: Prisma.VocabularyItemWhereInput,
    q: string | undefined,
    page: number,
    pageSize: number,
  ) {
    const skip = (page - 1) * pageSize;
    if (!q) return prisma.vocabularyItem.findMany({ where, orderBy, skip, take: pageSize });
    const exact = { AND: [where, exactLabelWhere(q)] };
    const exactCount = await prisma.vocabularyItem.count({ where: exact });
    const first =
      skip < exactCount
        ? await prisma.vocabularyItem.findMany({ where: exact, orderBy, skip, take: pageSize })
        : [];
    const rest =
      first.length < pageSize
        ? await prisma.vocabularyItem.findMany({
            where: { AND: [where, { NOT: exactLabelWhere(q) }] },
            orderBy,
            skip: Math.max(0, skip - exactCount),
            take: pageSize - first.length,
          })
        : [];
    return [...first, ...rest];
  }

  app.get(
    '/vocabulary',
    { preHandler: authorize(prisma, { roles: ['ADMIN', 'CAREGIVER'] }) },
    async (request): Promise<VocabularyListResponse> => {
      const { organizationId } = requireAccount(request);
      const query = vocabularyListQuerySchema.parse(request.query);
      // Nakijken (N8.8) gaat over wat deze organisatie mag wijzigen: de eigen items, en de startset
      // alleen voor de platformorganisatie. Anders ziet elke organisatie duizenden open
      // machinevertalingen waar ze niets mee kan.
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { isPlatform: true },
      });
      const reviewable = org?.isPlatform ? availableTo(organizationId) : { organizationId };
      const where = {
        ...(query.labelStatus === 'machine' ? reviewable : availableTo(organizationId)),
        status: query.status,
        ...(query.labelStatus ? { labelStatus: query.labelStatus } : {}),
        ...(query.q ? searchWhere(query.q) : {}),
      };
      const [total, rows, machineOpen] = await Promise.all([
        prisma.vocabularyItem.count({ where }),
        listPage(where, query.q, query.page, query.pageSize),
        prisma.vocabularyItem.count({
          where: { ...reviewable, status: 'approved', labelStatus: 'machine' },
        }),
      ]);
      const now = new Date();
      return vocabularyListResponseSchema.parse({
        items: rows.map((row) => vocabularyItemToPublic(parseVocabularyItem(row), env, now)),
        total,
        page: query.page,
        pageSize: query.pageSize,
        machineOpen,
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
          // Een gewijzigd label, of "Klopt" (N8.8): dan is de vertaling door een mens nagekeken.
          ...(body.labels || body.labelStatus ? { labelStatus: 'reviewed' } : {}),
          ...(body.labels ? { labels: body.labels } : {}),
          ...(body.concepts ? { concepts: body.concepts } : {}),
          ...(body.contexts ? { contexts: body.contexts } : {}),
          ...(body.isStart !== undefined ? { isStart: body.isStart } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...searchFields(labels, concepts),
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

  // Eigen afbeelding + woord (N8.1, §15, §53). Alleen de beheerder, alleen voor de eigen organisatie.
  app.post(
    '/vocabulary/upload',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply) => {
      const account = requireAccount(request);
      const fields: Record<string, string> = {};
      let bytes: Buffer | null = null;
      let truncated = false;
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || bytes) {
            await part.toBuffer().catch(() => undefined);
            throw new HttpError(
              400,
              'INVALID_UPLOAD',
              'Stuur precies één bestand in het veld "file".',
            );
          }
          bytes = await part.toBuffer();
          truncated = part.file.truncated;
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
      const meta = vocabularyUploadFieldsSchema.parse(fields);
      if (!bytes) throw new HttpError(400, 'INVALID_UPLOAD', 'Er is geen afbeelding meegestuurd.');
      if (truncated || bytes.byteLength > env.UPLOAD_MAX_BYTES) {
        throw new HttpError(
          413,
          'IMAGE_TOO_LARGE',
          `De afbeelding is groter dan ${Math.round(env.UPLOAD_MAX_BYTES / 1024)} kB.`,
        );
      }
      // De inhoud telt, niet de bestandsnaam of het opgegeven type (§53). Eigen uploads: geen SVG.
      const checked = checkImage(bytes, { maxBytes: env.UPLOAD_MAX_BYTES, allowSvg: false });
      if (!checked.ok) {
        throw new HttpError(415, 'UNSUPPORTED_IMAGE', 'Alleen PNG, JPEG of WebP.');
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const assetPath = `own/${account.organizationId}/${sha256}.${checked.extension}`;
      await writeStoredFile(env.STORAGE_DIR, assetPath, bytes);

      const labels = [meta.label, ...(meta.synonyms ?? [])];
      const unique = labels.filter(
        (label, index) =>
          labels.findIndex((l) => l.toLowerCase() === label.toLowerCase()) === index,
      );
      const now = new Date();
      const created = await prisma.vocabularyItem.create({
        data: {
          organizationId: account.organizationId,
          labels: unique,
          concepts: meta.concepts,
          contexts: meta.contexts?.length ? meta.contexts : ['other'],
          ...searchFields(unique, meta.concepts),
          status: 'approved',
          labelStatus: 'reviewed',
          source: 'own',
          // Licentie `own`: de beheerder bevestigde dat de organisatie de afbeelding mag gebruiken.
          licenseKey: 'own',
          author: account.name,
          importedAt: now,
          assetPath,
          mimeType: checked.mimeType,
          sha256,
          bytes: bytes.byteLength,
          createdById: account.id,
        },
      });

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.VOCABULARY_UPLOAD,
        targetType: 'vocabularyItem',
        targetId: created.id,
        metadata: { mimeType: checked.mimeType, bytes: bytes.byteLength, sha256 },
      });
      return reply.status(201).send(vocabularyItemToPublic(parseVocabularyItem(created), env, now));
    },
  );

  // Zoeken in een externe bron (N8.4, §15): de backend praat namens de beheer-UI met OpenSymbols.
  app.get(
    '/vocabulary/external/search',
    {
      preHandler: authorize(prisma, { roles: ['ADMIN'] }),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request): Promise<ExternalSearchResponse> => {
      const { q } = externalSearchQuerySchema.parse(request.query);
      if (!openSymbols.isConfigured()) {
        throw new HttpError(
          503,
          'EXTERNAL_SOURCE_UNAVAILABLE',
          'Zoeken in een externe bron is niet ingesteld (OPENSYMBOLS_SECRET).',
        );
      }
      let found;
      try {
        found = await openSymbols.search(q, 'nl');
      } catch (error) {
        request.log.warn({ err: error }, 'Zoeken in OpenSymbols mislukte');
        throw new HttpError(502, 'EXTERNAL_SEARCH_FAILED', 'De externe bron gaf geen antwoord.');
      }
      return externalSearchResponseSchema.parse({
        results: found.slice(0, MAX_EXTERNAL_RESULTS).map((result) => {
          const license = normalizeLicense(result.license, result.licenseUrl);
          return {
            ...result,
            licenseKey: license.key,
            allowed: isLicenseAllowed(license, env.VOCABULARY_ALLOWED_LICENSES),
          };
        }),
      });
    },
  );

  // Een extern symbool importeren (N8.5, §15, §53).
  app.post(
    '/vocabulary/import',
    {
      preHandler: authorize(prisma, { roles: ['ADMIN'] }),
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const account = requireAccount(request);
      const body = externalImportRequestSchema.parse(request.body);
      if (!openSymbols.isConfigured()) {
        throw new HttpError(
          503,
          'EXTERNAL_SOURCE_UNAVAILABLE',
          'Importeren uit een externe bron is niet ingesteld (OPENSYMBOLS_SECRET).',
        );
      }
      // Licentie, auteur en afbeelding komen van de bron zelf, nooit van de client.
      let found;
      try {
        found = await openSymbols.search(body.query, 'nl');
      } catch (error) {
        request.log.warn({ err: error }, 'Zoeken in OpenSymbols mislukte');
        throw new HttpError(502, 'EXTERNAL_SEARCH_FAILED', 'De externe bron gaf geen antwoord.');
      }
      const symbol = found.find((result) => result.id === body.id);
      if (!symbol) {
        throw new HttpError(
          404,
          'EXTERNAL_SYMBOL_NOT_FOUND',
          'Dat symbool staat niet (meer) bij de bron.',
        );
      }
      const license = normalizeLicense(symbol.license, symbol.licenseUrl);
      if (!isLicenseAllowed(license, env.VOCABULARY_ALLOWED_LICENSES)) {
        throw new HttpError(
          422,
          'LICENSE_NOT_ALLOWED',
          `De licentie (${symbol.license}) staat niet op de lijst van toegestane licenties.`,
        );
      }
      const url = assertSafeImageUrl(symbol.imageUrl);
      if (!env.VOCABULARY_IMAGE_HOSTS.includes(url.hostname.toLowerCase())) {
        throw new HttpError(
          422,
          'IMAGE_HOST_NOT_ALLOWED',
          'De afbeelding staat op een onbekende host.',
        );
      }
      const sourceRef = `${account.organizationId}/${symbol.id}`;
      const existing = await prisma.vocabularyItem.findUnique({
        where: { sourceName_sourceRef: { sourceName: 'OpenSymbols', sourceRef } },
      });
      if (existing) {
        throw new HttpError(409, 'ALREADY_IMPORTED', 'Dit symbool is al geïmporteerd.');
      }

      let bytes: Uint8Array;
      try {
        bytes = (await openSymbols.fetchImage(url.toString())).bytes;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 413) {
          throw new HttpError(422, 'IMAGE_TOO_LARGE', error.message);
        }
        request.log.warn({ err: error }, 'Afbeelding ophalen mislukte');
        throw new HttpError(
          502,
          'EXTERNAL_IMAGE_FAILED',
          'De afbeelding kon niet worden opgehaald.',
        );
      }
      if (bytes.byteLength > env.UPLOAD_MAX_BYTES) {
        throw new HttpError(422, 'IMAGE_TOO_LARGE', 'De afbeelding is te groot.');
      }
      // Ook hier telt de inhoud; een externe import is nooit SVG (§53, V8).
      const checked = checkImage(bytes, { maxBytes: env.UPLOAD_MAX_BYTES, allowSvg: false });
      if (!checked.ok) {
        throw new HttpError(422, 'UNSUPPORTED_IMAGE', 'Alleen PNG, JPEG of WebP.');
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const assetPath = `external/${account.organizationId}/${sha256}.${checked.extension}`;
      await writeStoredFile(env.STORAGE_DIR, assetPath, bytes);
      const labels = [body.label, ...(body.synonyms ?? [])].filter(
        (label, index, list) =>
          list.findIndex((l) => l.toLowerCase() === label.toLowerCase()) === index,
      );
      const now = new Date();
      const created = await prisma.vocabularyItem.create({
        data: {
          organizationId: account.organizationId,
          labels,
          concepts: body.concepts,
          contexts: body.contexts?.length ? body.contexts : ['other'],
          ...searchFields(labels, body.concepts),
          status: 'approved',
          labelStatus: 'reviewed',
          source: 'external',
          licenseKey: license.key,
          licenseUrl: symbol.licenseUrl,
          author: symbol.author,
          authorUrl: symbol.authorUrl,
          sourceName: 'OpenSymbols',
          sourceUrl: symbol.sourceUrl,
          sourceRef,
          importedAt: now,
          assetPath,
          mimeType: checked.mimeType,
          sha256,
          bytes: bytes.byteLength,
          createdById: account.id,
        },
      });
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.VOCABULARY_IMPORT,
        targetType: 'vocabularyItem',
        targetId: created.id,
        metadata: { externalId: symbol.id, licenseKey: license.key, sha256 },
      });
      return reply.status(201).send(vocabularyItemToPublic(parseVocabularyItem(created), env, now));
    },
  );

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
