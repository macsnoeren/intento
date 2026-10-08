import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { profileExportResponseSchema, userPublicSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createEncryptor } from '../crypto/encryption.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';

/** Contacten en Experience in de profielexport (N15.1, INTENTO-NEW-DESIGN §1, §28, §53). */

const encryptor = createEncryptor(testEnv());

describe('profielexport met contacten en Experience', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function exportOf(cookie: string, userId: string): Promise<string> {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${userId}/export`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return profileExportResponseSchema.parse(res.json()).data;
  }

  async function importInto(cookie: string, data: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie },
      payload: { data },
    });
    expect(res.statusCode).toBe(201);
    return userPublicSchema.parse(res.json());
  }

  it('rondgang: contacten weer onbevestigd, pictogram alleen als het daar bestaat, Experience mee', async () => {
    const a = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const b = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const platformIcon = await createVocabularyItem(prisma, { label: 'mama', concept: 'mother' });
    const ownIcon = await createVocabularyItem(prisma, {
      label: 'broer',
      concept: 'brother',
      organizationId: a.organizationId,
    });
    const sanne = await seedUser('Sanne', a.organizationId);
    const mama = await prisma.contact.create({
      data: {
        userId: sanne.id,
        organizationId: a.organizationId,
        nameEncrypted: encryptor.encrypt('Mama'),
        emailEncrypted: encryptor.encrypt('mama@example.org'),
        relation: 'moeder',
        vocabularyItemId: platformIcon,
        emailVerifiedAt: new Date(),
        sortOrder: 0,
      },
    });
    await prisma.contact.create({
      data: {
        userId: sanne.id,
        organizationId: a.organizationId,
        nameEncrypted: encryptor.encrypt('Tim'),
        emailEncrypted: encryptor.encrypt('tim@example.org'),
        relation: 'broer',
        vocabularyItemId: ownIcon,
        emailVerifiedAt: new Date(),
        active: false,
        sortOrder: 1,
      },
    });
    const stat = (subjectType: string, subjectRef: string, chosen: number) =>
      prisma.experienceStat.create({
        data: {
          userId: sanne.id,
          organizationId: a.organizationId,
          subjectType,
          subjectRef,
          presented: chosen + 1,
          chosen,
          chosenAtFirstPosition: 1,
          lastUsedAt: new Date('2026-10-01T10:00:00Z'),
        },
      });
    await stat('symbol', platformIcon, 4);
    await stat('symbol', ownIcon, 2);
    await stat('contact', mama.id, 3);
    await stat('mode', 'multi', 5);

    const data = await exportOf(await loginCookie(app, a.email, a.password), sanne.id);
    expect(data).not.toMatch(/mama@example|Tim/);
    const imported = await importInto(await loginCookie(app, b.email, b.password), data);

    const contacts = await prisma.contact.findMany({
      where: { userId: imported.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(
      contacts.map((c) => ({
        name: encryptor.decrypt(c.nameEncrypted),
        email: encryptor.decrypt(c.emailEncrypted),
        relation: c.relation,
        icon: c.vocabularyItemId,
        active: c.active,
        sortOrder: c.sortOrder,
        verified: c.emailVerifiedAt !== null,
        organizationId: c.organizationId,
      })),
    ).toEqual([
      {
        name: 'Mama',
        email: 'mama@example.org',
        relation: 'moeder',
        icon: platformIcon,
        active: true,
        sortOrder: 0,
        verified: false,
        organizationId: b.organizationId,
      },
      {
        name: 'Tim',
        email: 'tim@example.org',
        relation: 'broer',
        icon: null, // het eigen pictogram van organisatie A bestaat in B niet
        active: false,
        sortOrder: 1,
        verified: false,
        organizationId: b.organizationId,
      },
    ]);

    const stats = await prisma.experienceStat.findMany({
      where: { userId: imported.id },
      orderBy: [{ subjectType: 'asc' }, { subjectRef: 'asc' }],
    });
    expect(stats.map((s) => [s.subjectType, s.subjectRef, s.presented, s.chosen])).toEqual([
      ['contact', contacts[0]?.id, 4, 3],
      ['mode', 'multi', 6, 5],
      ['symbol', platformIcon, 5, 4],
    ]);
    expect(stats.every((s) => s.organizationId === b.organizationId)).toBe(true);
    expect(stats[0]?.lastUsedAt?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    // Het origineel blijft onaangetast.
    expect(await prisma.contact.count({ where: { userId: sanne.id } })).toBe(2);
  });

  it('een bestand van versie 1 (zonder contacten en Experience) is nog te importeren', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const data = encryptor.encrypt(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-07-01T10:00:00.000Z',
        user: { name: 'Emma' },
        communicationProfile: { interactionMode: 'binary', showText: true },
      }),
    );
    const imported = await importInto(await loginCookie(app, admin.email, admin.password), data);
    expect(imported.name).toBe('Emma');
    expect(await prisma.contact.count({ where: { userId: imported.id } })).toBe(0);
  });

  it('weigert een bestand met een ongeldig contact (zod), zonder half geïmporteerde gebruiker', async () => {
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const data = encryptor.encrypt(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-10-01T10:00:00.000Z',
        user: { name: 'Emma' },
        communicationProfile: { showText: true },
        contacts: [
          {
            key: 'c1',
            name: 'Mama',
            relation: null,
            email: 'geen-adres',
            vocabularyItemId: null,
            active: true,
            sortOrder: 0,
          },
        ],
        experience: [],
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie: await loginCookie(app, admin.email, admin.password) },
      payload: { data },
    });
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { name: 'Emma' } })).toBe(0);
  });
});
