import { z } from 'zod';
import {
  aacSymbolSchema,
  aacSymbolAdminSchema,
  type AacSymbol as AacSymbolPublic,
  type AacSymbolAdmin,
  type AacRelationEdge,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import { AAC_SEED_RELATIONS, AAC_SEED_SYMBOLS, type AacSeedSymbol } from './data.js';

/**
 * AAC-bibliotheekhelpers (T3.1, DESIGN §6.2, §7.6, FR-015).
 *
 * Bevat het normaliseren van zoektermen, het (idempotent) seeden van de bibliotheek, het serialiseren
 * naar de publieke vorm en het renderen van een placeholder-pictogram. Gedeeld door het seed-script,
 * de route en de tests, zodat er één bron van waarheid is voor de zoekindex en de afbeeldings-URL.
 */

/**
 * Publiek pad waarop een pictogram bereikbaar is. Zonder geüploade afbeelding rendert de server
 * een SVG-placeholder uit de glyph; met upload wordt de geüploade afbeelding geserveerd. Bij een
 * upload (`imageVersion > 0`) hangen we een cache-buster `?v=` aan, zodat een vervangen pictogram
 * niet uit de browsercache blijft komen (de serving zet een lange `Cache-Control`).
 */
export function imageUrlFor(symbolId: string, imageVersion = 0): string {
  const base = `/aac/images/${symbolId}`;
  return imageVersion > 0 ? `${base}?v=${imageVersion}` : base;
}

/**
 * Normaliseert tekst voor de zoekindex én de zoekterm: trimmen + lowercase. Beide kanten vooraf
 * lowercase maken houdt de match **portabel en hoofdletterongevoelig** op zowel SQLite als
 * PostgreSQL, zonder DB-specifieke `mode: 'insensitive'`.
 */
export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

/** Bouwt de genormaliseerde zoekindex uit concept, label en synoniemen. */
export function buildSearchText(
  symbol: Pick<AacSeedSymbol, 'concept' | 'label' | 'synonyms'>,
): string {
  return normalizeSearch([symbol.concept, symbol.label, ...symbol.synonyms].join(' '));
}

/** Synoniemen worden als JSON opgeslagen; bij het lezen valideren we de vorm expliciet. */
const synonymsSchema = z.array(z.string());

/**
 * Bouwt het attributie-object uit de opgeslagen bron-/licentievelden, of `null` als er geen
 * externe bron is (zelf-geüploade afbeelding of glyph-placeholder). De licentie is de dragende
 * waarde: zonder licentie is er geen te tonen attributie.
 */
function attributionOf(symbol: AacSymbolModel): AacSymbolPublic['attribution'] {
  if (!symbol.imageLicense) return null;
  return {
    license: symbol.imageLicense,
    licenseUrl: symbol.imageLicenseUrl ?? null,
    author: symbol.imageAuthor ?? null,
    authorUrl: symbol.imageAuthorUrl ?? null,
    sourceUrl: symbol.imageSourceUrl ?? null,
  };
}

/** Serialiseert een db-symbool naar de publieke (zod-gevalideerde) zoekresultaatvorm. */
export function symbolToPublic(symbol: AacSymbolModel): AacSymbolPublic {
  return aacSymbolSchema.parse({
    id: symbol.id,
    concept: symbol.concept,
    label: symbol.label,
    category: symbol.category,
    glyph: symbol.glyph,
    synonyms: synonymsSchema.parse(symbol.synonyms),
    imageUrl: imageUrlFor(symbol.id, symbol.imageVersion),
    attribution: attributionOf(symbol),
  });
}

/** Een symbool met zijn relaties, zoals de admin-query het teruggeeft (parent/child ge-include). */
export interface AacSymbolWithRelations extends AacSymbolModel {
  parentLinks: { id: string; relation: string; child: AacSymbolModel }[];
  childLinks: { id: string; relation: string; parent: AacSymbolModel }[];
}

/**
 * Serialiseert een symbool naar de beheerweergave: publieke velden + of er een afbeelding is en de
 * gelegde relaties. `children` = uitgaande relaties (dit symbool is de ouder, `parentLinks`);
 * `parents` = inkomende relaties (dit symbool is het kind, `childLinks`).
 */
export function symbolToAdmin(symbol: AacSymbolWithRelations): AacSymbolAdmin {
  const children: AacRelationEdge[] = symbol.parentLinks.map((link) => ({
    relationId: link.id,
    relation: link.relation,
    symbol: symbolToPublic(link.child),
  }));
  const parents: AacRelationEdge[] = symbol.childLinks.map((link) => ({
    relationId: link.id,
    relation: link.relation,
    symbol: symbolToPublic(link.parent),
  }));
  return aacSymbolAdminSchema.parse({
    ...symbolToPublic(symbol),
    hasImage: symbol.imageMimeType !== null,
    children,
    parents,
  });
}

/** Prisma-`include` dat de relaties met hun tegen-symbool ophaalt voor `symbolToAdmin`. */
export const adminSymbolInclude = {
  parentLinks: { include: { child: true }, orderBy: { child: { label: 'asc' } } },
  childLinks: { include: { parent: true }, orderBy: { parent: { label: 'asc' } } },
} as const;

/**
 * Seedt (of werkt bij) de volledige AAC-bibliotheek — idempotent, veilig herhaald uit te voeren.
 * Symbolen worden op de unieke `concept`-sleutel ge-upsert (searchText opnieuw afgeleid); relaties op
 * de unieke `(parentId, childId, relation)`-combinatie. Onbekende concepten in relaties worden
 * overgeslagen met een waarschuwing in plaats van de hele seed te laten falen.
 */
export async function seedAacLibrary(prisma: PrismaClient): Promise<void> {
  for (const symbol of AAC_SEED_SYMBOLS) {
    const data = {
      label: symbol.label,
      category: symbol.category,
      glyph: symbol.glyph,
      synonyms: symbol.synonyms,
      searchText: buildSearchText(symbol),
    };
    await prisma.aacSymbol.upsert({
      where: { concept: symbol.concept },
      create: { concept: symbol.concept, ...data },
      update: data,
    });
  }

  // Concept → id, zodat relaties op id kunnen verwijzen.
  const idByConcept = new Map(
    (await prisma.aacSymbol.findMany({ select: { id: true, concept: true } })).map((s) => [
      s.concept,
      s.id,
    ]),
  );

  for (const rel of AAC_SEED_RELATIONS) {
    const parentId = idByConcept.get(rel.parent);
    const childId = idByConcept.get(rel.child);
    const relation = rel.relation ?? 'contains';
    if (!parentId || !childId) {
      console.warn(`AAC-seed: relatie overgeslagen, onbekend concept ${rel.parent} → ${rel.child}`);
      continue;
    }
    await prisma.aacConceptRelation.upsert({
      where: { parentId_childId_relation: { parentId, childId, relation } },
      create: { parentId, childId, relation },
      update: {},
    });
  }
}

/**
 * Rendert een eenvoudige SVG-placeholder voor een symbool (MVP): de emoji groot in beeld met het
 * label eronder. Zo is elk pictogram direct bereikbaar vanuit de web-client zonder binaire assets;
 * T3.2 vervangt dit door geüploade afbeeldingsbestanden. De tekst wordt ge-escaped tegen XML-injectie.
 */
export function renderSymbolSvg(symbol: Pick<AacSymbolModel, 'glyph' | 'label'>): string {
  const glyph = escapeXml(symbol.glyph);
  const label = escapeXml(symbol.label);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${label}">
  <rect width="256" height="256" rx="24" fill="#f2f4f8"/>
  <text x="128" y="132" font-size="120" text-anchor="middle" dominant-baseline="central">${glyph}</text>
  <text x="128" y="224" font-size="28" text-anchor="middle" font-family="sans-serif" fill="#1a2330">${label}</text>
</svg>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
