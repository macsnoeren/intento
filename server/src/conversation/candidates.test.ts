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
});
