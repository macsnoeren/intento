import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  caregiverConversationViewSchema,
  conversationConfirmResponseSchema,
  conversationStateResponseSchema,
  pendingQuestionResponseSchema,
  questionStartResponseSchema,
  userListResponseSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import {
  deviceCookie,
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Vraagmodus (T7.1, DESIGN §3.2, §8.2, FR-012). Toetst de acceptatie end-to-end via HTTP:
 *  - de "Wat wil je drinken?"-flow (§3.2): begeleider stelt een vraag → tablet toont de vraag met de
 *    dranken als antwoordopties → gebruiker kiest → bevestigt zijn eigen boodschap;
 *  - alléén een **gekoppelde** begeleider mag een vraag stellen (isolatietest, 403);
 *  - tenant-isolatie en anker-validatie op de grens.
 */
describe('vraagmodus — /question (T7.1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
    });
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

  it('doorloopt de "Wat wil je drinken?"-flow end-to-end (§3.2)', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    await linkCaregiver(caregiver.accountId, user.id);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Begeleider stelt de vraag met het topic-anker "drink".
    const start = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: { userId: user.id, question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    });
    expect(start.statusCode).toBe(201);
    const started = questionStartResponseSchema.parse(start.json());
    expect(started.question).toBe('Wat wil je drinken?');

    // De tablet (device-auth) pakt de openstaande vraag op.
    const deviceCk = await deviceCookie(app, user.id);
    const pending = await app.inject({
      method: 'GET',
      url: '/conversation/pending',
      headers: { cookie: deviceCk },
    });
    expect(pending.statusCode).toBe(200);
    const { state } = pendingQuestionResponseSchema.parse(pending.json());
    expect(state).not.toBeNull();
    expect(state!.caregiverQuestion).toBe('Wat wil je drinken?');
    // De antwoordopties zijn de dranken — AAC-begrensd tot de kinderen van het anker (§7.6). Sinds
    // T9.11 kent de bibliotheek meer dranken; de begrenzing is dat er niets búiten de kinderen van
    // het anker bij zit.
    const options = (state!.question?.options ?? []).map((o) => o.concept).sort();
    expect(options).toEqual(expect.arrayContaining(['coffee', 'juice', 'milk', 'water']));
    const drinkChildren = await prisma.aacConceptRelation.findMany({
      where: { parent: { concept: 'drink' } },
      include: { child: true },
    });
    expect(options.sort()).toEqual(drinkChildren.map((r) => r.child.concept).sort());

    // Gebruiker kiest "water" → route klaar om een boodschap voor te stellen.
    const next = await app.inject({
      method: 'POST',
      url: `/conversation/${state!.sessionId}/next`,
      headers: { cookie: deviceCk },
      payload: { symbolId: await symbolId('water') },
    });
    expect(next.statusCode).toBe(200);
    expect(conversationStateResponseSchema.parse(next.json()).done).toBe(true);

    // Gebruiker bevestigt zelf zijn boodschap (de begeleider nooit namens hem).
    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${state!.sessionId}/confirm`,
      headers: { cookie: deviceCk },
    });
    expect(confirm.statusCode).toBe(200);
    const confirmed = conversationConfirmResponseSchema.parse(confirm.json());
    expect(confirmed.status).toBe('COMPLETED');
    expect(confirmed.message.toLowerCase()).toContain('water');

    // Alleen de bevestigde boodschap staat in de db.
    const messages = await prisma.generatedMessage.findMany({
      where: { sessionId: state!.sessionId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.confirmed).toBe(true);
  });

  it('weigert een niet-gekoppelde begeleider (403) — isolatie', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    // Bewust NIET gekoppeld.
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: { userId: user.id, question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    });
    expect(res.statusCode).toBe(403);
    // Er is geen sessie aangemaakt.
    expect(await prisma.conversationSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('weigert een gebruiker uit een andere organisatie (403) — tenant-isolatie', async () => {
    const orgA = await seedOrganization('A');
    const caregiver = await seedAccount('cg@a.local', 'pw-c', 'CAREGIVER', orgA);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const otherUser = await seedUser('Ander', await seedOrganization('B'));

    const res = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: { userId: otherUser.id, question: 'Wat wil je?', anchorConcept: 'drink' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('weigert een onbekend anker (400) en een anker zonder antwoordopties (400)', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, admin.email, admin.password);

    const unknown = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie },
      payload: { userId: user.id, question: 'Wat?', anchorConcept: 'bestaatniet' },
    });
    expect(unknown.statusCode).toBe(400);

    // "water" is een eindconcept (geen kinderen) → geen antwoorden om samen te stellen.
    const leaf = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie },
      payload: { userId: user.id, question: 'Wat?', anchorConcept: 'water' },
    });
    expect(leaf.statusCode).toBe(400);
  });

  it('laat de gebruiker het topic-anker niet ongedaan maken (blijft binnen de vraag)', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, admin.email, admin.password);

    const start = await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie },
      payload: { userId: user.id, question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    });
    const { sessionId } = questionStartResponseSchema.parse(start.json());

    const deviceCk = await deviceCookie(app, user.id);
    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie: deviceCk },
    });
    expect(back.statusCode).toBe(400);
  });

  it('laat een gekoppelde begeleider read-only meekijken met het lopende gesprek (T7.2, §3.3)', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    await linkCaregiver(caregiver.accountId, user.id);
    // Ondersteuningsmodus aanzetten zodat de begeleider dat in de meekijkweergave ziet (§3.3).
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: { supportMode: true },
    });
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Begeleider stelt een vraag en de gebruiker maakt op de tablet een keuze, zodat er context is.
    await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: {
        userId: user.id,
        question: 'Wat wil je drinken?',
        anchorConcept: 'drink',
        // De begeleider kiest de aanpak voor dít gesprek (T11.5) en moet hem straks terugzien (T11.6).
        strategy: 'explore',
      },
    });
    const deviceCk = await deviceCookie(app, user.id);
    const pending = await app.inject({
      method: 'GET',
      url: '/conversation/pending',
      headers: { cookie: deviceCk },
    });
    const { state } = pendingQuestionResponseSchema.parse(pending.json());
    await app.inject({
      method: 'POST',
      url: `/conversation/${state!.sessionId}/next`,
      headers: { cookie: deviceCk },
      payload: { symbolId: await symbolId('water') },
    });

    // Meekijken: read-only snapshot met ondersteuningsmodus, de eigen vraag en het afgelegde pad.
    const res = await app.inject({
      method: 'GET',
      url: `/question/users/${user.id}/conversation`,
      headers: { cookie: cgCookie },
    });
    expect(res.statusCode).toBe(200);
    const view = caregiverConversationViewSchema.parse(res.json());
    expect(view.supportMode).toBe(true);
    expect(view.session).not.toBeNull();
    expect(view.session!.mode).toBe('question');
    expect(view.session!.caregiverQuestion).toBe('Wat wil je drinken?');
    // Het anker (drink) + de keuze (water) staan in de broodkruimel.
    expect(view.session!.history.map((h) => h.symbol.concept)).toEqual(['drink', 'water']);
    // En de begeleider ziet wélke aanpak er draait (T11.6) — sleutel én leesbaar label.
    expect(view.session!.strategy).toEqual({ key: 'explore', label: 'Breed verkennen' });
    // Nooit de prompt of de parameters van de strategie (DESIGN §9.4).
    expect(res.body).not.toContain('aacRules');
    expect(res.body).not.toContain('confidencePropose');
  });

  it('geeft session=null als er geen gesprek loopt, en supportMode uit standaard', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    await linkCaregiver(caregiver.accountId, user.id);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'GET',
      url: `/question/users/${user.id}/conversation`,
      headers: { cookie: cgCookie },
    });
    const view = caregiverConversationViewSchema.parse(res.json());
    expect(view.session).toBeNull();
    expect(view.supportMode).toBe(false);
  });

  it('weigert meekijken door een niet-gekoppelde begeleider (403) en over de tenant-grens (403)', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const unlinked = await seedUser('Sanne', org);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Niet gekoppeld → 403.
    const notLinked = await app.inject({
      method: 'GET',
      url: `/question/users/${unlinked.id}/conversation`,
      headers: { cookie: cgCookie },
    });
    expect(notLinked.statusCode).toBe(403);

    // Andere organisatie → 403 (tenant-isolatie, lekt niet of de gebruiker bestaat).
    const otherUser = await seedUser('Ander', await seedOrganization('B'));
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/question/users/${otherUser.id}/conversation`,
      headers: { cookie: cgCookie },
    });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('laat ❌ Nee op een vraagmodus-sessie niet doodlopen op een voorstel uit het niets (T9.14)', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    await linkCaregiver(caregiver.accountId, user.id);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const deviceCk = await deviceCookie(app, user.id);

    // De begeleider vraagt iets met "er is iets aan de hand" als onderwerp.
    await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: {
        userId: user.id,
        question: 'Waarom wil je je nagels niet knippen?',
        anchorConcept: 'problem',
      },
    });

    const pending = await app.inject({
      method: 'GET',
      url: '/conversation/pending',
      headers: { cookie: deviceCk },
    });
    const { state } = pendingQuestionResponseSchema.parse(pending.json());
    const sessionId = state!.sessionId;

    // De gebruiker kiest "pijn" en wijst daarna het voorstel af.
    await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie: deviceCk },
      payload: { symbolId: await symbolId('pain') },
    });
    // ❌ verfijnt eerst (T10.12); pas de tweede rolt de keuze van de gebruiker terug.
    let after = conversationStateResponseSchema.parse({
      sessionId,
      status: 'ACTIVE',
      question: null,
      done: true,
      history: [],
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const corrected = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/correction`,
        headers: { cookie: deviceCk },
        payload: {},
      });
      expect(corrected.statusCode).toBe(200);
      after = conversationStateResponseSchema.parse(corrected.json());
    }

    // Er volgt een nieuwe vraag, géén boodschapvoorstel: de gebruiker had niets meer gekozen, dus er
    // valt niets van hém voor te stellen (DESIGN §2).
    expect(after.done).toBe(false);
    expect((after.question?.options ?? []).length).toBeGreaterThan(0);
    // Het anker van de begeleider blijft staan; de vraag blijft in beeld.
    expect(after.history.map((step) => step.symbol.concept)).toEqual(['problem']);
    expect(after.caregiverQuestion).toBe('Waarom wil je je nagels niet knippen?');
  });

  it('weigert een correctie als de gebruiker alleen het begeleiders-anker heeft (T9.14)', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    await linkCaregiver(caregiver.accountId, user.id);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const deviceCk = await deviceCookie(app, user.id);

    await app.inject({
      method: 'POST',
      url: '/question/start',
      headers: { cookie: cgCookie },
      payload: { userId: user.id, question: 'Wat wil je drinken?', anchorConcept: 'drink' },
    });
    const pending = await app.inject({
      method: 'GET',
      url: '/conversation/pending',
      headers: { cookie: deviceCk },
    });
    const { state } = pendingQuestionResponseSchema.parse(pending.json());

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${state!.sessionId}/correction`,
      headers: { cookie: deviceCk },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_STEPS_TO_CORRECT');
    // Het anker staat er nog: een correctie mag de vraag van de begeleider niet wegvegen.
    expect(await prisma.conversationStep.count({ where: { sessionId: state!.sessionId } })).toBe(1);
  });

  it('GET /question/users toont een begeleider alléén de gekoppelde gebruikers', async () => {
    const org = await seedOrganization('Org');
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const linked = await seedUser('Sanne', org);
    await seedUser('Niet gekoppeld', org);
    await linkCaregiver(caregiver.accountId, linked.id);
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'GET',
      url: '/question/users',
      headers: { cookie: cgCookie },
    });
    expect(res.statusCode).toBe(200);
    const { users } = userListResponseSchema.parse(res.json());
    expect(users.map((u) => u.id)).toEqual([linked.id]);
  });
});
