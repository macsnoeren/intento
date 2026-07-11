import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  conversationConfirmResponseSchema,
  conversationGenerateResponseSchema,
  conversationStateResponseSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiMessageResult, AiPrompt, AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';

/**
 * AI-boodschapgeneratie end-to-end via HTTP (T5.3, DESIGN §3.1, §7.4, §7.8). Toetst de acceptatie:
 * het voorstelscherm toont de **AI-zin** (`/generate`), en een AI-zin met een concept buiten de sessie
 * bereikt de gebruiker (en de db) **nooit** — dan valt de flow terug op de deterministische sjabloon.
 */
describe('AI-boodschapgeneratie — /conversation/{id}/generate (T5.3)', () => {
  let app: FastifyInstance;

  /**
   * Provider die de vraagselectie aan de mock delegeert (zodat de route te belopen is) en daarnaast een
   * vaste boodschap teruggeeft. Zo bewijzen we dat `/generate` de AI-zin gebruikt, met de safety-laag erop.
   */
  class MessageProvider implements AiProvider {
    readonly name = 'msg';
    private readonly base = new MockAiProvider();
    constructor(
      private readonly sentence: string,
      private readonly confidence?: number,
    ) {}
    selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
      return this.base.selectNextQuestion(prompt);
    }
    generateMessage(): Promise<AiMessageResult> {
      return Promise.resolve({ message: this.sentence, confidence: this.confidence });
    }
  }

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

  async function symbolId(concept: string): Promise<string> {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept } });
    if (!symbol) throw new Error(`Onbekend seed-concept: ${concept}`);
    return symbol.id;
  }

  /** Bouwt de app met de gegeven provider, koppelt een tablet en loopt de voorbeeldroute (§3.1) af. */
  async function walkExampleRoute(
    provider: AiProvider,
  ): Promise<{ cookie: string; sessionId: string }> {
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
      orchestrator: new AiOrchestrator(provider),
    });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    const sessionId = conversationStateResponseSchema.parse(start.json()).sessionId;

    for (const concept of ['want', 'do-activity', 'outside', 'walking', 'dog']) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/next`,
        headers: { cookie },
        payload: { symbolId: await symbolId(concept) },
      });
      expect(res.statusCode).toBe(200);
    }
    return { cookie, sessionId };
  }

  it('toont de AI-zin op het voorstelscherm en slaat die bij bevestigen op', async () => {
    const aiSentence = 'Ik wil graag lekker naar buiten om te wandelen met mijn hond.';
    const { cookie, sessionId } = await walkExampleRoute(new MessageProvider(aiSentence, 0.92));

    const gen = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/generate`,
      headers: { cookie },
      payload: {},
    });
    expect(gen.statusCode).toBe(200);
    const proposal = conversationGenerateResponseSchema.parse(gen.json());
    expect(proposal.message).toBe(aiSentence);
    expect(proposal.confidence).toBe(0.92);

    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    const confirmed = conversationConfirmResponseSchema.parse(confirm.json());
    expect(confirmed.message).toBe(aiSentence);

    const stored = await prisma.generatedMessage.findMany({ where: { sessionId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.message).toBe(aiSentence);
  });

  it('houdt een AI-zin met een concept buiten de sessie tegen en valt terug op de sjabloon', async () => {
    // "mama" hoort bij het niet-gekozen concept `mom` — mag de zin (en de db) nooit bereiken (§7.8).
    const rogue = 'Ik wil buiten wandelen met mijn hond en mama.';
    const { cookie, sessionId } = await walkExampleRoute(new MessageProvider(rogue, 0.99));

    const gen = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/generate`,
      headers: { cookie },
      payload: {},
    });
    const proposal = conversationGenerateResponseSchema.parse(gen.json());
    expect(proposal.message).toBe('Ik wil buiten wandelen met mijn hond.');
    expect(proposal.message.toLowerCase()).not.toContain('mama');

    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    const confirmed = conversationConfirmResponseSchema.parse(confirm.json());
    expect(confirmed.message).toBe('Ik wil buiten wandelen met mijn hond.');
    expect(confirmed.message.toLowerCase()).not.toContain('mama');
  });
});
