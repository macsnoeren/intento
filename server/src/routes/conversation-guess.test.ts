import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { conversationStateResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';

/**
 * **De gok als tegel** (T16.3, DESIGN §3.1, §7.4, §7.10 strategie `guess`).
 *
 * Bij `guess` draagt de AI elke beurt zelf begrippen aan; de zekerste daarvan is per definitie een
 * **gok**. Die verschijnt gemarkeerd tussen de gewone pictogrammen — niet als vroeg boodschapvoorstel.
 * Het verschil is niet cosmetisch: een gok die de route overslaat legt de onzekerheid van de AI bij de
 * gebruiker ("klopt dit?" op iets wat hij nooit koos), en dat is precies wat DESIGN §2 uitsluit.
 *
 * Deze tests belopen dat over de volle breedte: de tegel verschijnt alléén bij `guess`, hij bereikt
 * nooit een boodschap zonder dat de gebruiker hem aantikt én bevestigt, ❌ rolt er net zoveel van terug
 * als altijd (precies één stap), en `↩ Terug` toont hetzelfde scherm terug — inclusief de markering.
 */
describe('gespreksstrategie guess — de gok als tegel', () => {
  let app: FastifyInstance;

  /**
   * Provider die zelf begrippen aandraagt, ongeacht wat er aan opties wordt voorgelegd — precies wat
   * een vrije ronde van het model vraagt. `walking` is met afstand de zekerste: dát is de gok.
   */
  const guessing: AiProvider = {
    name: 'guessing',
    selectNextQuestion: (prompt) =>
      Promise.resolve<AiQuestionDecision>(
        prompt.conversationContext.length === 0
          ? {
              // Op het startscherm kiest ook dit model uit de intentiecategorieën: daar gaat het
              // gesprek over de richting, en die kiest de gebruiker (DESIGN §3.1).
              question: 'Waar gaat het over?',
              options: prompt.availableSymbols.map((ref) => ({
                symbol: ref.concept,
                confidence: 0.4,
              })),
              reason: 'eerste indruk',
              confidence: 0.3,
            }
          : {
              question: 'Bedoel je dit?',
              options: [
                { symbol: 'walking', confidence: 0.9 },
                { symbol: 'cycling', confidence: 0.5 },
                { symbol: 'dog', confidence: 0.4 },
              ],
              reason: 'ik gok op wandelen',
              confidence: 0.8,
            },
      ),
  };

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
      orchestrator: new AiOrchestrator(guessing),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  const parseState = (body: unknown) => conversationStateResponseSchema.parse(body);
  const conceptsOf = (state: ReturnType<typeof parseState>) =>
    (state.question?.options ?? []).map((option) => option.concept);

  /** Start een gesprek met de meegegeven strategie en kiest "Iets willen" — daarna gokt de AI. */
  async function afterFirstChoice(
    name: string,
    strategy: string,
  ): Promise<{ cookie: string; sessionId: string; state: ReturnType<typeof parseState> }> {
    const user = await seedUser(name);
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { conversationStrategy: strategy },
    });
    const cookie = await deviceCookie(app, user.id);

    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(start.statusCode).toBe(201);
    const startState = parseState(start.json());
    // Het startscherm is en blijft de richtingkeuze van de gebruiker: daar wordt niet gegokt.
    expect(startState.question?.guess ?? null).toBeNull();

    const want = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'want' } });
    const next = await app.inject({
      method: 'POST',
      url: `/conversation/${startState.sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: want.id },
    });
    expect(next.statusCode).toBe(200);
    return { cookie, sessionId: startState.sessionId, state: parseState(next.json()) };
  }

  it('markeert de zekerste aandraging als gok — en alleen bij `guess`', async () => {
    const { state } = await afterFirstChoice('Sanne', 'guess');

    expect(state.done).toBe(false);
    expect(state.question?.guess).toBe('walking');
    // De gok is een optie tussen de andere, geen apart scherm.
    expect(conceptsOf(state)).toContain('walking');
    expect(conceptsOf(state).length).toBeGreaterThan(1);

    // Dezelfde AI, dezelfde keuze, andere strategie: geen gemarkeerde tegel.
    const { state: metRefine } = await afterFirstChoice('Tim', 'refine');
    expect(metRefine.question?.guess ?? null).toBeNull();
    expect(conceptsOf(metRefine)).toContain('walking');
  });

  it('laat de gok pas in een boodschap komen na aantikken én bevestigen', async () => {
    const { cookie, sessionId, state } = await afterFirstChoice('Sanne', 'guess');
    expect(state.question?.guess).toBe('walking');

    // Op het scherm, maar nergens vastgelegd: geen stap, geen boodschap.
    expect(await prisma.conversationStep.count({ where: { sessionId } })).toBe(1);
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(0);

    // De gebruiker tikt de tegel zelf aan; dat is een gewone keuze.
    const walking = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'walking' } });
    const chosen = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: walking.id },
    });
    expect(chosen.statusCode).toBe(200);
    const afterTap = parseState(chosen.json());
    expect(afterTap.history.map((step) => step.symbol.concept)).toEqual(['want', 'walking']);
    // Nog steeds niets bewaard: pas `/confirm` maakt er communicatie van (DESIGN §3.6).
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(0);

    // De gebruiker rondt zelf af en bevestigt.
    if (!afterTap.done) {
      const enough = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/enough`,
        headers: { cookie },
      });
      expect(enough.statusCode).toBe(200);
    }
    const generated = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/generate`,
      headers: { cookie },
    });
    expect(generated.statusCode).toBe(200);
    // Ook ná `/generate` staat er nog niets in de database — het voorstel is vluchtig.
    expect(await prisma.generatedMessage.count({ where: { sessionId } })).toBe(0);

    const confirmed = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
    });
    expect(confirmed.statusCode).toBe(200);
    const messages = await prisma.generatedMessage.findMany({ where: { sessionId } });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.confirmed).toBe(true);
  });

  it('rolt met ❌ precies één stap terug, net als bij elke andere strategie', async () => {
    const { cookie, sessionId } = await afterFirstChoice('Sanne', 'guess');
    const walking = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'walking' } });
    await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: walking.id },
    });
    expect(await prisma.conversationStep.count({ where: { sessionId } })).toBe(2);

    // Eerste ❌: de goedkoopste verklaring gaat voor (T10.12) — een verfijnronde, niets teruggerold.
    const first = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'wrong_guess' },
    });
    expect(first.statusCode).toBe(200);
    expect(await prisma.conversationStep.count({ where: { sessionId } })).toBe(2);

    // Tweede ❌: precies één stap terug — de aangetikte gok — en die komt niet meer terug.
    const second = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'wrong_guess' },
    });
    expect(second.statusCode).toBe(200);
    const steps = await prisma.conversationStep.findMany({ where: { sessionId } });
    expect(steps.map((step) => step.selectedConcept)).toEqual(['want']);
    expect(conceptsOf(parseState(second.json()))).not.toContain('walking');
  });

  it('toont met ↩ Terug hetzelfde scherm terug, inclusief de markering', async () => {
    const { cookie, sessionId } = await afterFirstChoice('Sanne', 'guess');
    const walking = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'walking' } });
    await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: walking.id },
    });

    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie },
    });
    expect(back.statusCode).toBe(200);
    // Terug herstelt het aanbod van dat punt (T10.3); zonder de vastgelegde markering zou de tegel
    // stilletjes een gewone optie worden en het scherm dus van vorm veranderen.
    expect(parseState(back.json()).question?.guess).toBe('walking');
  });
});
