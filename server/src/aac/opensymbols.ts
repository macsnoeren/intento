import { z } from 'zod';
import { isIP } from 'node:net';
import type { OpenSymbolsResult } from '@intento/shared';
import type { Env } from '../env.js';
import { HttpError } from '../errors.js';

/**
 * OpenSymbols-integratie (T3.3, DESIGN §6.2, §8.2, FR-015).
 *
 * De backend proxyt namens de beheer-UI naar de OpenSymbols-API — de client praat **nooit**
 * rechtstreeks met externe diensten (DESIGN §8.1). Deze module bevat:
 *  - de provider-agnostische `OpenSymbolsClient`-interface (injecteerbaar/mockbaar in tests);
 *  - de echte, op `fetch` gebaseerde implementatie met token-uitwisseling en time-outs;
 *  - `assertSafeImageUrl`: de SSRF/`https`-guard die vóór elke download draait.
 *
 * Alle externe input wordt met zod gevalideerd en gesaneerd (alleen `https`-afbeeldings-URL's
 * passeren); een externe worker/dienst wordt nooit vertrouwd.
 */

/** Het resultaat van het ophalen van een externe afbeelding: het genormaliseerde mime-type + bytes. */
export interface FetchedImage {
  /** Content-type zonder parameters, lowercase (bv. "image/png"). */
  contentType: string;
  bytes: Uint8Array;
}

export interface OpenSymbolsClient {
  /** Of de integratie geconfigureerd is (secret aanwezig). Zo niet: endpoints geven 503. */
  isConfigured(): boolean;
  /** Zoekt pictogrammen; geeft alleen gesaneerde resultaten met een `https`-afbeeldings-URL terug. */
  search(query: string, locale?: string): Promise<OpenSymbolsResult[]>;
  /** Haalt een afbeelding op (na de SSRF/`https`-guard); geeft mime-type + bytes terug. */
  fetchImage(url: string): Promise<FetchedImage>;
}

// --- SSRF/https-guard ---------------------------------------------------------------------------

/** Loopback/link-local/private IP-bereiken die nooit vanaf de server benaderd mogen worden (SSRF). */
function isPrivateOrLoopbackIp(host: string): boolean {
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127) return true; // private + loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 0) return true; // "this host"
    return false;
  }
  if (version === 6) {
    const lower = host.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    return false;
  }
  return false;
}

/**
 * Guard vóór élke externe afbeelding-download (T3.3-veiligheidseis). Weigert alles wat geen
 * `https` is en alle hostnamen die naar het interne netwerk kunnen wijzen (loopback, private
 * IP-bereiken, `localhost`/`*.local`). Zo kan een bron-URL geen SSRF-verzoek naar interne
 * services uitlokken. Gooit een `HttpError(400)` bij afkeuring.
 */
export function assertSafeImageUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'INVALID_IMAGE_URL', 'Ongeldige afbeeldings-URL.');
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(
      400,
      'INVALID_IMAGE_URL',
      'Alleen https-afbeeldings-URL’s zijn toegestaan.',
    );
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, 'INVALID_IMAGE_URL', 'Deze host is niet toegestaan.');
  }
  // IPv6-hosts staan in URL-vorm tussen [] — die eraf halen vóór de IP-controle.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isPrivateOrLoopbackIp(bareHost)) {
    throw new HttpError(400, 'INVALID_IMAGE_URL', 'Interne adressen zijn niet toegestaan.');
  }
  return url;
}

// --- Externe API-vormen (rauw, defensief gevalideerd) -------------------------------------------

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

/**
 * Eén rauw OpenSymbols-symbool. Alle velden optioneel/tolerant: we vertrouwen de externe vorm niet
 * en vullen ontbrekende attributie met `null`. OpenSymbols laat ontbrekende attributie niet weg
 * maar stuurt expliciet `null` (bv. `source_url`), dus elk veld is `.nullish()` — anders zou één
 * `null` de hele zoekopdracht laten falen. Onbekende velden negeren we (`.loose()`).
 */
const rawSymbolSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    symbol_key: z.string().nullish(),
    name: z.string().nullish(),
    image_url: z.string().nullish(),
    extension: z.string().nullish(),
    license: z.string().nullish(),
    license_url: z.string().nullish(),
    author: z.string().nullish(),
    author_url: z.string().nullish(),
    source_url: z.string().nullish(),
  })
  .loose();

const rawSearchResponseSchema = z.array(rawSymbolSchema);

/** Alleen `https` is een veilige afbeeldingsbron (XSS/SSRF); al het andere valt weg. */
function isHttpsUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim());
}

/** Zet een tolerant leeg veld om naar `null` (attributie is optioneel). */
function orNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Mapt de rauwe externe resultaten naar de gesaneerde interne vorm. Resultaten **zonder** een
 * `https`-afbeeldings-URL worden weggelaten — die zijn onbruikbaar/onveilig. Zo bereikt geen
 * niet-`https`-bron ooit de client.
 */
export function mapOpenSymbolsResults(raw: unknown): OpenSymbolsResult[] {
  const parsed = rawSearchResponseSchema.parse(raw);
  const results: OpenSymbolsResult[] = [];
  for (const [index, item] of parsed.entries()) {
    if (!isHttpsUrl(item.image_url)) continue;
    results.push({
      id: String(item.id ?? item.symbol_key ?? index),
      name: item.name?.trim() || item.symbol_key || 'pictogram',
      imageUrl: item.image_url.trim(),
      extension: item.extension?.trim() || '',
      license: item.license?.trim() || 'onbekend',
      licenseUrl: orNull(item.license_url),
      author: orNull(item.author),
      authorUrl: orNull(item.author_url),
      sourceUrl: orNull(item.source_url),
    });
  }
  return results;
}

// --- HTTP-implementatie -------------------------------------------------------------------------

/**
 * Bouwt de echte OpenSymbols-client uit de env. Zonder `OPENSYMBOLS_SECRET` is de integratie
 * uitgeschakeld (`isConfigured()` → false) en weigeren de routes met 503. Het access-token wordt
 * gecachet en bij een 401 (verlopen) één keer ververst.
 */
export function createOpenSymbolsClient(env: Env): OpenSymbolsClient {
  const baseUrl = env.OPENSYMBOLS_API_URL.replace(/\/+$/, '');
  const secret = env.OPENSYMBOLS_SECRET;
  let cachedToken: string | null = null;

  function timeoutSignal(): AbortSignal {
    return AbortSignal.timeout(env.OPENSYMBOLS_TIMEOUT_MS);
  }

  async function fetchToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/v2/token?secret=${encodeURIComponent(secret)}`, {
      method: 'POST',
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      throw new Error(`OpenSymbols-tokenverzoek faalde met status ${res.status}`);
    }
    const { access_token } = tokenResponseSchema.parse(await res.json());
    cachedToken = access_token;
    return access_token;
  }

  async function token(): Promise<string> {
    return cachedToken ?? (await fetchToken());
  }

  return {
    isConfigured() {
      return secret.length > 0;
    },

    async search(query, locale) {
      const params = new URLSearchParams({ q: query, access_token: await token() });
      if (locale) params.set('locale', locale);

      let res = await fetch(`${baseUrl}/api/v2/symbols?${params.toString()}`, {
        signal: timeoutSignal(),
      });
      // Verlopen token: één keer opnieuw authenticeren en het verzoek herhalen.
      if (res.status === 401) {
        cachedToken = null;
        params.set('access_token', await token());
        res = await fetch(`${baseUrl}/api/v2/symbols?${params.toString()}`, {
          signal: timeoutSignal(),
        });
      }
      if (!res.ok) {
        throw new Error(`OpenSymbols-zoekverzoek faalde met status ${res.status}`);
      }
      return mapOpenSymbolsResults(await res.json());
    },

    async fetchImage(rawUrl) {
      const url = assertSafeImageUrl(rawUrl);
      const res = await fetch(url, { signal: timeoutSignal(), redirect: 'error' });
      if (!res.ok) {
        throw new Error(`Afbeelding ophalen faalde met status ${res.status}`);
      }
      // Vroege afwijzing op basis van de aangekondigde grootte (definitieve check in de route).
      const declaredLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > env.AAC_IMAGE_MAX_BYTES) {
        throw new HttpError(
          413,
          'IMAGE_TOO_LARGE',
          `Afbeelding is te groot (max ${env.AAC_IMAGE_MAX_BYTES} bytes).`,
        );
      }
      const contentType = (res.headers.get('content-type') ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase();
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { contentType, bytes };
    },
  };
}
