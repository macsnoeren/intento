import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDecision, Inference, Presentation } from '@intento/shared';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { resetAuthData, seedOrganization, seedUser } from '../test/auth-helpers.js';
import { createSession } from './sessions.js';
import {
  readProvenance,
  recordDecisions,
  recordInferences,
  recordObserved,
  recordPresentation,
} from './provenance.js';

/** Provenance-tabellen (N4.2, INTENTO-NEW-DESIGN §26, §27, §39, §41). */

const encryptor = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });

const presentation: Presentation = {
  kind: 'question',
  mode: 'multi',
  text: 'Wat bedoel je?',
  options: [
    {
      ref: 'v-1',
      kind: 'symbol',
      vocabulary_item_id: 'v-1',
      label: 'hoofdpijn',
      concept: 'headache',
      representation: 'exact',
      position: 0,
    },
    {
      ref: 'v-2',
      kind: 'symbol',
      vocabulary_item_id: 'v-2',
      label: 'buikpijn',
      concept: 'stomach_ache',
      representation: 'stand_in',
      position: 1,
    },
  ],
};

const inference: Inference = {
  agent: 'intent',
  kind: 'hypotheses',
  payload: { hypotheses: [{ concept: 'headache', label: 'hoofdpijn' }] },
  confidence: 0.6,
};

const decision: AgentDecision = {
  agent: 'intent',
  status: 'success',
  model: 'qwen',
  prompt_version: 'intent-v1',
  latency_ms: 120,
  validation: 'valid',
};

async function seedSession(orgName = 'A'): Promise<{ sessionId: string; org: string }> {
  const org = await seedOrganization(orgName);
  const user = await seedUser(`Sanne ${orgName}`, org);
  const session = await createSession(prisma, { userId: user.id, organizationId: org });
  return { sessionId: session.id, org };
}

describe('provenance', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  it('bewaart Presented, Observed en Inferred gescheiden en leest ze terug', async () => {
    const { sessionId, org } = await seedSession();
    await recordPresentation(prisma, encryptor, sessionId, 0, presentation);
    await recordObserved(prisma, sessionId, 0, {
      type: 'select_option',
      optionRef: 'v-2',
      position: 1,
      responseTimeMs: 2300,
    });
    await recordInferences(prisma, encryptor, sessionId, 1, [inference]);
    await recordDecisions(prisma, sessionId, 1, [decision]);

    expect(await prisma.presentationEvent.count({ where: { sessionId } })).toBe(1);
    expect(await prisma.observedEvent.count({ where: { sessionId } })).toBe(1);
    expect(await prisma.inference.count({ where: { sessionId } })).toBe(1);
    expect(await prisma.agentDecision.count({ where: { sessionId } })).toBe(1);

    const record = await readProvenance(prisma, encryptor, { sessionId, organizationId: org });
    expect(record?.presented).toEqual([
      {
        turn: 0,
        kind: 'question',
        mode: 'multi',
        text: 'Wat bedoel je?',
        message: null,
        options: [
          {
            ref: 'v-1',
            kind: 'symbol',
            vocabularyItemId: 'v-1',
            contactId: null,
            concept: 'headache',
            representation: 'exact',
            position: 0,
            label: 'hoofdpijn',
          },
          {
            ref: 'v-2',
            kind: 'symbol',
            vocabularyItemId: 'v-2',
            contactId: null,
            concept: 'stomach_ache',
            representation: 'stand_in',
            position: 1,
            label: 'buikpijn',
          },
        ],
      },
    ]);
    expect(record?.observed).toEqual([
      { turn: 0, type: 'select_option', optionRef: 'v-2', position: 1, responseTimeMs: 2300 },
    ]);
    expect(record?.inferred).toEqual([
      {
        turn: 1,
        agent: 'intent',
        kind: 'hypotheses',
        payload: inference.payload,
        confidence: 0.6,
      },
    ]);
    expect(record?.decisions).toEqual([
      {
        turn: 1,
        agent: 'intent',
        status: 'success',
        model: 'qwen',
        promptVersion: 'intent-v1',
        latencyMs: 120,
        validation: 'valid',
        reason: null,
      },
    ]);
  });

  it('versleutelt schermtekst, labels en inference-payload', async () => {
    const { sessionId } = await seedSession();
    await recordPresentation(prisma, encryptor, sessionId, 0, {
      ...presentation,
      kind: 'confirm_message',
      mode: 'binary',
      message: 'Ik heb hoofdpijn',
    });
    await recordInferences(prisma, encryptor, sessionId, 0, [inference]);

    const presented = await prisma.presentationEvent.findFirstOrThrow({ where: { sessionId } });
    expect(presented.contentEncrypted.startsWith('v1:')).toBe(true);
    expect(presented.contentEncrypted).not.toContain('hoofdpijn');
    expect(JSON.stringify(presented.optionsJson)).not.toContain('hoofdpijn');
    expect(JSON.stringify(presented.optionsJson)).not.toContain('buikpijn');
    const inferred = await prisma.inference.findFirstOrThrow({ where: { sessionId } });
    expect(inferred.payloadEncrypted.startsWith('v1:')).toBe(true);
    expect(inferred.payloadEncrypted).not.toContain('headache');
  });

  it('markeert beslissingen als ongeldig als de backend het antwoord verwierp', async () => {
    const { sessionId, org } = await seedSession();
    await recordDecisions(prisma, sessionId, 2, [decision], {
      status: 'invalid',
      reason: 'symbool buiten de Vocabulary',
    });
    const record = await readProvenance(prisma, encryptor, { sessionId, organizationId: org });
    expect(record?.decisions[0]).toMatchObject({
      status: 'invalid',
      validation: 'invalid',
      reason: 'symbool buiten de Vocabulary',
    });
  });

  it('isoleert provenance per organisatie en gebruiker', async () => {
    const a = await seedSession('A');
    const b = await seedSession('B');
    await recordObserved(prisma, a.sessionId, 0, { type: 'start' });
    await recordObserved(prisma, b.sessionId, 0, { type: 'stop' });

    expect(
      await readProvenance(prisma, encryptor, { sessionId: a.sessionId, organizationId: b.org }),
    ).toBeNull();
    const own = await readProvenance(prisma, encryptor, {
      sessionId: a.sessionId,
      organizationId: a.org,
    });
    expect(own?.observed.map((event) => event.type)).toEqual(['start']);

    const otherUser = await seedUser('Tom', a.org);
    expect(
      await readProvenance(prisma, encryptor, {
        sessionId: a.sessionId,
        organizationId: a.org,
        userId: otherUser.id,
      }),
    ).toBeNull();
  });

  it('verwijdert provenance samen met het gesprek', async () => {
    const { sessionId } = await seedSession();
    await recordPresentation(prisma, encryptor, sessionId, 0, presentation);
    await recordObserved(prisma, sessionId, 0, { type: 'start' });
    await recordInferences(prisma, encryptor, sessionId, 0, [inference]);
    await recordDecisions(prisma, sessionId, 0, [decision]);
    await prisma.communicationSession.delete({ where: { id: sessionId } });
    expect(await prisma.presentationEvent.count()).toBe(0);
    expect(await prisma.observedEvent.count()).toBe(0);
    expect(await prisma.inference.count()).toBe(0);
    expect(await prisma.agentDecision.count()).toBe(0);
  });
});
