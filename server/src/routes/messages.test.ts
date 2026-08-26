import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  caregiverMessageListResponseSchema,
  caregiverMessageResponseSchema,
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
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Berichtenlijst voor de begeleider (T13.1, DESIGN §2, §3.3, §9.1).
 *
 * Het ijkpunt is de hele keten: de gebruiker bevestigt op zijn tablet een boodschap, en die verschijnt
 * bij zijn begeleider — met het juiste tijdstip en bij niemand anders. Daarom loopt de eerste test via
 * de **echte gespreksflow** (device-auth) en niet via een vooraf in de database gezette rij: alleen zo
 * blijft de test kloppen als de bevestigflow verandert.
 */
describe('berichten voor de begeleider — GET /caregiver/messages (T13.1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({ env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /** Laat de gebruiker op zijn tablet een gesprek voeren en de boodschap bevestigen. */
  async function speak(userId: string): Promise<string> {
    const cookie = await deviceCookie(app, userId);
    const start = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(start.statusCode).toBe(201);
    const sessionId = start.json().sessionId as string;

    const want = await prisma.aacSymbol.findUnique({ where: { concept: 'want' } });
    const next = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: want!.id },
    });
    expect(next.statusCode).toBe(200);

    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
    });
    expect(confirm.statusCode).toBe(200);
    return confirm.json().message as string;
  }

  /** Legt rechtstreeks een bevestigde boodschap vast (voor de isolatietests). */
  async function seedMessage(userId: string, message: string): Promise<void> {
    const session = await prisma.conversationSession.create({
      data: { userId, status: 'COMPLETED' },
    });
    await prisma.generatedMessage.create({
      data: { sessionId: session.id, message, confirmed: true },
    });
  }

  it('toont een zojuist bevestigde boodschap bij de gekoppelde begeleider, met tijdstip', async () => {
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const begeleider = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-gekoppeld',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(begeleider.accountId, user.id);

    const voor = Date.now();
    const gezegd = await speak(user.id);
    const cookie = await loginCookie(app, begeleider.email, begeleider.password);

    const res = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { messages } = caregiverMessageListResponseSchema.parse(res.json());

    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toBe(gezegd);
    expect(messages[0]!.userName).toBe('Sanne');
    // Het tijdstip is dat van het bevestigen, niet van het opvragen.
    expect(new Date(messages[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(voor);
    expect(new Date(messages[0]!.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
    // De sessie staat erbij zodat het gesprek erachter te openen is (T12.1).
    expect(messages[0]!.sessionId).toBeTruthy();
  });

  it('laat een begeleider zonder koppeling niets zien, ook binnen dezelfde organisatie', async () => {
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    await seedMessage(user.id, 'Ik wil eten.');

    const ander = await seedAccount(
      'ander@intento.local',
      'pw-niet-gekoppeld-hier',
      'CAREGIVER',
      organizationId,
    );
    const cookie = await loginCookie(app, ander.email, ander.password);

    const res = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(caregiverMessageListResponseSchema.parse(res.json()).messages).toEqual([]);
    expect(res.body).not.toContain('Ik wil eten.');

    // Mét koppeling verschijnt hij wél: de grens zit op de koppeling, niet op de rol.
    await linkCaregiver(ander.accountId, user.id);
    const opnieuw = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    expect(caregiverMessageListResponseSchema.parse(opnieuw.json()).messages).toHaveLength(1);
  });

  it('toont een ADMIN de boodschappen van de eigen organisatie en van geen andere', async () => {
    const eigen = await seedAccount('admin-a@intento.local', 'pw-organisatie-a');
    const eigenUser = await seedUser('Sanne', eigen.organizationId);
    await seedMessage(eigenUser.id, 'Ik wil naar buiten.');

    const vreemd = await seedAccount('admin-b@intento.local', 'pw-organisatie-b');
    const vreemdeUser = await seedUser('Joris', vreemd.organizationId);
    await seedMessage(vreemdeUser.id, 'Ik heb pijn.');

    const cookie = await loginCookie(app, eigen.email, eigen.password);
    const res = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    const { messages } = caregiverMessageListResponseSchema.parse(res.json());

    expect(messages.map((entry) => entry.message)).toEqual(['Ik wil naar buiten.']);
    expect(res.body).not.toContain('Ik heb pijn.');
  });

  it('zet de nieuwste boodschap bovenaan', async () => {
    const { organizationId, email, password } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    await seedMessage(user.id, 'Eerste.');
    await seedMessage(user.id, 'Tweede.');

    const cookie = await loginCookie(app, email, password);
    const res = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    const { messages } = caregiverMessageListResponseSchema.parse(res.json());
    expect(messages.map((entry) => entry.message)).toEqual(['Tweede.', 'Eerste.']);
  });

  it('weigert zonder sessie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/caregiver/messages' });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * Afhandelen: wat is er al opgepakt? (T13.3, DESIGN §2, §3.3, §3.6).
 *
 * Het ijkpunt is dat de administratie van de begeleider en de uitspraak van de gebruiker gescheiden
 * blijven: aftekenen legt vast wie iets oppakte en wanneer, maar mag de boodschap nooit veranderen of
 * verbergen. En de stand is gedeeld — de vraag is "is hier al iets mee gedaan", niet "heb ík het gezien".
 */
describe('opgepakt aftekenen — /caregiver/messages/:id/acknowledge (T13.3)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({ env: testEnv() });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Legt een bevestigde boodschap vast en geeft het id terug. */
  async function seedMessage(userId: string, message: string): Promise<string> {
    const session = await prisma.conversationSession.create({
      data: { userId, status: 'COMPLETED' },
    });
    const created = await prisma.generatedMessage.create({
      data: { sessionId: session.id, message, confirmed: true },
    });
    return created.id;
  }

  /** Een organisatie met één gebruiker en één daaraan gekoppelde begeleider. */
  async function seedTeam(): Promise<{
    userId: string;
    messageId: string;
    organizationId: string;
    caregiver: { email: string; password: string; accountId: string };
  }> {
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const messageId = await seedMessage(user.id, 'Ik wil naar buiten.');
    const caregiver = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-gekoppeld',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(caregiver.accountId, user.id);
    return { userId: user.id, messageId, organizationId, caregiver };
  }

  it('tekent een boodschap af met wie en wanneer, en toont dat in de lijst', async () => {
    const { messageId, caregiver } = await seedTeam();
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    const voor = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { message } = caregiverMessageResponseSchema.parse(res.json());
    expect(message.acknowledgedBy).toBe(caregiver.email);
    expect(new Date(message.acknowledgedAt!).getTime()).toBeGreaterThanOrEqual(voor);

    // De lijst toont dezelfde stand: aftekenen is geen los antwoord maar de nieuwe werkelijkheid.
    const lijst = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    const { messages } = caregiverMessageListResponseSchema.parse(lijst.json());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.acknowledgedAt).toBe(message.acknowledgedAt);
    expect(messages[0]!.acknowledgedBy).toBe(caregiver.email);
  });

  it('laat de boodschap zelf ongemoeid: aftekenen is administratie, geen wijziging (DESIGN §2)', async () => {
    const { messageId, caregiver } = await seedTeam();
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);
    const voor = await prisma.generatedMessage.findUniqueOrThrow({ where: { id: messageId } });

    await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });

    const na = await prisma.generatedMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(na).toEqual(voor);
    // En hij verdwijnt niet uit de lijst: afgetekend is niet weggehaald.
    const lijst = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie },
    });
    const { messages } = caregiverMessageListResponseSchema.parse(lijst.json());
    expect(messages.map((entry) => entry.message)).toEqual(['Ik wil naar buiten.']);
  });

  it('is gedeeld: een tweede gekoppelde begeleider ziet dat het al is opgepakt, en door wie', async () => {
    const { userId, messageId, organizationId, caregiver } = await seedTeam();
    const collega = await seedAccount(
      'collega@intento.local',
      'pw-begeleider-collega',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(collega.accountId, userId);

    const eerste = await loginCookie(app, caregiver.email, caregiver.password);
    await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie: eerste },
    });

    const tweede = await loginCookie(app, collega.email, collega.password);
    const lijst = await app.inject({
      method: 'GET',
      url: '/caregiver/messages',
      headers: { cookie: tweede },
    });
    const { messages } = caregiverMessageListResponseSchema.parse(lijst.json());
    expect(messages[0]!.acknowledgedBy).toBe(caregiver.email);
  });

  it('houdt bij een tweede aftekening de eerste aftekenaar en het eerste tijdstip aan', async () => {
    const { userId, messageId, organizationId, caregiver } = await seedTeam();
    const collega = await seedAccount(
      'collega2@intento.local',
      'pw-begeleider-collega-2',
      'CAREGIVER',
      organizationId,
    );
    await linkCaregiver(collega.accountId, userId);

    const eerste = await loginCookie(app, caregiver.email, caregiver.password);
    const eersteRes = await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie: eerste },
    });
    const eersteStand = caregiverMessageResponseSchema.parse(eersteRes.json()).message;

    const tweede = await loginCookie(app, collega.email, collega.password);
    const tweedeRes = await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie: tweede },
    });
    expect(tweedeRes.statusCode).toBe(200);
    const tweedeStand = caregiverMessageResponseSchema.parse(tweedeRes.json()).message;
    expect(tweedeStand.acknowledgedBy).toBe(caregiver.email);
    expect(tweedeStand.acknowledgedAt).toBe(eersteStand.acknowledgedAt);
  });

  it('draait het aftekenen terug (ook door een ander) en blijft daarbij idempotent', async () => {
    const { messageId, caregiver } = await seedTeam();
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);
    await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(caregiverMessageResponseSchema.parse(res.json()).message.acknowledgedAt).toBeNull();

    // Nog eens terugdraaien is geen fout: de stand is al zoals gevraagd.
    const nogmaals = await app.inject({
      method: 'DELETE',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(nogmaals.statusCode).toBe(200);
    expect(caregiverMessageResponseSchema.parse(nogmaals.json()).message.acknowledgedBy).toBeNull();
  });

  it('weigert aftekenen door een begeleider zonder koppeling, ook binnen dezelfde organisatie', async () => {
    const { messageId, organizationId } = await seedTeam();
    const ander = await seedAccount(
      'ander@intento.local',
      'pw-niet-gekoppeld-hier',
      'CAREGIVER',
      organizationId,
    );
    const cookie = await loginCookie(app, ander.email, ander.password);

    const res = await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.messageAcknowledgement.count()).toBe(0);
  });

  it('weigert aftekenen vanuit een andere organisatie', async () => {
    const { messageId } = await seedTeam();
    const vreemd = await seedAccount('admin-b@intento.local', 'pw-organisatie-b');
    const cookie = await loginCookie(app, vreemd.email, vreemd.password);

    const res = await app.inject({
      method: 'POST',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.messageAcknowledgement.count()).toBe(0);

    // Terugdraaien kan een vreemde evenmin.
    const verwijder = await app.inject({
      method: 'DELETE',
      url: `/caregiver/messages/${messageId}/acknowledge`,
      headers: { cookie },
    });
    expect(verwijder.statusCode).toBe(404);
  });

  it('weigert zonder sessie met 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/caregiver/messages/onbekend/acknowledge',
    });
    expect(res.statusCode).toBe(401);
  });
});
