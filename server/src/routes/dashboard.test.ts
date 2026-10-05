import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { dashboardResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Beheerdashboard. Het overzicht is **tenant-gefilterd** (een admin ziet nooit de gebruikers of
 * begeleiders van een andere organisatie). Autorisatie: 401 ongeauthenticeerd, 403 voor een CAREGIVER.
 */
describe('beheerdashboard — /admin/dashboard', () => {
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

  it('weigert zonder sessie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('weigert een CAREGIVER met 403', async () => {
    const cg = await seedAccount('cg@intento.local', 'pw-cg', 'CAREGIVER');
    const cookie = await loginCookie(app, cg.email, cg.password);
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('geeft een tenant-gefilterd overzicht met tellingen', async () => {
    const admin = await seedAccount('admin@a.local', 'pw-a', 'ADMIN');
    const orgA = admin.organizationId;
    // Begeleider in dezelfde organisatie.
    await seedAccount('cg@a.local', 'pw-cg', 'CAREGIVER', orgA);
    // Twee gebruikers, waarvan één inactief.
    await seedUser('Sanne', orgA);
    const inactive = await seedUser('Tom', orgA);
    await prisma.user.update({ where: { id: inactive.id }, data: { active: false } });

    // Een ander organisatie met eigen gebruiker + begeleider — mag NIET meetellen.
    const other = await seedAccount('admin@b.local', 'pw-b', 'ADMIN');
    await seedAccount('cg@b.local', 'pw-cg', 'CAREGIVER', other.organizationId);
    await seedUser('Vreemde', other.organizationId);

    const cookie = await loginCookie(app, admin.email, admin.password);
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const dashboard = dashboardResponseSchema.parse(res.json());

    expect(dashboard.users).toEqual({ total: 2, active: 1 });
    expect(dashboard.caregivers).toEqual({ total: 1 });
    // Geen data van de andere organisatie.
    expect(res.body).not.toContain('Vreemde');
  });
});
