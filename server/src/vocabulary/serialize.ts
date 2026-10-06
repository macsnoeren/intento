import {
  labelStatusSchema,
  vocabularyItemPublicSchema,
  vocabularySourceSchema,
  vocabularyStatusSchema,
  type VocabularyItemPublic,
} from '@intento/shared';
import type { Env } from '../env.js';
import { signedAssetUrl } from './assets.js';
import type { VocabularyItem } from './repository.js';

/** Alleen http(s) als link; al het andere wordt `null` (XSS in een `href`, CLAUDE.md-checklist). */
function linkOrNull(value: string | null): string | null {
  return value && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

/**
 * Een Vocabulary-item in de vorm voor de beheeromgeving, met een ondertekende afbeeldings-URL. Een
 * ingetrokken item krijgt geen afbeeldings-URL: `/assets` serveert het toch niet meer.
 */
export function vocabularyItemToPublic(
  item: VocabularyItem,
  env: Pick<Env, 'ASSET_URL_SECRET' | 'ASSET_URL_TTL_SECONDS'>,
  now: Date = new Date(),
): VocabularyItemPublic {
  const status = vocabularyStatusSchema.parse(item.status);
  return vocabularyItemPublicSchema.parse({
    id: item.id,
    scope: item.organizationId ? 'organization' : 'platform',
    labels: item.labels,
    concepts: item.concepts,
    contexts: item.contexts,
    partOfSpeech: item.partOfSpeech,
    isStart: item.isStart,
    sortOrder: item.sortOrder,
    status,
    labelStatus: labelStatusSchema.parse(item.labelStatus),
    source: vocabularySourceSchema.parse(item.source),
    license: {
      key: item.licenseKey,
      url: linkOrNull(item.licenseUrl),
      author: item.author,
      authorUrl: linkOrNull(item.authorUrl),
      sourceName: item.sourceName,
      sourceUrl: linkOrNull(item.sourceUrl),
      sourceRef: item.sourceRef,
      importedAt: item.importedAt?.toISOString() ?? null,
    },
    imageUrl: status === 'approved' && item.assetPath ? signedAssetUrl(env, item, now) : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  });
}
