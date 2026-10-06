import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../env.js';

/**
 * Ondertekende, vervallende afbeeldings-URL's (INTENTO-NEW-DESIGN §51, §53).
 *
 * Een afbeelding is alleen bereikbaar via `GET /assets/:id?exp=…&sig=…`. De handtekening is een
 * HMAC-SHA256 over `id.exp` met `ASSET_URL_SECRET`; wie een URL heeft, kan die ene afbeelding tot
 * `exp` ophalen, en niets anders. De backend geeft een URL alleen uit aan wie het item mag zien.
 *
 * Waarom geen cookie-auth op `/assets`: de web-app draait op een andere origin dan de API en laadt
 * afbeeldingen als `<img src>`. Een ondertekende URL werkt daar zonder cookies of CORS.
 */

function signature(secret: string, id: string, exp: number): string {
  return createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');
}

/** De ondertekende URL voor één item (relatief pad; de client zet de API-host ervoor). */
export function signedAssetUrl(
  env: Pick<Env, 'ASSET_URL_SECRET' | 'ASSET_URL_TTL_SECONDS'>,
  item: { id: string },
  now: Date = new Date(),
): string {
  // Afronden op een heel kwartier houdt de URL een tijd gelijk, zodat de browser hem kan cachen.
  const quarter = 15 * 60;
  const exp = Math.ceil((now.getTime() / 1000 + env.ASSET_URL_TTL_SECONDS) / quarter) * quarter;
  const sig = signature(env.ASSET_URL_SECRET, item.id, exp);
  return `/assets/${encodeURIComponent(item.id)}?exp=${exp}&sig=${sig}`;
}

/** Klopt de handtekening en is hij nog geldig? Vergelijking in constante tijd. */
export function verifyAssetSignature(
  secret: string,
  id: string,
  exp: number,
  sig: string,
  now: Date = new Date(),
): boolean {
  if (!Number.isInteger(exp) || exp * 1000 < now.getTime()) return false;
  const expected = Buffer.from(signature(secret, id, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
