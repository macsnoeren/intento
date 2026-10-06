import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { writeStoredFile } from '../storage/files.js';
import type { Manifest } from './global-symbols.js';
import type { ImageIndex } from './images.js';
import { listAvailableVocabulary } from './repository.js';
import { licenseKeyFor, seedNoImageItem, seedSet } from './seed.js';
import type { TranslationFile } from './translation.js';
import { resetAuthData, seedOrganization } from '../test/auth-helpers.js';

/** Seed van de startset (N2.7, INTENTO-NEW-DESIGN §15, §15.1). */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>';
const SHA = 'a'.repeat(64);

const manifest: Manifest = {
  slug: 'testset',
  name: 'Testset Symbols',
  publisher: 'Uitgever',
  publisher_url: 'https://example.org/',
  licence: {
    name: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    version: '4.0',
    properties: 'by-sa',
  },
  source: 'https://globalsymbols.com/api/v1/pictos?symbolset=testset',
  total: 4,
  items: [1, 2, 3, 4].map((id) => ({
    id,
    part_of_speech: 'noun',
    image_url: `https://globalsymbols.com/${id}.svg`,
    format: 'svg',
    labels: { eng: `word ${id}`, deu: null, fra: null },
  })),
};

const translation: TranslationFile = {
  slug: 'testset',
  language: 'nl',
  items: [
    {
      id: 1,
      label: 'pijn',
      synonyms: ['zeer'],
      concept: 'pain',
      context: 'health',
      is_start: true,
      status: 'reviewed',
    },
    {
      id: 2,
      label: 'hoofd',
      synonyms: [],
      concept: 'head',
      context: 'body',
      is_start: false,
      status: 'machine',
    },
    // id 3 heeft geen vertaling; id 4 wel, maar geen afbeelding.
    {
      id: 4,
      label: 'buik',
      synonyms: [],
      concept: 'belly',
      context: 'body',
      is_start: false,
      status: 'reviewed',
    },
  ],
};

describe('seed van de startset', () => {
  let storageDir: string;
  let index: ImageIndex;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    storageDir = await mkdtemp(join(tmpdir(), 'intento-seed-'));
    index = {};
    for (const id of [1, 2, 3]) {
      const assetPath = `seed/testset/${id}.svg`;
      await writeStoredFile(storageDir, assetPath, Buffer.from(SVG));
      index[String(id)] = { assetPath, mimeType: 'image/svg+xml', sha256: SHA, bytes: SVG.length };
    }
  });

  afterAll(async () => {
    await prisma.vocabularyItem.deleteMany();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('maakt alleen items met een vertaling én een afbeelding, met licentie en bron', async () => {
    const report = await seedSet(prisma, { manifest, translation, index, storageDir });
    expect(report).toEqual({ created: 2, updated: 0, skippedNoImage: [4] });

    const items = await prisma.vocabularyItem.findMany({ orderBy: { sourceRef: 'asc' } });
    expect(items.map((item) => item.sourceRef)).toEqual(['1', '2']);
    for (const item of items) {
      expect(item).toMatchObject({
        organizationId: null,
        source: 'seed',
        licenseKey: 'CC-BY-SA-4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        author: 'Uitgever',
        sourceName: 'Testset Symbols',
        sourceUrl: 'https://globalsymbols.com/symbolsets/testset',
        status: 'approved',
        mimeType: 'image/svg+xml',
      });
      expect(item.assetPath).toMatch(/^seed\/testset\/\d\.svg$/);
    }
    expect(items[0]).toMatchObject({
      labels: ['pijn', 'zeer'],
      concepts: ['pain'],
      isStart: true,
      sortOrder: 1,
      labelStatus: 'reviewed',
    });
    expect(items[1]).toMatchObject({ labelStatus: 'machine', isStart: false });
  });

  it('draait twee keer zonder dubbelingen', async () => {
    await seedSet(prisma, { manifest, translation, index, storageDir });
    const second = await seedSet(prisma, { manifest, translation, index, storageDir });
    expect(second).toMatchObject({ created: 0, updated: 2 });
    expect(await prisma.vocabularyItem.count()).toBe(2);
  });

  it('overschrijft een in de app nagekeken label niet, en raakt de status niet', async () => {
    await seedSet(prisma, { manifest, translation, index, storageDir });
    await prisma.vocabularyItem.updateMany({
      where: { sourceRef: '1' },
      data: { labels: ['au'], status: 'retired' },
    });
    await seedSet(prisma, { manifest, translation, index, storageDir });
    const item = await prisma.vocabularyItem.findFirstOrThrow({ where: { sourceRef: '1' } });
    expect(item.labels).toEqual(['au']);
    expect(item.status).toBe('retired');
  });

  it('werkt een machinevertaling wel bij', async () => {
    await seedSet(prisma, { manifest, translation, index, storageDir });
    const better: TranslationFile = {
      ...translation,
      items: translation.items.map((item) => (item.id === 2 ? { ...item, label: 'kop' } : item)),
    };
    await seedSet(prisma, { manifest, translation: better, index, storageDir });
    const item = await prisma.vocabularyItem.findFirstOrThrow({ where: { sourceRef: '2' } });
    expect(item.labels).toEqual(['kop']);
  });

  it('maakt het eigen item "geen afbeelding", idempotent, en het is beschikbaar', async () => {
    await seedNoImageItem(prisma, storageDir);
    await seedNoImageItem(prisma, storageDir);
    const org = await seedOrganization();
    const available = await listAvailableVocabulary(prisma, org);
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      concepts: ['no_image'],
      licenseKey: 'own',
      mimeType: 'image/svg+xml',
    });
  });

  it('zet de licentie van Global Symbols om naar een vaste sleutel', () => {
    expect(licenseKeyFor(manifest.licence)).toBe('CC-BY-SA-4.0');
    expect(licenseKeyFor({ name: 'CC0', url: null, version: null, properties: 'cc0' })).toBe('CC0');
    expect(licenseKeyFor({ name: '?', url: null, version: null, properties: null })).toBe(
      'UNKNOWN',
    );
  });
});
