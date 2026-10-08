import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type CommunicationTurn } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { MemoryMailTransport } from '../mail/transport.js';
import { AgentUnavailableError, type FakeAgentClient } from '../agents/client.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';
import {
  EXPERIENCE_NOTE_KIND,
  acceptableNotes,
  experienceNotePayloadSchema,
  observeSession,
} from './observations.js';

/** Observaties na afloop (N12.4, INTENTO-NEW-DESIGN §21 laag 2). */

const encryptor = createEncryptor(testEnv());

describe('Experience Agent na afloop', () => {
  let app: FastifyInstance;
  let agents: FakeAgentClient;
  let org: string;
  let sanne: { id: string };

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    agents = fakeAgents();
    app = await buildApp({ env: testEnv(), agents, mail: new MemoryMailTransport() });
    org = await seedOrganization();
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    sanne = await seedUser('Sanne', org);
    await prisma.contact.create({
      data: {
        userId: sanne.id,
        organizationId: org,
        nameEncrypted: encryptor.encrypt('Tim'),
        emailEncrypted: encryptor.encrypt('tim@example.org'),
        emailVerifiedAt: new Date(),
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  /** JA (pijn) → JA (Bedoel je) → JA (Wil je dit sturen?) → JA (naar Tim): klaar en verstuurd. */
  async function fullConversation(): Promise<CommunicationTurn> {
    const cookie = await deviceCookie(app, sanne.id);
    const res = await app.inject({
      method: 'POST',
      url: '/communication/sessions',
      headers: { cookie },
    });
    let screen = communicationTurnSchema.parse(res.json());
    for (let i = 0; i < 4; i += 1) {
      const next = await app.inject({
        method: 'POST',
        url: `/communication/sessions/${screen.sessionId}/answer`,
        headers: { cookie },
        payload: { turn: screen.turn, answer: 'yes' },
      });
      expect(next.statusCode).toBe(200);
      screen = communicationTurnSchema.parse(next.json());
    }
    expect(screen.presentation.kind).toBe('done');
    return screen;
  }

  function notes(sessionId: string) {
    return prisma.inference.findMany({
      where: { sessionId, agent: 'experience-agent', kind: EXPERIENCE_NOTE_KIND },
    });
  }

  it('kijkt terug zonder contacten in het verzoek, en bewaart de observatie versleuteld', async () => {
    const done = await fullConversation();
    await vi.waitFor(async () => expect(await notes(done.sessionId)).toHaveLength(1));

    const [request] = agents.experienceRequests;
    expect(request).toMatchObject({ session_id: done.sessionId, outcome: 'confirmed', sent: true });
    expect(request?.screens.map((s) => [s.kind, s.answer])).toEqual([
      ['question', 'yes'],
      ['confirm_message', 'yes'],
      ['share_ask', 'yes'],
    ]);
    // V6: de contactvraag ("Wil je dit naar Tim sturen?") en het adres gaan nooit mee.
    expect(JSON.stringify(request)).not.toMatch(/Tim|tim@example/);

    const [row] = await notes(done.sessionId);
    expect(row?.payloadEncrypted).not.toContain('nep-agentdienst');
    const payload = experienceNotePayloadSchema.parse(
      JSON.parse(encryptor.decrypt(row?.payloadEncrypted ?? '')),
    );
    expect(payload.notes.map((n) => n.text)).toEqual(['Een observatie van de nep-agentdienst.']);
    const decision = await prisma.agentDecision.findFirstOrThrow({
      where: { sessionId: done.sessionId, agent: 'experience-agent' },
    });
    expect(decision.status).toBe('success');
  });

  it('Experience uit: niet terugkijken', async () => {
    await prisma.userCommunicationProfile.upsert({
      where: { userId: sanne.id },
      create: { userId: sanne.id, experienceEnabled: false },
      update: { experienceEnabled: false },
    });
    const done = await fullConversation();
    expect(await observeSession({ prisma, encryptor, agents }, done.sessionId)).toBe('skipped');
    expect(agents.experienceRequests).toEqual([]);
    expect(await notes(done.sessionId)).toEqual([]);
  });

  it('een falende aanroep raakt het gesprek niet; de mislukking staat in de provenance', async () => {
    agents.observe = () => Promise.reject(new AgentUnavailableError('timeout', 'te traag'));
    const done = await fullConversation();
    expect(done.delivery).toEqual({ contactName: 'Tim', status: 'sent' });
    const session = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: done.sessionId },
    });
    expect(session).toMatchObject({ status: 'confirmed' });
    expect(session.endedAt).not.toBeNull();
    await vi.waitFor(async () => {
      const decision = await prisma.agentDecision.findFirst({
        where: { sessionId: done.sessionId, agent: 'experience-agent' },
      });
      expect(decision).toMatchObject({ status: 'failed', reason: 'timeout' });
    });
    expect(await notes(done.sessionId)).toEqual([]);
    // Experience-tellingen zijn er gewoon.
    expect(await prisma.experienceStat.count({ where: { userId: sanne.id } })).toBeGreaterThan(0);
  });

  it('de tablet wacht nooit: ook een aanroep die blijft hangen houdt de beurt niet op', async () => {
    agents.observe = () => new Promise(() => undefined);
    const done = await fullConversation();
    expect(done.presentation.kind).toBe('done');
    // De aanroep begint pas na de beurt, en hij komt nooit terug; de beurt was al klaar.
    await vi.waitFor(() => expect(agents.experienceRequests).toHaveLength(1));
    expect(await notes(done.sessionId)).toEqual([]);
  });

  it('een gesprek wordt maar één keer bekeken', async () => {
    const done = await fullConversation();
    await vi.waitFor(async () => expect(await notes(done.sessionId)).toHaveLength(1));
    expect(await observeSession({ prisma, encryptor, agents }, done.sessionId)).toBe('skipped');
    expect(agents.experienceRequests).toHaveLength(1);
  });

  it('gooit observaties met een contactnaam of een URL weg', async () => {
    agents.observe = (request) => ({
      contract_version: 1,
      session_id: request.session_id,
      notes: [
        { about: 'flow', text: 'Het bericht ging snel naar tim.', confidence: 0.5 },
        { about: 'flow', text: 'Zie www.voorbeeld.nl voor uitleg.', confidence: 0.5 },
        { about: 'question', text: 'De eerste vraag werd snel beantwoord.', confidence: 0.4 },
      ],
      decision: {
        agent: 'experience-agent',
        status: 'success',
        model: 'nep',
        prompt_version: 'experience-v1',
        latency_ms: 5,
        validation: 'valid',
        reason: null,
      },
    });
    const done = await fullConversation();
    await vi.waitFor(async () => expect(await notes(done.sessionId)).toHaveLength(1));
    const [row] = await notes(done.sessionId);
    const payload = experienceNotePayloadSchema.parse(
      JSON.parse(encryptor.decrypt(row?.payloadEncrypted ?? '')),
    );
    expect(payload.notes.map((n) => n.text)).toEqual(['De eerste vraag werd snel beantwoord.']);
  });
});

describe('acceptableNotes', () => {
  it('laat alleen observaties zonder contactnaam en zonder URL door', () => {
    const note = (text: string) => ({ about: 'flow' as const, text, confidence: 0.5 });
    expect(
      acceptableNotes(
        [note('Mama werd gekozen.'), note('Kijk op https://x.nl.'), note('Rustig verloop.')],
        ['Mama', '  '],
      ).map((n) => n.text),
    ).toEqual(['Rustig verloop.']);
  });
});
