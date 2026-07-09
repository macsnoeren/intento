import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import {
  aacSearchQuerySchema,
  aacSearchResponseSchema,
  aacSymbolInputSchema,
  aacSymbolListResponseSchema,
  aacRelationInputSchema,
  type AacSearchResponse,
  type AacSymbolAdmin,
  type AacSymbolListResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';
import { HttpError } from '../errors.js';
import { readSessionToken } from '../auth/request.js';
import { findAccountBySessionToken } from '../auth/session.js';
import { readDeviceToken, findDeviceByToken } from '../auth/device.js';
import { authorize } from '../auth/authorize.js';
import {
  adminSymbolInclude,
  buildSearchText,
  normalizeSearch,
  renderSymbolSvg,
  symbolToAdmin,
  symbolToPublic,
} from '../aac/library.js';

export interface AacRoutesDeps {
  prisma: PrismaClient;
  env: Env;
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

/**
 * Toegangsguard voor de AAC-bibliotheek: **een ingelogd account óf een gekoppeld apparaat** mag
 * erbij. De bibliotheek is gedeelde, niet-gevoelige app-data (geen tenant-filtering), maar bewust
 * niet publiek — alleen geauthenticeerde clients (beheer-UI, begeleider) én de tablet (device-token,
 * nodig tijdens communicatie) kunnen zoeken. Zonder een van beide: 401.
 */
function authorizeAccountOrDevice(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async (request) => {
    const sessionToken = readSessionToken(request);
    if (sessionToken && (await findAccountBySessionToken(prisma, sessionToken))) return;

    const deviceToken = readDeviceToken(request);
    if (deviceToken && (await findDeviceByToken(prisma, deviceToken))) return;

    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Niet ingelogd.');
  };
}

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
 * - `POST /admin/aac/relations` — relatie ouder→kind leggen (geen zelfrelatie; dubbel → 409).
 * - `DELETE /admin/aac/relations/:id` — relatie verwijderen.
 */
export function registerAacRoutes(app: FastifyInstance, { prisma, env }: AacRoutesDeps): void {
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
}
