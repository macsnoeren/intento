import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type CommunicationTurn } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { MemoryMailTransport } from '../mail/transport.js';
import type { FakeAgentClient } from '../agents/client.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';

/** De Experience-samenvatting in de `TurnRequest` (N12.2, INTENTO-NEW-DESIGN §22, §29). */

const encryptor = createEncryptor(testEnv());

describe('Experience naar de agentdienst', () => {
  let app: FastifyInstance;
  let agents: FakeAgentClient;
  let org: string;
  let pain: string;
  let sanne: { id: string };
  let tim: string;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    agents = fakeAgents();
    app = await buildApp({ env: testEnv(), agents, mail: new MemoryMailTransport() });
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

  /** JA (pijn) → JA (Bedoel je) → JA (Wil je dit sturen?) → JA (naar Tim). */
  async function fullConversation(userId: string): Promise<void> {
    const started = await start(userId);
    let screen = started.screen;
    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/communication/sessions/${screen.sessionId}/answer`,
        headers: { cookie: started.cookie },
        payload: { turn: screen.turn, answer: 'yes' },
      });
      screen = communicationTurnSchema.parse(res.json());
    }
    expect(screen.presentation.kind).toBe('done');
  }

  function lastExperience() {
    return agents.requests.at(-1)?.experience;
  }

  it('aan: de tellingen gaan mee, alleen ids en aantallen', async () => {
    await start(sanne.id);
    expect(lastExperience()).toEqual({ symbols: [], contacts: [], modes: [] });

    // De nieuwe start sluit het eerste gesprek af: dat telt mee als getoond, niet gekozen.
    await fullConversation(sanne.id);
    await start(sanne.id);
    const experience = lastExperience();
    expect(experience).toEqual({
      symbols: [{ ref: pain, presented: 2, chosen: 1, chosen_at_first_position: 1 }],
      contacts: [{ ref: tim, presented: 1, chosen: 1, chosen_at_first_position: 1 }],
      modes: [{ ref: 'binary', presented: 2, chosen: 1, chosen_at_first_position: 0 }],
    });
    expect(JSON.stringify(experience)).not.toMatch(/Tim|tim@example/);
  });

  it('uit: geen samenvatting, ook niet als er al ervaring is', async () => {
    await fullConversation(sanne.id);
    await prisma.userCommunicationProfile.upsert({
      where: { userId: sanne.id },
      create: { userId: sanne.id, experienceEnabled: false },
      update: { experienceEnabled: false },
    });
    await start(sanne.id);
    const request = agents.requests.at(-1);
    expect(request?.experience).toBeNull();
    expect(request?.settings.experience_enabled).toBe(false);
  });

  it('alleen wat nu kan: geen symbool buiten de Vocabulary, geen contact dat niet meer kan', async () => {
    await fullConversation(sanne.id);
    await prisma.contact.update({ where: { id: tim }, data: { active: false } });
    await prisma.vocabularyItem.update({ where: { id: pain }, data: { status: 'retired' } });
    await createVocabularyItem(prisma, { label: 'eten', concept: 'eat' });
    await start(sanne.id);
    expect(lastExperience()).toMatchObject({ symbols: [], contacts: [] });
  });

  it('per gebruiker: de ervaring van een ander gaat nooit mee', async () => {
    const piet = await seedUser('Piet', org);
    await addContact(piet.id, 'Jan');
    await fullConversation(piet.id);
    await start(sanne.id);
    expect(lastExperience()).toEqual({ symbols: [], contacts: [], modes: [] });
  });
});
