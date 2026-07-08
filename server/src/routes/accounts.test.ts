import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountListResponseSchema, authResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Autorisatie- en tenant-isolatietests (T1.2, DESIGN §2, §9.4).
 *
 * Dekt de twee kanten van de middleware op een representatief beschermd endpoint
 * (`GET /admin/accounts`): rolcontrole (401/403) en organisatie-isolatie (org A ziet nooit
 * data van org B). De isolatietest voor het bestaande `/auth/me` staat onderaan.
 */
describe('autorisatie en tenant-isolatie — /admin/accounts', () => {
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

  it('weigert zonder sessie met 401 (consistente foutstructuur)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/accounts' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
  });

  it('weigert een CAREGIVER met 403 FORBIDDEN', async () => {
    const { email, password } = await seedAccount(
      'caregiver@intento.local',
      'pw-caregiver',
      'CAREGIVER',
    );
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({ method: 'GET', url: '/admin/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('weigert een USER met 403 FORBIDDEN', async () => {
    const { email, password } = await seedAccount('user@intento.local', 'pw-user', 'USER');
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({ method: 'GET', url: '/admin/accounts', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('laat een ADMIN alléén accounts van de eigen organisatie zien (tenant-isolatie)', async () => {
    // Organisatie A: admin + een caregiver.
    const orgA = await seedOrganization('Org A');
    const adminA = await seedAccount('admin.a@intento.local', 'pw-a', 'ADMIN', orgA);
    await seedAccount('caregiver.a@intento.local', 'pw-a2', 'CAREGIVER', orgA);

    // Organisatie B: een eigen admin die org A nooit mag zien.
    const orgB = await seedOrganization('Org B');
    await seedAccount('admin.b@intento.local', 'pw-b', 'ADMIN', orgB);

    const cookieA = await loginCookie(app, adminA.email, adminA.password);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/accounts',
      headers: { cookie: cookieA },
    });

    expect(res.statusCode).toBe(200);
    const body = accountListResponseSchema.parse(res.json());
    const emails = body.accounts.map((a) => a.email).sort();
    expect(emails).toEqual(['admin.a@intento.local', 'caregiver.a@intento.local']);
    // Geen enkel account uit organisatie B en geen enkel account buiten org A.
    expect(body.accounts.every((a) => a.organizationId === orgA)).toBe(true);
  });
});

describe('tenant-isolatie — /auth/me', () => {
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

  it('geeft elk account alleen zijn eigen organisatie-context terug', async () => {
    const a = await seedAccount('me.a@intento.local', 'pw-a', 'ADMIN');
    const b = await seedAccount('me.b@intento.local', 'pw-b', 'ADMIN');

    const cookieA = await loginCookie(app, a.email, a.password);
    const meA = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookieA } });
    const bodyA = authResponseSchema.parse(meA.json());
    expect(bodyA.account.organizationId).toBe(a.organizationId);
    expect(bodyA.account.organizationId).not.toBe(b.organizationId);
  });
});
