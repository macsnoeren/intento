import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Presentation, SessionState } from '@intento/shared';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import { resetAuthData, seedOrganization, seedUser } from '../test/auth-helpers.js';
import { createSession, type TurnSnapshot } from './sessions.js';
import { confirmIntent, findIntent } from './intents.js';

/** De bevestigde boodschap (N4.10, INTENTO-NEW-DESIGN §31, §52 I2). */

const encryptor = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });

const proposal: Presentation = {
  kind: 'confirm_message',
  mode: 'binary',
  text: 'Bedoel je: Ik heb pijn?',
  message: 'Ik heb pijn',
  options: [
    {
      ref: 'v-1',
      kind: 'symbol',
      vocabulary_item_id: 'v-1',
      label: 'pijn',
      concept: 'pain',
      representation: 'exact',
      position: 0,
    },
  ],
};

function screen(sessionId: string, presentation: Presentation = proposal): TurnSnapshot {
  const state: SessionState = {
    session_id: sessionId,
    phase: 'confirm_message',
    turn: 3,
    interaction_mode: 'binary',
    mode_since_turn: 0,
    intent_hypotheses: [],
    questions_asked: [],
    answers: [{ turn: 2, answer: 'yes', concepts: ['pain'] }],
    rejected_concepts: [],
    uncertainties: [],
    assumptions: [],
    proposal: { message: 'Ik heb pijn', concepts: ['pain', 'body'], confidence: 0.8 },
    share: { contacts_asked: [], sent_to: [] },
    last_presentation: presentation,
  };
  return { turn: 3, previousTurn: 2, state, presentation };
}

describe('confirmIntent', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  async function session() {
    const org = await seedOrganization();
    const user = await seedUser('Sanne', org);
    return createSession(prisma, { userId: user.id, organizationId: org });
  }

  it('legt de boodschap vast met de concepten uit het voorstel en bevestigt het gesprek', async () => {
    const s = await session();
    const intent = await confirmIntent(prisma, encryptor, s, screen(s.id));
    expect(intent).toMatchObject({ turn: 3, message: 'Ik heb pijn', concepts: ['pain', 'body'] });
    expect(intent.confidence).toBe(0.8);
    expect(await findIntent(prisma, encryptor, s.id)).toMatchObject({ message: 'Ik heb pijn' });
    expect(
      (await prisma.communicationSession.findUniqueOrThrow({ where: { id: s.id } })).status,
    ).toBe('confirmed');
  });

  it('weigert een scherm dat niet precies om die boodschap vroeg', async () => {
    const s = await session();
    const other = { ...proposal, text: 'Bedoel je: Ik heb honger?' };
    await expect(confirmIntent(prisma, encryptor, s, screen(s.id, other))).rejects.toMatchObject({
      code: 'CANNOT_CONFIRM',
    });
    const question = { ...proposal, kind: 'question' as const };
    await expect(confirmIntent(prisma, encryptor, s, screen(s.id, question))).rejects.toMatchObject(
      { code: 'CANNOT_CONFIRM' },
    );
    expect(await prisma.communicationIntent.count()).toBe(0);
  });

  it('maakt bij twee gelijktijdige bevestigingen één boodschap', async () => {
    const s = await session();
    const results = await Promise.allSettled([
      confirmIntent(prisma, encryptor, s, screen(s.id)),
      confirmIntent(prisma, encryptor, s, screen(s.id)),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await prisma.communicationIntent.count({ where: { sessionId: s.id } })).toBe(1);
  });

  it('weigert een tweede, ander voorstel in hetzelfde gesprek', async () => {
    const s = await session();
    await confirmIntent(prisma, encryptor, s, screen(s.id));
    const later = { ...screen(s.id), turn: 7 };
    await expect(confirmIntent(prisma, encryptor, s, later)).rejects.toMatchObject({
      code: 'ALREADY_CONFIRMED',
    });
  });
});
