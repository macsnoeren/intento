import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
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
    // De antwoordopties zijn de dranken — AAC-begrensd tot de kinderen van het anker (§7.6).
    const options = (state!.question?.options ?? []).map((o) => o.concept).sort();
    expect(options).toEqual(['coffee', 'juice', 'milk', 'water']);

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
