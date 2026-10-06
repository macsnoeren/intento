import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vocabularyListResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedPlatformAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';

/** `GET /vocabulary` (N2.9, INTENTO-NEW-DESIGN §15, §49). */
describe('GET /vocabulary', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.vocabularyItem.deleteMany();
  });

  async function list(cookie: string, query = '') {
    const res = await app.inject({
      method: 'GET',
      url: `/vocabulary${query}`,
      headers: { cookie },
    });
    return {
      status: res.statusCode,
      body: res.statusCode === 200 ? vocabularyListResponseSchema.parse(res.json()) : res.json(),
    };
  }

  it('geeft een beheerder de platformitems plus die van de eigen organisatie, nooit een andere', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const other = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain', sortOrder: 1 });
    await createVocabularyItem(prisma, {
      label: 'onze kat',
      concept: 'our_cat',
      organizationId: admin.organizationId,
      sortOrder: 2,
    });
    await createVocabularyItem(prisma, {
      label: 'hun hond',
      concept: 'their_dog',
      organizationId: other.organizationId,
      sortOrder: 3,
    });

    const { status, body } = await list(await loginCookie(app, admin.email, admin.password));
    expect(status).toBe(200);
    const response = vocabularyListResponseSchema.parse(body);
    expect(response.items.map((item) => [item.labels[0], item.scope])).toEqual([
      ['pijn', 'platform'],
      ['onze kat', 'organization'],
    ]);
    expect(response.total).toBe(2);
    expect(response.items[0]!.license).toMatchObject({
      key: 'CC-BY-SA-4.0',
      author: 'Steve Lee',
      sourceName: 'Mulberry Symbols',
    });
  });

  it('laat een begeleider lezen, maar een tablet en een anonieme bezoeker niet', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount('c@intento.local', 'pw', 'CAREGIVER', admin.organizationId);
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });

    expect((await list(await loginCookie(app, caregiver.email, caregiver.password))).status).toBe(
      200,
    );
    const user = await seedUser('Sanne', admin.organizationId);
    expect((await list(await deviceCookie(app, user.id))).status).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/vocabulary' })).statusCode).toBe(401);
  });

  it('pagineert', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    for (let i = 0; i < 25; i += 1) {
      await createVocabularyItem(prisma, {
        label: `woord ${i}`,
        concept: `word_${i}`,
        sortOrder: i,
      });
    }
    const cookie = await loginCookie(app, admin.email, admin.password);
    const third = vocabularyListResponseSchema.parse(
      (await list(cookie, '?page=3&pageSize=10')).body,
    );
    expect(third).toMatchObject({ total: 25, page: 3, pageSize: 10 });
    expect(third.items.map((item) => item.labels[0])).toEqual([
      'woord 20',
      'woord 21',
      'woord 22',
      'woord 23',
      'woord 24',
    ]);
    expect((await list(cookie, '?pageSize=500')).status).toBe(400);
  });

  it('zoekt hoofdletterongevoelig op label, synoniem en concept', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    await createVocabularyItem(prisma, { label: 'hoofdpijn', concept: 'headache' });
    await createVocabularyItem(prisma, { label: 'buik', concept: 'stomach', synonyms: ['maag'] });
    const cookie = await loginCookie(app, admin.email, admin.password);
    const labels = async (q: string) =>
      vocabularyListResponseSchema
        .parse((await list(cookie, `?q=${encodeURIComponent(q)}`)).body)
        .items.map((i) => i.labels[0]);
    expect(await labels('HOOFD')).toEqual(['hoofdpijn']);
    expect(await labels('maag')).toEqual(['buik']);
    expect(await labels('stomach')).toEqual(['buik']);
    expect(await labels('niets')).toEqual([]);
  });

  it('toont ingetrokken items alleen met het filter retired, zonder afbeelding', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    await createVocabularyItem(prisma, { label: 'oud', concept: 'old', status: 'retired' });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const approved = vocabularyListResponseSchema.parse((await list(cookie)).body);
    expect(approved.items.map((i) => i.labels[0])).toEqual(['pijn']);
    expect(approved.items[0]!.imageUrl).toMatch(/^\/assets\/.+\?exp=\d+&sig=/);

    const retired = vocabularyListResponseSchema.parse(
      (await list(cookie, '?status=retired')).body,
    );
    expect(retired.items.map((i) => [i.labels[0], i.imageUrl])).toEqual([['oud', null]]);
  });
});

/** `PATCH /vocabulary/:id` (N2.11, INTENTO-NEW-DESIGN §15, §16). */
describe('PATCH /vocabulary/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  async function patch(cookie: string, id: string, payload: unknown) {
    return app.inject({
      method: 'PATCH',
      url: `/vocabulary/${id}`,
      headers: { cookie },
      payload: payload as object,
    });
  }

  it('bewerkt labels, concepten, contexten, startconcept en volgorde; een nieuw label is nagekeken', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const id = await createVocabularyItem(prisma, {
      label: 'hoofd',
      concept: 'head',
      organizationId: admin.organizationId,
      labelStatus: 'machine',
    });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await patch(cookie, id, {
      labels: ['kop', 'hoofd'],
      concepts: ['head'],
      contexts: ['body'],
      isStart: true,
      sortOrder: 5,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      labels: ['kop', 'hoofd'],
      contexts: ['body'],
      isStart: true,
      sortOrder: 5,
      labelStatus: 'reviewed',
    });
    // De zoektekst loopt mee.
    const row = await prisma.vocabularyItem.findUniqueOrThrow({ where: { id } });
    expect(row.searchText).toContain('kop');
    // En het staat in het audit-log, zonder de labels zelf.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'vocabulary.update' },
    });
    expect(audit.targetId).toBe(id);
    expect(audit.metadataJson).not.toContain('kop');
  });

  it('laat het label met rust als alleen de volgorde wijzigt', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const id = await createVocabularyItem(prisma, {
      label: 'x',
      concept: 'x',
      organizationId: admin.organizationId,
      labelStatus: 'machine',
    });
    const res = await patch(await loginCookie(app, admin.email, admin.password), id, {
      sortOrder: 3,
    });
    expect(res.json()).toMatchObject({ labelStatus: 'machine', sortOrder: 3 });
  });

  it('valideert de invoer', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const id = await createVocabularyItem(prisma, {
      label: 'x',
      concept: 'x',
      organizationId: admin.organizationId,
    });
    const cookie = await loginCookie(app, admin.email, admin.password);
    for (const body of [
      {},
      { labels: [] },
      { labels: ['a', 'A'] },
      { concepts: ['Hoofd Pijn'] },
      { contexts: ['weer'] },
      { sortOrder: -1 },
      { labels: ['a'], status: 'retired' },
    ]) {
      expect((await patch(cookie, id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('is alleen voor de beheerder', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount('c@intento.local', 'pw', 'CAREGIVER', admin.organizationId);
    const id = await createVocabularyItem(prisma, {
      label: 'x',
      concept: 'x',
      organizationId: admin.organizationId,
    });
    const res = await patch(await loginCookie(app, caregiver.email, caregiver.password), id, {
      sortOrder: 1,
    });
    expect(res.statusCode).toBe(403);
  });

  it('kan geen item van een andere organisatie bewerken', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const other = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const theirs = await createVocabularyItem(prisma, {
      label: 'x',
      concept: 'x',
      organizationId: other.organizationId,
    });
    const cookie = await loginCookie(app, admin.email, admin.password);
    const res = await patch(cookie, theirs, { sortOrder: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect((await patch(cookie, 'bestaat-niet', { sortOrder: 1 })).statusCode).toBe(403);
  });

  it('weigert een platformitem voor een organisatiebeheerder, maar niet voor de platformbeheerder', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const platformItem = await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    const res = await patch(await loginCookie(app, admin.email, admin.password), platformItem, {
      sortOrder: 1,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'PLATFORM_ITEM' } });

    const { email, password } = await seedPlatformAccount('p@intento.local', 'pw');
    const ok = await patch(await loginCookie(app, email, password), platformItem, { sortOrder: 1 });
    expect(ok.statusCode).toBe(200);
  });
});
