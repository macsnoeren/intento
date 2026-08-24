import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { collectCandidates, retrievalTerms } from './candidates.js';

/**
 * Kandidatenselectie (T10.2, DESIGN §7.3). Deze tests dekken vooral de **kwaliteit** van de retrieval:
 * de bronvolgorde is elders gedekt (`strategy.behaviour.test.ts`), maar een kandidatenset met onzinnige
 * opties ondermijnt het hele scherm — ook als de rest van de pijplijn klopt.
 */
describe('collectCandidates — retrieval', () => {
  beforeAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  const steps = (...concepts: string[]) => concepts.map((selectedConcept) => ({ selectedConcept }));

  it('matcht niet midden in een woord (T10.10)', async () => {
    // Gevonden in de rooktest: bij "Wat wil je eten?" verscheen een **voet** tussen de opties, omdat
    // "eten" in "voeten" zit — en "warm", omdat het synoniem "zweten" is. Zulke opties doen een
    // gebruiker twijfelen aan het hele scherm.
    const found = await collectCandidates(prisma, {
      steps: steps('want', 'eat'),
      excluded: new Set(['want', 'eat']),
      userId: '',
      limit: 30,
    });

    const concepts = found.candidates.map((symbol) => symbol.concept);
    expect(concepts).not.toContain('foot');
    expect(concepts).not.toContain('hot');
    // De echte verfijningen staan er wél gewoon bij.
    expect(concepts).toEqual(expect.arrayContaining(['soup', 'bread', 'apple']));
  });

  it('vindt een woord nog steeds in verbogen vorm', async () => {
    // Woordbegin, geen exacte match: "hand" moet "handen" blijven vinden, anders wordt de retrieval
    // onbruikbaar.
    const found = await collectCandidates(prisma, {
      steps: steps('problem'),
      excluded: new Set(['problem']),
      userId: '',
      questionContext: 'Heb je pijn aan je handen?',
      limit: 30,
    });

    expect(found.candidates.map((symbol) => symbol.concept)).toContain('hand');
  });

  it('destilleert bruikbare zoektermen en laat functiewoorden vallen', () => {
    const terms = retrievalTerms({ questionContext: 'Wat wil je eten vandaag?' });
    expect(terms).toContain('eten');
    expect(terms).toContain('vandaag');
    expect(terms).not.toContain('wat');
    expect(terms).not.toContain('wil');
  });

  it('biedt tijdsbepalingen aan zodra een vraag een onderwerp heeft (T14.4)', async () => {
    // Gemeld in de zesde gebruikerstest: "Wat eten we **vandaag**?" was niet uit te drukken — de
    // bibliotheek kende geen tijdsbegrippen en de gebruiker kon zijn vraag dus niet in de tijd plaatsen.
    const found = await collectCandidates(prisma, {
      steps: steps('ask', 'ask-what', 'eat'),
      excluded: new Set(['ask', 'ask-what', 'eat']),
      userId: '',
      limit: 30,
    });

    const concepts = found.candidates.map((symbol) => symbol.concept);
    expect(concepts).toContain('today');
    // En ze gaan vóór de boomkinderen: wie "Wat eten we?" preciezer wil maken bedoelt "vandaag", niet
    // "brood" — dat laatste verandert de betekenis van de vraag.
    expect(concepts.indexOf('today')).toBeLessThan(concepts.indexOf('bread'));
    expect(found.counts.time).toBeGreaterThan(0);
    // Chronologisch, niet alfabetisch: anders staat "vandaag" achteraan (na "morgen" en "nu") en valt
    // het bij een klein aanbod weg.
    const tijden = concepts.filter((concept) =>
      ['now', 'soon', 'today', 'tonight', 'tomorrow'].includes(concept),
    );
    expect(tijden).toEqual(['now', 'soon', 'today', 'tonight', 'tomorrow']);
  });

  it('houdt tijdsbepalingen weg bij een wens (T14.4)', async () => {
    // "Ik wil vandaag." is geen boodschap. Een tijdsbepaling hoort bij een vraag, niet bij een wens —
    // daarom staat de regel in deze laag en niet als relatie in de boom.
    const found = await collectCandidates(prisma, {
      steps: steps('want', 'eat'),
      excluded: new Set(['want', 'eat']),
      userId: '',
      limit: 30,
    });

    expect(found.candidates.map((symbol) => symbol.concept)).not.toContain('today');
    expect(found.counts.time).toBe(0);
  });

  it('houdt tijdsbepalingen weg zolang de vraag nog geen onderwerp heeft (T14.4)', async () => {
    const found = await collectCandidates(prisma, {
      steps: steps('ask', 'ask-what'),
      excluded: new Set(['ask', 'ask-what']),
      userId: '',
      limit: 30,
    });

    expect(found.candidates.map((symbol) => symbol.concept)).not.toContain('today');
  });
});
