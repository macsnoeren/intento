import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { validateAiOptions } from './validation.js';
import type { AiOption } from './provider.js';

/**
 * Validatielaag (T5.2/T10.6, DESIGN §7.6, §7.8). Dekt beide kanten van de prioriteitsvolgorde:
 * bestaande concepten (direct of via synoniem/label) worden hergebruikt — de **deduplicatie** die
 * bijna-duplicaten voorkomt — en een aantoonbaar nieuw begrip wordt aangemaakt als nieuw woord zodat de
 * gebruiker het kán kiezen, met een `ConceptProposal` voor de beheerder. Staan nieuwe concepten uit, dan
 * blijft het bij het voorstel en bereikt het begrip de gebruiker niet.
 */
describe('validateAiOptions — AAC-begrenzing afdwingen', () => {
  beforeAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  beforeEach(async () => {
    await prisma.conceptProposal.deleteMany();
  });

  afterAll(async () => {
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  const opt = (symbol: string, confidence = 0.8): AiOption => ({ symbol, confidence });

  /** Roept de validatie aan met nieuwe concepten **uit** (het gedrag van vóór T10.6). */
  const validateStrict = (options: AiOption[], reason: string) =>
    validateAiOptions(prisma, { options, reason, allowNewConcepts: false });

  /** Roept de validatie aan met nieuwe concepten **aan**, zonder pictogrambron (placeholder-glyph). */
  const validateOpen = (options: AiOption[], reason: string) =>
    validateAiOptions(prisma, { options, reason, allowNewConcepts: true, icons: null });

  it('houdt een bestaand concept en koppelt het aan het echte symbool', async () => {
    const { valid, proposed } = await validateStrict([opt('walking')], 'reden');
    expect(proposed).toEqual([]);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.symbol.concept).toBe('walking');
    expect(valid[0]!.confidence).toBe(0.8);
  });

  it('zet een synoniem om naar het bestaande concept', async () => {
    // "lopen" is een synoniem van "walking"; "Wandelen" is het label.
    const { valid, proposed } = await validateStrict([opt('lopen'), opt('Wandelen')], 'reden');
    expect(proposed).toEqual([]);
    // Beide verwijzen naar hetzelfde symbool → ontdubbeld tot één.
    expect(valid).toHaveLength(1);
    expect(valid[0]!.symbol.concept).toBe('walking');
  });

  it('laat een onbekend concept weg als nieuwe concepten uitstaan, maar legt het wél vast', async () => {
    const { valid, proposed } = await validateStrict(
      [opt('walking'), opt('teleporteren')],
      'de gebruiker wilde zich verplaatsen',
    );
    // Het onbekende concept bereikt de gebruiker nooit.
    expect(valid.map((v) => v.symbol.concept)).toEqual(['walking']);
    expect(proposed).toEqual(['teleporteren']);

    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'teleporteren' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('PENDING');
    expect(proposal!.reason).toBe('de gebruiker wilde zich verplaatsen');
    expect(proposal!.linkedSymbolId).toBeNull();
  });

  it('is idempotent: hetzelfde onbekende concept levert één openstaand voorstel', async () => {
    await validateStrict([opt('zweven')], 'reden 1');
    await validateStrict([opt('zweven')], 'reden 2');
    const proposals = await prisma.conceptProposal.findMany({ where: { concept: 'zweven' } });
    expect(proposals).toHaveLength(1);
    // Bestaand voorstel wordt niet overschreven (eerste reden blijft staan).
    expect(proposals[0]!.reason).toBe('reden 1');
  });

  it('ontdubbelt herhaalde onbekende concepten binnen één aanroep', async () => {
    const { valid, proposed } = await validateStrict([opt('flauwekul'), opt('flauwekul')], 'reden');
    expect(valid).toEqual([]);
    expect(proposed).toEqual(['flauwekul']);
    expect(await prisma.conceptProposal.count({ where: { concept: 'flauwekul' } })).toBe(1);
  });

  // --- T16.1: semantische deduplicatie (trap 2½) -------------------------------------------------

  it('herkent een bijna-duplicaat en levert het bestaande symbool (T16.1)', async () => {
    // "boterhammen" staat niet als concept, label of synoniem in de bibliotheek — "boterham" (synoniem
    // van `bread`) wel. Zonder de retrieval-stap ná het model zou hier een tweede broodbegrip ontstaan.
    const before = await prisma.aacSymbol.count();
    const { valid, created, proposed } = await validateOpen([opt('boterhammen')], 'reden');

    expect(valid.map((v) => v.symbol.concept)).toEqual(['bread']);
    expect(created).toEqual([]);
    expect(proposed).toEqual([]);
    expect(
      await prisma.conceptProposal.findUnique({ where: { concept: 'boterhammen' } }),
    ).toBeNull();
    expect(await prisma.aacSymbol.count()).toBe(before);
  });

  it('houdt een term die een bestaand begrip alleen bevat apart (drempel, T16.1)', async () => {
    // "warme soep" deelt één van twee woorden met "soep": onder de drempel, dus een eigen begrip. Anders
    // zou de gebruiker het woord kwijtraken dat hij net aangeboden kreeg.
    const { valid, created } = await validateOpen([opt('warme soep')], 'reden');

    expect(valid.map((v) => v.symbol.concept)).toEqual(['warme soep']);
    expect(created).toEqual(['warme soep']);

    await prisma.aacSymbol.delete({ where: { concept: 'warme soep' } });
  });

  it('voegt een langer, ander woord niet samen met een bestaand begrip (T16.1)', async () => {
    // "nagelknipper" begint weliswaar met "nagel", maar is een ander ding. De verbuigingsgrens houdt de
    // deduplicatie bij meervouden en verkleinvormen; hij mag geen begrippen opslokken.
    const { valid, created } = await validateOpen([opt('nagelknipper')], 'reden');

    expect(valid.map((v) => v.symbol.concept)).toEqual(['nagelknipper']);
    expect(created).toEqual(['nagelknipper']);

    await prisma.aacSymbol.delete({ where: { concept: 'nagelknipper' } });
  });

  // --- T10.6: nieuwe concepten -------------------------------------------------------------------

  it('maakt een aantoonbaar nieuw begrip aan als gemarkeerd nieuw woord (T10.6)', async () => {
    const { valid, proposed, created } = await validateOpen(
      [opt('nagelknipper')],
      'de gebruiker wil zijn nagels knippen',
    );

    // Het begrip bereikt de gebruiker nu wél — dat is de uitweg uit andermans woordenschat.
    expect(valid.map((v) => v.symbol.concept)).toEqual(['nagelknipper']);
    expect(created).toEqual(['nagelknipper']);
    expect(proposed).toEqual(['nagelknipper']);

    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'nagelknipper' } });
    expect(symbol).not.toBeNull();
    expect(symbol!.origin).toBe('ai');
    expect(symbol!.reviewStatus).toBe('PENDING');
    // Zonder pictogrambron blijft de neutrale placeholder staan; het gesprek gaat gewoon door.
    expect(symbol!.imageData).toBeNull();

    // En de beheerder ziet het als voorstel.
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'nagelknipper' },
    });
    expect(proposal!.status).toBe('PENDING');

    await prisma.aacSymbol.delete({ where: { concept: 'nagelknipper' } });
  });

  it('maakt GEEN nieuw concept als het begrip al bestaat, ook niet onder een ander woord', async () => {
    // De deduplicatie (trap 1/2) gaat altijd voor: anders loopt de bibliotheek vol met bijna-duplicaten.
    const before = await prisma.aacSymbol.count();
    const { valid, created, proposed } = await validateOpen([opt('lopen')], 'reden');

    expect(valid.map((v) => v.symbol.concept)).toEqual(['walking']);
    expect(created).toEqual([]);
    expect(proposed).toEqual([]);
    expect(await prisma.aacSymbol.count()).toBe(before);
  });

  it('weigert een onbruikbare term als concept (halve zin) en houdt het bij een voorstel', async () => {
    const term = 'ik zou heel graag naar buiten willen om te wandelen met de hond';
    const { valid, created, proposed } = await validateOpen([opt(term)], 'reden');

    expect(valid).toEqual([]);
    expect(created).toEqual([]);
    expect(proposed).toEqual([term]);
    expect(await prisma.aacSymbol.findUnique({ where: { concept: term } })).toBeNull();
  });

  it('zoekt een pictogram bij een nieuw concept via de externe bron (T10.6)', async () => {
    const icons = {
      isConfigured: () => true,
      search: () =>
        Promise.resolve([
          {
            id: '1',
            name: 'tandenborstel',
            imageUrl: 'https://example.test/borstel.png',
            extension: 'png',
            license: 'CC BY-SA',
            licenseUrl: 'https://example.test/licentie',
            author: 'Iemand',
            authorUrl: null,
            sourceUrl: 'https://example.test/bron',
          },
        ]),
      fetchImage: () =>
        Promise.resolve({ contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }),
    };
    const { created } = await validateAiOptions(prisma, {
      options: [opt('tandenborstel')],
      reason: 'reden',
      allowNewConcepts: true,
      icons,
    });

    expect(created).toEqual(['tandenborstel']);
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'tandenborstel' } });
    expect(symbol!.imageMimeType).toBe('image/png');
    expect(symbol!.imageLicense).toBe('CC BY-SA');
    expect(symbol!.imageVersion).toBe(1);

    await prisma.aacSymbol.delete({ where: { concept: 'tandenborstel' } });
  });

  it('laat een falende pictogrambron het gesprek niet ophouden', async () => {
    const icons = {
      isConfigured: () => true,
      search: () => Promise.reject(new Error('extern kapot')),
      fetchImage: () => Promise.reject(new Error('extern kapot')),
    };
    const { created } = await validateAiOptions(prisma, {
      options: [opt('haarborstel')],
      reason: 'reden',
      allowNewConcepts: true,
      icons,
    });

    expect(created).toEqual(['haarborstel']);
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'haarborstel' } });
    expect(symbol!.imageData).toBeNull();

    await prisma.aacSymbol.delete({ where: { concept: 'haarborstel' } });
  });
});
