import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { decideNextQuestion } from './decision.js';

/**
 * AI-beslissingslaag (T5.2, DESIGN §7.4–7.6, §7.8). Toetst de kern-acceptatie los van HTTP:
 * onbekende concepten bereiken de gebruiker nooit, herhaalde opties worden uitgesloten, en de
 * confidence stuurt de fase (select/refine/propose) en de ordening.
 */
describe('decideNextQuestion — validatie, herhaling en confidence', () => {
  const mockOrchestrator = new AiOrchestrator(new MockAiProvider());

  /** Bouwt een orchestrator om een provider die een vaste beslissing teruggeeft (voor gerichte tests). */
  function stubOrchestrator(decision: AiQuestionDecision): AiOrchestrator {
    const provider: AiProvider = {
      name: 'stub',
      selectNextQuestion: () => Promise.resolve(decision),
    };
    return new AiOrchestrator(provider);
  }

  const steps = (...concepts: string[]) => concepts.map((selectedConcept) => ({ selectedConcept }));
  const conceptsOf = (d: Awaited<ReturnType<typeof decideNextQuestion>>) =>
    (d.question?.options ?? []).map((o) => o.concept);

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

  it('kiest bij de start de intentie-categorieën (fase select bij lage zekerheid)', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, steps());
    expect(decision.done).toBe(false);
    expect(conceptsOf(decision)).toEqual(
      expect.arrayContaining(['want', 'feel', 'problem', 'ask', 'say']),
    );
    expect(decision.phase).toBe('select');
  });

  it('verfijnt na een keuze (fase refine) en sluit het al gekozen concept uit', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, steps('want'));
    expect(decision.phase).toBe('refine');
    expect(conceptsOf(decision)).toEqual(expect.arrayContaining(['do-activity', 'eat', 'drink']));
    expect(conceptsOf(decision)).not.toContain('want');
  });

  it('stelt bij een eindconcept een boodschap voor (propose, geen vraag)', async () => {
    const decision = await decideNextQuestion(
      prisma,
      mockOrchestrator,
      steps('want', 'do-activity', 'outside', 'walking', 'dog'),
    );
    expect(decision.done).toBe(true);
    expect(decision.question).toBeNull();
    expect(decision.phase).toBe('propose');
  });

  it('laat een door de AI voorgesteld ONBEKEND concept nooit bij de gebruiker komen', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'de gebruiker wil iets nieuws',
      options: [
        { symbol: 'faketeleport', confidence: 0.9 },
        { symbol: 'do-activity', confidence: 0.7 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, steps('want'));

    expect(conceptsOf(decision)).toEqual(['do-activity']); // onbekend concept weggelaten
    expect(decision.proposed).toEqual(['faketeleport']);
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'faketeleport' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('PENDING');
  });

  it('sluit een al gekozen concept uit, ook als de AI het opnieuw aanbiedt (herhaling vermijden)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'herhaalt een eerdere keuze',
      options: [
        { symbol: 'want', confidence: 0.95 }, // al gekozen → moet wegvallen
        { symbol: 'do-activity', confidence: 0.6 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, steps('want'));
    expect(conceptsOf(decision)).not.toContain('want');
    expect(conceptsOf(decision)).toEqual(['do-activity']);
  });

  it('sluit expliciet uitgesloten concepten uit (bv. afgewezen keuze bij correctie, T5.4)', async () => {
    const decision = await decideNextQuestion(prisma, mockOrchestrator, steps('want'), ['eat']);
    expect(conceptsOf(decision)).not.toContain('eat');
    expect(conceptsOf(decision)).toEqual(expect.arrayContaining(['do-activity', 'drink']));
  });

  it('ordent de opties op zekerheid (meest waarschijnlijke eerst)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.7,
      reason: 'ongesorteerd',
      options: [
        { symbol: 'do-activity', confidence: 0.3 },
        { symbol: 'eat', confidence: 0.9 },
        { symbol: 'drink', confidence: 0.6 },
      ],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, steps('want'));
    expect(conceptsOf(decision)).toEqual(['eat', 'drink', 'do-activity']);
  });

  it('stelt vroegtijdig een boodschap voor bij hoge interpretatie-zekerheid (>85%)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je?',
      confidence: 0.92,
      reason: 'zeer zeker',
      options: [{ symbol: 'do-activity', confidence: 0.8 }],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, steps('want'));
    expect(decision.done).toBe(true);
    expect(decision.question).toBeNull();
    expect(decision.phase).toBe('propose');
  });

  it('stelt aan de start nooit voor, ook niet bij hoge zekerheid (er is nog niets gekozen)', async () => {
    const orchestrator = stubOrchestrator({
      question: 'Wat wil je duidelijk maken?',
      confidence: 0.95,
      reason: 'zeker maar geen route',
      options: [{ symbol: 'want', confidence: 0.9 }],
    });
    const decision = await decideNextQuestion(prisma, orchestrator, steps());
    expect(decision.done).toBe(false);
    expect(decision.question).not.toBeNull();
  });
});
