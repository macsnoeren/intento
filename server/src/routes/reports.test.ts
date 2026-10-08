import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { biasReportSchema } from '@intento/shared';
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

/** `GET /reports/bias` (N14.3, INTENTO-NEW-DESIGN §24 B4/B5). */

const PASSWORD = 'correct horse battery staple';
const encryptor = createEncryptor(testEnv());
const DAY = 24 * 60 * 60 * 1000;

describe('GET /reports/bias', () => {
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

  async function admin(email: string, organizationId: string): Promise<string> {
    await seedAccount(email, PASSWORD, 'ADMIN', organizationId);
    return loginCookie(app, email, PASSWORD);
  }

  /** Een gesprek: één ja/nee-vraag met het gegeven antwoord, en een contactvraag met JA. */
  async function conversation(
    user: { id: string },
    organizationId: string,
    answer: 'answer_yes' | 'answer_no',
    contactId: string,
    startedAt = new Date(),
  ): Promise<void> {
    const session = await prisma.communicationSession.create({
      data: { userId: user.id, organizationId, status: 'confirmed', startedAt, endedAt: startedAt },
    });
    const option = (kind: 'symbol' | 'contact', id: string) => ({
      ref: `${kind}-${id}`,
      kind,
      vocabularyItemId: kind === 'symbol' ? id : null,
      contactId: kind === 'contact' ? id : null,
      concept: null,
      representation: 'exact',
      position: 0,
    });
    await prisma.presentationEvent.createMany({
      data: [
        {
          sessionId: session.id,
          turn: 0,
          kind: 'question',
          mode: 'binary',
          optionsJson: [option('symbol', 'pain')],
          contentEncrypted: 'x',
        },
        {
          sessionId: session.id,
          turn: 1,
          kind: 'share_contact',
          mode: 'binary',
          optionsJson: [option('contact', contactId)],
          contentEncrypted: 'x',
        },
      ],
    });
    await prisma.observedEvent.createMany({
      data: [
        { sessionId: session.id, turn: 0, type: answer },
        { sessionId: session.id, turn: 1, type: 'answer_yes' },
      ],
    });
  }

  async function contact(userId: string, organizationId: string, name: string): Promise<string> {
    const row = await prisma.contact.create({
      data: {
        userId,
        organizationId,
        nameEncrypted: encryptor.encrypt(name),
        emailEncrypted: encryptor.encrypt(`${name.toLowerCase()}@example.org`),
      },
    });
    return row.id;
  }

  function get(cookie: string, query = '') {
    return app.inject({ method: 'GET', url: `/reports/bias${query}`, headers: { cookie } });
  }

  it('rekent over de eigen organisatie; per gebruiker en per periode te beperken', async () => {
    const org = await seedOrganization('A');
    const sanne = await seedUser('Sanne', org);
    const piet = await seedUser('Piet', org);
    const mama = await contact(sanne.id, org, 'Mama');
    const jan = await contact(piet.id, org, 'Jan');
    await conversation(sanne, org, 'answer_yes', mama);
    await conversation(sanne, org, 'answer_no', mama, new Date(Date.now() - 40 * DAY));
    await conversation(piet, org, 'answer_yes', jan);
    await prisma.vocabularyGap.create({
      data: {
        organizationId: org,
        conceptKey: 'dizzy',
        label: 'duizelig',
        lastConfidence: 0.3,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const cookie = await admin('a@intento.local', org);

    const all = biasReportSchema.parse((await get(cookie)).json());
    expect(all.sessions).toBe(3);
    expect(all.binaryYes).toEqual({ count: 2, of: 3, share: 2 / 3 });
    expect(all.contacts).toEqual([
      { contactId: mama, name: 'Mama', chosen: 2, chosenAtFirst: 2 },
      { contactId: jan, name: 'Jan', chosen: 1, chosenAtFirst: 1 },
    ]);
    expect(all.gaps).toEqual({ open: 1, total: 1 });

    const onlySanne = biasReportSchema.parse((await get(cookie, `?userId=${sanne.id}`)).json());
    expect(onlySanne.sessions).toBe(2);
    expect(onlySanne.contacts.map((c) => c.name)).toEqual(['Mama']);

    const recent = biasReportSchema.parse((await get(cookie, '?days=30')).json());
    expect(recent.sessions).toBe(2);
    expect(recent.binaryYes).toEqual({ count: 2, of: 2, share: 1 });

    expect((await get(cookie, '?days=0')).statusCode).toBe(400);
  });

  it('isoleert: een andere organisatie telt niet mee en kan geen gebruiker van ons opvragen', async () => {
    const a = await seedOrganization('A');
    const b = await seedOrganization('B');
    const sanne = await seedUser('Sanne', a);
    const bram = await seedUser('Bram', b);
    await conversation(sanne, a, 'answer_yes', await contact(sanne.id, a, 'Mama'));
    await conversation(bram, b, 'answer_no', await contact(bram.id, b, 'Kees'));
    const cookieB = await admin('b@intento.local', b);

    const report = biasReportSchema.parse((await get(cookieB)).json());
    expect(report.sessions).toBe(1);
    expect(report.binaryYes).toEqual({ count: 0, of: 1, share: 0 });
    expect(report.contacts.map((c) => c.name)).toEqual(['Kees']);
    expect((await get(cookieB, `?userId=${sanne.id}`)).statusCode).toBe(403);
    expect((await get(cookieB, '?userId=bestaat-niet')).statusCode).toBe(403);
  });

  it('alleen de beheerder', async () => {
    const org = await seedOrganization();
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    expect((await get(cookie)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/reports/bias' })).statusCode).toBe(401);
  });
});
