import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { PrismaClient } from '../generated/prisma/client.js';
import { resolveStoragePath, writeStoredFile } from '../storage/files.js';
import type { Manifest } from './global-symbols.js';
import { checkImage } from './image-check.js';
import { readImageIndex, type ImageIndex } from './images.js';
import { buildSearchText } from './repository.js';
import { loadManifest, loadTranslation, type TranslationFile } from './translation.js';

/**
 * Seed van de startset (INTENTO-NEW-DESIGN §15, §15.1).
 *
 * Maakt platformitems (`organizationId` null) van manifest + vertaling + gedownloade afbeelding.
 * Alleen symbolen met een Nederlandse vertaling **én** een geaccepteerde afbeelding komen erin: een
 * Engels label of een leeg vak op de tablet brengt de gebruiker meer in de war dan een ontbrekend woord.
 * Elk item krijgt licentie, uitgever en bron. Plus één eigen item "geen afbeelding" (§8, stap 3).
 *
 * Idempotent: upsert op `(sourceName, sourceRef)`. Bij een bestaand item worden licentie, herkomst,
 * afbeelding en woordsoort bijgewerkt; labels, concepten, contexten, startconcept en volgorde alleen
 * zolang het label nog een machinevertaling is — een in de app nagekeken item wordt niet overschreven.
 * De status (`approved`/`retired`) raakt de seed nooit.
 */

export const START_SET_SLUGS = ['mulberry', 'corona-symbols'] as const;

/** Vaste volgorde van de startconcepten (§6): wat het eerst gevraagd wordt zonder Experience. */
const START_ORDER = ['pain', 'eat', 'drink', 'toilet', 'tired', 'happy', 'sad', 'help'];

/** Licentiesleutel uit de Global Symbols-licentie ("by-sa", "4.0" → "CC-BY-SA-4.0"). */
export function licenseKeyFor(licence: Manifest['licence']): string {
  const properties = (licence.properties ?? '').trim().toUpperCase();
  if (!properties) return 'UNKNOWN';
  if (properties === 'CC0' || properties === 'PUBLIC-DOMAIN') return 'CC0';
  return ['CC', properties, licence.version ?? ''].filter(Boolean).join('-');
}

export interface SeedReport {
  created: number;
  updated: number;
  skippedNoImage: number[];
}

async function fileExists(storageDir: string, assetPath: string): Promise<boolean> {
  try {
    return (await stat(resolveStoragePath(storageDir, assetPath))).isFile();
  } catch {
    return false;
  }
}

/** Seedt één set uit reeds geladen bronnen. */
export async function seedSet(
  prisma: PrismaClient,
  input: {
    manifest: Manifest;
    translation: TranslationFile;
    index: ImageIndex;
    storageDir: string;
  },
  now: Date = new Date(),
): Promise<SeedReport> {
  const { manifest, translation, index, storageDir } = input;
  const manifestById = new Map(manifest.items.map((item) => [item.id, item]));
  const report: SeedReport = { created: 0, updated: 0, skippedNoImage: [] };

  for (const [position, entry] of translation.items.entries()) {
    const picto = manifestById.get(entry.id);
    const image = index[String(entry.id)];
    if (!picto)
      throw new Error(`Vertaling ${translation.slug}/${entry.id} staat niet in het manifest.`);
    if (!image || !(await fileExists(storageDir, image.assetPath))) {
      report.skippedNoImage.push(entry.id);
      continue;
    }

    const labels = [entry.label, ...entry.synonyms.filter((s) => s !== entry.label)];
    const startIndex = START_ORDER.indexOf(entry.concept);
    const content = {
      labels,
      concepts: [entry.concept],
      contexts: [entry.context],
      searchText: buildSearchText(labels, [entry.concept]),
      isStart: entry.is_start,
      sortOrder: entry.is_start && startIndex >= 0 ? startIndex + 1 : 100 + position,
      labelStatus: entry.status,
    };
    const provenance = {
      partOfSpeech: picto.part_of_speech,
      licenseKey: licenseKeyFor(manifest.licence),
      licenseUrl: manifest.licence.url,
      author: manifest.publisher,
      authorUrl: manifest.publisher_url,
      sourceUrl: `https://globalsymbols.com/symbolsets/${manifest.slug}`,
      assetPath: image.assetPath,
      mimeType: image.mimeType,
      sha256: image.sha256,
      bytes: image.bytes,
    };

    const key = { sourceName: manifest.name, sourceRef: String(entry.id) };
    const existing = await prisma.vocabularyItem.findUnique({
      where: { sourceName_sourceRef: key },
      select: { id: true, labelStatus: true },
    });
    if (existing) {
      await prisma.vocabularyItem.update({
        where: { id: existing.id },
        data: existing.labelStatus === 'machine' ? { ...provenance, ...content } : provenance,
      });
      report.updated += 1;
    } else {
      await prisma.vocabularyItem.create({
        data: {
          ...key,
          ...content,
          ...provenance,
          source: 'seed',
          importedAt: now,
          organizationId: null,
        },
      });
      report.created += 1;
    }
  }
  return report;
}

/** De eenvoudige eigen SVG voor "geen afbeelding": een rustig kader met een vraagteken. */
export const NO_IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect x="8" y="8" width="84" height="84" rx="14" fill="#f2f2f2" stroke="#9a9a9a" stroke-width="4"/>' +
  '<path d="M38 38a12 12 0 1 1 18 10c-4 2-6 5-6 9v3" fill="none" stroke="#6b6b6b" stroke-width="7" stroke-linecap="round"/>' +
  '<circle cx="50" cy="72" r="4.5" fill="#6b6b6b"/></svg>';

/** Het eigen item "geen afbeelding" (§8 stap 3, §17): het neutrale pictogram bij een ontbrekend woord. */
export async function seedNoImageItem(
  prisma: PrismaClient,
  storageDir: string,
  now = new Date(),
): Promise<void> {
  const bytes = Buffer.from(NO_IMAGE_SVG);
  const checked = checkImage(bytes, { maxBytes: 64 * 1024, allowSvg: true });
  if (!checked.ok)
    throw new Error(`Eigen SVG "geen afbeelding" faalt de controle: ${checked.reason}`);
  const assetPath = 'seed/own/no-image.svg';
  await writeStoredFile(storageDir, assetPath, bytes);
  const asset = {
    assetPath,
    mimeType: checked.mimeType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
  const labels = ['geen afbeelding'];
  await prisma.vocabularyItem.upsert({
    where: { sourceName_sourceRef: { sourceName: 'Intento', sourceRef: 'no-image' } },
    update: asset,
    create: {
      ...asset,
      sourceName: 'Intento',
      sourceRef: 'no-image',
      labels,
      concepts: ['no_image'],
      contexts: ['other'],
      searchText: buildSearchText(labels, ['no_image']),
      isStart: false,
      sortOrder: 9999,
      source: 'seed',
      licenseKey: 'own',
      author: 'Intento',
      importedAt: now,
    },
  });
}

/** De hele startset uit `vocabulary/` en `STORAGE_DIR`. */
export async function seedStartSet(
  prisma: PrismaClient,
  storageDir: string,
): Promise<Record<string, SeedReport>> {
  const reports: Record<string, SeedReport> = {};
  for (const slug of START_SET_SLUGS) {
    reports[slug] = await seedSet(prisma, {
      manifest: await loadManifest(slug),
      translation: await loadTranslation(slug),
      index: await readImageIndex(storageDir, slug),
      storageDir,
    });
  }
  await seedNoImageItem(prisma, storageDir);
  return reports;
}
