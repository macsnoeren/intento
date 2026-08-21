import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  operatorOrganizationDetailSchema,
  operatorOrganizationListResponseSchema,
  operatorOrganizationSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedPlatformAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4, ADR-0011).
 *
 * De console is bewust de enige plek die door de tenant-grens heen kijkt, dus de tests draaien vooral
 * om de grens zelf: wie mag erbij (alleen een operator), wat komt eruit (beheermetadata, nooit
 * communicatie-inhoud of gebruikersnamen), en wat gebeurt er als een organisatie gestopt wordt
 * (login, lopende sessies en tablets moeten écht dicht). Plus: reguliere tenant-endpoints blijven
 * strikt gefilterd — dat is de belofte die deze taak niet mag breken.
 */
describe('platform-operatorconsole — /operator', () => {
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

  describe('toegang', () => {
    it('weigert zonder sessie met 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/operator/organizations' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
    });

    it('weigert een gewone tenant-ADMIN met 403 NOT_OPERATOR', async () => {
      const { email, password } = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_OPERATOR' } });
    });

    it('weigert een CAREGIVER met 403 NOT_OPERATOR', async () => {
      const { organizationId } = await seedAccount('admin@zorg.local', 'pw-zorg', 'ADMIN');
      const { email, password } = await seedAccount(
        'cg@zorg.local',
        'pw-cg',
        'CAREGIVER',
        organizationId,
      );
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_OPERATOR' } });
    });

    it('weigert een ADMIN in de platformorganisatie zónder operatorvlag met 403', async () => {
      // `isPlatform` alleen ontgrendelt worker-tokenbeheer (T5.8), niet de console: de vlag op het
      // account is een tweede, aparte voorwaarde.
      const { email, password } = await seedPlatformAccount('infra@intento.local', 'pw-infra');
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_OPERATOR' } });
    });

    it('weigert een operatorvlag buiten de platformorganisatie met 403 (dubbele voorwaarde)', async () => {
      // Een `isOperator`-account in een gewone tenant — bv. via een geïmporteerde of geknoeide rij.
      const { accountId, email, password } = await seedAccount(
        'nep-operator@familie.local',
        'pw-nep',
        'ADMIN',
      );
      await prisma.account.update({ where: { id: accountId }, data: { isOperator: true } });
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'NOT_OPERATOR' } });
    });

    it('weigert een operator die nog op een tijdelijk wachtwoord draait (T2.6-gate)', async () => {
      const { accountId, email, password } = await seedPlatformAccount(
        'ops@intento.local',
        'pw-ops',
        { isOperator: true },
      );
      const cookie = await loginCookie(app, email, password);
      await prisma.account.update({ where: { id: accountId }, data: { mustChangePassword: true } });

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
    });

    it('weigert elk operator-endpoint voor een gewone ADMIN (hele routetak dicht)', async () => {
      const { email, password } = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const cookie = await loginCookie(app, email, password);
      const target = await prisma.organization.create({ data: { name: 'Doel', type: 'care' } });

      const calls = [
        { method: 'GET' as const, url: '/operator/organizations' },
        { method: 'POST' as const, url: '/operator/organizations' },
        { method: 'GET' as const, url: `/operator/organizations/${target.id}` },
        { method: 'POST' as const, url: `/operator/organizations/${target.id}/deactivate` },
        { method: 'POST' as const, url: `/operator/organizations/${target.id}/activate` },
      ];

      for (const call of calls) {
        const res = await app.inject({ ...call, headers: { cookie }, payload: {} });
        expect(res.statusCode, `${call.method} ${call.url}`).toBe(403);
        expect(res.json()).toMatchObject({ error: { code: 'NOT_OPERATOR' } });
      }

      // En de gedeactiveerde organisatie is ook echt niet gedeactiveerd geraakt.
      const after = await prisma.organization.findUnique({ where: { id: target.id } });
      expect(after?.active).toBe(true);
    });
  });

  describe('organisaties beheren over tenants heen', () => {
    it('toont organisaties van álle tenants met aantallen', async () => {
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      const familie = await seedAccount('a@familie.local', 'pw-a', 'ADMIN');
      await seedUser('Sanne', familie.organizationId);
      await seedUser('Tim', familie.organizationId);
      const zorg = await seedAccount('b@zorg.local', 'pw-b', 'ADMIN');

      const cookie = await loginCookie(app, email, password);
      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const { organizations } = operatorOrganizationListResponseSchema.parse(res.json());
      const ids = organizations.map((organization) => organization.id);
      expect(ids).toContain(familie.organizationId);
      expect(ids).toContain(zorg.organizationId);

      const familieRow = organizations.find((o) => o.id === familie.organizationId);
      expect(familieRow?.userCount).toBe(2);
      expect(familieRow?.accountCount).toBe(1);
      expect(familieRow?.active).toBe(true);
    });

    it('maakt een organisatie aan (zonder accounts) en audit die met de operator als actor', async () => {
      const { accountId, email, password } = await seedPlatformAccount(
        'ops@intento.local',
        'pw-ops',
        { isOperator: true },
      );
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'POST',
        url: '/operator/organizations',
        headers: { cookie },
        payload: { name: 'Zorggroep Noord', type: 'care' },
      });

      expect(res.statusCode).toBe(201);
      const organization = operatorOrganizationSchema.parse(res.json());
      expect(organization.name).toBe('Zorggroep Noord');
      expect(organization.active).toBe(true);
      // Een nieuwe omgeving is nooit een platformorganisatie en krijgt geen accounts mee.
      expect(organization.isPlatform).toBe(false);
      expect(organization.accountCount).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'operator.organization.create', targetId: organization.id },
      });
      expect(audit?.accountId).toBe(accountId);
      // Platform-actie: geen tenant, zodat hij niet in de audit-lijst van een organisatie opduikt.
      expect(audit?.organizationId).toBeNull();
    });

    it('weigert een ongeldige organisatiesoort met 400', async () => {
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'POST',
        url: '/operator/organizations',
        headers: { cookie },
        payload: { name: 'Fout', type: 'schoolklas' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('toont in het detail accounts als metadata en gebruikers zónder naam', async () => {
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      const tenant = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const user = await seedUser('Sanne de Vries', tenant.organizationId);
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: `/operator/organizations/${tenant.organizationId}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const detail = operatorOrganizationDetailSchema.parse(res.json());
      expect(detail.accounts.map((account) => account.email)).toEqual(['admin@familie.local']);
      expect(detail.users.map((u) => u.id)).toEqual([user.id]);

      // Harde inhoudsgrens: geen gebruikersnaam en geen wachtwoordhash in de respons.
      expect(res.body).not.toContain('Sanne de Vries');
      expect(res.body).not.toContain('passwordHash');
      expect(res.body).not.toContain('$argon2');
    });

    it('geeft 404 voor een onbekende organisatie', async () => {
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'GET',
        url: '/operator/organizations/bestaat-niet',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: 'ORGANIZATION_NOT_FOUND' } });
    });

    it('beschermt de platformorganisatie tegen deactiveren', async () => {
      const { organizationId, email, password } = await seedPlatformAccount(
        'ops@intento.local',
        'pw-ops',
        { isOperator: true },
      );
      const cookie = await loginCookie(app, email, password);

      const res = await app.inject({
        method: 'POST',
        url: `/operator/organizations/${organizationId}/deactivate`,
        headers: { cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'PLATFORM_ORGANIZATION_PROTECTED' } });

      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      expect(organization?.active).toBe(true);
    });
  });

  describe('deactiveren stopt de omgeving echt', () => {
    async function seedOperatorCookie(): Promise<string> {
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      return loginCookie(app, email, password);
    }

    it('sluit een lopende sessie meteen buiten en laat opnieuw inloggen niet toe', async () => {
      const tenant = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const tenantCookie = await loginCookie(app, tenant.email, tenant.password);
      // Vóór deactivatie werkt de sessie gewoon.
      const before = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: { cookie: tenantCookie },
      });
      expect(before.statusCode).toBe(200);

      const operatorCookie = await seedOperatorCookie();
      const deactivated = await app.inject({
        method: 'POST',
        url: `/operator/organizations/${tenant.organizationId}/deactivate`,
        headers: { cookie: operatorCookie },
        payload: {},
      });
      expect(deactivated.statusCode).toBe(200);
      expect(operatorOrganizationSchema.parse(deactivated.json()).active).toBe(false);

      // Lopende sessie: direct dicht, niet pas als de sessie verloopt.
      const after = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: { cookie: tenantCookie },
      });
      expect(after.statusCode).toBe(403);
      expect(after.json()).toMatchObject({ error: { code: 'ORGANIZATION_SUSPENDED' } });

      // En opnieuw inloggen met correcte gegevens levert geen nieuwe sessie op.
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: tenant.email, password: tenant.password },
      });
      expect(login.statusCode).toBe(403);
      expect(login.json()).toMatchObject({ error: { code: 'ORGANIZATION_SUSPENDED' } });
    });

    it('sluit ook een gekoppelde tablet buiten (device-auth)', async () => {
      // Anders zou de gebruikersapp vrolijk doorpraten met de AI terwijl de omgeving gestopt is.
      const tenant = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const user = await seedUser('Sanne', tenant.organizationId);
      const tablet = await deviceCookie(app, user.id);
      const before = await app.inject({
        method: 'GET',
        url: '/conversation/pending',
        headers: { cookie: tablet },
      });
      expect(before.statusCode).toBe(200);

      const operatorCookie = await seedOperatorCookie();
      await app.inject({
        method: 'POST',
        url: `/operator/organizations/${tenant.organizationId}/deactivate`,
        headers: { cookie: operatorCookie },
        payload: {},
      });

      const after = await app.inject({
        method: 'GET',
        url: '/conversation/pending',
        headers: { cookie: tablet },
      });
      expect(after.statusCode).toBe(403);
      expect(after.json()).toMatchObject({ error: { code: 'ORGANIZATION_SUSPENDED' } });
    });

    it('zet een organisatie weer aan (idempotent) waarna inloggen weer werkt', async () => {
      const tenant = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const operatorCookie = await seedOperatorCookie();

      await app.inject({
        method: 'POST',
        url: `/operator/organizations/${tenant.organizationId}/deactivate`,
        headers: { cookie: operatorCookie },
        payload: {},
      });
      // Twee keer activeren: idempotent, de tweede keer verandert niets.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await app.inject({
          method: 'POST',
          url: `/operator/organizations/${tenant.organizationId}/activate`,
          headers: { cookie: operatorCookie },
          payload: {},
        });
        expect(res.statusCode).toBe(200);
        expect(operatorOrganizationSchema.parse(res.json()).active).toBe(true);
      }

      await expect(loginCookie(app, tenant.email, tenant.password)).resolves.toBeTruthy();
    });
  });

  describe('tenant-isolatie blijft intact', () => {
    it('geeft een operator géén cross-tenant toegang op de gewone tenant-endpoints', async () => {
      // De console is een aparte routetak; de operator blijft op `/users` gewoon een ADMIN van zijn
      // eigen (platform)organisatie en ziet dus niets van een andere tenant.
      const { email, password } = await seedPlatformAccount('ops@intento.local', 'pw-ops', {
        isOperator: true,
      });
      const tenant = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
      const foreignUser = await seedUser('Sanne', tenant.organizationId);
      const cookie = await loginCookie(app, email, password);

      const list = await app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(foreignUser.id);

      const direct = await app.inject({
        method: 'GET',
        url: `/users/${foreignUser.id}`,
        headers: { cookie },
      });
      expect(direct.statusCode).toBe(403);
    });
  });
});
