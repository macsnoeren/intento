import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { userListResponseSchema, userPublicSchema } from '@intento/shared';
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

/**
 * Gebruikersbeheer-tests (INTENTO-NEW-DESIGN §49, §50, §39).
 *
 * Dekt de volledige CRUD-slice: aanmaken met standaardprofiel, lijst, ophalen, instellingen
 * (zod-validatie op 2/4/6/8), en verwijderen. Plus de twee harde eisen: rolcontrole
 * (caregiver mag niet verwijderen) en tenant-isolatie (org A ziet nooit gebruikers van org B).
 */
describe('gebruikersbeheer — /users', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('laat een ADMIN een gebruiker aanmaken met een standaard-communicatieprofiel', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie },
      payload: { name: 'Sanne' },
    });

    expect(res.statusCode).toBe(201);
    const user = userPublicSchema.parse(res.json());
    expect(user.name).toBe('Sanne');
    expect(user.active).toBe(true);
    expect(user.organizationId).toBe(admin.organizationId);
    // Standaardwaarden (INTENTO-NEW-DESIGN §50): 4 opties, tekst aan, leren aan, ondersteuning uit,
    // contextindicator aan.
    expect(user.communicationProfile).toEqual({
      interactionMode: 'binary',
      optionsPerScreen: 4,
      questionStrategy: 'general_to_specific',
      experienceEnabled: true,
      maxQuestions: 15,
      showText: true,
      speechEnabled: false,
      speechVoice: 'nl_NL-pim-medium',
    });
  });

  it('weigert een aanmaakverzoek zonder naam met 400 VALIDATION_ERROR', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie },
      payload: { name: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('geeft via /admin/users alléén gebruikers van de eigen organisatie terug (tenant-isolatie)', async () => {
    const orgA = await seedOrganization('Org A');
    const adminA = await seedAccount('admin.a@intento.local', 'pw-a', 'ADMIN', orgA);
    await seedUser('Gebruiker A1', orgA);
    await seedUser('Gebruiker A2', orgA);

    const orgB = await seedOrganization('Org B');
    await seedUser('Gebruiker B1', orgB);

    const cookie = await loginCookie(app, adminA.email, adminA.password);
    const res = await app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = userListResponseSchema.parse(res.json());
    expect(body.users.map((u) => u.name).sort()).toEqual(['Gebruiker A1', 'Gebruiker A2']);
    expect(body.users.every((u) => u.organizationId === orgA)).toBe(true);
  });

  it('weigert het ophalen van een gebruiker uit een andere organisatie met 403 (bestaan lekt niet)', async () => {
    const adminA = await seedAccount('admin.a@intento.local', 'pw-a', 'ADMIN');
    const userB = await seedUser('Gebruiker B', await seedOrganization('Org B'));

    const cookie = await loginCookie(app, adminA.email, adminA.password);
    const res = await app.inject({ method: 'GET', url: `/users/${userB.id}`, headers: { cookie } });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('werkt instellingen bij en weigert een onbekende stem', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const ok = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        interactionMode: 'binary',
        optionsPerScreen: 4,
        questionStrategy: 'general_to_specific',
        experienceEnabled: true,
        maxQuestions: 15,
        showText: false,
        speechEnabled: false,
        speechVoice: 'nl_NL-pim-medium',
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(userPublicSchema.parse(ok.json()).communicationProfile).toEqual({
      interactionMode: 'binary',
      optionsPerScreen: 4,
      questionStrategy: 'general_to_specific',
      experienceEnabled: true,
      maxQuestions: 15,
      showText: false,
      speechEnabled: false,
      speechVoice: 'nl_NL-pim-medium',
    });

    // Een stem buiten de catalogus is geen geldige waarde → 400.
    const bad = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        interactionMode: 'binary',
        optionsPerScreen: 4,
        questionStrategy: 'general_to_specific',
        experienceEnabled: true,
        maxQuestions: 15,
        showText: true,
        speechEnabled: false,
        speechVoice: 'onbekende-stem',
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('bewaakt de grenzen van de communicatie-instellingen (N3.1, §50)', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);
    const valid = {
      interactionMode: 'multi',
      optionsPerScreen: 8,
      questionStrategy: 'concrete_first',
      experienceEnabled: false,
      maxQuestions: 30,
      showText: true,
      speechEnabled: false,
      speechVoice: 'nl_NL-pim-medium',
    };
    const put = (payload: object) =>
      app.inject({
        method: 'PUT',
        url: `/users/${user.id}/settings`,
        headers: { cookie },
        payload,
      });

    const ok = await put(valid);
    expect(ok.statusCode).toBe(200);
    expect(userPublicSchema.parse(ok.json()).communicationProfile).toEqual(valid);
    expect(
      (await put({ ...valid, optionsPerScreen: 2, maxQuestions: 5, interactionMode: 'ai' }))
        .statusCode,
    ).toBe(200);

    for (const bad of [
      { optionsPerScreen: 1 },
      { optionsPerScreen: 9 },
      { maxQuestions: 4 },
      { maxQuestions: 31 },
      { questionStrategy: 'guess' },
      { interactionMode: 'voice' },
      { optionsPerScreen: 4.5 },
    ]) {
      const res = await put({ ...valid, ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    // Ontbreekt een veld, dan ook: PUT vervangt het hele profiel.
    const incomplete: Partial<typeof valid> = { ...valid };
    delete incomplete.maxQuestions;
    expect((await put(incomplete)).statusCode).toBe(400);
  });

  it('maakt een gebruiker aan met Experience aan, tenzij de beheerder hem bewust uitzet (V2)', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const create = async (payload: object) =>
      userPublicSchema.parse(
        (await app.inject({ method: 'POST', url: '/users', headers: { cookie }, payload })).json(),
      ).communicationProfile;
    expect(await create({ name: 'Sanne' })).toMatchObject({
      experienceEnabled: true,
      interactionMode: 'binary',
      optionsPerScreen: 4,
      questionStrategy: 'general_to_specific',
      maxQuestions: 15,
    });
    expect((await create({ name: 'Tom', experienceEnabled: false })).experienceEnabled).toBe(false);
  });

  it('laat een CAREGIVER instellingen aanpassen maar niet verwijderen (403)', async () => {
    const org = await seedOrganization('Org');
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('caregiver@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    // Begeleider moet aan de gebruiker gekoppeld zijn om die te mogen beheren.
    await linkCaregiver(caregiver.accountId, user.id);

    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Caregiver mag instellingen beheren (INTENTO-NEW-DESIGN §49).
    const put = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        interactionMode: 'binary',
        optionsPerScreen: 4,
        questionStrategy: 'general_to_specific',
        experienceEnabled: true,
        maxQuestions: 15,
        showText: true,
        speechEnabled: false,
        speechVoice: 'nl_NL-pim-medium',
      },
    });
    expect(put.statusCode).toBe(200);

    // Caregiver mag niet verwijderen.
    const del = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(403);
    expect(del.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('laat een ADMIN een gebruiker verwijderen (profiel verdwijnt mee)', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const del = await app.inject({
      method: 'DELETE',
      url: `/users/${user.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(
      await prisma.userCommunicationProfile.findUnique({ where: { userId: user.id } }),
    ).toBeNull();
  });

  it('weigert onbevoegde toegang: 401 zonder sessie, 403 voor USER', async () => {
    const anon = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });

    const user = await seedAccount('user@intento.local', 'pw-u', 'USER');
    const cookie = await loginCookie(app, user.email, user.password);
    const res = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});
