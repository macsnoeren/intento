import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  aacSearchQuerySchema,
  aacSearchResponseSchema,
  aiConceptReviewListResponseSchema,
  mergeAiConceptRequestSchema,
  aacTopicListResponseSchema,
  aacSymbolInputSchema,
  aacSymbolListResponseSchema,
  aacRelationInputSchema,
  attachOpenSymbolsRequestSchema,
  openSymbolsSearchQuerySchema,
  openSymbolsSearchResponseSchema,
  type AacSearchResponse,
  type AacSymbolAdmin,
  type AacTopicListResponse,
  type AacSymbolListResponse,
  type AiConceptReviewListResponse,
  type OpenSymbolsSearchResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';
import { HttpError } from '../errors.js';
import { authorize } from '../auth/authorize.js';
import { authorizeAccountOrDevice } from '../auth/account-or-device.js';
import {
  adminSymbolInclude,
  buildSearchText,
  normalizeSearch,
  renderSymbolSvg,
  symbolToAdmin,
  symbolToPublic,
} from '../aac/library.js';
import { assertSafeImageUrl, type OpenSymbolsClient } from '../aac/opensymbols.js';
import { recordAudit } from '../audit/audit.js';
import { AUDIT_ACTIONS } from '../audit/actions.js';

export interface AacRoutesDeps {
  prisma: PrismaClient;
  env: Env;
  /** OpenSymbols-proxy (T3.3); injecteerbaar zodat tests een mock zonder netwerk kunnen meegeven. */
  openSymbols: OpenSymbolsClient;
}

/** Route-parameter: het symbool-id uit het pad (met `.svg`-suffix afgekapt in de handler). */
const imageParamsSchema = z.object({ file: z.string().min(1) });

/** Route-parameters met een id (symbool of relatie). */
const idParamsSchema = z.object({ id: z.string().min(1) });

/** Optionele filters op de beheerslijst: vrije zoekterm en/of categorie. */
const adminListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(32).optional(),
});

/**
 * Toegestane afbeeldingstypes bij upload (T3.2). Bewust **alleen raster** — geen SVG: die kan
 * script bevatten en zou als geserveerde `<img>`/inline een XSS-risico zijn. Zo blijft de upload
 * onschuldige presentatiedata.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Haalt één symbool met relaties op en serialiseert het naar de beheerweergave (of 404). */
async function loadAdminSymbol(prisma: PrismaClient, id: string): Promise<AacSymbolAdmin> {
  const symbol = await prisma.aacSymbol.findUnique({ where: { id }, include: adminSymbolInclude });
  if (!symbol) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');
  return symbolToAdmin(symbol);
}

/**
 * AAC-bibliotheek: zoeken/serveren (T3.1) en beheren (T3.2, DESIGN §5.2, §6.2, §8.2, FR-015).
 *
 * Publiek/geauthenticeerd:
 * - `GET /aac/search?q=…` — zoekt hoofdletterongevoelig op concept, label én synoniemen.
 * - `GET /aac/images/:id` — levert het pictogram: de geüploade afbeelding als die er is, anders een
 *   server-gerenderde SVG-placeholder uit de glyph. Bewust publiek: niet-gevoelige presentatiedata.
 *
 * Beheer (ADMIN — de AAC-bibliotheek is een beheerderstaak, DESIGN §2, en **platformbreed gedeeld**,
 * dus niet tenant-gefilterd; rolcontrole volstaat):
 * - `GET /admin/aac/symbols` — alle symbolen met relaties (optioneel gefilterd op `q`/`category`).
 * - `POST /admin/aac/symbols` — symbool aanmaken (uniek concept, anders 409).
 * - `PUT /admin/aac/symbols/:id` — symbool bewerken (concept-botsing → 409).
 * - `DELETE /admin/aac/symbols/:id` — symbool verwijderen (relaties casceren mee).
 * - `POST /admin/aac/symbols/:id/image` — pictogram uploaden (multipart; mime-allowlist + limiet).
 * - `GET /aac/topics` — onderwerpen met antwoordopties (voor de vraagmodus, T9.7).
 * - `POST /admin/aac/relations` — relatie ouder→kind leggen (geen zelfrelatie; dubbel → 409).
 * - `DELETE /admin/aac/relations/:id` — relatie verwijderen.
 * - `GET /admin/aac/opensymbols/search?q=…` — proxy naar OpenSymbols (T3.3); gesaneerde resultaten.
 * - `POST /admin/aac/symbols/:id/opensymbols` — gekozen OpenSymbols-afbeelding lokaal koppelen.
 */
export function registerAacRoutes(
  app: FastifyInstance,
  { prisma, env, openSymbols }: AacRoutesDeps,
): void {
  // Zoeken — ingelogd account of gekoppeld apparaat.
  app.get(
    '/aac/search',
    { preHandler: authorizeAccountOrDevice(prisma) },
    async (request): Promise<AacSearchResponse> => {
      const { q } = aacSearchQuerySchema.parse(request.query);
      const symbols = await prisma.aacSymbol.findMany({
        where: { searchText: { contains: normalizeSearch(q) } },
        orderBy: { label: 'asc' },
      });
      return aacSearchResponseSchema.parse({ symbols: symbols.map(symbolToPublic) });
    },
  );

  // Onderwerpen met antwoordopties (T9.7) — ingelogd account of gekoppeld apparaat. Dit zijn precies de
  // symbolen die minstens één kind hebben in de relatieboom: alleen die kunnen als **anker** van een
  // begeleidersvraag dienen, want de kinderen vormen de antwoordopties (`POST /question/start` weigert
  // een anker zonder kinderen met `ANCHOR_WITHOUT_OPTIONS`). De begeleiderinterface vult er haar
  // onderwerp-keuzelijst mee, zodat de verstuurknop niet langer grijs blijft zonder aanwijsbare reden.
  app.get(
    '/aac/topics',
    { preHandler: authorizeAccountOrDevice(prisma) },
    async (): Promise<AacTopicListResponse> => {
      const parents = await prisma.aacConceptRelation.findMany({
        distinct: ['parentId'],
        include: { parent: true },
        orderBy: { parent: { label: 'asc' } },
      });
      return aacTopicListResponseSchema.parse({
        topics: parents.map((relation) => symbolToPublic(relation.parent)),
      });
    },
  );

  // Pictogram serveren — publiek (niet-gevoelige presentatiedata, geladen als <img src>).
  app.get('/aac/images/:file', async (request, reply) => {
    const { file } = imageParamsSchema.parse(request.params);
    const id = file.endsWith('.svg') ? file.slice(0, -'.svg'.length) : file;

    const symbol = await prisma.aacSymbol.findUnique({
      where: { id },
      select: { glyph: true, label: true, imageData: true, imageMimeType: true },
    });
    if (!symbol) {
      throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');
    }

    // Alleen deze route mag cross-origin geladen worden (T8.7). Helmet zet globaal
    // `Cross-Origin-Resource-Policy: same-origin`; de web-client draait op een andere origin dan de
    // API (Vite op :5173 vs. API op :3000) en laadt pictogrammen als `<img src>` — een no-cors
    // resource-load, waar CORS-headers niets aan doen en CORP wél: de browser gooit het plaatje weg
    // en de gebruiker ziet lege vakjes. Bewust route-scoped versoepeld: pictogrammen zijn publieke,
    // niet-persoonlijke presentatiedata; elke andere route houdt `same-origin`.
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');

    // Geüploade afbeelding heeft voorrang; anders de glyph-placeholder als SVG.
    if (symbol.imageData && symbol.imageMimeType) {
      reply
        .header('Content-Type', symbol.imageMimeType)
        .header('Cache-Control', 'public, max-age=86400');
      return reply.send(Buffer.from(symbol.imageData));
    }

    reply
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400');
    return renderSymbolSvg(symbol);
  });

  // --- Beheer (ADMIN) ---

  // Lijst — alle symbolen met relaties, optioneel gefilterd op zoekterm/categorie.
  app.get(
    '/admin/aac/symbols',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolListResponse> => {
      const { q, category } = adminListQuerySchema.parse(request.query);
      const symbols = await prisma.aacSymbol.findMany({
        where: {
          ...(q ? { searchText: { contains: normalizeSearch(q) } } : {}),
          ...(category ? { category } : {}),
        },
        include: adminSymbolInclude,
        orderBy: [{ category: 'asc' }, { label: 'asc' }],
      });
      return aacSymbolListResponseSchema.parse({ symbols: symbols.map(symbolToAdmin) });
    },
  );

  // Aanmaken — uniek concept (anders 409).
  app.post(
    '/admin/aac/symbols',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<AacSymbolAdmin> => {
      const input = aacSymbolInputSchema.parse(request.body);

      const existing = await prisma.aacSymbol.findUnique({ where: { concept: input.concept } });
      if (existing) {
        throw new HttpError(409, 'CONCEPT_EXISTS', `Concept "${input.concept}" bestaat al.`);
      }

      const created = await prisma.aacSymbol.create({
        data: {
          concept: input.concept,
          label: input.label,
          category: input.category,
          glyph: input.glyph,
          synonyms: input.synonyms,
          searchText: buildSearchText(input),
        },
        include: adminSymbolInclude,
      });
      reply.status(201);
      return symbolToAdmin(created);
    },
  );

  // Bewerken — concept-botsing met een ander symbool → 409.
  app.put(
    '/admin/aac/symbols/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolAdmin> => {
      const { id } = idParamsSchema.parse(request.params);
      const input = aacSymbolInputSchema.parse(request.body);

      const existing = await prisma.aacSymbol.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');

      const clash = await prisma.aacSymbol.findUnique({ where: { concept: input.concept } });
      if (clash && clash.id !== id) {
        throw new HttpError(409, 'CONCEPT_EXISTS', `Concept "${input.concept}" bestaat al.`);
      }

      const updated = await prisma.aacSymbol.update({
        where: { id },
        data: {
          concept: input.concept,
          label: input.label,
          category: input.category,
          glyph: input.glyph,
          synonyms: input.synonyms,
          searchText: buildSearchText(input),
        },
        include: adminSymbolInclude,
      });
      return symbolToAdmin(updated);
    },
  );

  // Verwijderen — relaties casceren mee (onDelete: Cascade).
  app.delete(
    '/admin/aac/symbols/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<void> => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = await prisma.aacSymbol.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');
      await prisma.aacSymbol.delete({ where: { id } });
      reply.status(204).send();
    },
  );

  // Pictogram uploaden — multipart. Mime-allowlist + groottelimiet (env). Vervangt de placeholder.
  app.post(
    '/admin/aac/symbols/:id/image',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolAdmin> => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = await prisma.aacSymbol.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');

      const file = await request.file();
      if (!file) {
        throw new HttpError(400, 'NO_FILE', 'Geen bestand ontvangen.');
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
        throw new HttpError(
          415,
          'UNSUPPORTED_IMAGE_TYPE',
          'Alleen PNG-, JPEG- of WebP-afbeeldingen zijn toegestaan.',
        );
      }

      // De multipart-plugin kapt bij de ingestelde limiet af en markeert de stream als truncated;
      // dan weigeren we in plaats van een half bestand op te slaan.
      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        throw new HttpError(
          413,
          'IMAGE_TOO_LARGE',
          `Afbeelding is te groot (max ${env.AAC_IMAGE_MAX_BYTES} bytes).`,
        );
      }

      const updated = await prisma.aacSymbol.update({
        where: { id },
        data: {
          // Prisma's Bytes verwacht een Uint8Array met een gewone ArrayBuffer-backing;
          // kopieer de Buffer daarheen (Buffer kan SharedArrayBuffer-backed zijn).
          imageData: new Uint8Array(buffer),
          imageMimeType: file.mimetype,
          imageVersion: { increment: 1 },
          // Een zelf-geüploade afbeelding heeft geen externe bron; wis eventuele oude attributie
          // zodat er geen onjuiste licentie/bron blijft hangen (bv. na een eerdere OpenSymbols-koppeling).
          imageLicense: null,
          imageLicenseUrl: null,
          imageAuthor: null,
          imageAuthorUrl: null,
          imageSourceUrl: null,
        },
        include: adminSymbolInclude,
      });
      return symbolToAdmin(updated);
    },
  );

  // Relatie leggen — ouder→kind. Geen zelfrelatie; dubbele relatie → 409.
  app.post(
    '/admin/aac/relations',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<AacSymbolAdmin> => {
      const { parentId, childId, relation } = aacRelationInputSchema.parse(request.body);
      if (parentId === childId) {
        throw new HttpError(
          400,
          'INVALID_RELATION',
          'Een symbool kan niet met zichzelf gekoppeld worden.',
        );
      }

      const [parent, child] = await Promise.all([
        prisma.aacSymbol.findUnique({ where: { id: parentId } }),
        prisma.aacSymbol.findUnique({ where: { id: childId } }),
      ]);
      if (!parent || !child) {
        throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Ouder- of kindsymbool bestaat niet.');
      }

      const duplicate = await prisma.aacConceptRelation.findUnique({
        where: { parentId_childId_relation: { parentId, childId, relation } },
      });
      if (duplicate) {
        throw new HttpError(409, 'RELATION_EXISTS', 'Deze relatie bestaat al.');
      }

      await prisma.aacConceptRelation.create({ data: { parentId, childId, relation } });
      reply.status(201);
      // Geef het bijgewerkte oudersymbool terug, zodat de UI de nieuwe relatie meteen toont.
      return loadAdminSymbol(prisma, parentId);
    },
  );

  // Relatie verwijderen.
  app.delete(
    '/admin/aac/relations/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<void> => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = await prisma.aacConceptRelation.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'RELATION_NOT_FOUND', 'Relatie bestaat niet.');
      await prisma.aacConceptRelation.delete({ where: { id } });
      reply.status(204).send();
    },
  );

  // --- OpenSymbols-integratie (T3.3) ---

  // Zoeken bij OpenSymbols via de backend-proxy (de client praat nooit rechtstreeks, DESIGN §8.1).
  // Zonder configuratie: 503; een externe fout wordt netjes als 502 teruggegeven (nooit lekken).
  app.get(
    '/admin/aac/opensymbols/search',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<OpenSymbolsSearchResponse> => {
      const { q, locale } = openSymbolsSearchQuerySchema.parse(request.query);
      if (!openSymbols.isConfigured()) {
        throw new HttpError(
          503,
          'OPENSYMBOLS_UNAVAILABLE',
          'OpenSymbols is niet geconfigureerd op deze server.',
        );
      }
      let results;
      try {
        results = await openSymbols.search(q, locale);
      } catch (err) {
        request.log.error({ err }, 'OpenSymbols-zoekopdracht mislukt');
        throw new HttpError(
          502,
          'OPENSYMBOLS_ERROR',
          'OpenSymbols is momenteel niet bereikbaar. Probeer het later opnieuw.',
        );
      }
      return openSymbolsSearchResponseSchema.parse({ results });
    },
  );

  // --- Door de AI aangedragen concepten beoordelen (T10.7, DESIGN §7.6 trap 4, ADR-0012) ---
  //
  // De AI mag tijdens een gesprek een begrip aandragen dat nog niet in de bibliotheek staat; dat wordt
  // meteen een bruikbaar (gemarkeerd) pictogram, want de gebruiker moet het kúnnen kiezen. Wat blijvend
  // in de beheerde bibliotheek terechtkomt, blijft echter aan de beheerder. Drie uitkomsten:
  //
  //  - **behouden** — het begrip is terecht nieuw; label/pictogram/relaties bewerkt de beheerder met de
  //    bestaande symbool-endpoints, en deze route haalt de "nieuw"-markering weg;
  //  - **samenvoegen** — het begrip is een ander woord voor een bestaand pictogram; het wordt daar een
  //    synoniem van en verdwijnt als los concept (zo blijft de bibliotheek vrij van bijna-duplicaten);
  //  - **verwijderen** — onbruikbaar; het symbool gaat weg en het voorstel wordt afgewezen.

  app.get(
    '/admin/aac/new-concepts',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (): Promise<AiConceptReviewListResponse> => {
      const symbols = await prisma.aacSymbol.findMany({
        where: { origin: 'ai', reviewStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: adminSymbolInclude,
      });
      if (symbols.length === 0) {
        return aiConceptReviewListResponseSchema.parse({ concepts: [] });
      }

      const concepts = symbols.map((symbol) => symbol.concept);
      // Hoe vaak is dit begrip echt gekozen? Dat scheidt een woord dat aanslaat van een eenmalige gok.
      const usage = await prisma.conversationStep.groupBy({
        by: ['selectedConcept'],
        where: { selectedConcept: { in: concepts } },
        _count: { selectedConcept: true },
      });
      const countByConcept = new Map(
        usage.map((row) => [row.selectedConcept, row._count.selectedConcept]),
      );
      const proposals = await prisma.conceptProposal.findMany({
        where: { concept: { in: concepts } },
        select: { concept: true, reason: true },
      });
      const reasonByConcept = new Map(proposals.map((row) => [row.concept, row.reason]));

      return aiConceptReviewListResponseSchema.parse({
        concepts: symbols.map((symbol) => ({
          symbol: symbolToAdmin(symbol),
          timesChosen: countByConcept.get(symbol.concept) ?? 0,
          reason: reasonByConcept.get(symbol.concept) ?? null,
          createdAt: symbol.createdAt.toISOString(),
        })),
      });
    },
  );

  // Behouden: het begrip hoort in de bibliotheek. De "nieuw"-markering verdwijnt uit de gebruikersapp.
  app.post(
    '/admin/aac/new-concepts/:id/keep',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolAdmin> => {
      const { id } = idParamsSchema.parse(request.params);
      const symbol = await loadPendingAiSymbol(prisma, id);

      const updated = await prisma.aacSymbol.update({
        where: { id },
        data: { reviewStatus: 'APPROVED' },
        include: adminSymbolInclude,
      });
      await prisma.conceptProposal.updateMany({
        where: { concept: symbol.concept },
        data: { status: 'APPROVED', linkedSymbolId: id },
      });
      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AI_CONCEPT_KEEP,
        organizationId: null,
        targetType: 'aacSymbol',
        targetId: id,
        metadata: { concept: symbol.concept },
      });
      return symbolToAdmin(updated);
    },
  );

  // Samenvoegen: het begrip wordt een synoniem van een bestaand pictogram en verdwijnt als los concept.
  app.post(
    '/admin/aac/new-concepts/:id/merge',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolAdmin> => {
      const { id } = idParamsSchema.parse(request.params);
      const { targetSymbolId } = mergeAiConceptRequestSchema.parse(request.body);
      const symbol = await loadPendingAiSymbol(prisma, id);

      if (targetSymbolId === id) {
        throw new HttpError(400, 'INVALID_MERGE_TARGET', 'Een begrip kan niet in zichzelf opgaan.');
      }
      const target = await prisma.aacSymbol.findUnique({ where: { id: targetSymbolId } });
      if (!target) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');

      // Het begrip als synoniem toevoegen (idempotent, genormaliseerd ontdubbeld), zodat de
      // validatielaag het voortaan naar dit pictogram resolvet in plaats van opnieuw aan te maken.
      const existing = Array.isArray(target.synonyms)
        ? target.synonyms.filter((value): value is string => typeof value === 'string')
        : [];
      const already = existing.some((value) => normalizeSearch(value) === symbol.concept);
      const synonyms = already ? existing : [...existing, symbol.concept];

      const [updated] = await prisma.$transaction([
        prisma.aacSymbol.update({
          where: { id: targetSymbolId },
          data: {
            synonyms,
            searchText: buildSearchText({
              concept: target.concept,
              label: target.label,
              synonyms,
            }),
          },
          include: adminSymbolInclude,
        }),
        prisma.conceptProposal.updateMany({
          where: { concept: symbol.concept },
          data: { status: 'APPROVED', linkedSymbolId: targetSymbolId },
        }),
        // Het losse AI-symbool verdwijnt; relaties gaan mee via de cascade op AacConceptRelation.
        prisma.aacSymbol.delete({ where: { id } }),
      ]);

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AI_CONCEPT_MERGE,
        organizationId: null,
        targetType: 'aacSymbol',
        targetId: targetSymbolId,
        metadata: { concept: symbol.concept, targetConcept: target.concept },
      });
      return symbolToAdmin(updated);
    },
  );

  // Verwijderen: het begrip is onbruikbaar. Symbool weg, voorstel afgewezen.
  app.delete(
    '/admin/aac/new-concepts/:id',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request, reply): Promise<void> => {
      const { id } = idParamsSchema.parse(request.params);
      const symbol = await loadPendingAiSymbol(prisma, id);

      await prisma.$transaction([
        prisma.conceptProposal.updateMany({
          where: { concept: symbol.concept },
          data: { status: 'REJECTED', linkedSymbolId: null },
        }),
        prisma.aacSymbol.delete({ where: { id } }),
      ]);

      await recordAudit(prisma, request, {
        action: AUDIT_ACTIONS.AI_CONCEPT_DISCARD,
        organizationId: null,
        targetType: 'aacSymbol',
        targetId: id,
        metadata: { concept: symbol.concept },
      });
      reply.status(204);
    },
  );

  // Een gekozen OpenSymbols-afbeelding lokaal koppelen aan een symbool. De backend haalt de bytes
  // zelf op (https-only + SSRF-guard + content-type + groottelimiet) en legt de bron/licentie vast.
  app.post(
    '/admin/aac/symbols/:id/opensymbols',
    { preHandler: authorize(prisma, { roles: ['ADMIN'] }) },
    async (request): Promise<AacSymbolAdmin> => {
      const { id } = idParamsSchema.parse(request.params);
      const input = attachOpenSymbolsRequestSchema.parse(request.body);

      const existing = await prisma.aacSymbol.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');

      if (!openSymbols.isConfigured()) {
        throw new HttpError(
          503,
          'OPENSYMBOLS_UNAVAILABLE',
          'OpenSymbols is niet geconfigureerd op deze server.',
        );
      }

      // Guard vóór elke download: https-only + geen interne/loopback-hosts (SSRF).
      assertSafeImageUrl(input.imageUrl);

      let image;
      try {
        image = await openSymbols.fetchImage(input.imageUrl);
      } catch (err) {
        // Een groottefout van de proxy is al een nette HttpError; die laten we door.
        if (err instanceof HttpError) throw err;
        request.log.error({ err }, 'OpenSymbols-afbeelding ophalen mislukt');
        throw new HttpError(
          502,
          'OPENSYMBOLS_ERROR',
          'De gekozen afbeelding kon niet worden opgehaald.',
        );
      }

      if (image.bytes.byteLength === 0) {
        throw new HttpError(502, 'OPENSYMBOLS_ERROR', 'De opgehaalde afbeelding is leeg.');
      }
      if (!ALLOWED_IMAGE_MIME_TYPES.has(image.contentType)) {
        throw new HttpError(
          415,
          'UNSUPPORTED_IMAGE_TYPE',
          'De gekozen afbeelding heeft een niet-ondersteund type (alleen PNG, JPEG of WebP).',
        );
      }
      if (image.bytes.byteLength > env.AAC_IMAGE_MAX_BYTES) {
        throw new HttpError(
          413,
          'IMAGE_TOO_LARGE',
          `Afbeelding is te groot (max ${env.AAC_IMAGE_MAX_BYTES} bytes).`,
        );
      }

      const updated = await prisma.aacSymbol.update({
        where: { id },
        data: {
          // Kopieer naar een Uint8Array met een gewone ArrayBuffer-backing (Prisma Bytes-eis).
          imageData: new Uint8Array(image.bytes),
          imageMimeType: image.contentType,
          imageVersion: { increment: 1 },
          imageLicense: input.license,
          imageLicenseUrl: input.licenseUrl ?? null,
          imageAuthor: input.author ?? null,
          imageAuthorUrl: input.authorUrl ?? null,
          imageSourceUrl: input.sourceUrl ?? null,
        },
        include: adminSymbolInclude,
      });
      return symbolToAdmin(updated);
    },
  );
}

/**
 * Laadt een symbool dat een **nog niet beoordeeld AI-concept** is. Een gewoon bibliotheeksymbool of een
 * al beoordeeld concept hoort niet via deze routes bewerkt te worden (daar zijn de gewone
 * symbool-endpoints voor) — dat is een 404, zodat het beoordeelpad niet als sluipweg dient.
 */
async function loadPendingAiSymbol(
  prisma: PrismaClient,
  id: string,
): Promise<{ id: string; concept: string }> {
  const symbol = await prisma.aacSymbol.findUnique({
    where: { id },
    select: { id: true, concept: true, origin: true, reviewStatus: true },
  });
  if (!symbol || symbol.origin !== 'ai' || symbol.reviewStatus !== 'PENDING') {
    throw new HttpError(404, 'NEW_CONCEPT_NOT_FOUND', 'Dit nieuwe begrip bestaat niet (meer).');
  }
  return { id: symbol.id, concept: symbol.concept };
}
