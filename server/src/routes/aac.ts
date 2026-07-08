import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { aacSearchQuerySchema, aacSearchResponseSchema, type AacSearchResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { readSessionToken } from '../auth/request.js';
import { findAccountBySessionToken } from '../auth/session.js';
import { readDeviceToken, findDeviceByToken } from '../auth/device.js';
import { normalizeSearch, renderSymbolSvg, symbolToPublic } from '../aac/library.js';

export interface AacRoutesDeps {
  prisma: PrismaClient;
}

/** Route-parameter: het symbool-id uit het pad (met `.svg`-suffix afgekapt in de handler). */
const imageParamsSchema = z.object({ file: z.string().min(1) });

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

/**
 * AAC-bibliotheek: zoeken en pictogrammen serveren (T3.1, DESIGN §6.2, §8.2, FR-015).
 *
 * - `GET /aac/search?q=…` zoekt hoofdletterongevoelig op concept, label én synoniemen via de
 *   genormaliseerde zoekindex (`searchText`) — portabel op SQLite en PostgreSQL.
 * - `GET /aac/images/:id.svg` levert het pictogram (in de MVP een server-gerenderde SVG-placeholder
 *   uit de emoji; T3.2 vervangt dit door geüploade bestanden). Bewust publiek: het is niet-gevoelige
 *   presentatiedata die de web-client als `<img src>` moet kunnen laden.
 */
export function registerAacRoutes(app: FastifyInstance, { prisma }: AacRoutesDeps): void {
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
      select: { glyph: true, label: true },
    });
    if (!symbol) {
      throw new HttpError(404, 'SYMBOL_NOT_FOUND', 'Pictogram bestaat niet.');
    }

    reply
      .header('Content-Type', 'image/svg+xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400');
    return renderSymbolSvg(symbol);
  });
}
