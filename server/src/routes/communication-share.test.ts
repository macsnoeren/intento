import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import type { FakeAgentClient } from '../agents/client.js';
import { createEncryptor } from '../crypto/encryption.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';

/** "Wil je dit sturen?" (N11.1, INTENTO-NEW-DESIGN §4.1, §28, §31). */

const encryptor = createEncryptor(testEnv());

describe('delen na een bevestigde boodschap', () => {
  let app: FastifyInstance;
  let agents: FakeAgentClient;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    agents = fakeAgents();
    app = await buildApp({ env: testEnv(), agents });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function addContact(
    userId: string,
    organizationId: string,
    name: string,
    options: { verified?: boolean; active?: boolean; sortOrder?: number; symbol?: string } = {},
  ): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        userId,
        organizationId,
        nameEncrypted: encryptor.encrypt(name),
        emailEncrypted: encryptor.encrypt(`${name.toLowerCase()}@example.org`),
        emailVerifiedAt: options.verified === false ? null : new Date(),
        active: options.active ?? true,
        sortOrder: options.sortOrder ?? 0,
        vocabularyItemId: options.symbol ?? null,
      },
    });
    return contact.id;
  }

  async function post(cookie: string, url: string, payload: Record<string, unknown> = {}) {
    const res = await app.inject({ method: 'POST', url, headers: { cookie }, payload });
    expect(res.statusCode).toBeLessThan(300);
    return communicationTurnSchema.parse(res.json());
  }

  it('stuurt alleen bevestigde, actieve contacten mee, zonder e-mailadres', async () => {
    const org = await seedOrganization();
    const mother = await createVocabularyItem(prisma, { label: 'moeder', concept: 'mother' });
    const retired = await createVocabularyItem(prisma, {
      label: 'oud',
      concept: 'old',
      status: 'retired',
    });
    const sanne = await seedUser('Sanne', org);
    const piet = await seedUser('Piet', org);
    const mama = await addContact(sanne.id, org, 'Mama', { sortOrder: 1, symbol: mother });
    const tim = await addContact(sanne.id, org, 'Tim', { sortOrder: 0, symbol: retired });
    await addContact(sanne.id, org, 'Nog niet', { verified: false });
    await addContact(sanne.id, org, 'Uitgezet', { active: false });
    await addContact(piet.id, org, 'Opa');

    await post(await deviceCookie(app, sanne.id), '/communication/sessions');
    const sent = agents.requests[0]?.contacts;
    expect(sent).toEqual([
      // Een ingetrokken pictogram gaat niet mee.
      { id: tim, name: 'Tim', vocabulary_item_id: null, sort_order: 0 },
      { id: mama, name: 'Mama', vocabulary_item_id: mother, sort_order: 1 },
    ]);
    expect(JSON.stringify(agents.requests)).not.toContain('@example.org');
  });

  it('JA → "Wil je dit sturen?", Terug maakt de bevestiging ongedaan, NEE → klaar', async () => {
    const org = await seedOrganization();
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const sanne = await seedUser('Sanne', org);
    await addContact(sanne.id, org, 'Mama');
    const cookie = await deviceCookie(app, sanne.id);

    const first = await post(cookie, '/communication/sessions');
    const base = `/communication/sessions/${first.sessionId}`;
    const proposal = await post(cookie, `${base}/answer`, { turn: first.turn, answer: 'yes' });
    expect(proposal.presentation.text).toBe('Bedoel je: Pijn?');

    const ask = await post(cookie, `${base}/answer`, { turn: proposal.turn, answer: 'yes' });
    expect(ask.presentation).toMatchObject({ kind: 'share_ask', text: 'Wil je dit sturen?' });
    expect(ask.canGoBack).toBe(true);
    const session = () =>
      prisma.communicationSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(await session()).toMatchObject({ status: 'confirmed', endedAt: null });
    expect(
      await prisma.communicationIntent.findUnique({ where: { sessionId: first.sessionId } }),
    ).toMatchObject({ turn: proposal.turn });

    // ↩ Terug: de JA op "Bedoel je" is ongedaan; de boodschap is niet meer bevestigd.
    const again = await post(cookie, `${base}/back`, { turn: ask.turn });
    expect(again.presentation.text).toBe('Bedoel je: Pijn?');
    expect(await prisma.communicationIntent.count()).toBe(0);
    expect(await session()).toMatchObject({ status: 'active', endedAt: null });
    const observed = await prisma.observedEvent.findMany({
      where: { sessionId: first.sessionId },
      orderBy: { createdAt: 'asc' },
    });
    expect(observed.map((e) => e.type)).toEqual(['start', 'answer_yes', 'answer_yes', 'back']);

    // Opnieuw JA: opnieuw bevestigd, nu op het nieuwe scherm.
    const ask2 = await post(cookie, `${base}/answer`, { turn: again.turn, answer: 'yes' });
    expect(ask2.presentation.kind).toBe('share_ask');
    expect(
      await prisma.communicationIntent.findUnique({ where: { sessionId: first.sessionId } }),
    ).toMatchObject({ turn: again.turn });

    // NEE op "Wil je dit sturen?": klaar, bevestigd, niets verstuurd.
    const done = await post(cookie, `${base}/answer`, { turn: ask2.turn, answer: 'no' });
    expect(done.presentation).toMatchObject({ kind: 'done', message: 'Pijn' });
    const ended = await session();
    expect(ended.status).toBe('confirmed');
    expect(ended.endedAt).not.toBeNull();
  });

  it('zonder bevestigd contact meteen klaar', async () => {
    const org = await seedOrganization();
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const sanne = await seedUser('Sanne', org);
    await addContact(sanne.id, org, 'Mama', { verified: false });
    const cookie = await deviceCookie(app, sanne.id);
    const first = await post(cookie, '/communication/sessions');
    const base = `/communication/sessions/${first.sessionId}`;
    const proposal = await post(cookie, `${base}/answer`, { turn: first.turn, answer: 'yes' });
    const done = await post(cookie, `${base}/answer`, { turn: proposal.turn, answer: 'yes' });
    expect(done.presentation.kind).toBe('done');
  });
});
