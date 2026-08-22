import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { auditLogListResponseSchema } from '@intento/shared';
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
 * Audit-logging-tests (T8.2, DESIGN §9.4).
 *
 * Toont dat gevoelige acties (login, instellingen, context, export/import, beheer) **aantoonbaar**
 * worden gelogd, zonder communicatie-inhoud, en dat de inzage-lijst ADMIN-only en tenant-geïsoleerd is.
 */
describe('audit-logging — gevoelige acties', () => {
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

  it('logt een geslaagde login met actor en tenant', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    await loginCookie(app, admin.email, admin.password);

    const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('success');
    expect(rows[0].accountId).toBe(admin.accountId);
    expect(rows[0].organizationId).toBe(admin.organizationId);
  });

  it('logt een mislukte login als failure, zonder e-mailadres of tenant te lekken', async () => {
    await seedAccount('admin@intento.local', 'pw', 'ADMIN');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@intento.local', password: 'fout' },
    });
    expect(res.statusCode).toBe(401);

    const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('failure');
    expect(rows[0].accountId).toBeNull();
    expect(rows[0].organizationId).toBeNull();
    // Geen e-mailadres in het spoor (geen enumeratie), alleen een neutrale reden.
    const meta = rows[0].metadataJson ?? '';
    expect(meta).not.toContain('admin@intento.local');
    expect(meta).toContain('invalid_credentials');
  });

  it('logt instellingen aanpassen en verwijzing naar de gebruiker', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'PUT',
      url: `/users/${user.id}/settings`,
      headers: { cookie },
      payload: {
        iconsPerScreen: 6,
        showText: true,
        aiLearningEnabled: true,
        supportMode: false,
        contextIndicator: true,
        conversationStrategy: 'refine',
      },
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { action: 'user.settings.update' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe('user');
    expect(rows[0].targetId).toBe(user.id);
    expect(rows[0].accountId).toBe(admin.accountId);
  });

  it('logt persoonlijke context zonder de PII (naam/relatie) op te slaan in het spoor', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: { category: 'PERSON', name: 'Geheime Naam', relationship: 'dochter' },
    });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.auditLog.findMany({ where: { action: 'context.create' } });
    expect(rows).toHaveLength(1);
    const meta = rows[0].metadataJson ?? '';
    expect(meta).not.toContain('Geheime Naam');
    expect(meta).not.toContain('dochter');
    expect(meta).toContain('PERSON');
  });

  it('logt een profielexport', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/export`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { action: 'profile.export' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe(user.id);
  });

  it('toont de audit-lijst alleen aan ADMIN en tenant-geïsoleerd', async () => {
    // Org A: admin logt in (→ audit-regel) en vraagt de lijst op.
    const adminA = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookieA = await loginCookie(app, adminA.email, adminA.password);

    // Org B: aparte organisatie met eigen login-spoor.
    const orgB = await seedOrganization('Org B');
    const adminB = await seedAccount('b@intento.local', 'pw', 'ADMIN', orgB);
    await loginCookie(app, adminB.email, adminB.password);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const body = auditLogListResponseSchema.parse(res.json());

    // Alleen het eigen spoor (org A): geen enkele regel van een ander account.
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.accountId).toBe(adminA.accountId);
    }
    // De publieke vorm bevat geen IP (privacygevoelige herkomstdata blijft server-side).
    expect(body.entries[0]).not.toHaveProperty('ip');
  });

  it('weigert de audit-lijst voor een CAREGIVER met 403', async () => {
    const orgId = await seedOrganization();
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', orgId);
    const caregiver = await seedAccount('care@intento.local', 'pw', 'CAREGIVER', orgId);
    const user = await seedUser('Sanne', orgId);
    await linkCaregiver(caregiver.accountId, user.id);
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({ method: 'GET', url: '/admin/audit-logs', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
