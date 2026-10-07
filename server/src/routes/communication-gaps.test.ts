import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { communicationTurnSchema, type TurnRequest, type TurnResponse } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { FakeAgentClient } from '../agents/client.js';
import {
  deviceCookie,
  resetAuthData,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { simpleResponder } from '../test/agent-helpers.js';

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
