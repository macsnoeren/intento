import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type CommunicationTurn } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { MemoryMailTransport } from '../mail/transport.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';
import { recordSessionExperience } from './stats.js';

/** Experience tellen na afloop van een gesprek (N12.1, INTENTO-NEW-DESIGN §21 laag 1, §22). */

const encryptor = createEncryptor(testEnv());

describe('Experience na afloop', () => {
  let app: FastifyInstance;
  let org: string;
  let pain: string;
  let sanne: { id: string };
  let tim: string;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({ env: testEnv(), agents: fakeAgents(), mail: new MemoryMailTransport() });
    org = await seedOrganization();
    pain = await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    sanne = await seedUser('Sanne', org);
    tim = await addContact(sanne.id, 'Tim');
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function addContact(userId: string, name: string): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        userId,
        organizationId: org,
        nameEncrypted: encryptor.encrypt(name),
        emailEncrypted: encryptor.encrypt(`${name.toLowerCase()}@example.org`),
        emailVerifiedAt: new Date(),
      },
    });
    return contact.id;
  }

  async function start(userId: string): Promise<{ cookie: string; screen: CommunicationTurn }> {
    const cookie = await deviceCookie(app, userId);
    const res = await app.inject({
      method: 'POST',
      url: '/communication/sessions',
      headers: { cookie },
    });
    return { cookie, screen: communicationTurnSchema.parse(res.json()) };
  }

  async function answer(cookie: string, screen: CommunicationTurn, value: 'yes' | 'no') {
    const res = await app.inject({
      method: 'POST',
      url: `/communication/sessions/${screen.sessionId}/answer`,
      headers: { cookie },
      payload: { turn: screen.turn, answer: value },
    });
    return communicationTurnSchema.parse(res.json());
  }

  /** JA (pijn) → JA (Bedoel je) → JA (Wil je dit sturen?) → JA (naar Tim): klaar en verstuurd. */
  async function fullConversation(userId: string): Promise<string> {
    const started = await start(userId);
    let screen = started.screen;
    for (let i = 0; i < 4; i += 1) screen = await answer(started.cookie, screen, 'yes');
    expect(screen.presentation.kind).toBe('done');
    return screen.sessionId;
  }

  function stats(userId: string) {
    return prisma.experienceStat.findMany({
      where: { userId },
      orderBy: [{ subjectType: 'asc' }, { subjectRef: 'asc' }],
    });
  }

  it('aan (standaard): telt symbool, contact en vorm, inclusief de eerste plek', async () => {
    const sessionId = await fullConversation(sanne.id);
    const rows = await stats(sanne.id);
    expect(
      rows.map((r) => [
        r.subjectType,
        r.subjectRef,
        r.presented,
        r.chosen,
        r.chosenAtFirstPosition,
      ]),
    ).toEqual([
      ['contact', tim, 1, 1, 1],
      ['mode', 'binary', 1, 1, 0],
      ['symbol', pain, 1, 1, 1],
    ]);
    expect(rows.every((r) => r.organizationId === org && r.lastUsedAt !== null)).toBe(true);
    const session = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.experienceCountedAt).not.toBeNull();
  });

  it('telt op over gesprekken; NEE is getoond maar niet gekozen', async () => {
    await fullConversation(sanne.id);
    const { cookie, screen } = await start(sanne.id);
    const after = await answer(cookie, screen, 'no');
    await app.inject({
      method: 'POST',
      url: `/communication/sessions/${after.sessionId}/stop`,
      headers: { cookie },
    });
    const symbol = (await stats(sanne.id)).find((r) => r.subjectType === 'symbol');
    expect(symbol).toMatchObject({ chosen: 1, chosenAtFirstPosition: 1 });
    expect(symbol?.presented).toBeGreaterThanOrEqual(2);
  });

  it('uit: niets opgebouwd, ook niet als Experience later weer aan gaat', async () => {
    await prisma.userCommunicationProfile.upsert({
      where: { userId: sanne.id },
      create: { userId: sanne.id, experienceEnabled: false },
      update: { experienceEnabled: false },
    });
    const sessionId = await fullConversation(sanne.id);
    expect(await prisma.experienceStat.count()).toBe(0);

    await prisma.userCommunicationProfile.update({
      where: { userId: sanne.id },
      data: { experienceEnabled: true },
    });
    expect(await recordSessionExperience(prisma, sessionId)).toBe(false);
    expect(await prisma.experienceStat.count()).toBe(0);
  });

  it('een gesprek telt maar één keer, en een lopend gesprek nog niet', async () => {
    const { cookie, screen } = await start(sanne.id);
    await answer(cookie, screen, 'yes');
    expect(await recordSessionExperience(prisma, screen.sessionId)).toBe(false);
    expect(await prisma.experienceStat.count()).toBe(0);

    const sessionId = await fullConversation(sanne.id);
    const before = await stats(sanne.id);
    const again = await Promise.all([
      recordSessionExperience(prisma, sessionId),
      recordSessionExperience(prisma, sessionId),
    ]);
    expect(again).toEqual([false, false]);
    expect(await stats(sanne.id)).toEqual(before);
  });

  it('een nieuwe start sluit het oude gesprek af en telt het mee', async () => {
    const first = await start(sanne.id);
    await answer(first.cookie, first.screen, 'yes');
    await start(sanne.id);
    const symbol = (await stats(sanne.id)).find((r) => r.subjectType === 'symbol');
    expect(symbol).toMatchObject({ presented: 1, chosen: 1 });
  });

  it('per gebruiker: het gesprek van de een raakt de ervaring van de ander niet', async () => {
    const piet = await seedUser('Piet', org);
    await addContact(piet.id, 'Jan');
    await fullConversation(piet.id);
    expect(await stats(sanne.id)).toEqual([]);
    expect((await stats(piet.id)).length).toBeGreaterThan(0);
  });
});
