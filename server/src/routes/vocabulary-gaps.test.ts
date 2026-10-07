import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vocabularyGapListResponseSchema, vocabularyGapPublicSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { recordGaps } from '../vocabulary/gaps.js';

/** "Ontbrekende woorden" voor de beheerder (N9.2, INTENTO-NEW-DESIGN §17, §49). */

const PASSWORD = 'correct horse battery staple';

function gap(concept: string, label: string, bestAvailable: string | null = null) {
  return {
    type: 'vocabulary_gap' as const,
    concept,
    label,
    context: 'health',
    best_available_item_id: bestAvailable,
    confidence: 0.3,
  };
}

describe('/vocabulary/gaps', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function admin(email: string, organizationId: string) {
    await seedAccount(email, PASSWORD, 'ADMIN', organizationId);
    return loginCookie(app, email, PASSWORD);
  }

  async function list(cookie: string, status?: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/vocabulary/gaps${status ? `?status=${status}` : ''}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return vocabularyGapListResponseSchema.parse(res.json());
  }

  function act(cookie: string, id: string, action: string) {
    return app.inject({
      method: 'POST',
      url: `/vocabulary/gaps/${id}/${action}`,
      headers: { cookie },
    });
  }

  it('toont de open woorden, vaakst eerst, met het pictogram dat de gebruiker zag', async () => {
    const org = await seedOrganization();
    const sick = await createVocabularyItem(prisma, {
      label: 'ziek',
      concept: 'sick',
      assetPath: 'seed/x/1.png',
    });
    const t = new Date('2026-10-07T08:00:00Z');
    await recordGaps(prisma, org, [gap('dizziness', 'duizelig', sick)], t);
    await recordGaps(prisma, org, [gap('dizziness', 'duizelig', sick)], t);
    await recordGaps(prisma, org, [gap('freckles', 'sproeten')], t);
    const cookie = await admin('a@intento.local', org);

    const body = await list(cookie);
    expect(body.open).toBe(2);
    expect(body.items.map((i) => [i.label, i.occurrences])).toEqual([
      ['duizelig', 2],
      ['sproeten', 1],
    ]);
    expect(body.items[0]?.bestAvailable).toMatchObject({ id: sick, label: 'ziek' });
    expect(body.items[0]?.bestAvailable?.imageUrl).toMatch(/^\/assets\/.+\?exp=\d+&sig=/);
    expect(body.items[1]?.bestAvailable).toBeNull();
  });

  it('negeren, oplossen en weer openzetten; met audit', async () => {
    const org = await seedOrganization();
    await recordGaps(
      prisma,
      org,
      [gap('dizziness', 'duizelig'), gap('freckles', 'sproeten')],
      new Date(),
    );
    const cookie = await admin('a@intento.local', org);
    const [dizzy, freckles] = (await list(cookie)).items;

    const dismissed = await act(cookie, freckles?.id ?? '', 'dismiss');
    expect(dismissed.statusCode).toBe(200);
    expect(vocabularyGapPublicSchema.parse(dismissed.json()).status).toBe('dismissed');
    expect((await act(cookie, dizzy?.id ?? '', 'resolve')).statusCode).toBe(200);

    expect(await list(cookie)).toMatchObject({ items: [], open: 0 });
    expect((await list(cookie, 'dismissed')).items.map((i) => i.label)).toEqual(['sproeten']);
    expect((await list(cookie, 'resolved')).items.map((i) => i.label)).toEqual(['duizelig']);

    expect((await act(cookie, freckles?.id ?? '', 'reopen')).statusCode).toBe(200);
    expect((await list(cookie)).open).toBe(1);

    const audit = await prisma.auditLog.findMany({
      where: { targetType: 'vocabularyGap' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'vocabulary.gap.dismiss',
      'vocabulary.gap.resolve',
      'vocabulary.gap.reopen',
    ]);
    expect(JSON.stringify(audit)).not.toContain('sproeten');
  });

  it('isoleert: een andere organisatie ziet en wijzigt de woorden niet', async () => {
    const a = await seedOrganization('A');
    const b = await seedOrganization('B');
    await recordGaps(prisma, a, [gap('dizziness', 'duizelig')], new Date());
    const cookieA = await admin('a@intento.local', a);
    const cookieB = await admin('b@intento.local', b);
    const id = (await list(cookieA)).items[0]?.id ?? '';

    expect(await list(cookieB)).toMatchObject({ items: [], open: 0 });
    for (const action of ['dismiss', 'resolve', 'reopen']) {
      const res = await act(cookieB, id, action);
      expect(res.statusCode).toBe(403);
    }
    // Een onbekend id geeft hetzelfde antwoord (verraadt niet of het bestaat).
    expect((await act(cookieB, 'bestaat-niet', 'dismiss')).statusCode).toBe(403);
    expect((await list(cookieA)).items[0]?.status).toBe('open');
  });

  it('alleen de beheerder', async () => {
    const org = await seedOrganization();
    await recordGaps(prisma, org, [gap('dizziness', 'duizelig')], new Date());
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    const res = await app.inject({ method: 'GET', url: '/vocabulary/gaps', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    const id = (await prisma.vocabularyGap.findFirstOrThrow()).id;
    expect((await act(cookie, id, 'dismiss')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/vocabulary/gaps' })).statusCode).toBe(401);
  });

  it('weigert een onbekende status', async () => {
    const cookie = await admin('a@intento.local', await seedOrganization());
    const res = await app.inject({
      method: 'GET',
      url: '/vocabulary/gaps?status=alles',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
