import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  accountListResponseSchema,
  authResponseSchema,
  caregiverListResponseSchema,
  createCaregiverResponseSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { MemoryMailTransport } from '../mail/transport.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
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

/**
 * Begeleider-accounts aanmaken (T2.4, DESIGN §2, §5.2, FR-017).
 *
 * `POST /admin/accounts` is de ontbrekende schakel onder T2.2: zonder CAREGIVER-accounts had de
 * koppelweergave niets te kiezen. De tests dekken de happy path (aanmaken → meteen koppelbaar),
 * de rol-/tenantgrenzen (401/403, rol altijd CAREGIVER ongeacht invoer, eigen organisatie) en de
 * beveiligingseisen (geen enumeratie, wachtwoord alleen gehasht at-rest, audit-spoor).
 */
describe('begeleider-accounts — POST /admin/accounts', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;

  beforeEach(async () => {
    await resetAuthData();
    mail = new MemoryMailTransport();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }), mail });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newCaregiver = { name: 'Sam de Begeleider', email: 'sam@intento.local' };

  async function adminCookie(): Promise<{ cookie: string; organizationId: string }> {
    const admin = await seedAccount('admin@intento.local', 'pw-admin', 'ADMIN');
    return {
      cookie: await loginCookie(app, admin.email, admin.password),
      organizationId: admin.organizationId,
    };
  }

  it('maakt een CAREGIVER in de eigen organisatie en geeft het tijdelijke wachtwoord één keer terug', async () => {
    const { cookie, organizationId } = await adminCookie();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });

    expect(res.statusCode).toBe(201);
    const body = createCaregiverResponseSchema.parse(res.json());
    expect(body.account.role).toBe('CAREGIVER');
    expect(body.account.organizationId).toBe(organizationId);
    expect(body.account.name).toBe(newCaregiver.name);
    expect(body.account.emailVerified).toBe(false);
    // Het tijdelijke wachtwoord is server-gegenereerd en sterk genoeg om ermee in te loggen.
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(12);

    // Het wachtwoord staat nergens plaintext: de db kent alleen de argon2id-hash.
    const stored = await prisma.account.findUnique({ where: { email: newCaregiver.email } });
    expect(stored?.passwordHash).not.toContain(body.temporaryPassword);
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);

    // …en het werkt: de nieuwe begeleider kan er direct mee inloggen.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: newCaregiver.email, password: body.temporaryPassword },
    });
    expect(login.statusCode).toBe(200);
    expect(authResponseSchema.parse(login.json()).account.role).toBe('CAREGIVER');
  });

  it('normaliseert de e-mail naar lowercase en verstuurt een verificatiemail', async () => {
    const { cookie } = await adminCookie();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: { ...newCaregiver, email: 'Sam@Intento.Local' },
    });

    expect(res.statusCode).toBe(201);
    expect(createCaregiverResponseSchema.parse(res.json()).account.email).toBe('sam@intento.local');
    expect(mail.sent).toHaveLength(1);
    expect(mail.last()?.to).toBe('sam@intento.local');
  });

  it('houdt de rol op CAREGIVER en de organisatie op die van de ADMIN, ongeacht de invoer', async () => {
    const { cookie, organizationId } = await adminCookie();
    const otherOrg = await seedOrganization('Andere organisatie');

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      // Poging tot privilege-escalatie + tenant-hopping via extra body-velden.
      payload: { ...newCaregiver, role: 'ADMIN', organizationId: otherOrg },
    });

    expect(res.statusCode).toBe(201);
    const { account } = createCaregiverResponseSchema.parse(res.json());
    expect(account.role).toBe('CAREGIVER');
    expect(account.organizationId).toBe(organizationId);

    const stored = await prisma.account.findUnique({ where: { id: account.id } });
    expect(stored?.role).toBe('CAREGIVER');
    expect(stored?.organizationId).toBe(organizationId);
  });

  it('levert een account op dat meteen aan een gebruiker gekoppeld kan worden (T2.2)', async () => {
    const { cookie, organizationId } = await adminCookie();
    const user = await seedUser('Kim', organizationId);

    const created = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });
    const { account } = createCaregiverResponseSchema.parse(created.json());

    // De koppelweergave toont het nieuwe account direct…
    const list = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
    });
    expect(caregiverListResponseSchema.parse(list.json()).caregivers).toEqual([
      { accountId: account.id, email: newCaregiver.email, linked: false },
    ]);

    // …en koppelen slaagt.
    const link = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: account.id, linked: true },
    });
    expect(link.statusCode).toBe(200);
    expect(caregiverListResponseSchema.parse(link.json()).caregivers[0]?.linked).toBe(true);
  });

  it('weigert zonder sessie met 401 en een CAREGIVER met 403', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      payload: newCaregiver,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });

    const caregiver = await seedAccount('care@intento.local', 'pw-care', 'CAREGIVER');
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    // Geen van beide pogingen heeft een account achtergelaten.
    expect(await prisma.account.count({ where: { email: newCaregiver.email } })).toBe(0);
  });

  it('eist een geverifieerd e-mailadres van de ADMIN (T1.4-gate)', async () => {
    const admin = await seedAccount('nieuw@intento.local', 'pw-nieuw', 'ADMIN', undefined, {
      emailVerified: false,
    });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'EMAIL_NOT_VERIFIED' } });
  });

  it('weigert een bestaand e-mailadres zonder te lekken dat het bestaat', async () => {
    const { cookie } = await adminCookie();
    // Het adres bestaat al in een *andere* organisatie; de melding mag dat niet verraden.
    const otherOrg = await seedOrganization('Andere organisatie');
    await seedAccount(newCaregiver.email, 'pw-bestaand', 'ADMIN', otherOrg);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ACCOUNT_CREATE_FAILED');
    expect(body.error.message).not.toContain(newCaregiver.email);
    expect(body.error.message.toLowerCase()).not.toContain('bestaat');
  });

  it('weigert ongeldige invoer met 400', async () => {
    const { cookie } = await adminCookie();
    for (const payload of [
      { name: '', email: 'sam@intento.local' },
      { name: 'Sam', email: 'geen-adres' },
      {},
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/accounts',
        headers: { cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('legt het aanmaken vast in het audit-log (zonder wachtwoord)', async () => {
    const { cookie, organizationId } = await adminCookie();

    const res = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });
    const { account, temporaryPassword } = createCaregiverResponseSchema.parse(res.json());

    const entry = await prisma.auditLog.findFirst({ where: { action: 'account.create' } });
    expect(entry).toMatchObject({
      organizationId,
      targetType: 'account',
      targetId: account.id,
      outcome: 'success',
    });
    expect(entry?.metadataJson ?? '').not.toContain(temporaryPassword);
    expect(entry?.metadataJson ?? '').toContain('CAREGIVER');
  });

  it('toont de nieuwe begeleider in de accountlijst van de eigen organisatie, niet in die van een andere', async () => {
    const { cookie } = await adminCookie();
    await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      headers: { cookie },
      payload: newCaregiver,
    });

    const other = await seedAccount('admin.b@intento.local', 'pw-b', 'ADMIN');
    const cookieB = await loginCookie(app, other.email, other.password);
    const listB = await app.inject({
      method: 'GET',
      url: '/admin/accounts',
      headers: { cookie: cookieB },
    });
    const emailsB = accountListResponseSchema.parse(listB.json()).accounts.map((a) => a.email);
    expect(emailsB).not.toContain(newCaregiver.email);

    const listA = await app.inject({ method: 'GET', url: '/admin/accounts', headers: { cookie } });
    const emailsA = accountListResponseSchema.parse(listA.json()).accounts.map((a) => a.email);
    expect(emailsA).toContain(newCaregiver.email);
  });
});
