import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { conceptKeySchema, VOCABULARY_CONTEXTS } from '@intento/shared';
import { manifestSchema, type Manifest } from './global-symbols.js';
import { manifestPath, translationPath } from './paths.js';

/**
 * Het Nederlandse vertaalbestand van een symboolset (INTENTO-NEW-DESIGN §15.1, stap 3).
 *
 * Per Global Symbols-id: het Nederlandse label, synoniemen, een taalneutraal concept, een context uit
 * een vaste lijst, of het een startconcept is, en of de vertaling door een mens is nagekeken
 * (`reviewed`) of door de machine gemaakt (`machine`).
 */

export { VOCABULARY_CONTEXTS };

export const translationItemSchema = z.strictObject({
  id: z.number().int().positive(),
  label: z.string().trim().min(1).max(60),
  synonyms: z.array(z.string().trim().min(1).max(60)),
  concept: conceptKeySchema,
  context: z.enum(VOCABULARY_CONTEXTS),
  is_start: z.boolean(),
  status: z.enum(['reviewed', 'machine']),
});
export type TranslationItem = z.infer<typeof translationItemSchema>;

export const translationFileSchema = z
  .strictObject({
    slug: z.string().min(1),
    language: z.literal('nl'),
    items: z.array(translationItemSchema),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<number>();
    for (const [index, item] of file.items.entries()) {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `dubbel id ${item.id}`,
        });
      }
      ids.add(item.id);
    }
  });
export type TranslationFile = z.infer<typeof translationFileSchema>;

/**
 * Het concept dat bij een Engels label hoort: kleine letters, zonder ", to" van een werkwoord, en
 * alles wat geen letter of cijfer is wordt een underscore (*chest pain* → `chest_pain`).
 */
export function conceptFromEnglish(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s*,\s*to\s*$/, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function loadManifest(slug: string): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(manifestPath(slug), 'utf8')));
}

export async function loadTranslation(slug: string): Promise<TranslationFile> {
  return translationFileSchema.parse(JSON.parse(await readFile(translationPath(slug), 'utf8')));
}
