import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { conversationStateResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiProvider, AiPrompt, AiQuestionDecision } from '../ai/provider.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';

/**
 * Correctieflow — `POST /conversation/{id}/correction` (T5.4, DESIGN §3.4, §7.5, FR-009).
 *
 * Toetst de acceptatie end-to-end via HTTP: na ❌ volgt een **gerichte hervraag** over de vermoedelijke
 * foutstap (niet terug naar het begin), de afgewezen route wordt niet opnieuw aangeboden, de correctie
 * wordt vastgelegd als `CorrectionEvent`, en er wordt niets geleerd/opgeslagen (geen boodschap, sessie
 * blijft actief).
 */
describe('correctieflow — /conversation/{id}/correction (T5.4)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /**
   * Provider die één specifieke stap onzeker maakt: wanneer de laatste keuze `lowConfidenceAfter` is,
   * geeft hij een lage interpretatie-zekerheid terug, anders een normale (blijft onder de voorsteldrempel
   * zodat de route doorloopt). Zo is deterministisch te sturen welke stap de heranalyse als foutstap kiest.
   */
  function tunedProvider(lowConfidenceAfter: string): AiProvider {
    return {
      name: 'tuned',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        const options = prompt.availableSymbols.map((ref, index) => ({
          symbol: ref.concept,
          confidence: Math.max(0.3, 0.7 - index * 0.1),
        }));
        const low = prompt.lastChoice?.concept === lowConfidenceAfter;
        return Promise.resolve({
          question: prompt.lastChoice
            ? `Wat past bij "${prompt.lastChoice.label}"?`
            : 'Wat wil je?',
          options,
          confidence: low ? 0.2 : 0.7,
          reason: 'tuned test provider',
        });
      },
    };
  }

  async function symbolId(concept: string): Promise<string> {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept } });
    if (!symbol) throw new Error(`Onbekend seed-concept: ${concept}`);
    return symbol.id;
  }

  async function startFor(
    orchestrator: AiOrchestrator,
  ): Promise<{ cookie: string; sessionId: string }> {
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
      orchestrator,
    });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    return { cookie, sessionId: conversationStateResponseSchema.parse(res.json()).sessionId };
  }

  /** Voert één keuze uit (`/next`) en geeft de nieuwe toestand terug. */
  async function next(cookie: string, sessionId: string, concept: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId(concept) },
    });
    expect(res.statusCode).toBe(200);
    return conversationStateResponseSchema.parse(res.json());
  }

  it('herstelt de vermoedelijke foutstap gericht en biedt de afgewezen route niet opnieuw aan', async () => {
    // `do-activity` is de onzekere stap → de heranalyse moet die als foutstap kiezen.
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');
    await next(cookie, sessionId, 'outside');

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const state = conversationStateResponseSchema.parse(res.json());

    // Gerichte hervraag op het teruggerolde punt: alleen "want" resteert in de historie (stap 0), de
    // foutstap "do-activity" en alles erna is teruggerold — niet terug naar het begin.
    expect(state.history.map((step) => step.symbol.concept)).toEqual(['want']);
    expect(state.question).not.toBeNull();

    // De afgewezen route ("do-activity") wordt niet opnieuw aangeboden (§7.5).
    const shown = (state.question?.options ?? []).map((o) => o.concept);
    expect(shown).not.toContain('do-activity');
    expect(shown.length).toBeGreaterThan(0);

    // De correctie is vastgelegd als signaal (maar er wordt niet van geleerd).
    const events = await prisma.correctionEvent.findMany({ where: { sessionId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('wrong_guess');
    expect(events[0]!.rejectedConcept).toBe('do-activity');
    expect(events[0]!.stepOrder).toBe(1);

    // Niets geleerd/opgeslagen: geen boodschap bewaard, sessie nog actief.
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(0);
    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session!.status).toBe('ACTIVE');
  });

  it('blijft de afgewezen route uitsluiten bij vervolgkeuzes in dezelfde sessie', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');
    await next(cookie, sessionId, 'outside');

    await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: {},
    });

    // Kies een alternatief ("drink") en ga daarna terug: "do-activity" blijft weg uit de opties.
    const afterDrink = await next(cookie, sessionId, 'drink');
    expect(afterDrink.history.map((s) => s.symbol.concept)).toEqual(['want', 'drink']);

    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie },
      payload: {},
    });
    const state = conversationStateResponseSchema.parse(back.json());
    expect((state.question?.options ?? []).map((o) => o.concept)).not.toContain('do-activity');
  });

  it('weigert een correctie zonder keuzes (400)', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('none')));
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_STEPS_TO_CORRECT');
  });

  it('weigert een onbekend correctietype (400)', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));
    await next(cookie, sessionId, 'want');
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'sabotage' },
    });
    expect(res.statusCode).toBe(400);
  });
});
