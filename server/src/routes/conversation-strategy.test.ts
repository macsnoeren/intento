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

    // Dezelfde AI, dezelfde bibliotheek, dezelfde keuze — en toch een ander gesprek. Beide stellen nog
    // een vraag (op "Iets willen" valt nog van alles te verfijnen, T10.10), maar het scherm verschilt:
    // `calm` houdt het klein en overzichtelijk…
    expect(withCalm.done).toBe(false);
    expect(conceptsOf(withCalm).length).toBeGreaterThan(0);
    expect(conceptsOf(withCalm).length).toBeLessThanOrEqual(4);

    // …terwijl `refine` er ruim meer aanbiedt.
    expect(withRefine.done).toBe(false);
    expect(conceptsOf(withRefine).length).toBeGreaterThan(conceptsOf(withCalm).length);
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

  // --- T11.5: de strategie van dít gesprek ----------------------------------------------------------

  describe('per gesprek (vraagmodus)', () => {
    /** Zet een begeleider + gekoppelde gebruiker klaar en levert de cookie van de begeleider. */
    async function caregiverFor(
      userStrategy: string,
    ): Promise<{ cookie: string; userId: string; deviceCookie: string }> {
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const cookie = await loginCookie(app, admin.email, admin.password);
      const user = await seedUser('Sanne', admin.organizationId);
      await prisma.userCommunicationProfile.update({
        where: { userId: user.id },
        data: { conversationStrategy: userStrategy },
      });
      return { cookie, userId: user.id, deviceCookie: await deviceCookie(app, user.id) };
    }

    /** Stelt een vraag via de vraagmodus, eventueel met een expliciete strategie. */
    async function askQuestion(
      cookie: string,
      userId: string,
      strategy?: string,
    ): Promise<{ statusCode: number; sessionId?: string }> {
      const res = await app.inject({
        method: 'POST',
        url: '/question/start',
        headers: { cookie },
        payload: {
          userId,
          question: 'Wat wil je drinken?',
          anchorConcept: 'drink',
          ...(strategy ? { strategy } : {}),
        },
      });
      return {
        statusCode: res.statusCode,
        ...(res.statusCode === 201 ? { sessionId: res.json().sessionId as string } : {}),
      };
    }

    it('volgt de strategie van het gesprek, niet die van de gebruiker', async () => {
      const { cookie, userId } = await caregiverFor('refine');
      const { statusCode, sessionId } = await askQuestion(cookie, userId, 'calm');
      expect(statusCode).toBe(201);

      const session = await prisma.conversationSession.findUniqueOrThrow({
        where: { id: sessionId! },
      });
      expect(session.strategy).toBe('calm');
    });

    it('valt zonder keuze terug op de gebruiker, en zonder gebruikersinstelling op de standaard', async () => {
      // Niveau 2: geen strategie bij de vraag → de instelling van de gebruiker.
      const withUser = await caregiverFor('explore');
      const asked = await askQuestion(withUser.cookie, withUser.userId);
      expect(asked.statusCode).toBe(201);
      const session = await prisma.conversationSession.findUniqueOrThrow({
        where: { id: asked.sessionId! },
      });
      expect(session.strategy).toBe('explore');

      // Niveau 3: een gebruiker zonder eigen keuze houdt de standaard.
      await resetAuthData();
      const withDefault = await caregiverFor('refine');
      const asked2 = await askQuestion(withDefault.cookie, withDefault.userId);
      const session2 = await prisma.conversationSession.findUniqueOrThrow({
        where: { id: asked2.sessionId! },
      });
      expect(session2.strategy).toBe('refine');
    });

    it('weigert een onbekende strategie bij het stellen van een vraag met 400', async () => {
      const { cookie, userId } = await caregiverFor('refine');
      const { statusCode } = await askQuestion(cookie, userId, 'verzonnen-aanpak');
      expect(statusCode).toBe(400);
      expect(await prisma.conversationSession.count({ where: { userId } })).toBe(0);
    });

    it('houdt een lopend gesprek bij zijn strategie, ook als de instelling verandert', async () => {
      const { cookie, userId, deviceCookie: device } = await caregiverFor('refine');
      const { sessionId } = await askQuestion(cookie, userId, 'calm');

      // De tablet pakt de vraag op en de gebruiker kiest een van de aangeboden antwoorden.
      const pending = await app.inject({
        method: 'GET',
        url: '/conversation/pending',
        headers: { cookie: device },
      });
      expect(pending.statusCode).toBe(200);
      const offered = parseState(pending.json().state).question?.options ?? [];
      // `calm` houdt het aanbod klein: dat is precies de aanpak waarmee dit gesprek begon.
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.length).toBeLessThanOrEqual(4);
      const answer = offered[0]!;

      // Halverwege verandert de begeleider de instelling van de gebruiker…
      await prisma.userCommunicationProfile.update({
        where: { userId },
        data: { conversationStrategy: 'explore' },
      });

      const next = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId!}/next`,
        headers: { cookie: device },
        payload: { symbolId: answer.id },
      });
      expect(next.statusCode).toBe(200);

      // …maar het lopende gesprek houdt de aanpak waarmee het begon. Halverwege wisselen zou het
      // vastgelegde aanbod en de lopende hypothese inconsistent maken.
      const session = await prisma.conversationSession.findUniqueOrThrow({
        where: { id: sessionId! },
      });
      expect(session.strategy).toBe('calm');
    });

    it('legt de strategie ook vast bij een vrij gesprek van de tablet', async () => {
      const { deviceCookie: device } = await caregiverFor('context-first');
      const start = await app.inject({
        method: 'POST',
        url: '/conversation/start',
        headers: { cookie: device },
      });
      expect(start.statusCode).toBe(201);
      const session = await prisma.conversationSession.findUniqueOrThrow({
        where: { id: parseState(start.json()).sessionId },
      });
      expect(session.strategy).toBe('context-first');
    });
  });

  // --- T11.6: zichtbaar maken wélke aanpak draaide ---------------------------------------------------

  it('noemt de actieve strategie in de AI-beslissingslogregel (T11.6)', async () => {
    // De logregel is het antwoord op "waarom deed de AI dit?" (T9.15). Met meerdere aanpakken is die
    // vraag niet te beantwoorden zonder te weten wélke draaide.
    const lines: Record<string, unknown>[] = [];
    await app.close();
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100', LOGIN_RATE_LIMIT_MAX: '100' }),
      orchestrator: new AiOrchestrator(confident),
      logger: {
        level: 'info',
        // De logregels opvangen in plaats van ze naar stdout te schrijven.
        stream: {
          write: (line: string) => {
            lines.push(JSON.parse(line) as Record<string, unknown>);
          },
        },
      },
    });

    const user = await seedUser('Sanne');
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { conversationStrategy: 'explore' },
    });
    const cookie = await deviceCookie(app, user.id);
    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(start.statusCode).toBe(201);

    const decisionLines = lines.filter((line) => typeof line.ai === 'object' && line.ai !== null);
    expect(decisionLines.length).toBeGreaterThan(0);
    const ai = decisionLines[decisionLines.length - 1]!.ai as Record<string, unknown>;
    expect(ai.strategy).toBe('explore');
    // Alleen de sleutel: geen promptinhoud en geen persoonlijke context (DESIGN §9.4).
    expect(JSON.stringify(ai)).not.toContain('aacRules');
    expect(JSON.stringify(ai)).not.toContain('goal');
  });

  it('laat een strategie die de registry niet kent een lopend gesprek niet breken', async () => {
    // Een rij die ooit met een sindsdien verwijderde strategie is opgeslagen: de invoer wordt op de
    // API-grens geweigerd, maar bestaande data mag nooit een gesprek laten crashen (§7.10).
    const state = await conversationFor('Iris', 'ooit-bestaan-hebbende-aanpak');
    // De standaardstrategie neemt het over: hetzelfde gedrag als `refine`, geen crash.
    const withRefine = await conversationFor('Iris-refine', 'refine');
    expect(state.done).toBe(withRefine.done);
    expect(conceptsOf(state).length).toBe(conceptsOf(withRefine).length);
  });
});
