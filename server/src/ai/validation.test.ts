import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { validateAiOptions } from './validation.js';
import type { AiOption } from './provider.js';

/**
 * Validatielaag (T5.2, DESIGN §7.6, §7.8). Dekt de acceptatie: een door de AI voorgesteld **onbekend**
 * concept bereikt de gebruiker nooit — het wordt weggelaten en als `ConceptProposal` vastgelegd — terwijl
 * bestaande concepten (direct of via synoniem/label) behouden blijven.
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

  it('houdt een bestaand concept en koppelt het aan het echte symbool', async () => {
    const { valid, proposed } = await validateAiOptions(prisma, [opt('walking')], 'reden');
    expect(proposed).toEqual([]);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.symbol.concept).toBe('walking');
    expect(valid[0]!.confidence).toBe(0.8);
  });

  it('zet een synoniem om naar het bestaande concept', async () => {
    // "lopen" is een synoniem van "walking"; "Wandelen" is het label.
    const { valid, proposed } = await validateAiOptions(
      prisma,
      [opt('lopen'), opt('Wandelen')],
      'reden',
    );
    expect(proposed).toEqual([]);
    // Beide verwijzen naar hetzelfde symbool → ontdubbeld tot één.
    expect(valid).toHaveLength(1);
    expect(valid[0]!.symbol.concept).toBe('walking');
  });

  it('vangt een onbekend concept af als ConceptProposal en laat het weg', async () => {
    const { valid, proposed } = await validateAiOptions(
      prisma,
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
    await validateAiOptions(prisma, [opt('zweven')], 'reden 1');
    await validateAiOptions(prisma, [opt('zweven')], 'reden 2');
    const proposals = await prisma.conceptProposal.findMany({ where: { concept: 'zweven' } });
    expect(proposals).toHaveLength(1);
    // Bestaand voorstel wordt niet overschreven (eerste reden blijft staan).
    expect(proposals[0]!.reason).toBe('reden 1');
  });

  it('ontdubbelt herhaalde onbekende concepten binnen één aanroep', async () => {
    const { valid, proposed } = await validateAiOptions(
      prisma,
      [opt('flauwekul'), opt('flauwekul')],
      'reden',
    );
    expect(valid).toEqual([]);
    expect(proposed).toEqual(['flauwekul']);
    expect(await prisma.conceptProposal.count({ where: { concept: 'flauwekul' } })).toBe(1);
  });
});
