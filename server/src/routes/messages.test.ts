import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { caregiverMessageListResponseSchema } from '@intento/shared';
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
