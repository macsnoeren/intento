import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { attributionListResponseSchema, vocabularyListResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedPlatformAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { listAvailableVocabulary } from '../vocabulary/repository.js';

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

  it('zoekt in labels ook binnen een woord, in concepten alleen op het begin (N2.15)', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    await createVocabularyItem(prisma, { label: 'buik', concept: 'stomach', sortOrder: 1 });
    await createVocabularyItem(prisma, { label: 'hoofdpijn', concept: 'headache', sortOrder: 2 });
    await createVocabularyItem(prisma, { label: 'borstpijn', concept: 'chest_pain', sortOrder: 3 });
    await createVocabularyItem(prisma, { label: 'aroma', concept: 'aroma', sortOrder: 4 });
    await createVocabularyItem(prisma, { label: 'oma', concept: 'grandmother', sortOrder: 5 });
    const cookie = await loginCookie(app, admin.email, admin.password);
    const labels = async (q: string, extra = '') =>
      vocabularyListResponseSchema
        .parse((await list(cookie, `?q=${encodeURIComponent(q)}${extra}`)).body)
        .items.map((i) => i.labels[0]);

    // "oma" vindt geen stomach; het exacte label "oma" staat vóór "aroma".
    expect(await labels('oma')).toEqual(['oma', 'aroma']);
    expect(await labels('pijn')).toEqual(['hoofdpijn', 'borstpijn']);
    expect(await labels('pain')).toEqual(['borstpijn']);
    expect(await labels('chest_pain')).toEqual(['borstpijn']);
    expect(await labels('  ')).toHaveLength(5);

    // De pagina's lopen over exacte en overige treffers door.
    expect(await labels('oma', '&pageSize=1&page=1')).toEqual(['oma']);
    expect(await labels('oma', '&pageSize=1&page=2')).toEqual(['aroma']);
    const body = vocabularyListResponseSchema.parse(
      (await list(cookie, '?q=oma&pageSize=1&page=2')).body,
    );
    expect(body.total).toBe(2);
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

/** Machinevertalingen nakijken (N8.8, INTENTO-NEW-DESIGN §15.1, §49). */
describe('machinevertalingen nakijken', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  it('filtert op machinevertaling en telt wat nog openstaat', async () => {
    const admin = await seedPlatformAccount('p@intento.local', 'pw');
    await createVocabularyItem(prisma, {
      label: 'appel',
      concept: 'apple',
      labelStatus: 'machine',
    });
    await createVocabularyItem(prisma, { label: 'peer', concept: 'pear', labelStatus: 'machine' });
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain', labelStatus: 'reviewed' });
    await createVocabularyItem(prisma, {
      label: 'oud',
      concept: 'old',
      labelStatus: 'machine',
      status: 'retired',
    });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const all = vocabularyListResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie } })).json(),
    );
    expect(all.total).toBe(3);
    expect(all.machineOpen).toBe(2); // ingetrokken telt niet mee
    const machine = vocabularyListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/vocabulary?labelStatus=machine',
          headers: { cookie },
        })
      ).json(),
    );
    expect(machine.items.map((i) => i.labels[0]).sort()).toEqual(['appel', 'peer']);
  });

  it('"Klopt" maakt een machinevertaling nagekeken zonder het woord te veranderen', async () => {
    const { email, password } = await seedPlatformAccount('p@intento.local', 'pw');
    const id = await createVocabularyItem(prisma, {
      label: 'appel',
      concept: 'apple',
      labelStatus: 'machine',
    });
    const cookie = await loginCookie(app, email, password);
    const res = await app.inject({
      method: 'PATCH',
      url: `/vocabulary/${id}`,
      headers: { cookie },
      payload: { labelStatus: 'reviewed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ labels: ['appel'], labelStatus: 'reviewed' });
    const list = vocabularyListResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie } })).json(),
    );
    expect(list.machineOpen).toBe(0);
  });

  it('alleen "reviewed" kan, en een organisatiebeheerder kan de startset niet nakijken', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const id = await createVocabularyItem(prisma, {
      label: 'appel',
      concept: 'apple',
      labelStatus: 'machine',
    });
    const cookie = await loginCookie(app, admin.email, admin.password);
    const back = await app.inject({
      method: 'PATCH',
      url: `/vocabulary/${id}`,
      headers: { cookie },
      payload: { labelStatus: 'machine' },
    });
    expect(back.statusCode).toBe(400);
    const platform = await app.inject({
      method: 'PATCH',
      url: `/vocabulary/${id}`,
      headers: { cookie },
      payload: { labelStatus: 'reviewed' },
    });
    expect(platform.statusCode).toBe(403);
  });

  it('een gewone organisatie ziet alleen haar eigen machinevertalingen als open, nooit die van een ander', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    await seedAccount('a@intento.local', 'pw', 'ADMIN', orgA);
    await createVocabularyItem(prisma, {
      label: 'appel',
      concept: 'apple',
      labelStatus: 'machine',
    });
    await createVocabularyItem(prisma, {
      label: 'opa',
      concept: 'grandfather',
      labelStatus: 'machine',
      organizationId: orgA,
    });
    await createVocabularyItem(prisma, {
      label: 'oma',
      concept: 'grandmother',
      labelStatus: 'machine',
      organizationId: orgB,
    });
    const cookie = await loginCookie(app, 'a@intento.local', 'pw');

    const all = vocabularyListResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie } })).json(),
    );
    expect(all.items.map((i) => i.labels[0]).sort()).toEqual(['appel', 'opa']);
    expect(all.machineOpen).toBe(1); // de startset kan deze beheerder niet wijzigen
    const machine = vocabularyListResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/vocabulary?labelStatus=machine',
          headers: { cookie },
        })
      ).json(),
    );
    expect(machine.items.map((i) => i.labels[0])).toEqual(['opa']);
  });
});

/** Intrekken en terugzetten (N2.13, INTENTO-NEW-DESIGN §15). */
describe('POST /vocabulary/:id/retire en /restore', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  it('trekt een item in: het valt uit de beschikbare Vocabulary maar blijft bestaan; terugzetten kan', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const id = await createVocabularyItem(prisma, {
      label: 'kat',
      concept: 'cat',
      organizationId: admin.organizationId,
    });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const retired = await app.inject({
      method: 'POST',
      url: `/vocabulary/${id}/retire`,
      headers: { cookie },
    });
    expect(retired.statusCode).toBe(200);
    expect(retired.json()).toMatchObject({ status: 'retired', imageUrl: null });
    expect(await listAvailableVocabulary(prisma, admin.organizationId)).toEqual([]);
    expect(await prisma.vocabularyItem.count({ where: { id } })).toBe(1);

    const restored = await app.inject({
      method: 'POST',
      url: `/vocabulary/${id}/restore`,
      headers: { cookie },
    });
    expect(restored.json()).toMatchObject({ status: 'approved' });
    expect((await listAvailableVocabulary(prisma, admin.organizationId)).map((i) => i.id)).toEqual([
      id,
    ]);

    const actions = (
      await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual(['vocabulary.retire', 'vocabulary.restore']);
  });

  it('is alleen voor de beheerder, en alleen voor items die hij mag beheren', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount('c@intento.local', 'pw', 'CAREGIVER', admin.organizationId);
    const other = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const own = await createVocabularyItem(prisma, {
      label: 'kat',
      concept: 'cat',
      organizationId: admin.organizationId,
    });
    const theirs = await createVocabularyItem(prisma, {
      label: 'hond',
      concept: 'dog',
      organizationId: other.organizationId,
    });
    const platform = await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });

    const cg = await loginCookie(app, caregiver.email, caregiver.password);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/vocabulary/${own}/retire`,
          headers: { cookie: cg },
        })
      ).statusCode,
    ).toBe(403);

    const cookie = await loginCookie(app, admin.email, admin.password);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/vocabulary/${theirs}/retire`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    const res = await app.inject({
      method: 'POST',
      url: `/vocabulary/${platform}/retire`,
      headers: { cookie },
    });
    expect(res.json()).toMatchObject({ error: { code: 'PLATFORM_ITEM' } });
    expect(await prisma.vocabularyItem.count({ where: { status: 'retired' } })).toBe(0);
  });
});

/** Bronvermelding (N2.14, INTENTO-NEW-DESIGN §15). */
describe('GET /vocabulary/attributions', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  it('noemt elk CC BY-item met auteur en bron, ook voor de tablet; niets van een andere organisatie', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const other = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const ccBy = [
      await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' }),
      await createVocabularyItem(prisma, { label: 'eten', concept: 'eat' }),
    ];
    await createVocabularyItem(prisma, {
      label: 'kat',
      concept: 'cat',
      organizationId: admin.organizationId,
    });
    await createVocabularyItem(prisma, {
      label: 'geheim',
      concept: 'secret',
      organizationId: other.organizationId,
    });
    await createVocabularyItem(prisma, { label: 'oud', concept: 'old', status: 'retired' });

    const user = await seedUser('Sanne', admin.organizationId);
    for (const cookie of [
      await loginCookie(app, admin.email, admin.password),
      await deviceCookie(app, user.id),
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/vocabulary/attributions',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const { sources } = attributionListResponseSchema.parse(res.json());

      const mulberry = sources.find((s) => s.sourceName === 'Mulberry Symbols');
      expect(mulberry).toMatchObject({
        licenseKey: 'CC-BY-SA-4.0',
        author: 'Steve Lee',
        sourceUrl: 'https://globalsymbols.com/symbolsets/mulberry',
        requiresAttribution: true,
      });
      for (const id of ccBy) expect(mulberry!.items.map((i) => i.id)).toContain(id);

      const own = sources.find((s) => s.sourceName === 'Eigen afbeeldingen');
      expect(own).toMatchObject({ requiresAttribution: false, items: [{ label: 'kat' }] });
      expect(JSON.stringify(sources)).not.toContain('geheim');
      expect(JSON.stringify(sources)).not.toContain('oud');
    }
  });

  it('is niet publiek', async () => {
    expect((await app.inject({ method: 'GET', url: '/vocabulary/attributions' })).statusCode).toBe(
      401,
    );
  });
});
