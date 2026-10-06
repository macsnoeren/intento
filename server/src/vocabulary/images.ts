import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { ReadableStreamDefaultReader, ReadableStreamReadResult } from 'node:stream/web';
import { z } from 'zod';
import { resolveStoragePath, writeStoredFile } from '../storage/files.js';
import type { Manifest, ManifestItem } from './global-symbols.js';
import { checkImage } from './image-check.js';

/**
 * Afbeeldingen van de startset downloaden (INTENTO-NEW-DESIGN §15.1 stap 2, §53).
 *
 * Alleen https van een bekende host (`globalsymbols.com`), met groottelimiet, time-out en zonder
 * redirects. Elke afbeelding gaat door de afbeeldingscontrole (§20); wat daar niet door komt, wordt
 * niet opgeslagen en staat in het overzicht aan het eind. Een bestand dat er al staat, wordt
 * overgeslagen, zodat een tweede run niets opnieuw downloadt.
 *
 * Per set: `seed/<slug>/<id>.<ext>` in `STORAGE_DIR`, plus `seed/<slug>/index.json` met per id het
 * bestand, het gecontroleerde type, de sha256 en de grootte. Die index leest de seed (N2.7).
 */

export const DEFAULT_IMAGE_HOSTS = ['globalsymbols.com'];
export const DEFAULT_IMAGE_MAX_BYTES = 512 * 1024;

export const imageIndexEntrySchema = z.object({
  assetPath: z.string(),
  mimeType: z.enum(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
});
export type ImageIndexEntry = z.infer<typeof imageIndexEntrySchema>;
export const imageIndexSchema = z.record(z.string().regex(/^\d+$/), imageIndexEntrySchema);
export type ImageIndex = z.infer<typeof imageIndexSchema>;

export interface DownloadOptions {
  storageDir: string;
  maxBytes?: number;
  timeoutMs?: number;
  concurrency?: number;
  allowedHosts?: string[];
  /** Alleen voor tests met een lokale nep-server: http toestaan. */
  allowHttp?: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}

export interface DownloadReport {
  downloaded: number;
  skipped: number;
  rejected: { id: number; reason: string }[];
}

export function indexPath(slug: string): string {
  return `seed/${slug}/index.json`;
}

export async function readImageIndex(storageDir: string, slug: string): Promise<ImageIndex> {
  try {
    const raw = await readFile(resolveStoragePath(storageDir, indexPath(slug)), 'utf8');
    return imageIndexSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function fileExists(storageDir: string, assetPath: string): Promise<boolean> {
  try {
    return (await stat(resolveStoragePath(storageDir, assetPath))).isFile();
  } catch {
    return false;
  }
}

/** Mag deze URL gedownload worden? Geeft de reden terug als dat niet zo is. */
function urlProblem(raw: string, allowedHosts: string[], allowHttp: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'ongeldige URL';
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return 'alleen https';
  if (url.username || url.password) return 'URL met inloggegevens';
  if (!allowedHosts.includes(url.hostname.toLowerCase())) return `onbekende host ${url.hostname}`;
  return null;
}

/** Leest de body tot `maxBytes`; daarboven wordt de download afgebroken. */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
    if (chunk.done) break;
    const value = chunk.value;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadOne(
  item: ManifestItem,
  slug: string,
  options: Required<Omit<DownloadOptions, 'onProgress'>>,
): Promise<{ entry: ImageIndexEntry } | { reason: string }> {
  const problem = urlProblem(item.image_url, options.allowedHosts, options.allowHttp);
  if (problem) return { reason: problem };
  let response: Response;
  try {
    response = await options.fetchImpl(item.image_url, {
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    return { reason: `download mislukt (${(error as Error).name})` };
  }
  if (!response.ok) return { reason: `status ${response.status}` };
  const bytes = await readLimited(response, options.maxBytes);
  if (!bytes) return { reason: `te groot (meer dan ${options.maxBytes} bytes)` };

  const checked = checkImage(bytes, { maxBytes: options.maxBytes, allowSvg: true });
  if (!checked.ok) return { reason: checked.reason };

  const assetPath = `seed/${slug}/${item.id}.${checked.extension}`;
  await writeStoredFile(options.storageDir, assetPath, bytes);
  return {
    entry: {
      assetPath,
      mimeType: checked.mimeType,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    },
  };
}

/** Downloadt de afbeeldingen van een set; slaat over wat er al is. */
export async function downloadSetImages(
  manifest: Manifest,
  options: DownloadOptions,
): Promise<DownloadReport> {
  const settings = {
    storageDir: options.storageDir,
    maxBytes: options.maxBytes ?? DEFAULT_IMAGE_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? 20_000,
    concurrency: Math.max(1, options.concurrency ?? 4),
    allowedHosts: (options.allowedHosts ?? DEFAULT_IMAGE_HOSTS).map((host) => host.toLowerCase()),
    allowHttp: options.allowHttp ?? false,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const index = await readImageIndex(settings.storageDir, manifest.slug);
  const report: DownloadReport = { downloaded: 0, skipped: 0, rejected: [] };

  const queue = [...manifest.items];
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const known = index[String(item.id)];
      if (known && (await fileExists(settings.storageDir, known.assetPath))) {
        report.skipped += 1;
      } else {
        const result = await downloadOne(item, manifest.slug, settings);
        if ('entry' in result) {
          index[String(item.id)] = result.entry;
          report.downloaded += 1;
        } else {
          report.rejected.push({ id: item.id, reason: result.reason });
        }
      }
      done += 1;
      options.onProgress?.(done, manifest.items.length);
    }
  };
  await Promise.all(Array.from({ length: settings.concurrency }, worker));

  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => Number(a) - Number(b)),
  );
  await writeStoredFile(
    settings.storageDir,
    indexPath(manifest.slug),
    Buffer.from(`${JSON.stringify(sorted, null, 2)}\n`),
  );
  report.rejected.sort((a, b) => a.id - b.id);
  return report;
}
