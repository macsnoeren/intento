import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { conversationStateResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiProvider, AiQuestionDecision } from '../ai/provider.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * De gespreksstrategie **per gebruiker** (T11.4, DESIGN §5.3, §7.10).
 *
 * De aanpak hoort bij de persoon, niet bij het systeem. Deze tests toetsen dat over de volle breedte:
 * de instelling is te zetten via de bestaande profiel-API, een onbekende sleutel wordt geweigerd, en —
 * het punt van de hele fase — twee gebruikers met een verschillende strategie krijgen aantoonbaar een
 * ander gesprek, bij dezelfde AI en dezelfde bibliotheek.
 */
describe('gespreksstrategie per gebruiker', () => {
  let app: FastifyInstance;

  /** Provider die zeer zeker is: legt het verschil in voorsteldrempel tussen strategieën bloot. */
  const confident: AiProvider = {
    name: 'confident',
    selectNextQuestion: (prompt) =>
      Promise.resolve<AiQuestionDecision>({
        question: 'Bedoel je dit?',
        options: prompt.availableSymbols
          .slice(0, 3)
          .map((ref) => ({ symbol: ref.concept, confidence: 0.9 })),
        reason: 'vrij zeker',
        confidence: 0.9,
      }),
  };

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100', LOGIN_RATE_LIMIT_MAX: '100' }),
      orchestrator: new AiOrchestrator(confident),
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

  /** Start een gesprek voor een gebruiker met de meegegeven strategie en kiest "Iets willen". */
  async function conversationFor(
    name: string,
    strategy: string,
  ): Promise<ReturnType<typeof parseState>> {
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
    const sessionId = parseState(start.json()).sessionId;

    const want = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'want' } });
    const next = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: want.id },
    });
    expect(next.statusCode).toBe(200);
    return parseState(next.json());
  }

  it('geeft twee gebruikers met een andere strategie aantoonbaar een ander gesprek', async () => {
    const withRefine = await conversationFor('Sanne', 'refine');
    const withCalm = await conversationFor('Tim', 'calm');

    // Dezelfde AI, dezelfde bibliotheek, dezelfde keuze — en toch een ander gesprek:
    // `refine` is zeker genoeg (0,9 > 0,85) en stelt een boodschap voor…
    expect(withRefine.done).toBe(true);
    // …terwijl `calm` pas vanaf 0,92 voorstelt en dus nog een vraag stelt, met een klein aanbod.
    expect(withCalm.done).toBe(false);
    expect(conceptsOf(withCalm).length).toBeGreaterThan(0);
    expect(conceptsOf(withCalm).length).toBeLessThanOrEqual(4);
  });

  it('valt zonder expliciete keuze terug op de standaardstrategie', async () => {
    const user = await seedUser('Nora');
    const profile = await prisma.userCommunicationProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.conversationStrategy).toBe('refine');
  });

  it('weigert een onbekende strategie met 400 en raakt de database niet aan', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 4,
        showText: true,
        aiLearningEnabled: true,
        supportMode: false,
        contextIndicator: true,
        conversationStrategy: 'verzonnen-aanpak',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    // Een half toegepaste strategie is erger dan een geweigerde request: er is niets gewijzigd.
    const profile = await prisma.userCommunicationProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.conversationStrategy).toBe('refine');
  });

  it('slaat een geldige strategie op via de bestaande profiel-API', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 4,
        showText: true,
        aiLearningEnabled: true,
        supportMode: false,
        contextIndicator: true,
        conversationStrategy: 'explore',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().communicationProfile.conversationStrategy).toBe('explore');
    const profile = await prisma.userCommunicationProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.conversationStrategy).toBe('explore');
  });

  it('laat een strategie die de registry niet kent een lopend gesprek niet breken', async () => {
    // Een rij die ooit met een sindsdien verwijderde strategie is opgeslagen: de invoer wordt op de
    // API-grens geweigerd, maar bestaande data mag nooit een gesprek laten crashen (§7.10).
    const state = await conversationFor('Iris', 'ooit-bestaan-hebbende-aanpak');
    // De standaardstrategie neemt het over: hetzelfde gedrag als `refine`.
    expect(state.done).toBe(true);
  });
});
