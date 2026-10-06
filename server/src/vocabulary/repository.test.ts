import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { vocabularyEntrySchema } from '@intento/shared';
import { prisma } from '../db/prisma.js';
import { resetAuthData, seedOrganization } from '../test/auth-helpers.js';
import {
  buildSearchText,
  listAvailableVocabulary,
  parseVocabularyItem,
  toVocabularyEntry,
} from './repository.js';

/**
 * Vocabulary-repository (N2.1, INTENTO-NEW-DESIGN §15, §39). De kern is tenant-isolatie: een
 * organisatie ziet de platformitems plus haar eigen items, nooit die van een andere.
 */

async function createItem(data: {
  label: string;
  concept: string;
  organizationId?: string | null;
  status?: string;
  sortOrder?: number;
  sourceRef?: string;
}): Promise<string> {
  const item = await prisma.vocabularyItem.create({
    data: {
      organizationId: data.organizationId ?? null,
      labels: [data.label],
      concepts: [data.concept],
      contexts: ['health'],
      searchText: buildSearchText([data.label], [data.concept]),
      status: data.status ?? 'approved',
      sortOrder: data.sortOrder ?? 0,
      source: data.organizationId ? 'own' : 'seed',
      licenseKey: data.organizationId ? 'own' : 'CC-BY-SA-4.0',
      sourceName: data.sourceRef ? 'Mulberry Symbols' : null,
      sourceRef: data.sourceRef ?? null,
    },
  });
  return item.id;
}

describe('Vocabulary-repository', () => {
  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
  });

  afterAll(async () => {
    await prisma.vocabularyItem.deleteMany();
  });

  it('geeft platformitems plus de eigen organisatie, nooit een andere organisatie', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    await createItem({ label: 'pijn', concept: 'pain', sortOrder: 1 });
    await createItem({ label: 'onze kat', concept: 'our_cat', organizationId: orgA, sortOrder: 2 });
    await createItem({
      label: 'hun hond',
      concept: 'their_dog',
      organizationId: orgB,
      sortOrder: 3,
    });

    const forA = (await listAvailableVocabulary(prisma, orgA)).map((item) => item.labels[0]);
    const forB = (await listAvailableVocabulary(prisma, orgB)).map((item) => item.labels[0]);

    expect(forA).toEqual(['pijn', 'onze kat']);
    expect(forB).toEqual(['pijn', 'hun hond']);
  });

  it('laat ingetrokken items weg', async () => {
    const org = await seedOrganization();
    await createItem({ label: 'pijn', concept: 'pain' });
    await createItem({ label: 'oud', concept: 'old', status: 'retired' });
    expect((await listAvailableVocabulary(prisma, org)).map((i) => i.concepts[0])).toEqual([
      'pain',
    ]);
  });

  it('staat geen dubbele import toe: (sourceName, sourceRef) is uniek', async () => {
    await createItem({ label: 'pijn', concept: 'pain', sourceRef: '123' });
    await expect(
      createItem({ label: 'pijn 2', concept: 'pain2', sourceRef: '123' }),
    ).rejects.toThrow();
  });

  it('valideert de JSON-lijsten bij het lezen', async () => {
    const id = await createItem({ label: 'pijn', concept: 'pain' });
    const row = await prisma.vocabularyItem.findUniqueOrThrow({ where: { id } });
    expect(() => parseVocabularyItem({ ...row, labels: [] })).toThrow();
    expect(() => parseVocabularyItem({ ...row, concepts: 'pain' })).toThrow();
  });

  it('zet een item om naar de compacte vorm van het agentcontract', async () => {
    const org = await seedOrganization();
    await createItem({ label: 'pijn', concept: 'chest_pain' });
    const [item] = await listAvailableVocabulary(prisma, org);
    const entry = toVocabularyEntry(item!);
    expect(vocabularyEntrySchema.parse(entry)).toEqual(entry);
    expect(entry).toMatchObject({ labels: ['pijn'], concepts: ['chest_pain'], is_start: false });
  });

  it('bouwt een zoektekst in kleine letters, met concepten als losse woorden', () => {
    expect(buildSearchText(['Borstpijn', 'pijn op de borst'], ['chest_pain'])).toBe(
      'borstpijn | pijn op de borst | chest pain',
    );
  });
});
