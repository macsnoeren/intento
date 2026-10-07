import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type CommunicationTurn } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { MemoryMailTransport, type MailTransport } from '../mail/transport.js';
import {
  deviceCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';
import { deliver } from '../communication/deliveries.js';
import { loadTurn } from '../communication/sessions.js';

/** Versturen per e-mail (N11.3, INTENTO-NEW-DESIGN §32, invariant I3). */

const encryptor = createEncryptor(testEnv());

describe('versturen na een JA op dát contact', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;
  let org: string;
  let sanne: { id: string };
  let tim: string;
  let mama: string;

  async function setup(transport: MailTransport): Promise<void> {
    app = await buildApp({ env: testEnv(), agents: fakeAgents(), mail: transport });
  }

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    mail = new MemoryMailTransport();
    await setup(mail);
    org = await seedOrganization();
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    sanne = await seedUser('Sanne', org);
    tim = await addContact(sanne.id, 'Tim', 0);
    mama = await addContact(sanne.id, 'Mama', 1);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function addContact(userId: string, name: string, sortOrder: number): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        userId,
        organizationId: org,
        nameEncrypted: encryptor.encrypt(name),
        emailEncrypted: encryptor.encrypt(`${name.toLowerCase()}@example.org`),
        emailVerifiedAt: new Date(),
        sortOrder,
      },
    });
    return contact.id;
  }

  async function answer(cookie: string, turn: CommunicationTurn, value: 'yes' | 'no') {
    return app.inject({
      method: 'POST',
      url: `/communication/sessions/${turn.sessionId}/answer`,
      headers: { cookie },
      payload: { turn: turn.turn, answer: value },
    });
  }

  /** Start → JA (pijn) → JA (Bedoel je) → JA (Wil je dit sturen?) → "Wil je dit naar Tim sturen?". */
  async function untilTim(): Promise<{ cookie: string; screen: CommunicationTurn }> {
    const cookie = await deviceCookie(app, sanne.id);
    const start = await app.inject({
      method: 'POST',
      url: '/communication/sessions',
      headers: { cookie },
    });
    let screen = communicationTurnSchema.parse(start.json());
    for (let i = 0; i < 3; i += 1) {
      screen = communicationTurnSchema.parse((await answer(cookie, screen, 'yes')).json());
    }
    expect(screen.presentation.text).toBe('Wil je dit naar Tim sturen?');
    return { cookie, screen };
  }

  it('NEE op Tim, JA op Mama: alleen Mama krijgt het bericht, met de naam van de gebruiker', async () => {
    const { cookie, screen } = await untilTim();
    const toMama = communicationTurnSchema.parse((await answer(cookie, screen, 'no')).json());
    expect(toMama.presentation.text).toBe('Wil je dit naar Mama sturen?');
    expect(mail.sent).toHaveLength(0);

    const done = communicationTurnSchema.parse((await answer(cookie, toMama, 'yes')).json());
    expect(done.presentation.kind).toBe('done');
    expect(done.canGoBack).toBe(false);
    expect(done.delivery).toEqual({ contactName: 'Mama', status: 'sent' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.last()).toMatchObject({ to: 'mama@example.org', subject: 'Bericht van Sanne' });
    expect(mail.last()?.text).toContain('"Pijn"');

    const [delivery] = await prisma.delivery.findMany();
    expect(delivery).toMatchObject({
      contactId: mama,
      userId: sanne.id,
      organizationId: org,
      channel: 'email',
      status: 'sent',
      error: null,
    });
    expect(delivery?.sentAt).not.toBeNull();

    // In de opgeslagen toestand staat dat er verstuurd is (alleen de backend weet dat).
    const saved = await loadTurn(prisma, encryptor, done.sessionId, done.turn);
    expect(saved?.state.share.sent_to).toEqual([mama]);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'message.send' } });
    expect(audit).toMatchObject({ outcome: 'success', targetId: mama, organizationId: org });
    expect(JSON.stringify(audit)).not.toContain('Pijn');
  });

  it('zonder JA wordt er niets verstuurd', async () => {
    const { cookie, screen } = await untilTim();
    const toMama = communicationTurnSchema.parse((await answer(cookie, screen, 'no')).json());
    const done = communicationTurnSchema.parse((await answer(cookie, toMama, 'no')).json());
    expect(done.presentation.kind).toBe('done');
    expect(done.delivery).toBeNull();
    expect(mail.sent).toHaveLength(0);
    expect(await prisma.delivery.count()).toBe(0);
  });

  it('een contact dat (inmiddels) van een andere gebruiker is: geweigerd', async () => {
    const { cookie, screen } = await untilTim();
    const piet = await seedUser('Piet', org);
    await prisma.contact.update({ where: { id: tim }, data: { userId: piet.id } });
    const res = await answer(cookie, screen, 'yes');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CANNOT_SEND' } });
    expect(mail.sent).toHaveLength(0);
    expect(await prisma.delivery.count()).toBe(0);
  });

  it('een (inmiddels) onbevestigd of uitgezet contact: geweigerd', async () => {
    const { cookie, screen } = await untilTim();
    await prisma.contact.update({ where: { id: tim }, data: { emailVerifiedAt: null } });
    expect((await answer(cookie, screen, 'yes')).statusCode).toBe(409);
    await prisma.contact.update({
      where: { id: tim },
      data: { emailVerifiedAt: new Date(), active: false },
    });
    expect((await answer(cookie, screen, 'yes')).statusCode).toBe(409);
    expect(mail.sent).toHaveLength(0);
  });

  it('een mailfout wordt `failed`; het gesprek loopt door en Terug blijft weg', async () => {
    await app.close();
    await setup({ send: () => Promise.reject(new Error('mailserver weg')) });
    const { cookie, screen } = await untilTim();
    const res = await answer(cookie, screen, 'yes');
    expect(res.statusCode).toBe(200);
    const failed = communicationTurnSchema.parse(res.json());
    expect(failed.presentation.kind).toBe('done');
    expect(failed.delivery).toEqual({ contactName: 'Tim', status: 'failed' });
    expect(await prisma.delivery.findFirstOrThrow()).toMatchObject({
      contactId: tim,
      status: 'failed',
      error: 'mail_failed',
      sentAt: null,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'message.send' } });
    expect(audit.outcome).toBe('failure');
  });

  it('dezelfde verzending twee keer: maar één e-mail', async () => {
    const { screen } = await untilTim();
    const session = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: screen.sessionId },
    });
    const deps = { prisma, encryptor, mail };
    const [a, b] = await Promise.all([
      deliver(deps, session, 'Sanne', tim),
      deliver(deps, session, 'Sanne', tim),
    ]);
    expect(a.deliveryId).toBe(b.deliveryId);
    expect(mail.sent).toHaveLength(1);
    expect(await prisma.delivery.count()).toBe(1);
  });

  it('kopie aan de beheerders die dat willen, met de ontvanger; nooit aan een andere organisatie', async () => {
    await seedAccount('wil@intento.local', 'pw', 'ADMIN', org);
    await seedAccount('wilniet@intento.local', 'pw', 'ADMIN', org);
    await seedAccount('onbevestigd@intento.local', 'pw', 'ADMIN', org, { emailVerified: false });
    await seedAccount('begeleider@intento.local', 'pw', 'CAREGIVER', org);
    await seedAccount('ander@intento.local', 'pw', 'ADMIN', await seedOrganization('Ander'));
    await prisma.account.updateMany({
      where: {
        email: {
          in: [
            'wil@intento.local',
            'onbevestigd@intento.local',
            'begeleider@intento.local',
            'ander@intento.local',
          ],
        },
      },
      data: { copySentMessages: true },
    });
    const { cookie, screen } = await untilTim();
    expect((await answer(cookie, screen, 'yes')).statusCode).toBe(200);

    expect(mail.sent.map((m) => m.to)).toEqual(['tim@example.org', 'wil@intento.local']);
    const copy = mail.sent[1];
    expect(copy?.subject).toBe('Kopie: bericht van Sanne aan Tim');
    expect(copy?.text).toContain('"Pijn"');
    expect(copy?.text).not.toContain('tim@example.org');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'message.send' } });
    expect(JSON.parse(audit.metadataJson ?? '{}')).toMatchObject({ copies: 1, copiesFailed: 0 });
  });

  it('geen kopie als niemand het aanzette, en niet bij een mislukte verzending', async () => {
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const { cookie, screen } = await untilTim();
    await answer(cookie, screen, 'yes');
    expect(mail.sent.map((m) => m.to)).toEqual(['tim@example.org']);

    await app.close();
    await prisma.account.updateMany({ data: { copySentMessages: true } });
    const failing = new MemoryMailTransport();
    let calls = 0;
    await setup({
      send: (message) => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('weg')) : failing.send(message);
      },
    });
    const second = await untilTim();
    await answer(second.cookie, second.screen, 'yes');
    expect(failing.sent).toHaveLength(0);
  });
});
