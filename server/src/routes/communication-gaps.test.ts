import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type TurnRequest, type TurnResponse } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { FakeAgentClient } from '../agents/client.js';
import {
  deviceCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { simpleResponder } from '../test/agent-helpers.js';
import { MemoryMailTransport } from '../mail/transport.js';

/**
 * Gaps uit een beurt komen per organisatie in `VocabularyGap` (N9.1, INTENTO-NEW-DESIGN §17): de
 * gebruiker ziet "duizelig" met het pictogram "ziek", en de beheerder krijgt een ontbrekend woord.
 */

/** Zoals `simpleResponder`, maar elke vraag toont "duizelig" met het eerste pictogram als stand-in. */
function dizzyResponder(request: TurnRequest): TurnResponse {
  const response = simpleResponder(request);
  const option = response.presentation.options[0];
  if (response.presentation.kind !== 'question' || !option?.vocabulary_item_id) return response;
  option.label = 'duizelig';
  option.concept = 'dizziness';
  option.representation = 'stand_in';
  return {
    ...response,
    gaps: [
      {
        type: 'vocabulary_gap',
        concept: 'dizziness',
        label: 'duizelig',
        context: 'health',
        best_available_item_id: option.vocabulary_item_id,
        confidence: 0.31,
      },
    ],
  };
}

describe('gaps uit een gesprek', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({ env: testEnv(), agents: new FakeAgentClient(dizzyResponder) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  it('voegt ze samen per concept per organisatie, zonder gebruiker of gesprek', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    const sick = await createVocabularyItem(prisma, { label: 'ziek', concept: 'sick' });
    const sanne = await seedUser('Sanne', orgA);
    const piet = await seedUser('Piet', orgA);
    const bram = await seedUser('Bram', orgB);

    const sessions: string[] = [];
    for (const user of [sanne, piet, bram]) {
      const cookie = await deviceCookie(app, user.id);
      const res = await app.inject({
        method: 'POST',
        url: '/communication/sessions',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(201);
      const turn = communicationTurnSchema.parse(res.json());
      expect(turn.presentation.options[0]?.label).toBe('duizelig');
      sessions.push(turn.sessionId);
    }

    const a = await prisma.vocabularyGap.findUniqueOrThrow({
      where: { organizationId_conceptKey: { organizationId: orgA, conceptKey: 'dizziness' } },
    });
    expect(a).toMatchObject({
      label: 'duizelig',
      context: 'health',
      bestAvailableItemId: sick,
      lastConfidence: 0.31,
      occurrences: 2,
      status: 'open',
    });
    const b = await prisma.vocabularyGap.findUniqueOrThrow({
      where: { organizationId_conceptKey: { organizationId: orgB, conceptKey: 'dizziness' } },
    });
    expect(b.occurrences).toBe(1);

    // Niets in de regel verwijst naar een gebruiker of gesprek.
    const stored = JSON.stringify(await prisma.vocabularyGap.findMany());
    for (const id of [sanne.id, piet.id, bram.id, ...sessions]) {
      expect(stored).not.toContain(id);
    }
  });
});

/** Eén e-mail per nieuw ontbrekend woord, alleen als de beheerder dat wil (N9.3, §17). */
describe('e-mail bij een nieuw ontbrekend woord', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    mail = new MemoryMailTransport();
    app = await buildApp({
      env: testEnv(),
      agents: new FakeAgentClient(dizzyResponder),
      mail,
    });
    await createVocabularyItem(prisma, { label: 'ziek', concept: 'sick' });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function talk(userId: string): Promise<void> {
    const cookie = await deviceCookie(app, userId);
    const res = await app.inject({
      method: 'POST',
      url: '/communication/sessions',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
  }

  async function notify(email: string, on: boolean): Promise<void> {
    await prisma.account.update({ where: { email }, data: { notifyGapsByEmail: on } });
  }

  it('stuurt één e-mail per nieuw woord, niet per keer, alleen aan wie het aanzette', async () => {
    const org = await seedOrganization('A');
    const other = await seedOrganization('B');
    await seedAccount('wil@intento.local', 'pw', 'ADMIN', org);
    await seedAccount('wilniet@intento.local', 'pw', 'ADMIN', org);
    await seedAccount('onbevestigd@intento.local', 'pw', 'ADMIN', org, { emailVerified: false });
    await seedAccount('begeleider@intento.local', 'pw', 'CAREGIVER', org);
    await seedAccount('ander@intento.local', 'pw', 'ADMIN', other);
    for (const email of [
      'wil@intento.local',
      'onbevestigd@intento.local',
      'begeleider@intento.local',
      'ander@intento.local',
    ]) {
      await notify(email, true);
    }
    const sanne = await seedUser('Sanne', org);

    await talk(sanne.id);
    await vi.waitFor(() => expect(mail.sent).toHaveLength(1));
    expect(mail.sent[0]?.to).toBe('wil@intento.local');
    expect(mail.sent[0]?.subject).toContain('"duizelig"');
    expect(mail.sent[0]?.text).not.toContain('Sanne');

    // Hetzelfde woord nog eens (ander gesprek, andere gebruiker): geen tweede e-mail.
    await talk((await seedUser('Piet', org)).id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mail.sent).toHaveLength(1);
    expect((await prisma.vocabularyGap.findFirstOrThrow()).occurrences).toBe(2);
  });

  it('instelling uit → geen e-mail', async () => {
    const org = await seedOrganization();
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    await talk((await seedUser('Sanne', org)).id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mail.sent).toHaveLength(0);
    expect(await prisma.vocabularyGap.count()).toBe(1);
  });

  it('een mislukte e-mail breekt het gesprek niet', async () => {
    await app.close();
    app = await buildApp({
      env: testEnv(),
      agents: new FakeAgentClient(dizzyResponder),
      mail: { send: () => Promise.reject(new Error('mailserver weg')) },
    });
    const org = await seedOrganization();
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    await notify('admin@intento.local', true);
    await talk((await seedUser('Sanne', org)).id);
    expect(await prisma.vocabularyGap.count()).toBe(1);
  });
});
