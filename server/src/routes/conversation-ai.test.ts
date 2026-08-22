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
 * Gespreksflow met de AI-orchestrator (T5.2, DESIGN §7.4–7.6, §7.8). Toetst de acceptatie end-to-end via
 * HTTP: een provider die een **onbekend** concept teruggeeft, bereikt de gebruiker nooit (het wordt
 * afgevangen als `ConceptProposal`), en de `/next`-respons draagt de confidence/fase (§7.4).
 */
describe('gespreksflow met AI-provider — /conversation (T5.2)', () => {
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
   * Provider die één verzonnen concept ("teleporteren") plus één bestaand kandidaat-concept teruggeeft.
   * Zo bewijzen we wat de validatielaag met een niet-bestaand begrip doet, ongeacht wat de provider zegt.
   */
  const rogueProvider: AiProvider = {
    name: 'rogue',
    selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
      const real = prompt.availableSymbols[0]?.concept ?? 'do-activity';
      return Promise.resolve({
        question: 'Wat wil je?',
        confidence: 0.7,
        reason: 'de gebruiker wil zich verplaatsen',
        options: [
          { symbol: 'teleporteren', confidence: 0.95 },
          { symbol: real, confidence: 0.7 },
        ],
      });
    },
  };

  async function startFor(
    orchestrator: AiOrchestrator,
    envOverrides: Record<string, string> = {},
  ): Promise<{ cookie: string; sessionId: string }> {
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100', ...envOverrides }),
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

  async function symbolId(concept: string): Promise<string> {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept } });
    if (!symbol) throw new Error(`Onbekend seed-concept: ${concept}`);
    return symbol.id;
  }

  it('houdt een verzonnen concept tegen met AI_ALLOW_NEW_CONCEPTS=false en legt het vast', async () => {
    // De harde AAC-begrenzing bestaat nog steeds als **keuze** (env-schakelaar): staat ze aan, dan
    // bereikt een verzonnen begrip de gebruiker nooit. Standaard staat ze uit — dan is een nieuw begrip
    // juist de uitweg voor de gebruiker (T10.6, DESIGN §7.6 trap 3); dat pad staat in
    // `conversation-fase10.test.ts`.
    const { cookie, sessionId } = await startFor(new AiOrchestrator(rogueProvider), {
      AI_ALLOW_NEW_CONCEPTS: 'false',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId('want') },
    });
    expect(res.statusCode).toBe(200);
    const state = conversationStateResponseSchema.parse(res.json());

    // Het verzonnen concept bereikt de gebruiker nooit.
    const shown = (state.question?.options ?? []).map((o) => o.concept);
    expect(shown).not.toContain('teleporteren');
    expect(shown.length).toBeGreaterThan(0);

    // Maar het is wel vastgelegd voor beoordeling door een beheerder (T7.3).
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'teleporteren' },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('PENDING');
  });

  it('draagt de interpretatie-zekerheid en fase mee in de /next-respons (§7.4)', async () => {
    // Standaard mock-provider (via env AI_PROVIDER=mock).
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    const sessionId = conversationStateResponseSchema.parse(start.json()).sessionId;

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId('want') },
    });
    const state = conversationStateResponseSchema.parse(res.json());
    expect(typeof state.confidence).toBe('number');
    expect(state.phase).toBe('refine');

    // De zekerheid is ook op de opgeslagen stap vastgelegd (was `null` in de gescripte engine). Sinds
    // T10.3 is dat de zekerheid waarmee de beantwoorde vraag werd **aangeboden**, niet die van de
    // toestand erna: de stap legt vast wat de gebruiker te zien kreeg. De toestand erna is per definitie
    // een nieuwe beslissing, met een over beurten heen gedempte zekerheid (T10.8).
    const step = await prisma.conversationStep.findFirst({
      where: { sessionId },
      orderBy: { order: 'desc' },
    });
    expect(typeof step!.confidence).toBe('number');
    expect(step!.confidence).toBeGreaterThan(0);
    expect(step!.confidence).not.toBeCloseTo(state.confidence!, 5);

    // De opgeslagen stap legt óók vast welke opties er bij die vraag zijn aangeboden (T10.3), zodat
    // `↩ Terug` exact herstelt en "Geen van deze past" precies uitsluit wat de gebruiker zag.
    expect(step!.offeredConcepts).toEqual(expect.arrayContaining(['want']));
  });
});
