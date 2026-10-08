import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { resetAuthData, seedOrganization, seedUser, testEnv } from '../test/auth-helpers.js';
import { purgeExpired, scheduleRetention } from './purge.js';

/** De bewaartermijn uitvoeren (N14.2, INTENTO-NEW-DESIGN §53). */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-08T12:00:00Z');
const env = { RETENTION_DEFAULT_DAYS: 90 };
const encryptor = createEncryptor(testEnv());

/** Een afgerond gesprek met alles erop en eraan: beurt, provenance, boodschap en verzending. */
async function conversation(
  user: { id: string },
  organizationId: string,
  startedAt: Date,
): Promise<string> {
  const session = await prisma.communicationSession.create({
    data: {
      userId: user.id,
      organizationId,
      status: 'confirmed',
      startedAt,
      endedAt: new Date(startedAt.getTime() + 60_000),
    },
  });
  const sessionId = session.id;
  await prisma.sessionTurn.create({
    data: { sessionId, turn: 0, stateEncrypted: 'x', presentationEncrypted: 'x' },
  });
  await prisma.presentationEvent.create({
    data: {
      sessionId,
      turn: 0,
      kind: 'question',
      mode: 'binary',
      optionsJson: [],
      contentEncrypted: 'x',
    },
  });
  await prisma.observedEvent.create({ data: { sessionId, turn: 0, type: 'answer_yes' } });
  await prisma.inference.create({
    data: {
      sessionId,
      turn: 0,
      agent: 'intent-agent',
      kind: 'intent_hypotheses',
      payloadEncrypted: 'x',
    },
  });
  await prisma.agentDecision.create({
    data: { sessionId, turn: 0, agent: 'intent-agent', status: 'success', latencyMs: 1 },
  });
  const intent = await prisma.communicationIntent.create({
    data: {
      sessionId,
      userId: user.id,
      organizationId,
      turn: 1,
      messageEncrypted: encryptor.encrypt('Pijn'),
      concepts: ['pain'],
    },
  });
  const contact = await prisma.contact.create({
    data: {
      userId: user.id,
      organizationId,
      nameEncrypted: encryptor.encrypt('Tim'),
      emailEncrypted: encryptor.encrypt('tim@example.org'),
    },
  });
  await prisma.delivery.create({
    data: {
      sessionId,
      intentId: intent.id,
      contactId: contact.id,
      userId: user.id,
      organizationId,
      channel: 'email',
      status: 'sent',
    },
  });
  return sessionId;
}

async function rows(sessionId: string): Promise<number[]> {
  const where = { sessionId };
  return Promise.all([
    prisma.communicationSession.count({ where: { id: sessionId } }),
    prisma.sessionTurn.count({ where }),
    prisma.presentationEvent.count({ where }),
    prisma.observedEvent.count({ where }),
    prisma.inference.count({ where }),
    prisma.agentDecision.count({ where }),
    prisma.communicationIntent.count({ where }),
    prisma.delivery.count({ where }),
  ]);
}

const ALL = [1, 1, 1, 1, 1, 1, 1, 1];
const NONE = [0, 0, 0, 0, 0, 0, 0, 0];

describe('purgeExpired', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  it('net te oud → alles weg; net te jong → blijft (standaard 90 dagen)', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const old = await conversation(user, org, new Date(NOW.getTime() - 90 * DAY - 60_000));
    const young = await conversation(user, org, new Date(NOW.getTime() - 90 * DAY + 60_000));

    expect(await purgeExpired(prisma, env, NOW)).toEqual({ organizations: 1, sessions: 1 });
    expect(await rows(old)).toEqual(NONE);
    expect(await rows(young)).toEqual(ALL);
    // De contacten zelf blijven: alleen het gesprek en wat eraan hangt verdwijnt.
    expect(await prisma.contact.count()).toBe(2);
  });

  it('per organisatie de eigen termijn; een andere organisatie blijft ongemoeid', async () => {
    const short = await seedOrganization('Kort');
    await prisma.organization.update({ where: { id: short }, data: { retentionDays: 30 } });
    const standard = await seedOrganization('Standaard');
    const a = await seedUser('Anna', short);
    const b = await seedUser('Bram', standard);
    const sixtyDays = new Date(NOW.getTime() - 60 * DAY);
    const goneShort = await conversation(a, short, sixtyDays);
    const keptShort = await conversation(a, short, new Date(NOW.getTime() - 29 * DAY));
    const keptStandard = await conversation(b, standard, sixtyDays);

    expect(await purgeExpired(prisma, env, NOW)).toEqual({ organizations: 2, sessions: 1 });
    expect(await rows(goneShort)).toEqual(NONE);
    expect(await rows(keptShort)).toEqual(ALL);
    expect(await rows(keptStandard)).toEqual(ALL);
  });

  it('Experience, ontbrekende woorden en het audit-log blijven', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    await conversation(user, org, new Date(NOW.getTime() - 200 * DAY));
    await prisma.experienceStat.create({
      data: {
        userId: user.id,
        organizationId: org,
        subjectType: 'mode',
        subjectRef: 'binary',
        chosen: 3,
      },
    });
    await prisma.vocabularyGap.create({
      data: {
        organizationId: org,
        conceptKey: 'dizzy',
        lastConfidence: 0.3,
        label: 'duizelig',
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
    });
    await prisma.auditLog.create({
      data: { action: 'message.send', outcome: 'success', organizationId: org },
    });

    expect((await purgeExpired(prisma, env, NOW)).sessions).toBe(1);
    expect(await prisma.experienceStat.count()).toBe(1);
    expect(await prisma.vocabularyGap.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('draait bij het starten van de server (en daarna dagelijks)', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const old = await conversation(user, org, new Date(Date.now() - 365 * DAY));
    const app = await buildApp({ env: testEnv() });
    scheduleRetention(app, prisma, env);
    await app.ready();
    await vi.waitFor(async () => expect(await rows(old)).toEqual(NONE));
    await app.close();
  });
});
