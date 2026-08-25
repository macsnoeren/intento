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

  /** ❌ Nee indrukken; geeft de nieuwe toestand terug. */
  async function reject(cookie: string, sessionId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    return conversationStateResponseSchema.parse(res.json());
  }

  it('verfijnt bij de eerste ❌ en houdt de route intact (T10.12)', async () => {
    // Gemeld in de gebruikerstest: op "Ik wil brood eten." wilde de gebruiker zeggen dat hij er
    // chocopasta op wil, maar ❌ leverde appel en banaan op — de bróértjes van brood. De goedkoopste
    // verklaring van ❌ is "nog niet precies genoeg", dus die proberen we eerst.
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');
    await next(cookie, sessionId, 'outside');

    const state = await reject(cookie, sessionId);

    // Niets teruggerold en niets uitgesloten: de gebruiker krijgt de kans preciezer te worden.
    expect(state.history.map((step) => step.symbol.concept)).toEqual([
      'want',
      'do-activity',
      'outside',
    ]);
    expect(state.question).not.toBeNull();
    // Er wordt niets uitgesloten: geen enkele vastlegging draagt een afgewezen concept. De verfijnronde
    // zelf staat er sinds T12.3 wél, als gebeurtenis zonder gevolg — anders is in de terugblik niet te
    // zien waarom het gesprek hier een wending nam.
    expect(
      await prisma.correctionEvent.count({
        where: { sessionId, rejectedConcept: { not: null } },
      }),
    ).toBe(0);
    const events = await prisma.correctionEvent.findMany({ where: { sessionId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'refine_round', rejectedConcept: null });
  });

  it('rolt bij de tweede ❌ één stap terug en biedt de afgewezen keuze niet opnieuw aan', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');
    await next(cookie, sessionId, 'outside');

    await reject(cookie, sessionId); // verfijnronde
    const state = await reject(cookie, sessionId); // nu pas terugrollen

    // Precies één stap terug (T10.10): "outside" verdwijnt, de rest van de route blijft staan — de
    // gebruiker koos "want" en "do-activity" zelf en die worden niet weggegooid omdat de AI onzeker was.
    expect(state.history.map((step) => step.symbol.concept)).toEqual(['want', 'do-activity']);
    expect(state.question).not.toBeNull();

    // De afgewezen keuze wordt niet opnieuw aangeboden (§7.5).
    const shown = (state.question?.options ?? []).map((o) => o.concept);
    expect(shown).not.toContain('outside');
    expect(shown.length).toBeGreaterThan(0);

    // De correctie is vastgelegd als signaal (maar er wordt niet van geleerd). Er staat er nu één die
    // iets uitsluit — de terugrol — naast de verfijnronde van de eerste ❌ (T12.3), die niets uitsluit.
    const events = await prisma.correctionEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((event) => event.type)).toEqual(['refine_round', 'wrong_guess']);
    const excluding = events.filter((event) => event.rejectedConcept !== null);
    expect(excluding).toHaveLength(1);
    expect(excluding[0]!.type).toBe('wrong_guess');
    expect(excluding[0]!.rejectedConcept).toBe('outside');
    expect(excluding[0]!.stepOrder).toBe(2);

    // Niets geleerd/opgeslagen: geen boodschap bewaard, sessie nog actief.
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(0);
    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session!.status).toBe('ACTIVE');
  });

  it('rolt bij herhaald ❌ de route stap voor stap terug (T10.10/T10.12)', async () => {
    // Dit is de bevinding uit de derde gebruikerstest: ❌ bracht de gebruiker in één klap terug naar het
    // startscherm, met zijn eigen eerste keuze permanent uitgesloten. Nu krijgt hij eerst de kans om
    // preciezer te worden, en daarna loopt hij zijn route stap voor stap terug in zijn eigen tempo.
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');

    await reject(cookie, sessionId); // verfijnronde op "do-activity"
    const first = await reject(cookie, sessionId);
    expect(first.history.map((step) => step.symbol.concept)).toEqual(['want']);

    await reject(cookie, sessionId); // verfijnronde op "want"
    const second = await reject(cookie, sessionId);
    expect(second.history).toEqual([]);
    // Pas na herhaald afwijzen is "want" weg — omdat de gebruiker dat zelf steeds opnieuw aangaf.
    expect(second.question).not.toBeNull();
    expect((second.question?.options ?? []).map((o) => o.concept)).not.toContain('want');
  });

  it('blijft de afgewezen route uitsluiten bij vervolgkeuzes in dezelfde sessie', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('do-activity')));

    await next(cookie, sessionId, 'want');
    await next(cookie, sessionId, 'do-activity');
    await next(cookie, sessionId, 'outside');

    await reject(cookie, sessionId); // verfijnronde
    await reject(cookie, sessionId); // en nu pas terugrollen

    // Na de correctie staat de route op `want > do-activity` en is "outside" uitgesloten. Kies een
    // alternatief en ga daarna terug: "outside" blijft weg uit de opties.
    const afterCycling = await next(cookie, sessionId, 'cycling');
    expect(afterCycling.history.map((s) => s.symbol.concept)).toEqual([
      'want',
      'do-activity',
      'cycling',
    ]);

    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie },
      payload: {},
    });
    const state = conversationStateResponseSchema.parse(back.json());
    expect((state.question?.options ?? []).map((o) => o.concept)).not.toContain('outside');
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

  it('geeft bij "Geen van deze past" andere opties zonder een keuze terug te rollen (T9.12)', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('none')));

    await next(cookie, sessionId, 'problem');
    const before = await next(cookie, sessionId, 'pain');
    const shownBefore = (before.question?.options ?? []).map((o) => o.concept);
    expect(shownBefore.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'no_fitting_option' },
    });
    expect(res.statusCode).toBe(200);
    const state = conversationStateResponseSchema.parse(res.json());

    // De gemaakte keuzes blijven staan — dit is geen "terug", maar "hier staat het niet tussen".
    expect(state.history.map((step) => step.symbol.concept)).toEqual(['problem', 'pain']);
    // Er is weer iets te kiezen, en geen enkele eerder getoonde optie zit er nog bij.
    expect(state.question).not.toBeNull();
    const shownAfter = (state.question?.options ?? []).map((o) => o.concept);
    expect(shownAfter.length).toBeGreaterThan(0);
    for (const concept of shownBefore) {
      expect(shownAfter).not.toContain(concept);
    }

    // Elke overgeslagen optie is als signaal vastgelegd (geen leerdata; §3.4 punt 4).
    const events = await prisma.correctionEvent.findMany({ where: { sessionId } });
    expect(events.map((event) => event.type)).toEqual(shownBefore.map(() => 'no_fitting_option'));
    expect(events.map((event) => event.rejectedConcept).sort()).toEqual([...shownBefore].sort());
  });

  it('laat "Geen van deze past" nooit een leeg startscherm achter (T9.12)', async () => {
    const { cookie, sessionId } = await startFor(new AiOrchestrator(tunedProvider('none')));

    // Op het startscherm alles overslaan: de intentiecategorieën komen gewoon terug (een leeg scherm
    // is nooit een geldige uitkomst) in plaats van een boodschap uit het niets.
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'no_fitting_option' },
    });
    expect(res.statusCode).toBe(200);
    const state = conversationStateResponseSchema.parse(res.json());
    expect(state.done).toBe(false);
    expect((state.question?.options ?? []).length).toBeGreaterThan(0);
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
