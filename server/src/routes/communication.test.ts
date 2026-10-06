import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { AgentUnavailableError, type FakeAgentClient } from '../agents/client.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents, simpleResponder } from '../test/agent-helpers.js';

/** Gesprek starten op de tablet (N4.5, INTENTO-NEW-DESIGN §51, §52). */

describe('POST /communication/sessions', () => {
  let app: FastifyInstance;
  let agents: FakeAgentClient;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    agents = fakeAgents();
    app = await buildApp({ env: testEnv(), agents });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function start(cookie: string) {
    return app.inject({ method: 'POST', url: '/communication/sessions', headers: { cookie } });
  }

  it('weigert zonder gekoppeld apparaat', async () => {
    const res = await app.inject({ method: 'POST', url: '/communication/sessions' });
    expect(res.statusCode).toBe(401);
    expect(agents.requests).toHaveLength(0);
  });

  it('start een gesprek en geeft het eerste scherm, zonder concepten of ids', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const pain = await createVocabularyItem(prisma, {
      label: 'pijn',
      concept: 'pain',
      isStart: true,
      sortOrder: 1,
    });
    await createVocabularyItem(prisma, { label: 'eten', concept: 'eat', sortOrder: 2 });
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { optionsPerScreen: 6, maxQuestions: 20, experienceEnabled: false },
    });
    const cookie = await deviceCookie(app, user.id);

    const res = await start(cookie);
    expect(res.statusCode).toBe(201);
    const body = communicationTurnSchema.parse(res.json());
    expect(body.turn).toBe(0);
    expect(body.presentation).toMatchObject({ kind: 'question', mode: 'binary', text: 'Pijn?' });
    expect(body.presentation.options).toHaveLength(1);
    expect(body.presentation.options[0]?.label).toBe('pijn');
    expect(body.presentation.options[0]?.imageUrl).toMatch(
      new RegExp(`^/assets/${pain}\\?exp=\\d+&sig=`),
    );
    expect(res.body).not.toContain('"concept"');
    expect(res.body).not.toContain('vocabulary_item_id');

    // Wat de agentdienst kreeg: event start, instellingen uit het profiel, de Vocabulary compact.
    const request = agents.requests[0];
    expect(request?.event).toEqual({ type: 'start' });
    expect(request?.state).toBeNull();
    expect(request?.settings).toEqual({
      interaction_mode: 'binary',
      options_per_screen: 6,
      question_strategy: 'general_to_specific',
      max_questions: 20,
      experience_enabled: false,
    });
    expect(request?.vocabulary.map((entry) => entry.labels[0])).toEqual(['pijn', 'eten']);
    expect(request?.contacts).toEqual([]);

    // Opgeslagen: gesprek, momentopname, Observed start, Presented, Inferred, beslissing.
    const session = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: body.sessionId },
    });
    expect(session).toMatchObject({ userId: user.id, organizationId: org, status: 'active' });
    expect(await prisma.sessionTurn.count({ where: { sessionId: session.id } })).toBe(1);
    expect(
      (await prisma.observedEvent.findMany({ where: { sessionId: session.id } })).map(
        (event) => event.type,
      ),
    ).toEqual(['start']);
    expect(await prisma.presentationEvent.count({ where: { sessionId: session.id } })).toBe(1);
    expect(await prisma.inference.count({ where: { sessionId: session.id } })).toBe(1);
    expect(
      (await prisma.agentDecision.findMany({ where: { sessionId: session.id } })).map(
        (decision) => decision.status,
      ),
    ).toEqual(['success']);
  });

  it('stopt een lopend gesprek bij een nieuwe start', async () => {
    const user = await seedUser('Sanne');
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const cookie = await deviceCookie(app, user.id);

    const first = communicationTurnSchema.parse((await start(cookie)).json());
    const second = communicationTurnSchema.parse((await start(cookie)).json());
    expect(second.sessionId).not.toBe(first.sessionId);
    const old = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: first.sessionId },
    });
    expect(old.status).toBe('stopped');
    expect(old.endedAt).not.toBeNull();
    expect(
      await prisma.communicationSession.count({ where: { userId: user.id, status: 'active' } }),
    ).toBe(1);
  });

  it('geeft 503 AGENT_UNAVAILABLE als de agentdienst faalt, en legt dat vast', async () => {
    const user = await seedUser('Sanne');
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const cookie = await deviceCookie(app, user.id);
    agents.setResponder(() => {
      throw new AgentUnavailableError('timeout', 'Geen antwoord binnen 30000 ms.');
    });

    const res = await start(cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_UNAVAILABLE' } });

    const session = await prisma.communicationSession.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(session.status).toBe('stopped');
    expect(await prisma.sessionTurn.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.observedEvent.count({ where: { sessionId: session.id } })).toBe(1);
    expect(
      await prisma.agentDecision.findFirst({ where: { sessionId: session.id } }),
    ).toMatchObject({ agent: 'agent-service', status: 'failed', reason: 'timeout' });
  });

  it('verwerpt een antwoord dat een invariant schendt (I1) en legt het vast als invalid', async () => {
    const user = await seedUser('Sanne');
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const cookie = await deviceCookie(app, user.id);
    agents.setResponder((request) => {
      const response = simpleResponder(request);
      const first = response.presentation.options[0];
      if (first) first.vocabulary_item_id = 'verzonnen-symbool';
      return response;
    });

    const res = await start(cookie);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'AGENT_UNAVAILABLE' } });
    expect(res.body).not.toContain('verzonnen');

    const session = await prisma.communicationSession.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(await prisma.sessionTurn.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.presentationEvent.count({ where: { sessionId: session.id } })).toBe(0);
    const decision = await prisma.agentDecision.findFirstOrThrow({
      where: { sessionId: session.id },
    });
    expect(decision).toMatchObject({ status: 'invalid', validation: 'invalid' });
    expect(decision.reason).toContain('I1');
  });

  it('geeft 503 VOCABULARY_EMPTY zonder symbolen', async () => {
    const user = await seedUser('Sanne');
    const res = await start(await deviceCookie(app, user.id));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'VOCABULARY_EMPTY' } });
    expect(agents.requests).toHaveLength(0);
  });

  it('isoleert organisaties: eigen Vocabulary, eigen gesprekken', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    const a = await seedUser('Sanne', orgA);
    const b = await seedUser('Tom', orgB);
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain', sortOrder: 1 });
    await createVocabularyItem(prisma, {
      label: 'opa',
      concept: 'grandpa',
      organizationId: orgB,
      sortOrder: 0,
    });

    const sessionB = communicationTurnSchema.parse(
      (await start(await deviceCookie(app, b.id))).json(),
    );
    const sessionA = communicationTurnSchema.parse(
      (await start(await deviceCookie(app, a.id))).json(),
    );

    // A kreeg alleen het platformitem mee, niet het eigen item van B.
    expect(agents.requests[1]?.vocabulary.map((entry) => entry.labels[0])).toEqual(['pijn']);
    expect(agents.requests[0]?.vocabulary.map((entry) => entry.labels[0])).toEqual(['opa', 'pijn']);
    // Het starten door A stopte het gesprek van B niet, en elk gesprek hoort bij de eigen org.
    expect(
      await prisma.communicationSession.findUniqueOrThrow({ where: { id: sessionB.sessionId } }),
    ).toMatchObject({ status: 'active', organizationId: orgB, userId: b.id });
    expect(
      await prisma.communicationSession.findUniqueOrThrow({ where: { id: sessionA.sessionId } }),
    ).toMatchObject({ status: 'active', organizationId: orgA, userId: a.id });
  });
});
