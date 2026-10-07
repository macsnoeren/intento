import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { messageListResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/** Berichtenoverzicht voor de beheerder (N11.6, INTENTO-NEW-DESIGN §32, §49). */

const PASSWORD = 'correct horse battery staple';
const encryptor = createEncryptor(testEnv());

async function confirmedMessage(
  organizationId: string,
  userId: string,
  message: string,
  confirmedAt: Date,
  deliveries: { contactName: string; status: 'sent' | 'failed' }[] = [],
): Promise<void> {
  const session = await prisma.communicationSession.create({
    data: { userId, organizationId, status: 'confirmed', endedAt: confirmedAt },
  });
  const intent = await prisma.communicationIntent.create({
    data: {
      sessionId: session.id,
      userId,
      organizationId,
      turn: 1,
      messageEncrypted: encryptor.encrypt(message),
      concepts: ['x'],
      confirmedAt,
    },
  });
  for (const delivery of deliveries) {
    const contact = await prisma.contact.create({
      data: {
        userId,
        organizationId,
        nameEncrypted: encryptor.encrypt(delivery.contactName),
        emailEncrypted: encryptor.encrypt('x@example.org'),
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.delivery.create({
      data: {
        sessionId: session.id,
        intentId: intent.id,
        contactId: contact.id,
        userId,
        organizationId,
        status: delivery.status,
        sentAt: delivery.status === 'sent' ? confirmedAt : null,
      },
    });
  }
}

describe('GET /messages', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  async function list(cookie: string, query = '') {
    const res = await app.inject({ method: 'GET', url: `/messages${query}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return messageListResponseSchema.parse(res.json());
  }

  it('toont de berichten nieuwste eerst: van wie, wat, aan wie verstuurd; geaudit', async () => {
    const org = await seedOrganization();
    await seedAccount('admin@intento.local', PASSWORD, 'ADMIN', org);
    const cookie = await loginCookie(app, 'admin@intento.local', PASSWORD);
    const sanne = await seedUser('Sanne', org);
    const piet = await seedUser('Piet', org);
    await confirmedMessage(org, sanne.id, 'Ik heb hoofdpijn.', new Date('2026-10-07T08:00:00Z'), [
      { contactName: 'Tim', status: 'failed' },
      { contactName: 'Mama', status: 'sent' },
    ]);
    await confirmedMessage(org, piet.id, 'Drinken.', new Date('2026-10-07T09:00:00Z'));

    const body = await list(cookie);
    expect(body.total).toBe(2);
    expect(body.items.map((m) => [m.user.name, m.message])).toEqual([
      ['Piet', 'Drinken.'],
      ['Sanne', 'Ik heb hoofdpijn.'],
    ]);
    expect(body.items[0]?.deliveries).toEqual([]); // niet verstuurd
    expect(body.items[1]?.deliveries.map((d) => [d.contactName, d.status])).toEqual([
      ['Tim', 'failed'],
      ['Mama', 'sent'],
    ]);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'message.list' } });
    expect(audit.organizationId).toBe(org);
    expect(JSON.stringify(audit)).not.toContain('hoofdpijn');
  });

  it('een verwijderd contact: de verzending blijft, zonder naam', async () => {
    const org = await seedOrganization();
    await seedAccount('admin@intento.local', PASSWORD, 'ADMIN', org);
    const cookie = await loginCookie(app, 'admin@intento.local', PASSWORD);
    const sanne = await seedUser('Sanne', org);
    await confirmedMessage(org, sanne.id, 'Pijn.', new Date(), [
      { contactName: 'Mama', status: 'sent' },
    ]);
    await prisma.contact.deleteMany();
    const [item] = (await list(cookie)).items;
    expect(item?.deliveries).toEqual([
      expect.objectContaining({ contactName: null, status: 'sent' }),
    ]);
  });

  it('bladert', async () => {
    const org = await seedOrganization();
    await seedAccount('admin@intento.local', PASSWORD, 'ADMIN', org);
    const cookie = await loginCookie(app, 'admin@intento.local', PASSWORD);
    const sanne = await seedUser('Sanne', org);
    for (let i = 0; i < 3; i += 1) {
      await confirmedMessage(org, sanne.id, `Bericht ${i}`, new Date(Date.UTC(2026, 9, 7, i)));
    }
    const second = await list(cookie, '?page=2&pageSize=2');
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.items.map((m) => m.message)).toEqual(['Bericht 0']);
    const bad = await app.inject({
      method: 'GET',
      url: '/messages?pageSize=500',
      headers: { cookie },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('isoleert: een andere organisatie ziet de berichten niet', async () => {
    const a = await seedOrganization('A');
    const b = await seedOrganization('B');
    await seedAccount('b@intento.local', PASSWORD, 'ADMIN', b);
    const sanne = await seedUser('Sanne', a);
    await confirmedMessage(a, sanne.id, 'Geheim.', new Date());
    const cookie = await loginCookie(app, 'b@intento.local', PASSWORD);
    expect(await list(cookie)).toMatchObject({ items: [], total: 0 });
  });

  it('een begeleider krijgt 403, zonder login 401', async () => {
    const org = await seedOrganization();
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    const res = await app.inject({ method: 'GET', url: '/messages', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/messages' })).statusCode).toBe(401);
  });
});
