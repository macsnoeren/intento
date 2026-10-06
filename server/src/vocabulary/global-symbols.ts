import { z } from 'zod';

/**
 * Global Symbols — het manifest van een symboolset (INTENTO-NEW-DESIGN §15.1, stap 1).
 *
 * De openbare API (`/api/v1/pictos?symbolset=<slug>&page=…&per_page=…`, zonder API-key) levert per
 * picto het id, de woordsoort, de afbeeldings-URL en de labels. Dit maakt daar een **manifest** van dat
 * in de repo staat: klein, herhaalbaar, en los van wat de bron later verandert. Elke pagina wordt met
 * zod gevalideerd; tussen de pagina's zit een pauze (beleefd tempo) en elke aanroep heeft een time-out.
 */

export const GLOBAL_SYMBOLS_API = 'https://globalsymbols.com/api/v1';

/** De talen die we bewaren: Engels (voor het concept), Duits en Frans (voor de vertaling, §15.1). */
export const MANIFEST_LANGUAGES = ['eng', 'deu', 'fra'] as const;
type ManifestLanguage = (typeof MANIFEST_LANGUAGES)[number];

const pictoSchema = z.object({
  id: z.number().int().positive(),
  part_of_speech: z.string().nullable(),
  image_url: z.url().refine((url) => url.startsWith('https://'), 'image_url moet https zijn'),
  native_format: z.string().min(1),
  labels: z.array(z.object({ language: z.string(), text: z.string() })),
});

const pageSchema = z.object({
  items: z.array(pictoSchema),
  total: z.number().int().nonnegative(),
});

const symbolSetSchema = z.object({
  slug: z.string(),
  name: z.string(),
  publisher: z.string().nullable(),
  publisher_url: z.string().nullable(),
  licence: z.object({
    name: z.string(),
    url: z.string().nullable(),
    version: z.string().nullable(),
    properties: z.string().nullable(),
  }),
});

export const manifestItemSchema = z.object({
  id: z.number().int().positive(),
  part_of_speech: z.string().nullable(),
  image_url: z.string(),
  format: z.string(),
  labels: z.object({
    eng: z.string().nullable(),
    deu: z.string().nullable(),
    fra: z.string().nullable(),
  }),
});
export type ManifestItem = z.infer<typeof manifestItemSchema>;

export const manifestSchema = z.object({
  slug: z.string(),
  name: z.string(),
  publisher: z.string().nullable(),
  publisher_url: z.string().nullable(),
  licence: symbolSetSchema.shape.licence,
  source: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(manifestItemSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;

export interface FetchManifestOptions {
  apiUrl?: string;
  perPage?: number;
  /** Pauze tussen twee pagina's, in ms. */
  delayMs?: number;
  timeoutMs?: number;
  /** Bovengrens op het aantal pagina's (vangnet tegen een bron die nooit ophoudt). */
  maxPages?: number;
  fetchImpl?: typeof fetch;
  onPage?: (page: number, received: number, total: number) => void;
}

export class GlobalSymbolsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobalSymbolsError';
  }
}

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) throw new GlobalSymbolsError(`${url} gaf status ${response.status}`);
  return response.json();
}

function pickLabel(
  labels: { language: string; text: string }[],
  language: ManifestLanguage,
): string | null {
  const text = labels.find((label) => label.language === language)?.text.trim();
  return text ? text : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Haalt alle pictos van een set op en bouwt het manifest. */
export async function fetchManifest(
  slug: string,
  options: FetchManifestOptions = {},
): Promise<Manifest> {
  const apiUrl = (options.apiUrl ?? GLOBAL_SYMBOLS_API).replace(/\/+$/, '');
  const perPage = options.perPage ?? 100;
  const delayMs = options.delayMs ?? 300;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxPages = options.maxPages ?? 200;
  const fetchImpl = options.fetchImpl ?? fetch;

  const sets = z
    .array(symbolSetSchema)
    .parse(await getJson(fetchImpl, `${apiUrl}/symbolsets`, timeoutMs));
  const set = sets.find((candidate) => candidate.slug === slug);
  if (!set) throw new GlobalSymbolsError(`Symboolset ${slug} bestaat niet bij Global Symbols.`);

  const items = new Map<number, ManifestItem>();
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    if (page > 1 && delayMs > 0) await sleep(delayMs);
    const url = `${apiUrl}/pictos?symbolset=${encodeURIComponent(slug)}&page=${page}&per_page=${perPage}`;
    const parsed = pageSchema.safeParse(await getJson(fetchImpl, url, timeoutMs));
    if (!parsed.success) throw new GlobalSymbolsError(`Pagina ${page} heeft een onverwachte vorm.`);
    total = parsed.data.total;
    for (const picto of parsed.data.items) {
      items.set(picto.id, {
        id: picto.id,
        part_of_speech: picto.part_of_speech,
        image_url: picto.image_url,
        format: picto.native_format.toLowerCase(),
        labels: {
          eng: pickLabel(picto.labels, 'eng'),
          deu: pickLabel(picto.labels, 'deu'),
          fra: pickLabel(picto.labels, 'fra'),
        },
      });
    }
    options.onPage?.(page, items.size, total);
    if (parsed.data.items.length < perPage || items.size >= total) break;
  }
  if (items.size !== total) {
    throw new GlobalSymbolsError(`Onvolledig: ${items.size} van ${total} pictos opgehaald.`);
  }

  return manifestSchema.parse({
    slug: set.slug,
    name: set.name,
    publisher: set.publisher,
    publisher_url: set.publisher_url,
    licence: set.licence,
    source: `${apiUrl}/pictos?symbolset=${slug}`,
    total,
    items: [...items.values()].sort((a, b) => a.id - b.id),
  });
}
