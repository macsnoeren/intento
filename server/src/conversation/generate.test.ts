import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiMessagePrompt, AiMessageResult, AiProvider } from '../ai/provider.js';
import { SCRIPTED_CONFIDENCE, type ChosenConcept } from './message.js';
import { composeMessage, containsTerm, isMeaningBearingTerm } from './generate.js';

/**
 * AI-boodschapgeneratie met safety-vangnet (T5.3, DESIGN §7.4, §7.8). Toetst los van HTTP: de zin komt
 * van de AI wanneer die er is en veilig is, maar bevat **nooit** een concept buiten de sessie — dan valt
 * hij terug op de deterministische sjabloon-zin.
 */
describe('composeMessage — AI-zin met AAC-begrenzing', () => {
  // De voorbeeldroute uit DESIGN §3.1: 🎯 willen → iets doen → buiten → wandelen → met hond.
  const dogRoute: ChosenConcept[] = [
    { concept: 'want', label: 'Iets willen' },
    { concept: 'do-activity', label: 'Iets doen' },
    { concept: 'outside', label: 'Buiten' },
    { concept: 'walking', label: 'Wandelen' },
    { concept: 'dog', label: 'Hond' },
  ];

  /** Orchestrator om een provider die een vaste boodschap teruggeeft (voor gerichte tests). */
  function stubOrchestrator(generate: (p: AiMessagePrompt) => AiMessageResult): AiOrchestrator {
    const provider: AiProvider = {
      name: 'stub',
      selectNextQuestion: () => Promise.reject(new Error('niet gebruikt')),
      generateMessage: (prompt) => Promise.resolve(generate(prompt)),
    };
    return new AiOrchestrator(provider);
  }

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

  it('valt terug op de sjabloon-zin als de provider geen boodschap kan formuleren', async () => {
    const orchestrator = new AiOrchestrator(new MockAiProvider()); // geen generateMessage
    expect(orchestrator.canGenerateMessage).toBe(false);

    const result = await composeMessage(prisma, orchestrator, dogRoute);
    expect(result.source).toBe('scripted');
    expect(result.message).toBe('Ik wil buiten wandelen met mijn hond.');
    expect(result.confidence).toBe(SCRIPTED_CONFIDENCE);
  });

  it('gebruikt de AI-zin wanneer die binnen de gekozen concepten blijft', async () => {
    const aiSentence = 'Ik wil graag lekker naar buiten om te wandelen met mijn hond.';
    const orchestrator = stubOrchestrator(() => ({ message: aiSentence, confidence: 0.91 }));

    const result = await composeMessage(prisma, orchestrator, dogRoute);
    expect(result.source).toBe('ai');
    expect(result.message).toBe(aiSentence);
    expect(result.confidence).toBe(0.91);
  });

  it('houdt een AI-zin met een concept buiten de sessie tegen (§7.8) en valt terug op de sjabloon', async () => {
    // "mama" is een synoniem van het niet-gekozen concept `mom` — dat mag de zin nooit binnensluipen.
    const orchestrator = stubOrchestrator(() => ({
      message: 'Ik wil buiten wandelen met mijn hond en mama.',
      confidence: 0.99,
    }));

    const result = await composeMessage(prisma, orchestrator, dogRoute);
    expect(result.source).toBe('scripted');
    expect(result.message).toBe('Ik wil buiten wandelen met mijn hond.');
    expect(result.message.toLowerCase()).not.toContain('mama');
  });

  it('valt terug op de sjabloon bij een lege AI-zin', async () => {
    const orchestrator = stubOrchestrator(() => ({ message: '   ', confidence: 0.9 }));
    const result = await composeMessage(prisma, orchestrator, dogRoute);
    expect(result.source).toBe('scripted');
  });

  it('geeft de bevestigde concepten (niet meer, niet minder) door aan de provider', async () => {
    let seen: string[] = [];
    const orchestrator = stubOrchestrator((prompt) => {
      seen = prompt.chosenConcepts.map((c) => c.concept);
      return { message: 'Ik wil buiten wandelen met mijn hond.', confidence: 0.9 };
    });

    await composeMessage(prisma, orchestrator, dogRoute);
    expect(seen).toEqual(['want', 'do-activity', 'outside', 'walking', 'dog']);
  });

  it('gebruikt de neutrale terugval-zekerheid als de provider geen confidence levert', async () => {
    const orchestrator = stubOrchestrator(() => ({
      message: 'Ik wil buiten wandelen met mijn hond.',
    }));
    const result = await composeMessage(prisma, orchestrator, dogRoute);
    expect(result.source).toBe('ai');
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  // --- T10.9: functiewoorden zijn geen bewijs van een concept ----------------------------------------

  describe('betekenisdragende concepten (T10.9)', () => {
    /** Route zonder intentie: één AI-aangedragen concept, precies zoals in de rooktest van T10.6. */
    const clipperRoute: ChosenConcept[] = [{ concept: 'nagelknipper', label: 'Nagelknipper' }];

    beforeAll(async () => {
      await prisma.aacSymbol.create({
        data: {
          concept: 'nagelknipper',
          label: 'Nagelknipper',
          category: 'object',
          glyph: '✂️',
          synonyms: ['nagelschaartje'],
          searchText: 'nagelknipper nagelschaartje',
          origin: 'ai',
          reviewStatus: 'PENDING',
        },
      });
    });

    it('keurt "Ik wil de nagelknipper." goed: "wil" is zinsbouw, geen smokkelroute voor `want`', async () => {
      const aiSentence = 'Ik wil de nagelknipper.';
      const orchestrator = stubOrchestrator(() => ({ message: aiSentence, confidence: 0.9 }));

      const result = await composeMessage(prisma, orchestrator, clipperRoute);
      expect(result.source).toBe('ai');
      expect(result.message).toBe(aiSentence);
    });

    it('weigert nog steeds een zin met een écht niet-gekozen begrip', async () => {
      const orchestrator = stubOrchestrator(() => ({
        message: 'Ik wil buiten wandelen.',
        confidence: 0.99,
      }));

      const result = await composeMessage(prisma, orchestrator, clipperRoute);
      expect(result.source).toBe('scripted');
      expect(result.message).toBe('Ik wil iets zeggen over nagelknipper.');
    });

    it('weigert een zin met een kort contentwoord van een niet-gekozen concept', async () => {
      // Geen lengteregel maar een woordklasse: "sap" (synoniem/fragment van `juice`) telt gewoon mee.
      const orchestrator = stubOrchestrator(() => ({
        message: 'Ik wil de nagelknipper en sap.',
        confidence: 0.99,
      }));

      const result = await composeMessage(prisma, orchestrator, clipperRoute);
      expect(result.source).toBe('scripted');
    });
  });

  // --- T10.10: buigingsvormen glippen er niet meer langs ---------------------------------------------

  describe('buigingsvormen (T10.10)', () => {
    /** De route uit de gebruikerstest: "Iets willen" → "Eten", verder niets concreets. */
    const eatRoute: ChosenConcept[] = [
      { concept: 'want', label: 'Iets willen', category: 'intent' },
      { concept: 'eat', label: 'Eten' },
    ];

    it('weigert "Ik wil iets warms eten." — `hot` ("Warm") is niet gekozen', async () => {
      // Gereproduceerd in de gebruikerstest: de check matchte op hele woorden, dus " warms " ontsnapte
      // terwijl `hot` het label "Warm" en het synoniem "warm" draagt. Zo kwam een concept dat de
      // gebruiker nooit koos tóch in zijn boodschap (§7.8).
      const orchestrator = stubOrchestrator(() => ({
        message: 'Ik wil iets warms eten.',
        confidence: 0.9,
      }));

      const result = await composeMessage(prisma, orchestrator, eatRoute);
      expect(result.source).toBe('scripted');
      expect(result.message).not.toContain('warms');
    });

    it('laat een zin binnen de gekozen concepten gewoon door', async () => {
      const aiSentence = 'Ik wil graag eten.';
      const orchestrator = stubOrchestrator(() => ({ message: aiSentence, confidence: 0.9 }));

      const result = await composeMessage(prisma, orchestrator, eatRoute);
      expect(result.source).toBe('ai');
      expect(result.message).toBe(aiSentence);
    });
  });
});

describe('containsTerm — hele woorden en korte buigingsvormen (T10.10)', () => {
  const haystack = ' ik wil iets warms eten met de handen ';

  it('herkent het hele woord', () => {
    expect(containsTerm(haystack, 'eten')).toBe(true);
  });

  it('herkent een korte buigingsvorm', () => {
    expect(containsTerm(haystack, 'warm')).toBe(true);
    expect(containsTerm(haystack, 'hand')).toBe(true);
  });

  it('rekt korte woorden niet op (te veel valse treffers)', () => {
    // Onder de stamlengte blijft het een hele-woord-match: "ete" bewijst niets over "eten".
    expect(containsTerm(haystack, 'ete')).toBe(false);
  });

  it('knoopt geen woordfamilies aan elkaar', () => {
    // Meer dan twee tekens verschil is geen buiging meer.
    expect(containsTerm(' ik ga naar de bedoeling ', 'bedoel')).toBe(false);
  });

  it('houdt meerwoordige termen exact', () => {
    expect(containsTerm(' ik wil met hond wandelen ', 'met hond')).toBe(true);
    expect(containsTerm(' ik wil met honden wandelen ', 'met hond')).toBe(false);
  });
});

/** De woordklasse-regel zelf, los van de bibliotheek en de database. */
describe('isMeaningBearingTerm', () => {
  it('rekent losse functiewoorden niet als bewijs van een concept', () => {
    for (const term of ['wil', 'willen', 'ik', 'de', 'met', 'iets willen']) {
      expect(isMeaningBearingTerm(term)).toBe(false);
    }
  });

  it('houdt contentwoorden en frases met een contentwoord overeind', () => {
    for (const term of ['buiten', 'naar buiten', 'mama', 'mam', 'sap', 'met hond']) {
      expect(isMeaningBearingTerm(term)).toBe(true);
    }
  });
});
