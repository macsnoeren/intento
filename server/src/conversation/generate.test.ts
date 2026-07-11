import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiMessagePrompt, AiMessageResult, AiProvider } from '../ai/provider.js';
import { SCRIPTED_CONFIDENCE, type ChosenConcept } from './message.js';
import { composeMessage } from './generate.js';

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
});
