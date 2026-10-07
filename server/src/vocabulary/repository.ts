import { z } from 'zod';
import type { VocabularyEntry } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { VocabularyItemModel } from '../generated/prisma/models.js';

/**
 * Vocabulary-repository (INTENTO-NEW-DESIGN §15, §39).
 *
 * De JSON-velden (`labels`, `concepts`, `contexts`) worden bij het lezen met zod gevalideerd: wat de
 * database teruggeeft, vertrouwen we niet blind. Elke query is gefilterd op wat voor de organisatie
 * beschikbaar is — de platformitems (`organizationId` null) plus die van de eigen organisatie, nooit
 * die van een andere (tenant-isolatie, ADR-0005).
 */

export const VOCABULARY_STATUSES = ['approved', 'retired'] as const;
export const LABEL_STATUSES = ['reviewed', 'machine'] as const;
export const VOCABULARY_SOURCES = ['seed', 'external', 'own'] as const;

const stringList = z.array(z.string().min(1));

/** Een Vocabulary-item met gevalideerde lijsten. */
export interface VocabularyItem extends Omit<
  VocabularyItemModel,
  'labels' | 'concepts' | 'contexts'
> {
  labels: string[];
  concepts: string[];
  contexts: string[];
}

export function parseVocabularyItem(row: VocabularyItemModel): VocabularyItem {
  return {
    ...row,
    labels: stringList.min(1).parse(row.labels),
    concepts: stringList.min(1).parse(row.concepts),
    contexts: stringList.parse(row.contexts),
  };
}

/**
 * De zoekvelden van een item (N2.15). `searchText`: de labels in kleine letters, elk op een eigen regel,
 * met een regeleinde ervoor en erachter. `conceptText`: de woorden van de concepten (`chest_pain` →
 * "chest pain"), elk met een spatie ervoor. Zie `searchWhere` voor hoe er gezocht wordt.
 */
export function searchFields(
  labels: string[],
  concepts: string[],
): { searchText: string; conceptText: string } {
  const clean = (parts: string[]) =>
    parts
      .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((part) => part.length > 0);
  const words = clean(concepts.map((concept) => concept.replace(/_/g, ' ')));
  return {
    searchText: `\n${clean(labels).join('\n')}\n`,
    conceptText: words.map((word) => ` ${word}`).join(''),
  };
}

/** Een zoekterm zoals hij in de zoekvelden staat: kleine letters, één spatie, geen underscores. */
export function normalizeQuery(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ');
}

/**
 * Het zoekfilter: in de labels overal (een Nederlands woord zit vaak in een samenstelling: "pijn" →
 * hoofdpijn), in de concepten alleen aan het begin van een woord ("pain" → chest_pain, maar "oma" niet
 * → stomach). Leeg na normaliseren: geen filter.
 */
export function searchWhere(q: string) {
  const term = normalizeQuery(q);
  if (!term) return {};
  return { OR: [{ searchText: { contains: term } }, { conceptText: { contains: ` ${term}` } }] };
}

/** Exacte treffer op een label, om die vooraan te zetten. */
export function exactLabelWhere(q: string) {
  return { searchText: { contains: `\n${normalizeQuery(q)}\n` } };
}

/** Het filter "beschikbaar voor deze organisatie": platform + eigen organisatie. */
export function availableTo(organizationId: string) {
  return { OR: [{ organizationId: null }, { organizationId }] };
}

/**
 * Alle bruikbare items voor een organisatie: platform + eigen, alleen `approved`, in vaste volgorde.
 * Dit is wat de agentdienst per beurt meekrijgt; een ingetrokken item valt er dus vanzelf uit.
 */
export async function listAvailableVocabulary(
  prisma: PrismaClient,
  organizationId: string,
): Promise<VocabularyItem[]> {
  const rows = await prisma.vocabularyItem.findMany({
    where: { status: 'approved', ...availableTo(organizationId) },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return rows.map(parseVocabularyItem);
}

/** De compacte vorm voor de agentdienst: geen afbeelding, geen licentie (INTENTO-NEW-DESIGN §3.1). */
export function toVocabularyEntry(item: VocabularyItem): VocabularyEntry {
  return {
    id: item.id,
    labels: item.labels,
    concepts: item.concepts,
    contexts: item.contexts,
    part_of_speech: item.partOfSpeech,
    is_start: item.isStart,
    sort_order: item.sortOrder,
  };
}
