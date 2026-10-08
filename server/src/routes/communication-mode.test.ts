import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  communicationTurnSchema,
  type CommunicationTurn,
  type TurnRequest,
  type TurnResponse,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import type { FakeAgentClient } from '../agents/client.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents, simpleResponder } from '../test/agent-helpers.js';

/** Vorm kiezen en wisselen (N13.1, INTENTO-NEW-DESIGN §14, I7). */

describe('vorm kiezen en wisselen', () => {
  let app: FastifyInstance;
  let agents: FakeAgentClient;
  let user: { id: string };
  let cookie: string;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    agents = fakeAgents();
    app = await buildApp({ env: testEnv(), agents });
    for (const [label, concept] of [
      ['pijn', 'pain'],
      ['eten', 'eat'],
      ['drinken', 'drink'],
    ] as const) {
      await createVocabularyItem(prisma, { label, concept });
    }
    user = await seedUser('Sanne');
    cookie = await deviceCookie(app, user.id);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function setMode(interactionMode: 'binary' | 'multi' | 'ai'): Promise<void> {
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { interactionMode },
    });
  }

  async function start() {
    return app.inject({ method: 'POST', url: '/communication/sessions', headers: { cookie } });
  }

  async function send(turn: CommunicationTurn, body: Record<string, unknown>, path = 'answer') {
    return app.inject({
      method: 'POST',
      url: `/communication/sessions/${turn.sessionId}/${path}`,
      headers: { cookie },
      payload: { turn: turn.turn, ...body },
    });
  }

  /** Het antwoord van de nep-agent, maar dan in multi-icon gewisseld op deze beurt. */
  function switchedToMulti(request: TurnRequest): TurnResponse {
    const response = simpleResponder(request);
    response.state.interaction_mode = 'multi';
    response.state.mode_since_turn = request.turn;
    response.presentation = {
      kind: 'question',
      mode: 'multi',
      text: 'Wat bedoel je?',
      options: request.vocabulary.slice(0, 2).map((entry, position) => ({
        ref: `opt-${entry.id}`,
        kind: 'symbol',
        vocabulary_item_id: entry.id,
        contact_id: null,
        label: entry.labels[0] ?? entry.id,
        concept: entry.concepts[0] ?? null,
        representation: 'exact',
        position,
      })),
      message: null,
    };
    response.state.last_presentation = response.presentation;
    return response;
  }

  it('stuurt de laatste handelingen mee, ook ↩ Terug, met het scherm erbij', async () => {
    let screen = communicationTurnSchema.parse((await start()).json());
    screen = communicationTurnSchema.parse((await send(screen, { answer: 'yes' })).json());
    expect(screen.presentation.kind).toBe('confirm_message');
    screen = communicationTurnSchema.parse((await send(screen, {}, 'back')).json());
    await send(screen, { answer: 'no' });

    expect(agents.requests.at(-1)?.recent).toEqual([
      { turn: 0, screen: 'question', mode: 'binary', event: 'answer_yes' },
      { turn: 1, screen: 'confirm_message', mode: 'binary', event: 'back' },
      { turn: 2, screen: 'question', mode: 'binary', event: 'answer_no' },
    ]);
    expect(agents.requests[0]?.recent).toEqual([]);
  });

  it('een ingestelde vorm wisselt nooit: een wissel van de agent wordt verworpen (I7)', async () => {
    for (const mode of ['binary', 'multi'] as const) {
      await setMode(mode);
      agents.setResponder((request) => {
        const response = switchedToMulti(request);
        if (mode === 'multi') {
          response.state.interaction_mode = 'binary';
          response.presentation = simpleResponder(request).presentation;
        }
        return response;
      });
      const res = await start();
      expect(res.statusCode).toBe(503);
      const decision = await prisma.agentDecision.findFirstOrThrow({
        where: { status: 'invalid', session: { userId: user.id } },
        orderBy: { createdAt: 'desc' },
      });
      expect(decision.reason).toContain('I7');
      expect(decision.reason).toContain(`ingesteld op ${mode}`);
    }
  });

  it('AI kiest: niet binnen 3 beurten, daarna wel', async () => {
    await setMode('ai');
    let screen = communicationTurnSchema.parse((await start()).json());
    expect(agents.requests[0]?.settings.interaction_mode).toBe('ai');

    // Beurt 2: te vroeg — verworpen, het scherm blijft staan.
    screen = communicationTurnSchema.parse((await send(screen, { answer: 'no' })).json());
    agents.setResponder((request) =>
      request.turn === 2 ? switchedToMulti(request) : simpleResponder(request),
    );
    const early = await send(screen, { answer: 'no' });
    expect(early.statusCode).toBe(503);
    const rejected = await prisma.agentDecision.findFirstOrThrow({
      where: { status: 'invalid', sessionId: screen.sessionId },
    });
    expect(rejected.reason).toContain('wissel na 2 beurten');

    // Opnieuw, zonder wissel; op beurt 3 mag het.
    agents.setResponder(simpleResponder);
    screen = communicationTurnSchema.parse((await send(screen, { answer: 'no' })).json());
    agents.setResponder((request) =>
      request.turn === 3 ? switchedToMulti(request) : simpleResponder(request),
    );
    const res = await send(screen, { answer: 'no' });
    expect(res.statusCode).toBe(200);
    const tiles = communicationTurnSchema.parse(res.json());
    expect(tiles.presentation.mode).toBe('multi');
    expect(tiles.presentation.options).toHaveLength(2);
  });
});
