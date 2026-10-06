import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Presentation, SessionState } from '@intento/shared';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { resetAuthData, seedOrganization, seedUser } from '../test/auth-helpers.js';
import {
  createSession,
  endSession,
  findActiveSession,
  findSessionForUser,
  lastTurnNumber,
  loadTurn,
  saveTurn,
} from './sessions.js';

/** Sessietabellen met versleutelde momentopnamen (N4.1, INTENTO-NEW-DESIGN §5, §39, §53). */

const encryptor = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });

const presentation: Presentation = {
  kind: 'question',
  mode: 'binary',
  text: 'Heb je hoofdpijn?',
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
  ],
};

function state(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    phase: 'clarify',
    turn: 0,
    interaction_mode: 'binary',
    mode_since_turn: 0,
    current_intent: { concept: 'headache', label: 'hoofdpijn', confidence: 0.4 },
    intent_hypotheses: [],
    questions_asked: [{ turn: 0, concept: 'headache', text: 'Heb je hoofdpijn?' }],
    answers: [],
    rejected_concepts: [],
    uncertainties: [],
    assumptions: [],
    share: { contacts_asked: [], sent_to: [] },
    last_presentation: presentation,
  };
}

describe('gesprekken en momentopnamen', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  it('slaat een beurt versleuteld op en leest hem correct terug', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const session = await createSession(prisma, { userId: user.id, organizationId: org });

    await saveTurn(prisma, encryptor, session.id, {
      turn: 0,
      previousTurn: null,
      state: state(session.id),
      presentation,
    });

    const loaded = await loadTurn(prisma, encryptor, session.id, 0);
    expect(loaded).toEqual({ turn: 0, previousTurn: null, state: state(session.id), presentation });
    expect(
      (await prisma.communicationSession.findUniqueOrThrow({ where: { id: session.id } }))
        .currentTurn,
    ).toBe(0);
    expect(await lastTurnNumber(prisma, session.id)).toBe(0);
    expect(await loadTurn(prisma, encryptor, session.id, 5)).toBeNull();
  });

  it('bewaart geen leesbare state of schermtekst in de database', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const session = await createSession(prisma, { userId: user.id, organizationId: org });
    await saveTurn(prisma, encryptor, session.id, {
      turn: 0,
      previousTurn: null,
      state: state(session.id),
      presentation,
    });

    const raw = await prisma.sessionTurn.findFirstOrThrow({ where: { sessionId: session.id } });
    for (const column of [raw.stateEncrypted, raw.presentationEncrypted]) {
      expect(column.startsWith('v1:')).toBe(true);
      expect(column).not.toContain('hoofdpijn');
      expect(column).not.toContain('headache');
    }
  });

  it('weigert een ongeldige momentopname bij het lezen', async () => {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    const session = await createSession(prisma, { userId: user.id, organizationId: org });
    await prisma.sessionTurn.create({
      data: {
        sessionId: session.id,
        turn: 0,
        stateEncrypted: encryptor.encrypt(JSON.stringify({ phase: 'onbekend' })),
        presentationEncrypted: encryptor.encrypt(JSON.stringify(presentation)),
      },
    });
    await expect(loadTurn(prisma, encryptor, session.id, 0)).rejects.toThrow();
  });

  it('isoleert gesprekken per gebruiker', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    const a = await seedUser('Sanne', orgA);
    const b = await seedUser('Tom', orgB);
    const session = await createSession(prisma, { userId: a.id, organizationId: orgA });

    expect(await findSessionForUser(prisma, session.id, a.id)).not.toBeNull();
    expect(await findSessionForUser(prisma, session.id, b.id)).toBeNull();
    expect((await findActiveSession(prisma, a.id))?.id).toBe(session.id);
    expect(await findActiveSession(prisma, b.id)).toBeNull();

    await endSession(prisma, session.id, 'stopped');
    expect(await findActiveSession(prisma, a.id)).toBeNull();
    const ended = await prisma.communicationSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(ended.status).toBe('stopped');
    expect(ended.endedAt).not.toBeNull();
  });
});
