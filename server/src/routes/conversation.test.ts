import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  conversationChoiceResponseSchema,
  conversationConfirmResponseSchema,
  conversationGenerateResponseSchema,
  conversationStateResponseSchema,
  type ConversationStateResponse,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { ROOT_PROMPT } from '../conversation/engine.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';

/**
 * Gespreksflow — sessies en stappen (T4.1, DESIGN §3.1, §6.2, §8.2, FR-001/005/006/010).
 *
 * Dekt de acceptatie: de volledige voorbeeldroute uit DESIGN §3.1 via de API, de terug-functie die de
 * vorige opties **exact** herstelt, en gebruiker-gebonden isolatie (een apparaat ziet nooit de sessies
 * van een andere gebruiker). Plus de harde randen: keuze buiten de opties, ongeauthenticeerd, afgeronde
 * sessie, en niets om ongedaan te maken.
 */
describe('gespreksflow — /conversation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    // AAC is niet tenant-gebonden en wordt door resetAuthData niet aangeraakt; idempotent (her)seeden.
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /** Zoekt het symbool-id bij een concept (om als keuze mee te sturen). */
  async function symbolId(concept: string): Promise<string> {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept } });
    if (!symbol) throw new Error(`Onbekend seed-concept: ${concept}`);
    return symbol.id;
  }

  /** Start een sessie voor een verse gebruiker en geeft de state + device-cookie terug. */
  async function startSession(): Promise<{ cookie: string; state: ConversationStateResponse }> {
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    return { cookie, state: conversationStateResponseSchema.parse(res.json()) };
  }

  /** Stuurt een keuze in via /next en geeft de nieuwe state terug. */
  async function next(
    cookie: string,
    sessionId: string,
    concept: string,
  ): Promise<ConversationStateResponse> {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId(concept) },
    });
    expect(res.statusCode).toBe(200);
    return conversationStateResponseSchema.parse(res.json());
  }

  const concepts = (state: ConversationStateResponse): string[] =>
    (state.question?.options ?? []).map((option) => option.concept);

  it('start toont de intentie-categorieën als eerste vraag', async () => {
    const { state } = await startSession();
    expect(state.status).toBe('ACTIVE');
    expect(state.done).toBe(false);
    expect(state.question?.prompt).toBe(ROOT_PROMPT);
    expect(concepts(state)).toEqual(
      expect.arrayContaining(['want', 'feel', 'problem', 'ask', 'say']),
    );
    expect(state.history).toEqual([]);
  });

  it('doorloopt de volledige voorbeeldroute uit DESIGN §3.1 tot een eindconcept', async () => {
    const { cookie, state } = await startSession();
    const sessionId = state.sessionId;

    // 🎯 Iets willen → 🚶 Iets doen → 🌳 Buiten → 🚶 Wandelen → 🐕 Met hond.
    const s1 = await next(cookie, sessionId, 'want');
    expect(concepts(s1)).toEqual(expect.arrayContaining(['do-activity', 'eat', 'drink']));

    const s2 = await next(cookie, sessionId, 'do-activity');
    expect(concepts(s2)).toContain('outside');

    const s3 = await next(cookie, sessionId, 'outside');
    expect(concepts(s3)).toEqual(expect.arrayContaining(['walking', 'cycling']));

    const s4 = await next(cookie, sessionId, 'walking');
    expect(concepts(s4)).toEqual(expect.arrayContaining(['dog', 'park']));

    // 🐕 Hond is een eindconcept: geen verdere vraag, klaar voor een voorstel (T4.3).
    const s5 = await next(cookie, sessionId, 'dog');
    expect(s5.done).toBe(true);
    expect(s5.question).toBeNull();
    expect(s5.history.map((step) => step.symbol.concept)).toEqual([
      'want',
      'do-activity',
      'outside',
      'walking',
      'dog',
    ]);

    // Alle vijf stappen zijn opgeslagen, op volgorde.
    const stored = await prisma.conversationStep.findMany({
      where: { sessionId },
      orderBy: { order: 'asc' },
    });
    expect(stored.map((step) => step.selectedConcept)).toEqual([
      'want',
      'do-activity',
      'outside',
      'walking',
      'dog',
    ]);
  });

  it('terug herstelt de vorige vraag en opties exact', async () => {
    const { cookie, state } = await startSession();
    const sessionId = state.sessionId;

    await next(cookie, sessionId, 'want');
    const beforeOutside = await next(cookie, sessionId, 'do-activity'); // vraag na 'do-activity'
    const afterOutside = await next(cookie, sessionId, 'outside'); // volgende vraag
    expect(concepts(afterOutside)).not.toEqual(concepts(beforeOutside));

    // Terug na de keuze 'outside' moet exact de vraag+opties van vóór die keuze teruggeven.
    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie },
    });
    expect(back.statusCode).toBe(200);
    const restored = conversationStateResponseSchema.parse(back.json());
    expect(restored.question?.prompt).toBe(beforeOutside.question?.prompt);
    expect(concepts(restored)).toEqual(concepts(beforeOutside));
    expect(restored.history.map((s) => s.symbol.concept)).toEqual(['want', 'do-activity']);

    // De ongedaan gemaakte stap is echt verwijderd.
    expect(await prisma.conversationStep.count({ where: { sessionId } })).toBe(2);
  });

  it('weigert een keuze die niet bij de huidige vraag hoort (400)', async () => {
    const { cookie, state } = await startSession();
    // 'dog' is geen intentie-optie op het startscherm.
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state.sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId('dog') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CHOICE' } });
    expect(await prisma.conversationStep.count()).toBe(0);
  });

  it('slaat met /choice een keuze op zonder de volgende vraag terug te geven', async () => {
    const { cookie, state } = await startSession();
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state.sessionId}/choice`,
      headers: { cookie },
      payload: { symbolId: await symbolId('want') },
    });
    expect(res.statusCode).toBe(201);
    const body = conversationChoiceResponseSchema.parse(res.json());
    expect(body.step.symbol.concept).toBe('want');
    expect(body.canRefine).toBe(true); // 'want' heeft kinderen
    expect(body.history.map((s) => s.symbol.concept)).toEqual(['want']);
    expect(await prisma.conversationStep.count({ where: { sessionId: state.sessionId } })).toBe(1);
  });

  it('isoleert sessies per gebruiker: een ander apparaat krijgt 404', async () => {
    // Gebruiker A start een sessie.
    const { state } = await startSession();

    // Gebruiker B (ander apparaat) probeert diezelfde sessie te bedienen.
    const userB = await seedUser('Ben');
    const cookieB = await deviceCookie(app, userB.id);
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state.sessionId}/next`,
      headers: { cookie: cookieB },
      payload: { symbolId: await symbolId('want') },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('vereist een gekoppeld apparaat (401 zonder device-cookie)', async () => {
    const res = await app.inject({ method: 'POST', url: '/conversation/start' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'DEVICE_NOT_LINKED' } });
  });

  it('weigert een keuze in een afgeronde sessie (409)', async () => {
    const { cookie, state } = await startSession();
    await prisma.conversationSession.update({
      where: { id: state.sessionId },
      data: { status: 'COMPLETED' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state.sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId('want') },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'SESSION_NOT_ACTIVE' } });
  });

  it('weigert terug als er niets is om ongedaan te maken (400)', async () => {
    const { cookie, state } = await startSession();
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state.sessionId}/back`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'NO_STEPS_TO_UNDO' } });
  });

  // --- Boodschap voorstellen en bevestigen (T4.3, DESIGN §3.1, §3.6, FR-007) ---

  /** Loopt de voorbeeldroute uit DESIGN §3.1 af en geeft cookie + sessionId terug (klaar voor generate). */
  async function walkExampleRoute(): Promise<{ cookie: string; sessionId: string }> {
    const { cookie, state } = await startSession();
    const sessionId = state.sessionId;
    for (const concept of ['want', 'do-activity', 'outside', 'walking', 'dog']) {
      await next(cookie, sessionId, concept);
    }
    return { cookie, sessionId };
  }

  it('stelt de boodschap uit DESIGN §3.1 voor zonder iets op te slaan', async () => {
    const { cookie, sessionId } = await walkExampleRoute();

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/generate`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = conversationGenerateResponseSchema.parse(res.json());
    expect(body.message).toBe('Ik wil buiten wandelen met mijn hond.');
    expect(body.confidence).toBeGreaterThan(0.85);
    expect(body.symbols.map((s) => s.concept)).toEqual([
      'want',
      'do-activity',
      'outside',
      'walking',
      'dog',
    ]);

    // Voorstellen is vluchtig: geen GeneratedMessage, sessie blijft ACTIVE (DESIGN §3.6).
    expect(await prisma.generatedMessage.count()).toBe(0);
    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.status).toBe('ACTIVE');
  });

  it('bevestigen rondt de sessie af en slaat alleen de bevestigde boodschap op', async () => {
    const { cookie, sessionId } = await walkExampleRoute();

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = conversationConfirmResponseSchema.parse(res.json());
    expect(body.status).toBe('COMPLETED');
    expect(body.message).toBe('Ik wil buiten wandelen met mijn hond.');

    // Precies één opgeslagen, bevestigde boodschap; de zin hoort bij de gekozen route.
    const stored = await prisma.generatedMessage.findMany({ where: { sessionId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.confirmed).toBe(true);
    expect(stored[0]!.message).toBe('Ik wil buiten wandelen met mijn hond.');

    const session = await prisma.conversationSession.findUnique({ where: { id: sessionId } });
    expect(session?.status).toBe('COMPLETED');
  });

  it('genereert per intentie een passende sjabloon-zin', async () => {
    // Hoe ik mij voel → blij.
    {
      const { cookie, state } = await startSession();
      await next(cookie, state.sessionId, 'feel');
      await next(cookie, state.sessionId, 'happy');
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${state.sessionId}/generate`,
        headers: { cookie },
        payload: {},
      });
      expect(conversationGenerateResponseSchema.parse(res.json()).message).toBe('Ik voel me blij.');
    }
    // Er is iets aan de hand → pijn → hoofd.
    {
      const { cookie, state } = await startSession();
      await next(cookie, state.sessionId, 'problem');
      await next(cookie, state.sessionId, 'pain');
      await next(cookie, state.sessionId, 'head');
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${state.sessionId}/generate`,
        headers: { cookie },
        payload: {},
      });
      expect(conversationGenerateResponseSchema.parse(res.json()).message).toBe(
        'Ik heb pijn aan mijn hoofd.',
      );
    }
  });

  it('weigert genereren of bevestigen zonder gekozen concepten (400)', async () => {
    const { cookie, state } = await startSession();
    for (const path of ['generate', 'confirm']) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${state.sessionId}/${path}`,
        headers: { cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'NO_STEPS_TO_GENERATE' } });
    }
  });

  it('weigert een tweede bevestiging op een afgeronde sessie (409)', async () => {
    const { cookie, sessionId } = await walkExampleRoute();
    const first = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'SESSION_NOT_ACTIVE' } });
    // Nog steeds precies één opgeslagen boodschap.
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(1);
  });

  it('isoleert generate/confirm per gebruiker: een ander apparaat krijgt 404', async () => {
    const { sessionId } = await walkExampleRoute();
    const userB = await seedUser('Ben');
    const cookieB = await deviceCookie(app, userB.id);
    for (const path of ['generate', 'confirm']) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/${path}`,
        headers: { cookie: cookieB },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } });
    }
  });
});
