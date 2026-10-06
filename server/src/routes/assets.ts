import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { readStoredFile } from '../storage/files.js';
import { verifyAssetSignature } from '../vocabulary/assets.js';

export interface AssetRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

const paramsSchema = z.object({ id: z.string().min(1).max(200) });
const querySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1).max(200),
});

/** Alleen deze typen serveren we; alles wat de afbeeldingscontrole doorliet valt hieronder. */
const SERVABLE = new Set(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']);

/**
 * CSP voor een SVG: geen scripts, geen externe resources, geen formulieren of navigatie. Inline stijl
 * mag, want pictogrammen gebruiken die. `sandbox` zet het document daarbovenop in een afgeschermde
 * context, mocht iemand de afbeelding los openen.
 */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

/**
 * `GET /assets/:id?exp=…&sig=…` — een afbeelding uit de Vocabulary (INTENTO-NEW-DESIGN §51, §53).
 *
 * Alleen met een geldige, niet-verlopen handtekening (anders 403), alleen voor een `approved` item met
 * een opgeslagen afbeelding (anders 404). Een ingetrokken item wordt niet meer geserveerd.
 */
export function registerAssetRoutes(app: FastifyInstance, { env, prisma }: AssetRoutesDeps): void {
  app.get('/assets/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const parsed = querySchema.safeParse(request.query);
    if (
      !parsed.success ||
      !verifyAssetSignature(env.ASSET_URL_SECRET, id, parsed.data.exp, parsed.data.sig)
    ) {
      throw new HttpError(
        403,
        'INVALID_ASSET_SIGNATURE',
        'Deze afbeeldingslink is ongeldig of verlopen.',
      );
    }

    const item = await prisma.vocabularyItem.findUnique({
      where: { id },
      select: { status: true, assetPath: true, mimeType: true },
    });
    if (!item || item.status !== 'approved' || !item.assetPath || !item.mimeType) {
      throw new HttpError(404, 'ASSET_NOT_FOUND', 'Afbeelding niet gevonden.');
    }
    if (!SERVABLE.has(item.mimeType)) {
      throw new HttpError(404, 'ASSET_NOT_FOUND', 'Afbeelding niet gevonden.');
    }

    let bytes: Buffer;
    try {
      bytes = await readStoredFile(env.STORAGE_DIR, item.assetPath);
    } catch {
      throw new HttpError(404, 'ASSET_NOT_FOUND', 'Afbeelding niet gevonden.');
    }

    const maxAge = Math.max(0, parsed.data.exp - Math.floor(Date.now() / 1000));
    reply
      .header('Content-Type', item.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      // De web-app laadt dit als `<img src>` vanaf een andere origin; daar doet CORS niets en blokkeert
      // helmets `same-origin` het plaatje. Route-gebonden uitzondering, alleen voor afbeeldingen.
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', `private, max-age=${maxAge}`);
    if (item.mimeType === 'image/svg+xml') reply.header('Content-Security-Policy', SVG_CSP);
    return reply.send(bytes);
  });
}
