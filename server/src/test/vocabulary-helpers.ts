import type { PrismaClient } from '../generated/prisma/client.js';
import { buildSearchText } from '../vocabulary/repository.js';

/** Maakt een Vocabulary-item voor tests; standaard een platformitem met een SVG-afbeelding. */
export async function createVocabularyItem(
  prisma: PrismaClient,
  data: {
    label: string;
    concept: string;
    organizationId?: string | null;
    status?: string;
    labelStatus?: string;
    sortOrder?: number;
    isStart?: boolean;
    synonyms?: string[];
    contexts?: string[];
    assetPath?: string | null;
    sourceRef?: string;
    licenseKey?: string;
    author?: string | null;
  },
): Promise<string> {
  const labels = [data.label, ...(data.synonyms ?? [])];
  const own = Boolean(data.organizationId);
  const item = await prisma.vocabularyItem.create({
    data: {
      organizationId: data.organizationId ?? null,
      labels,
      concepts: [data.concept],
      contexts: data.contexts ?? ['health'],
      searchText: buildSearchText(labels, [data.concept]),
      status: data.status ?? 'approved',
      labelStatus: data.labelStatus ?? 'reviewed',
      sortOrder: data.sortOrder ?? 0,
      isStart: data.isStart ?? false,
      source: own ? 'own' : 'seed',
      licenseKey: data.licenseKey ?? (own ? 'own' : 'CC-BY-SA-4.0'),
      licenseUrl: own ? null : 'https://creativecommons.org/licenses/by-sa/4.0/',
      author: data.author === undefined ? (own ? null : 'Steve Lee') : data.author,
      sourceName: own ? null : 'Mulberry Symbols',
      sourceUrl: own ? null : 'https://globalsymbols.com/symbolsets/mulberry',
      sourceRef: data.sourceRef ?? null,
      assetPath: data.assetPath === undefined ? `seed/test/${data.concept}.svg` : data.assetPath,
      mimeType: 'image/svg+xml',
    },
  });
  return item.id;
}
