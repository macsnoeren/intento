import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { contactListResponseSchema, contactPublicSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';

/** Contacten van een gebruiker (N10.1, INTENTO-NEW-DESIGN §28, §39). */

const PASSWORD = 'correct horse battery staple';
const MAMA = { name: 'Mama', relation: 'moeder', email: 'Mama@Example.org' };

describe('/users/:id/contacts', () => {
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

  async function adminOf(org: string, email = 'admin@intento.local') {
    const account = await seedAccount(email, PASSWORD, 'ADMIN', org);
    return { ...account, cookie: await loginCookie(app, email, PASSWORD) };
  }

  function create(cookie: string, userId: string, payload: Record<string, unknown> = MAMA) {
    return app.inject({
      method: 'POST',
      url: `/users/${userId}/contacts`,
      headers: { cookie },
      payload,
    });
  }

  function patch(cookie: string, userId: string, id: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: `/users/${userId}/contacts/${id}`,
      headers: { cookie },
      payload,
    });
  }

  async function list(cookie: string, userId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${userId}/contacts`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return contactListResponseSchema.parse(res.json()).contacts;
  }

  it('voegt toe, toont, wijzigt en verwijdert; volgorde loopt door; met audit', async () => {
    const org = await seedOrganization();
    const { cookie } = await adminOf(org);
    const sanne = await seedUser('Sanne', org);
    const mother = await createVocabularyItem(prisma, {
      label: 'moeder',
      concept: 'mother',
      assetPath: 'seed/x/m.png',
    });

    const res = await create(cookie, sanne.id, { ...MAMA, vocabularyItemId: mother });
    expect(res.statusCode).toBe(201);
    const mama = contactPublicSchema.parse(res.json());
    expect(mama).toMatchObject({
      userId: sanne.id,
      name: 'Mama',
      relation: 'moeder',
      email: 'mama@example.org',
      emailVerified: false,
      active: true,
      sortOrder: 0,
      symbol: { id: mother, label: 'moeder' },
    });
    expect(mama.symbol?.imageUrl).toMatch(/^\/assets\//);
    const broer = contactPublicSchema.parse(
      (
        await create(cookie, sanne.id, { name: 'Tim', relation: 'broer', email: 'tim@example.org' })
      ).json(),
    );
    expect(broer.sortOrder).toBe(1);
    expect((await list(cookie, sanne.id)).map((c) => c.name)).toEqual(['Mama', 'Tim']);

    const moved = await patch(cookie, sanne.id, broer.id, { sortOrder: 0, active: false });
    expect(moved.json()).toMatchObject({ sortOrder: 0, active: false });
    const renamed = await patch(cookie, sanne.id, mama.id, { name: 'Mam', relation: null });
    expect(renamed.json()).toMatchObject({
      name: 'Mam',
      relation: null,
      email: 'mama@example.org',
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/users/${sanne.id}/contacts/${broer.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    expect((await list(cookie, sanne.id)).map((c) => c.name)).toEqual(['Mam']);

    const audit = await prisma.auditLog.findMany({
      where: { targetType: 'contact' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'contact.create',
      'contact.verification.send',
      'contact.create',
      'contact.verification.send',
      'contact.update',
      'contact.update',
      'contact.delete',
    ]);
    const auditText = JSON.stringify(audit);
    for (const secret of ['Mama', 'Mam"', 'mama@example.org', 'tim@example.org', 'Tim']) {
      expect(auditText).not.toContain(secret);
    }
  });

  it('in de database staan naam en e-mailadres niet leesbaar', async () => {
    const org = await seedOrganization();
    const { cookie } = await adminOf(org);
    const sanne = await seedUser('Sanne', org);
    await create(cookie, sanne.id);
    const row = await prisma.contact.findFirstOrThrow();
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('Mama');
    expect(raw.toLowerCase()).not.toContain('mama@example.org');
    expect(row.nameEncrypted).toMatch(/^v1:/);
    expect(row.emailEncrypted).toMatch(/^v1:/);
  });

  it('een ander e-mailadres moet opnieuw bevestigd worden; hetzelfde adres niet', async () => {
    const org = await seedOrganization();
    const { cookie } = await adminOf(org);
    const sanne = await seedUser('Sanne', org);
    const mama = contactPublicSchema.parse((await create(cookie, sanne.id)).json());
    await prisma.contact.update({ where: { id: mama.id }, data: { emailVerifiedAt: new Date() } });

    const same = await patch(cookie, sanne.id, mama.id, { email: 'MAMA@example.org' });
    expect(same.json()).toMatchObject({ emailVerified: true });
    const other = await patch(cookie, sanne.id, mama.id, { email: 'mama@elders.org' });
    expect(other.json()).toMatchObject({ emailVerified: false, email: 'mama@elders.org' });
  });

  it('valideert de invoer', async () => {
    const org = await seedOrganization();
    const other = await seedOrganization('Ander');
    const { cookie } = await adminOf(org);
    const sanne = await seedUser('Sanne', org);
    const foreign = await createVocabularyItem(prisma, {
      label: 'opa',
      concept: 'grandfather',
      organizationId: other,
    });
    const retired = await createVocabularyItem(prisma, {
      label: 'oud',
      concept: 'old',
      status: 'retired',
    });

    for (const payload of [
      { ...MAMA, name: '' },
      { ...MAMA, name: 'x'.repeat(61) },
      { ...MAMA, name: 'Ma\u0000ma' },
      { ...MAMA, email: 'geen-adres' },
      { ...MAMA, extra: true },
      { name: 'Mama' },
    ]) {
      expect((await create(cookie, sanne.id, payload)).statusCode).toBe(400);
    }
    for (const vocabularyItemId of [foreign, retired, 'bestaat-niet']) {
      const res = await create(cookie, sanne.id, { ...MAMA, vocabularyItemId });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'SYMBOL_NOT_AVAILABLE' } });
    }
    const mama = contactPublicSchema.parse((await create(cookie, sanne.id)).json());
    expect((await patch(cookie, sanne.id, mama.id, {})).statusCode).toBe(400);
    expect(await prisma.contact.count()).toBe(1);
  });

  it('een gekoppelde begeleider mag het, een niet-gekoppelde niet', async () => {
    const org = await seedOrganization();
    const sanne = await seedUser('Sanne', org);
    const linked = await seedAccount('gekoppeld@intento.local', PASSWORD, 'CAREGIVER', org);
    await linkCaregiver(linked.accountId, sanne.id);
    await seedAccount('los@intento.local', PASSWORD, 'CAREGIVER', org);

    const linkedCookie = await loginCookie(app, 'gekoppeld@intento.local', PASSWORD);
    expect((await create(linkedCookie, sanne.id)).statusCode).toBe(201);
    expect(await list(linkedCookie, sanne.id)).toHaveLength(1);

    const looseCookie = await loginCookie(app, 'los@intento.local', PASSWORD);
    expect((await create(looseCookie, sanne.id)).statusCode).toBe(403);
    const res = await app.inject({
      method: 'GET',
      url: `/users/${sanne.id}/contacts`,
      headers: { cookie: looseCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/users/${sanne.id}/contacts` })).statusCode,
    ).toBe(401);
  });

  it('isoleert: een andere organisatie of een andere gebruiker komt er niet bij', async () => {
    const orgA = await seedOrganization('A');
    const orgB = await seedOrganization('B');
    const a = await adminOf(orgA, 'a@intento.local');
    const b = await adminOf(orgB, 'b@intento.local');
    const sanne = await seedUser('Sanne', orgA);
    const piet = await seedUser('Piet', orgA);
    const mama = contactPublicSchema.parse((await create(a.cookie, sanne.id)).json());

    expect((await create(b.cookie, sanne.id)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/users/${sanne.id}/contacts`,
          headers: { cookie: b.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect((await patch(b.cookie, sanne.id, mama.id, { name: 'X' })).statusCode).toBe(403);

    // Het contact van Sanne via het pad van Piet: bestaat daar niet.
    expect((await patch(a.cookie, piet.id, mama.id, { name: 'X' })).statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE',
      url: `/users/${piet.id}/contacts/${mama.id}`,
      headers: { cookie: a.cookie },
    });
    expect(del.statusCode).toBe(404);
    expect(await list(a.cookie, piet.id)).toEqual([]);
    expect((await list(a.cookie, sanne.id)).map((c) => c.name)).toEqual(['Mama']);
  });
});
