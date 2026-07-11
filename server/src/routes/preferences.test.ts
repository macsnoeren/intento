import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  conversationStateResponseSchema,
  personalContextListResponseSchema,
  preferenceListResponseSchema,
  preferencePublicSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiPrompt, AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { SUGGESTION_THRESHOLD } from '../users/preferences.js';
import {
  deviceCookie,
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Leermechanisme-tests (T6.3, DESIGN §3.8, §6.2 Preference, §7.1 taak 5, FR-014).
 *
 * Dekt de acceptatie: een **bevestigde** boodschap verhoogt de voorkeur, een correctie (afwijzing) leert
 * niet; de per-user schakelaar `aiLearningEnabled` uit = geen mutaties; voorkeuren komen in de AI-prompt;
 * en de begeleider-suggestie (accepteren/aanpassen/weigeren) werkt met tenant-/begeleider-isolatie.
 */
describe('leermechanisme — voorkeuren (T6.3)', () => {
  let app: FastifyInstance;

  /** De concepten uit de voorbeeldroute (§3.1); de mock kiest opties in bibliotheekvolgorde. */
  const ROUTE = ['want', 'do-activity', 'outside', 'walking', 'dog'] as const;

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

  /** Start een gesprek, loopt de voorbeeldroute en (optioneel) bevestigt de boodschap. */
  async function walkRoute(
    cookie: string,
    concepts: readonly string[] = ROUTE,
  ): Promise<string> {
    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    const sessionId = conversationStateResponseSchema.parse(start.json()).sessionId;
    for (const concept of concepts) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/next`,
        headers: { cookie },
        payload: { symbolId: await symbolId(concept) },
      });
      expect(res.statusCode).toBe(200);
    }
    return sessionId;
  }

  async function confirm(cookie: string, sessionId: string): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  }

  it('verhoogt voorkeuren bij een bevestigde boodschap (alleen bevestigde concepten)', async () => {
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    await confirm(cookie, await walkRoute(cookie));

    const prefs = await prisma.preference.findMany({ where: { userId: user.id } });
    expect(prefs.map((p) => p.concept).sort()).toEqual([...ROUTE].sort());
    for (const pref of prefs) {
      expect(pref.count).toBe(1);
      expect(pref.confidence).toBeCloseTo(0.2);
      expect(pref.source).toBe('confirmed_usage');
      expect(pref.suggestionStatus).toBe('none');
    }

    // Nog een bevestiging van dezelfde route → count/confidence stijgen.
    await confirm(cookie, await walkRoute(cookie));
    const again = await prisma.preference.findUnique({
      where: { userId_concept: { userId: user.id, concept: 'walking' } },
    });
    expect(again!.count).toBe(2);
    expect(again!.confidence).toBeCloseTo(0.4);
  });

  it('leert niet van een correctie/afwijzing (alleen bevestigde communicatie)', async () => {
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    const sessionId = await walkRoute(cookie);
    // ❌ correctie: heranalyse rolt de vermoedelijke foutstap terug — er wordt niets geleerd (§3.4 punt 4).
    const correction = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: {},
    });
    expect(correction.statusCode).toBe(200);

    // Zonder bevestiging bestaat er geen enkele voorkeur.
    expect(await prisma.preference.count({ where: { userId: user.id } })).toBe(0);
    // De correctie is wél als signaal vastgelegd (maar niet als leerdata).
    expect(await prisma.correctionEvent.count({ where: { sessionId } })).toBe(1);
  });

  it('muteert niets als aiLearningEnabled uit staat', async () => {
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
    const user = await seedUser('Sanne');
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { aiLearningEnabled: false },
    });
    const cookie = await deviceCookie(app, user.id);

    await confirm(cookie, await walkRoute(cookie));
    expect(await prisma.preference.count({ where: { userId: user.id } })).toBe(0);
  });

  it('geeft geleerde voorkeuren door aan de AI-prompt (alleen bij leren aan)', async () => {
    let captured: AiPrompt | null = null;
    const provider: AiProvider = {
      name: 'spy',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        captured = prompt;
        return Promise.resolve({
          question: 'vraag?',
          reason: 'spy',
          options: prompt.availableSymbols.map((ref) => ({ symbol: ref.concept, confidence: 0.5 })),
        });
      },
    };
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
      orchestrator: new AiOrchestrator(provider),
    });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    await confirm(cookie, await walkRoute(cookie));

    // Nieuw gesprek starten → de spy vangt de prompt; de voorkeuren zitten als context erin.
    await app.inject({ method: 'POST', url: '/conversation/start', headers: { cookie } });
    expect(captured).not.toBeNull();
    const prefItems = captured!.userContext.filter((i) => i.kind === 'preference');
    expect(prefItems.length).toBeGreaterThan(0);
    const walkingLabel = (await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } }))!.label;
    expect(prefItems.map((i) => i.value)).toContain(walkingLabel);
  });

  it('laat een ADMIN de voorkeuren opvragen (sterkste eerst, met label)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const adminCookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);
    const deviceC = await deviceCookie(app, user.id);

    await confirm(deviceC, await walkRoute(deviceC));

    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/preferences`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { preferences } = preferenceListResponseSchema.parse(res.json());
    expect(preferences.length).toBe(ROUTE.length);
    expect(preferences.every((p) => p.label.length > 0)).toBe(true);
    expect(preferences.every((p) => p.confidence > 0)).toBe(true);
  });

  it('weigert voorkeuren van een gebruiker uit een andere organisatie (403, bestaan lekt niet)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const adminA = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookieA = await loginCookie(app, adminA.email, adminA.password);
    const userB = await seedUser('Bram'); // andere organisatie

    const res = await app.inject({
      method: 'GET',
      url: `/users/${userB.id}/preferences`,
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(403);
  });

  it('weigert een niet-gekoppelde CAREGIVER (403) en staat een gekoppelde toe', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount(
      'begeleider@intento.local',
      'pw',
      'CAREGIVER',
      admin.organizationId,
    );
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const before = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/preferences`,
      headers: { cookie: cgCookie },
    });
    expect(before.statusCode).toBe(403);

    await linkCaregiver(caregiver.accountId, user.id);
    const after = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/preferences`,
      headers: { cookie: cgCookie },
    });
    expect(after.statusCode).toBe(200);
  });

  describe('begeleider-suggestie (§3.8)', () => {
    /** Zet direct een voorkeur met een openstaande suggestie (drempel bereikt) neer. */
    async function seedPendingPreference(userId: string, concept = 'walking') {
      return prisma.preference.create({
        data: {
          userId,
          concept,
          count: SUGGESTION_THRESHOLD,
          confidence: 0.6,
          source: 'confirmed_usage',
          suggestionStatus: 'pending',
        },
      });
    }

    it('ontstaat automatisch zodra een concept de drempel bereikt', async () => {
      app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
      const user = await seedUser('Sanne');
      const cookie = await deviceCookie(app, user.id);
      for (let i = 0; i < SUGGESTION_THRESHOLD; i++) {
        await confirm(cookie, await walkRoute(cookie));
      }
      const pending = await prisma.preference.findMany({
        where: { userId: user.id, suggestionStatus: 'pending' },
      });
      expect(pending.length).toBe(ROUTE.length);
    });

    it('accepteren maakt versleutelde persoonlijke context aan en sluit de suggestie', async () => {
      app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const adminCookie = await loginCookie(app, admin.email, admin.password);
      const user = await seedUser('Sanne', admin.organizationId);
      const pref = await seedPendingPreference(user.id, 'walking');

      const res = await app.inject({
        method: 'POST',
        url: `/users/${user.id}/preferences/${pref.id}/suggestion`,
        headers: { cookie: adminCookie },
        payload: { action: 'accept' },
      });
      expect(res.statusCode).toBe(200);
      const updated = preferencePublicSchema.parse(res.json());
      expect(updated.suggestionStatus).toBe('accepted');
      expect(updated.suggested).toBe(false);

      // Persoonlijke context is aangemaakt (categorie afgeleid uit AAC: walking → ACTIVITY), AI-toegestaan.
      const list = await app.inject({
        method: 'GET',
        url: `/users/${user.id}/context`,
        headers: { cookie: adminCookie },
      });
      const { contexts } = personalContextListResponseSchema.parse(list.json());
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({ category: 'ACTIVITY', aiUsageAllowed: true });

      // De ruwe db bevat geen plaintext van de naam (versleuteld at-rest, T6.1).
      const raw = await prisma.personalContext.findFirst({ where: { userId: user.id } });
      const label = (await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } }))!.label;
      expect(raw!.nameEncrypted).not.toContain(label);
    });

    it('aanpassen gebruikt de opgegeven categorie/naam', async () => {
      app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const adminCookie = await loginCookie(app, admin.email, admin.password);
      const user = await seedUser('Sanne', admin.organizationId);
      const pref = await seedPendingPreference(user.id, 'walking');

      const res = await app.inject({
        method: 'POST',
        url: `/users/${user.id}/preferences/${pref.id}/suggestion`,
        headers: { cookie: adminCookie },
        payload: { action: 'adjust', category: 'ROUTINE', name: 'Ochtendwandeling' },
      });
      expect(res.statusCode).toBe(200);

      const list = await app.inject({
        method: 'GET',
        url: `/users/${user.id}/context`,
        headers: { cookie: adminCookie },
      });
      const { contexts } = personalContextListResponseSchema.parse(list.json());
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({ category: 'ROUTINE', name: 'Ochtendwandeling' });
    });

    it('weigeren sluit de suggestie zonder context aan te maken', async () => {
      app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const adminCookie = await loginCookie(app, admin.email, admin.password);
      const user = await seedUser('Sanne', admin.organizationId);
      const pref = await seedPendingPreference(user.id, 'walking');

      const res = await app.inject({
        method: 'POST',
        url: `/users/${user.id}/preferences/${pref.id}/suggestion`,
        headers: { cookie: adminCookie },
        payload: { action: 'reject' },
      });
      expect(res.statusCode).toBe(200);
      expect(preferencePublicSchema.parse(res.json()).suggestionStatus).toBe('dismissed');
      expect(await prisma.personalContext.count({ where: { userId: user.id } })).toBe(0);
    });

    it('een reeds afgehandelde suggestie geeft 409 (idempotent, geen dubbele context)', async () => {
      app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const adminCookie = await loginCookie(app, admin.email, admin.password);
      const user = await seedUser('Sanne', admin.organizationId);
      const pref = await seedPendingPreference(user.id, 'walking');

      const first = await app.inject({
        method: 'POST',
        url: `/users/${user.id}/preferences/${pref.id}/suggestion`,
        headers: { cookie: adminCookie },
        payload: { action: 'reject' },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: `/users/${user.id}/preferences/${pref.id}/suggestion`,
        headers: { cookie: adminCookie },
        payload: { action: 'accept' },
      });
      expect(second.statusCode).toBe(409);
    });
  });
});
