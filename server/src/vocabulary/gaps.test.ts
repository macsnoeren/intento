import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VocabularyGap } from '@intento/shared';
import { prisma } from '../db/prisma.js';
import { resetAuthData, seedOrganization } from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { recordGaps } from './gaps.js';

/** Ontbrekende woorden samenvoegen per concept per organisatie (N9.1, INTENTO-NEW-DESIGN §17, §39). */

function gap(overrides: Partial<VocabularyGap> = {}): VocabularyGap {
  return {
    type: 'vocabulary_gap',
    concept: 'dizziness',
    label: 'duizelig',
    context: 'health',
    best_available_item_id: null,
    confidence: 0.31,
    ...overrides,
  };
}

const T1 = new Date('2026-10-07T08:00:00Z');
const T2 = new Date('2026-10-07T09:30:00Z');

describe('recordGaps', () => {
  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  it('zelfde concept twee keer → één regel met occurrences 2 en de laatste gegevens', async () => {
    const org = await seedOrganization();
    const sick = await createVocabularyItem(prisma, { label: 'ziek', concept: 'sick' });

    expect(await recordGaps(prisma, org, [gap()], T1)).toEqual(['dizziness']);
    expect(
      await recordGaps(
        prisma,
        org,
        [gap({ label: 'draaierig', best_available_item_id: sick, confidence: 0.4 })],
        T2,
      ),
    ).toEqual([]);

    const rows = await prisma.vocabularyGap.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conceptKey: 'dizziness',
      label: 'draaierig',
      context: 'health',
      bestAvailableItemId: sick,
      lastConfidence: 0.4,
      occurrences: 2,
      firstSeenAt: T1,
      lastSeenAt: T2,
      status: 'open',
    });
  });

  it('telt hetzelfde concept in één beurt één keer', async () => {
    const org = await seedOrganization();
    await recordGaps(prisma, org, [gap(), gap({ label: 'draaierig' })], T1);
    const row = await prisma.vocabularyGap.findFirstOrThrow({ where: { organizationId: org } });
    expect(row).toMatchObject({ occurrences: 1, label: 'draaierig' });
  });

  it('bewaart geen gebruiker of gesprek', () => {
    const fields = Object.keys(prisma.vocabularyGap.fields);
    expect(fields).not.toContain('userId');
    expect(fields).not.toContain('sessionId');
    expect(fields).toContain('organizationId');
  });

  it('isoleert per organisatie', async () => {
    const a = await seedOrganization('A');
    const b = await seedOrganization('B');
    await recordGaps(prisma, a, [gap()], T1);
    await recordGaps(prisma, b, [gap()], T2);
    await recordGaps(prisma, a, [gap()], T2);
    const rows = await prisma.vocabularyGap.findMany({ orderBy: { occurrences: 'asc' } });
    expect(rows.map((row) => [row.organizationId, row.occurrences])).toEqual([
      [b, 1],
      [a, 2],
    ]);
  });

  it('een opgelost woord dat weer voorkomt gaat terug naar open; genegeerd blijft genegeerd', async () => {
    const org = await seedOrganization();
    await recordGaps(prisma, org, [gap(), gap({ concept: 'freckles', label: 'sproeten' })], T1);
    await prisma.vocabularyGap.updateMany({
      where: { organizationId: org, conceptKey: 'dizziness' },
      data: { status: 'resolved' },
    });
    await prisma.vocabularyGap.updateMany({
      where: { organizationId: org, conceptKey: 'freckles' },
      data: { status: 'dismissed' },
    });
    await recordGaps(prisma, org, [gap(), gap({ concept: 'freckles', label: 'sproeten' })], T2);
    const rows = await prisma.vocabularyGap.findMany({
      where: { organizationId: org },
      orderBy: { conceptKey: 'asc' },
    });
    expect(rows.map((row) => [row.conceptKey, row.status, row.occurrences])).toEqual([
      ['dizziness', 'open', 2],
      ['freckles', 'dismissed', 2],
    ]);
  });

  it('een ingetrokken of ontbrekend pictogram laat de gap staan', async () => {
    const org = await seedOrganization();
    const sick = await createVocabularyItem(prisma, { label: 'ziek', concept: 'sick' });
    await recordGaps(prisma, org, [gap({ best_available_item_id: sick })], T1);
    await prisma.vocabularyItem.delete({ where: { id: sick } });
    const row = await prisma.vocabularyGap.findFirstOrThrow({ where: { organizationId: org } });
    expect(row.bestAvailableItemId).toBeNull();
  });
});
