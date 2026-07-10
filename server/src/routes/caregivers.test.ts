import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { caregiverListResponseSchema } from '@intento/shared';
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
 * Begeleiders koppelen (T2.2, DESIGN §2, §8.2, FR-017).
 *
 * Dekt de koppel-/ontkoppelflow (ADMIN), de afgeleide toegangsregel (een CAREGIVER ziet
 * alléén gekoppelde gebruikers — niet-gekoppeld = 403) en de harde randen: rolcontrole en
 * tenant-isolatie (nooit een gebruiker of begeleider uit een andere organisatie raken).
 */
describe('begeleiders koppelen — /admin/users/:id/caregivers', () => {
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

  it('laat een ADMIN begeleiders koppelen en ontkoppelen (idempotent)', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, admin.email, admin.password);

    // Overzicht: begeleider bekend, nog niet gekoppeld.
    const before = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
    });
    expect(before.statusCode).toBe(200);
    expect(caregiverListResponseSchema.parse(before.json()).caregivers).toEqual([
      { accountId: caregiver.accountId, email: caregiver.email, linked: false },
    ]);

    // Koppelen.
    const link = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: caregiver.accountId, linked: true },
    });
    expect(link.statusCode).toBe(200);
    expect(caregiverListResponseSchema.parse(link.json()).caregivers[0]?.linked).toBe(true);
    expect(
      await prisma.caregiverAssignment.findUnique({
        where: { userId_accountId: { userId: user.id, accountId: caregiver.accountId } },
      }),
    ).not.toBeNull();

    // Nogmaals koppelen: idempotent, geen dubbele rij.
    await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: caregiver.accountId, linked: true },
    });
    expect(await prisma.caregiverAssignment.count({ where: { userId: user.id } })).toBe(1);

    // Ontkoppelen.
    const unlink = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: caregiver.accountId, linked: false },
    });
    expect(unlink.statusCode).toBe(200);
    expect(caregiverListResponseSchema.parse(unlink.json()).caregivers[0]?.linked).toBe(false);
    expect(await prisma.caregiverAssignment.count({ where: { userId: user.id } })).toBe(0);
  });

  it('toont in het overzicht alléén CAREGIVER-accounts van de eigen organisatie', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    await seedAccount('cg1@intento.local', 'pw', 'CAREGIVER', org);
    await seedAccount('cg2@intento.local', 'pw', 'CAREGIVER', org);
    // Ruis: een tweede admin (geen caregiver) en een caregiver in een andere organisatie.
    await seedAccount('admin2@intento.local', 'pw', 'ADMIN', org);
    await seedAccount(
      'cg-other@intento.local',
      'pw',
      'CAREGIVER',
      await seedOrganization('Andere'),
    );
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
    });
    const emails = caregiverListResponseSchema.parse(res.json()).caregivers.map((c) => c.email);
    expect(emails).toEqual(['cg1@intento.local', 'cg2@intento.local']);
  });

  it('weigert het koppelen van een account dat geen CAREGIVER is met 400', async () => {
    const org = await seedOrganization('Org');
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const notCaregiver = await seedAccount('user-acc@intento.local', 'pw', 'USER', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: notCaregiver.accountId, linked: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_A_CAREGIVER' } });
  });

  it('weigert het koppelen van een begeleider uit een andere organisatie met 403', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const foreignCaregiver = await seedAccount(
      'cg-foreign@intento.local',
      'pw',
      'CAREGIVER',
      await seedOrganization('Andere'),
    );
    const user = await seedUser('Sanne', admin.organizationId);
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: foreignCaregiver.accountId, linked: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('weigert het beheren van koppelingen voor een gebruiker uit een andere organisatie met 403', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const userB = await seedUser('Gebruiker B', await seedOrganization('Org B'));
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${userB.id}/caregivers`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('is ADMIN-only: caregiver mag koppelingen niet beheren (403)', async () => {
    const org = await seedOrganization('Org');
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: caregiver.accountId, linked: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  describe('afgeleide toegang: caregiver ziet alléén gekoppelde gebruikers', () => {
    it('geeft een niet-gekoppelde caregiver 403 op ophalen én instellingen', async () => {
      const org = await seedOrganization('Org');
      const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
      const user = await seedUser('Sanne', org);
      const cookie = await loginCookie(app, caregiver.email, caregiver.password);

      const get = await app.inject({
        method: 'GET',
        url: `/users/${user.id}`,
        headers: { cookie },
      });
      expect(get.statusCode).toBe(403);
      expect(get.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

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
        },
      });
      expect(put.statusCode).toBe(403);
      expect(put.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('geeft een gekoppelde caregiver wél toegang tot ophalen én instellingen', async () => {
      const org = await seedOrganization('Org');
      const caregiver = await seedAccount('cg@intento.local', 'pw-c', 'CAREGIVER', org);
      const user = await seedUser('Sanne', org);
      await linkCaregiver(caregiver.accountId, user.id);
      const cookie = await loginCookie(app, caregiver.email, caregiver.password);

      const get = await app.inject({
        method: 'GET',
        url: `/users/${user.id}`,
        headers: { cookie },
      });
      expect(get.statusCode).toBe(200);

      const put = await app.inject({
        method: 'PUT',
        url: `/users/${user.id}/settings`,
        headers: { cookie },
        payload: {
          iconsPerScreen: 6,
          showText: false,
          aiLearningEnabled: false,
          supportMode: true,
          contextIndicator: true,
        },
      });
      expect(put.statusCode).toBe(200);
    });

    it('laat een ADMIN elke gebruiker van de eigen organisatie zien zonder koppeling', async () => {
      const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
      const user = await seedUser('Sanne', admin.organizationId);
      const cookie = await loginCookie(app, admin.email, admin.password);

      const get = await app.inject({
        method: 'GET',
        url: `/users/${user.id}`,
        headers: { cookie },
      });
      expect(get.statusCode).toBe(200);
    });
  });
});
