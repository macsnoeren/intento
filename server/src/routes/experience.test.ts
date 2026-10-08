import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { experienceClearResponseSchema, userExperienceSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';

/** Ervaring bekijken en wissen (N12.3, INTENTO-NEW-DESIGN §22, §49). */

const PASSWORD = 'correct horse battery staple';
const encryptor = createEncryptor(testEnv());

describe('/users/:id/experience', () => {
  let app: FastifyInstance;
  let org: string;
  let pain: string;
  let drink: string;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }) });
    org = await seedOrganization();
    pain = await createVocabularyItem(prisma, {
      label: 'pijn',
      concept: 'pain',
      assetPath: 'seed/x/1.png',
    });
    drink = await createVocabularyItem(prisma, { label: 'drinken', concept: 'drink' });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function admin(email: string, organizationId: string): Promise<string> {
    await seedAccount(email, PASSWORD, 'ADMIN', organizationId);
    return loginCookie(app, email, PASSWORD);
  }

  async function stat(
    user: { id: string },
    organizationId: string,
    subjectType: string,
    subjectRef: string,
    chosen: number,
  ): Promise<void> {
    await prisma.experienceStat.create({
      data: {
        userId: user.id,
        organizationId,
        subjectType,
        subjectRef,
        presented: chosen + 2,
        chosen,
        chosenAtFirstPosition: chosen,
        lastUsedAt: chosen > 0 ? new Date('2026-10-07T10:00:00Z') : null,
      },
    });
  }

  async function addContact(userId: string, name: string): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        userId,
        organizationId: org,
        nameEncrypted: encryptor.encrypt(name),
        emailEncrypted: encryptor.encrypt(`${name.toLowerCase()}@example.org`),
      },
    });
    return contact.id;
  }

  function get(cookie: string, userId: string) {
    return app.inject({ method: 'GET', url: `/users/${userId}/experience`, headers: { cookie } });
  }

  function clear(cookie: string, userId: string) {
    return app.inject({
      method: 'DELETE',
      url: `/users/${userId}/experience`,
      headers: { cookie },
    });
  }

  it('toont wat er geleerd is: vaakst gekozen eerst, met woord, afbeelding en contactnaam', async () => {
    const sanne = await seedUser('Sanne', org);
    const mama = await addContact(sanne.id, 'Mama');
    await stat(sanne, org, 'symbol', drink, 1);
    await stat(sanne, org, 'symbol', pain, 4);
    await stat(sanne, org, 'contact', mama, 2);
    await stat(sanne, org, 'contact', 'verwijderd-contact', 3);
    await stat(sanne, org, 'mode', 'binary', 5);
    const cookie = await admin('a@intento.local', org);

    const res = await get(cookie, sanne.id);
    expect(res.statusCode).toBe(200);
    const body = userExperienceSchema.parse(res.json());
    expect(body.enabled).toBe(true);
    expect(body.symbols.map((s) => [s.label, s.chosen])).toEqual([
      ['pijn', 4],
      ['drinken', 1],
    ]);
    expect(body.symbols[0]?.imageUrl).toMatch(/^\/assets\/.+\?exp=\d+&sig=/);
    expect(body.symbols[0]?.lastUsedAt).toBe('2026-10-07T10:00:00.000Z');
    // Een verwijderd contact heeft geen naam meer en staat er niet bij.
    expect(body.contacts).toEqual([expect.objectContaining({ id: mama, name: 'Mama', chosen: 2 })]);
    expect(body.modes).toEqual([expect.objectContaining({ mode: 'binary', chosen: 5 })]);
    expect(body.symbolCount).toBe(2);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'experience.view' } });
    expect(audit).toMatchObject({ targetType: 'user', targetId: sanne.id, outcome: 'success' });
    expect(JSON.stringify(audit)).not.toMatch(/Mama|pijn/);
  });

  it('Ervaring wissen: alles van die gebruiker weg, niets van een ander; geaudit', async () => {
    const sanne = await seedUser('Sanne', org);
    const piet = await seedUser('Piet', org);
    await stat(sanne, org, 'symbol', pain, 4);
    await stat(sanne, org, 'mode', 'binary', 1);
    await stat(piet, org, 'symbol', pain, 2);
    const cookie = await admin('a@intento.local', org);

    const res = await clear(cookie, sanne.id);
    expect(res.statusCode).toBe(200);
    expect(experienceClearResponseSchema.parse(res.json())).toEqual({ deleted: 2 });
    expect(await prisma.experienceStat.count({ where: { userId: sanne.id } })).toBe(0);
    expect(await prisma.experienceStat.count({ where: { userId: piet.id } })).toBe(1);

    const after = userExperienceSchema.parse((await get(cookie, sanne.id)).json());
    expect(after).toMatchObject({ symbols: [], contacts: [], modes: [], symbolCount: 0 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'experience.clear' } });
    expect(audit).toMatchObject({ targetId: sanne.id });
    expect(JSON.parse(audit.metadataJson ?? '{}')).toEqual({ deleted: 2 });
  });

  it('Experience uit: wel te zien dat hij uit staat', async () => {
    const sanne = await seedUser('Sanne', org);
    await prisma.userCommunicationProfile.upsert({
      where: { userId: sanne.id },
      create: { userId: sanne.id, experienceEnabled: false },
      update: { experienceEnabled: false },
    });
    const cookie = await admin('a@intento.local', org);
    expect(userExperienceSchema.parse((await get(cookie, sanne.id)).json()).enabled).toBe(false);
  });

  it('isoleert: een beheerder van een andere organisatie ziet en wist niets', async () => {
    const sanne = await seedUser('Sanne', org);
    await stat(sanne, org, 'symbol', pain, 4);
    const other = await admin('b@intento.local', await seedOrganization('Ander'));
    expect((await get(other, sanne.id)).statusCode).toBe(403);
    expect((await clear(other, sanne.id)).statusCode).toBe(403);
    expect((await get(other, 'bestaat-niet')).statusCode).toBe(403);
    expect(await prisma.experienceStat.count()).toBe(1);
  });

  it('alleen de beheerder: een begeleider krijgt 403, zonder login 401', async () => {
    const sanne = await seedUser('Sanne', org);
    await stat(sanne, org, 'symbol', pain, 4);
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    expect((await get(cookie, sanne.id)).statusCode).toBe(403);
    expect((await clear(cookie, sanne.id)).statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: `/users/${sanne.id}/experience` });
    expect(anonymous.statusCode).toBe(401);
    expect(await prisma.experienceStat.count()).toBe(1);
  });
});
