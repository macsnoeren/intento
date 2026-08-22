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
 * Gebruikersbeheer-tests (T2.1, DESIGN §2, §5.3, §6.2, FR-017).
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
    // Standaardwaarden (DESIGN §5.3): 4 opties, tekst aan, leren aan, ondersteuning uit,
    // contextindicator aan.
    expect(user.communicationProfile).toEqual({
      iconsPerScreen: 4,
      showText: true,
      aiLearningEnabled: true,
      supportMode: false,
      contextIndicator: true,
      // Standaardstrategie (T11.4): bestaande gebruikers houden het gedrag van vóór de instelling.
      conversationStrategy: 'refine',
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

  it('werkt instellingen bij en valideert iconsPerScreen op 2/4/6/8', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const ok = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 6,
        showText: false,
        aiLearningEnabled: false,
        supportMode: true,
        contextIndicator: false,
        conversationStrategy: 'calm',
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(userPublicSchema.parse(ok.json()).communicationProfile).toEqual({
      iconsPerScreen: 6,
      showText: false,
      aiLearningEnabled: false,
      supportMode: true,
      contextIndicator: false,
      conversationStrategy: 'calm',
    });

    // 3 is geen geldige waarde → 400.
    const bad = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 3,
        showText: true,
        aiLearningEnabled: true,
        supportMode: false,
        contextIndicator: true,
        conversationStrategy: 'refine',
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('laat een CAREGIVER instellingen aanpassen maar niet verwijderen (403)', async () => {
    const org = await seedOrganization('Org');
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('caregiver@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    // Begeleider moet aan de gebruiker gekoppeld zijn om die te mogen beheren (T2.2).
    await linkCaregiver(caregiver.accountId, user.id);

    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Caregiver mag instellingen beheren (DESIGN §2).
    const put = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 2,
        showText: true,
        aiLearningEnabled: true,
        supportMode: false,
        contextIndicator: true,
        conversationStrategy: 'refine',
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
