import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Waar de bronbestanden van de startset staan (INTENTO-NEW-DESIGN §15.1): `vocabulary/` in de
 * repo-root, met `sources/<slug>.manifest.json` en `translations/<slug>.nl.json`.
 *
 * Standaard gezocht vanaf deze module (`server/src/vocabulary` of `server/dist/vocabulary` → drie
 * niveaus omhoog); `VOCABULARY_DIR` overschrijft dat, bv. in een container.
 */
export function vocabularyDir(): string {
  const fromEnv = process.env.VOCABULARY_DIR;
  if (fromEnv) return resolve(fromEnv);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vocabulary');
}

export function manifestPath(slug: string): string {
  return join(vocabularyDir(), 'sources', `${slug}.manifest.json`);
}

export function translationPath(slug: string): string {
  return join(vocabularyDir(), 'translations', `${slug}.nl.json`);
}
