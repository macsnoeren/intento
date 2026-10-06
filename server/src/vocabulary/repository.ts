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
 * De zoektekst: labels en concepten in kleine letters, met spaties ertussen. Concepten zijn
 * taalneutrale sleutels (`chest_pain`); de underscore wordt een spatie zodat "borst" en "pain" allebei
 * vinden.
 */
export function buildSearchText(labels: string[], concepts: string[]): string {
  return [...labels, ...concepts.map((concept) => concept.replace(/_/g, ' '))]
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join(' | ');
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
