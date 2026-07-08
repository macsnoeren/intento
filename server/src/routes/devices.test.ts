import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { deviceCodeResponseSchema, deviceSessionResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  deviceCookieHeader,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Tabletkoppeling (T2.3, DESIGN §6.2, §8.2, FR-018).
 *
 * Dekt de volledige koppelflow (beheerder genereert code → tablet wisselt in → apparaat-token
 * geeft toegang tot alléén de eigen gebruiker), de harde randen (verlopen/gebruikte/onbekende
 * code geweigerd), de scheiding tussen device- en accountpijler (een device-token werkt niet op
 * beheerroutes) en tenant-isolatie op het genereren.
 */
describe('tabletkoppeling — devices', () => {
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

  /** Genereert een koppelcode als ingelogde ADMIN en geeft de plaintext code terug. */
  async function generateCode(cookie: string, userId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/device-code`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    return deviceCodeResponseSchema.parse(res.json()).code;
  }

  it('koppelt end-to-end: code genereren → inwisselen → eigen gebruiker via device-token', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const adminCookie = await loginCookie(app, admin.email, admin.password);

    const code = await generateCode(adminCookie, user.id);

    // De code staat alléén gehasht in de db (nooit plaintext).
    const stored = await prisma.deviceLinkCode.findFirst({ where: { userId: user.id } });
    expect(stored?.codeHash).toBeTruthy();
    expect(stored?.codeHash).not.toBe(code);

    // Inwisselen op de tablet (niet ingelogd). Genormaliseerd: kleine letters/streepjes mogen.
    const link = await app.inject({
      method: 'POST',
      url: '/devices/link',
      payload: { code: code.toLowerCase() },
    });
    expect(link.statusCode).toBe(201);
    const session = deviceSessionResponseSchema.parse(link.json());
    expect(session.user.id).toBe(user.id);
    expect(session.device.userId).toBe(user.id);

    const deviceCookie = deviceCookieHeader(link);
    expect(deviceCookie).toBeTruthy();

    // Het apparaat-token staat alléén gehasht in de db.
    const device = await prisma.device.findFirst({ where: { userId: user.id } });
    expect(device?.tokenHash).toBeTruthy();
    expect(deviceCookie).not.toContain(device!.tokenHash);

    // Met het device-token: eigen gebruiker ophalen zonder dagelijkse login.
    const me = await app.inject({
      method: 'GET',
      url: '/device/me',
      headers: { cookie: deviceCookie! },
    });
    expect(me.statusCode).toBe(200);
    expect(deviceSessionResponseSchema.parse(me.json()).user.id).toBe(user.id);
  });

  it('weigert een tweede inwisseling van dezelfde code (eenmalig)', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const adminCookie = await loginCookie(app, admin.email, admin.password);
    const code = await generateCode(adminCookie, user.id);

    const first = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toMatchObject({ error: { code: 'INVALID_LINK_CODE' } });

    // Geen tweede apparaat aangemaakt.
    expect(await prisma.device.count({ where: { userId: user.id } })).toBe(1);
  });

  it('weigert een verlopen code', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const adminCookie = await loginCookie(app, admin.email, admin.password);
    const code = await generateCode(adminCookie, user.id);

    // Zet de vervaltijd in het verleden (simuleert verlopen).
    await prisma.deviceLinkCode.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_LINK_CODE' } });
    expect(await prisma.device.count()).toBe(0);
  });

  it('weigert een onbekende code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/devices/link',
      payload: { code: 'ZZZZ2222' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_LINK_CODE' } });
  });

  it('vervangt een eerdere ongebruikte code bij opnieuw genereren', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const adminCookie = await loginCookie(app, admin.email, admin.password);

    const first = await generateCode(adminCookie, user.id);
    const second = await generateCode(adminCookie, user.id);
    expect(second).not.toBe(first);
    // Slechts één (de nieuwste) geldige code blijft over.
    expect(await prisma.deviceLinkCode.count({ where: { userId: user.id } })).toBe(1);

    // De oude code werkt niet meer.
    const oldRes = await app.inject({
      method: 'POST',
      url: '/devices/link',
      payload: { code: first },
    });
    expect(oldRes.statusCode).toBe(400);
  });

  it('geeft zonder device-cookie 401 op /device/me', async () => {
    const res = await app.inject({ method: 'GET', url: '/device/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'DEVICE_NOT_LINKED' } });
  });

  it('geeft een device-token géén toegang tot beheerroutes (aparte auth-pijler)', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const user = await seedUser('Sanne', org);
    const adminCookie = await loginCookie(app, admin.email, admin.password);
    const code = await generateCode(adminCookie, user.id);

    const link = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
    const deviceCookie = deviceCookieHeader(link)!;

    // De device-cookie is geen sessie-cookie: beheerroutes blijven 401.
    const admins = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: deviceCookie },
    });
    expect(admins.statusCode).toBe(401);
  });

  it('is ADMIN-only voor het genereren van een koppelcode (caregiver → 403)', async () => {
    const org = await seedOrganization('Org');
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/device-code`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('weigert een koppelcode voor een gebruiker uit een andere organisatie met 403', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const userB = await seedUser('Gebruiker B', await seedOrganization('Org B'));
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${userB.id}/device-code`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await prisma.deviceLinkCode.count()).toBe(0);
  });
});
