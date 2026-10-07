import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  conceptFromEnglish,
  loadManifest,
  loadTranslation,
  translationFileSchema,
} from './translation.js';

/**
 * De Nederlandse vertaalbestanden van de startset (N2.5, INTENTO-NEW-DESIGN §15.1 stap 3).
 */

const SLUGS = ['mulberry', 'corona-symbols'] as const;
const START_CONCEPTS = ['pain', 'eat', 'drink', 'toilet', 'tired', 'happy', 'sad', 'help'];

describe('vertaalbestanden van de startset', () => {
  it.each(SLUGS)('%s valideert en elk id bestaat in het manifest', async (slug) => {
    const translation = await loadTranslation(slug);
    const manifest = await loadManifest(slug);
    expect(translation.slug).toBe(slug);
    const ids = new Set(manifest.items.map((item) => item.id));
    const missing = translation.items.filter((item) => !ids.has(item.id)).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it('heeft over alle bestanden heen unieke concepten', async () => {
    const concepts = (await Promise.all(SLUGS.map(loadTranslation))).flatMap((file) =>
      file.items.map((item) => item.concept),
    );
    const duplicates = concepts.filter((concept, index) => concepts.indexOf(concept) !== index);
    expect(duplicates).toEqual([]);
  });

  it('bevat de startconcepten, en alleen die zijn startconcept', async () => {
    const items = (await Promise.all(SLUGS.map(loadTranslation))).flatMap((file) => file.items);
    const start = items.filter((item) => item.is_start).map((item) => item.concept);
    expect(start.sort()).toEqual([...START_CONCEPTS].sort());
  });

  it('vertaalt alle 42 zorgsymbolen van de Plus Collection, nagekeken', async () => {
    const translation = await loadTranslation('corona-symbols');
    expect(translation.items).toHaveLength(42);
    expect(translation.items.every((item) => item.status === 'reviewed')).toBe(true);
  });

  it('weigert een ongeldig vertaalbestand', () => {
    const base = {
      slug: 'x',
      language: 'nl',
      items: [
        {
          id: 1,
          label: 'pijn',
          synonyms: [],
          concept: 'pain',
          context: 'health',
          is_start: true,
          status: 'reviewed',
        },
      ],
    };
    expect(translationFileSchema.safeParse(base).success).toBe(true);
    for (const broken of [
      { ...base, language: 'en' },
      { ...base, items: [{ ...base.items[0], concept: 'Chest Pain' }] },
      { ...base, items: [{ ...base.items[0], context: 'weather' }] },
      { ...base, items: [{ ...base.items[0], status: 'guess' }] },
      { ...base, items: [{ ...base.items[0], label: '' }] },
      { ...base, items: [base.items[0], base.items[0]] },
      { ...base, items: [{ ...base.items[0], extra: true }] },
    ]) {
      expect(translationFileSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('leidt een concept af uit het Engelse label', () => {
    expect(conceptFromEnglish('chest pain')).toBe('chest_pain');
    expect(conceptFromEnglish('Undress , To')).toBe('undress');
    expect(conceptFromEnglish("can't smell")).toBe('cant_smell');
    expect(conceptFromEnglish('COVID-19')).toBe('covid_19');
  });
});

describe('conceptFromEnglish tegen contracts/concept_from_english.json (N8.7)', () => {
  // Dezelfde voorbeelden toetst de agentdienst (machinevertaling): beide kanten maken hetzelfde concept.
  const pairs = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        'contracts',
        'concept_from_english.json',
      ),
      'utf8',
    ),
  ) as [string, string][];
  it.each(pairs)('%s → %s', (label, concept) => {
    expect(conceptFromEnglish(label)).toBe(concept);
  });
});
