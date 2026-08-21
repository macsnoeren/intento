import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  accountListResponseSchema,
  authResponseSchema,
  caregiverListResponseSchema,
  createCaregiverResponseSchema,
  resetAccountPasswordResponseSchema,
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

    // De koppelweergave toont het nieuwe account direct… (naast de beheerder zelf, die sinds T9.1
    // ook begeleider mag zijn).
    const list = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
    });
    expect(
      caregiverListResponseSchema
        .parse(list.json())
        .caregivers.find((c) => c.accountId === account.id),
    ).toEqual({
      accountId: account.id,
      email: newCaregiver.email,
      role: 'CAREGIVER',
      linked: false,
    });

    // …en koppelen slaagt.
    const link = await app.inject({
      method: 'POST',
      url: `/admin/users/${user.id}/caregivers`,
      headers: { cookie },
      payload: { accountId: account.id, linked: true },
    });
    expect(link.statusCode).toBe(200);
    expect(
      caregiverListResponseSchema
        .parse(link.json())
        .caregivers.find((c) => c.accountId === account.id)?.linked,
    ).toBe(true);
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

/**
 * Nieuw tijdelijk wachtwoord uitgeven (T2.7, DESIGN §2, §6.2 Account, §9.4).
 *
 * Sinds de harde gate van T2.6 zit een begeleider die zijn tijdelijke wachtwoord kwijt is volledig
 * klem: inloggen lukt niet en zonder sessie is `POST /auth/password` onbereikbaar. Deze tests dekken
 * de weg terug (`POST /admin/accounts/:id/password`): het oude wachtwoord en lopende sessies zijn
 * daarna dood, het account staat weer op de tijdelijk-wachtwoord-gate, en de rol-/tenantgrenzen en
 * het audit-spoor kloppen.
 */
describe('nieuw tijdelijk wachtwoord — POST /admin/accounts/:id/password', () => {
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

  /** Beheerder + een begeleider in dezelfde organisatie; de begeleider is het doelwit. */
  async function seedOrgWithCaregiver(): Promise<{
    cookie: string;
    adminId: string;
    organizationId: string;
    caregiver: { accountId: string; email: string; password: string };
  }> {
    const admin = await seedAccount('admin@intento.local', 'pw-admin', 'ADMIN');
    const caregiver = await seedAccount(
      'care@intento.local',
      'oud-tijdelijk-wachtwoord',
      'CAREGIVER',
      admin.organizationId,
    );
    return {
      cookie: await loginCookie(app, admin.email, admin.password),
      adminId: admin.accountId,
      organizationId: admin.organizationId,
      caregiver,
    };
  }

  it('zet een nieuw tijdelijk wachtwoord: het oude werkt niet meer, het nieuwe wel', async () => {
    const { cookie, caregiver } = await seedOrgWithCaregiver();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = resetAccountPasswordResponseSchema.parse(res.json());
    expect(body.account.id).toBe(caregiver.accountId);
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(body.temporaryPassword).not.toBe(caregiver.password);

    // Alleen de hash staat in de db — het wachtwoord is daarna niet meer op te vragen.
    const stored = await prisma.account.findUnique({ where: { id: caregiver.accountId } });
    expect(stored?.passwordHash).not.toContain(body.temporaryPassword);
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);

    const oud = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: caregiver.email, password: caregiver.password },
    });
    expect(oud.statusCode).toBe(401);

    const nieuw = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: caregiver.email, password: body.temporaryPassword },
    });
    expect(nieuw.statusCode).toBe(200);
  });

  it('markeert het account weer als tijdelijk wachtwoord en zet het op het blokkerende scherm', async () => {
    const { cookie, caregiver } = await seedOrgWithCaregiver();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie },
    });
    const body = resetAccountPasswordResponseSchema.parse(res.json());
    expect(body.account.mustChangePassword).toBe(true);

    // De markering staat ook in de accountlijst van de beheerder (T2.6-weergave).
    const list = await app.inject({ method: 'GET', url: '/admin/accounts', headers: { cookie } });
    const listed = accountListResponseSchema
      .parse(list.json())
      .accounts.find((a) => a.id === caregiver.accountId);
    expect(listed?.mustChangePassword).toBe(true);

    // …en de T2.6-gate staat weer aan: alleen /auth/me en /auth/password mogen.
    const cookieCare = await loginCookie(app, caregiver.email, body.temporaryPassword);
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieCare },
    });
    expect(me.statusCode).toBe(200);
    expect(authResponseSchema.parse(me.json()).account.mustChangePassword).toBe(true);

    // Een route die een CAREGIVER normaal wél mag (vraagmodus, T7.1), zodat de weigering
    // aantoonbaar van de gate komt en niet van de rolcontrole.
    const geblokkeerd = await app.inject({
      method: 'GET',
      url: '/question/users',
      headers: { cookie: cookieCare },
    });
    expect(geblokkeerd.statusCode).toBe(403);
    expect(geblokkeerd.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });

    // Zelf een wachtwoord kiezen mag wél — en heft de markering weer op.
    const change = await app.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie: cookieCare },
      payload: {
        currentPassword: body.temporaryPassword,
        newPassword: 'zelfgekozen-wachtwoord-2026',
      },
    });
    expect(change.statusCode).toBe(200);
    const na = await prisma.account.findUnique({ where: { id: caregiver.accountId } });
    expect(na?.mustChangePassword).toBe(false);
  });

  it('trekt alle lopende sessies van het doelaccount in', async () => {
    const { cookie, caregiver } = await seedOrgWithCaregiver();
    // De begeleider staat op twee apparaten ingelogd met het oude wachtwoord.
    const cookieA = await loginCookie(app, caregiver.email, caregiver.password);
    const cookieB = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie },
    });
    expect(resetAccountPasswordResponseSchema.parse(res.json()).revokedSessions).toBe(2);

    for (const dood of [cookieA, cookieB]) {
      const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: dood } });
      expect(me.statusCode).toBe(401);
    }
    expect(await prisma.session.count({ where: { accountId: caregiver.accountId } })).toBe(0);

    // De sessie van de beheerder zelf blijft gewoon geldig.
    const adminMe = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(adminMe.statusCode).toBe(200);
  });

  it('haalt een door de lockout buitengesloten account weer vlot', async () => {
    const { cookie, caregiver } = await seedOrgWithCaregiver();
    await prisma.account.update({
      where: { id: caregiver.accountId },
      data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie },
    });
    const { temporaryPassword } = resetAccountPasswordResponseSchema.parse(res.json());

    const stored = await prisma.account.findUnique({ where: { id: caregiver.accountId } });
    expect(stored?.failedLoginAttempts).toBe(0);
    expect(stored?.lockedUntil).toBeNull();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: caregiver.email, password: temporaryPassword },
    });
    expect(login.statusCode).toBe(200);
  });

  it('weigert het eigen account (dat loopt via POST /auth/password)', async () => {
    const { cookie, adminId } = await seedOrgWithCaregiver();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${adminId}/password`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'CANNOT_RESET_OWN_PASSWORD' } });

    // De beheerder kan gewoon door: zijn wachtwoord en sessie zijn ongemoeid.
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('weigert een account uit een andere organisatie met 403 (tenant-isolatie)', async () => {
    const { cookie } = await seedOrgWithCaregiver();
    const andere = await seedAccount('care.b@intento.local', 'pw-b', 'CAREGIVER');
    const hashVoor = (await prisma.account.findUnique({ where: { id: andere.accountId } }))
      ?.passwordHash;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${andere.accountId}/password`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    // Het account van de andere organisatie is onaangeroerd gebleven.
    const na = await prisma.account.findUnique({ where: { id: andere.accountId } });
    expect(na?.passwordHash).toBe(hashVoor);
    expect(na?.mustChangePassword).toBe(false);

    // …en een niet-bestaand id geeft exact dezelfde fout (geen enumeratie).
    const onbekend = await app.inject({
      method: 'POST',
      url: '/admin/accounts/bestaat-niet/password',
      headers: { cookie },
    });
    expect(onbekend.statusCode).toBe(403);
    expect(onbekend.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('weigert zonder sessie met 401 en een CAREGIVER met 403', async () => {
    const { caregiver, organizationId } = await seedOrgWithCaregiver();
    const collega = await seedAccount(
      'care2@intento.local',
      'pw-care2',
      'CAREGIVER',
      organizationId,
    );

    const anoniem = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
    });
    expect(anoniem.statusCode).toBe(401);
    expect(anoniem.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });

    const cookieCare = await loginCookie(app, collega.email, collega.password);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie: cookieCare },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });

    // Geen van beide pogingen heeft het doelaccount aangeraakt.
    const doel = await prisma.account.findUnique({ where: { id: caregiver.accountId } });
    expect(doel?.mustChangePassword).toBe(false);
  });

  it('eist een geverifieerd e-mailadres van de ADMIN (T1.4-gate)', async () => {
    const admin = await seedAccount('nieuw@intento.local', 'pw-nieuw', 'ADMIN', undefined, {
      emailVerified: false,
    });
    const doel = await seedAccount(
      'care.c@intento.local',
      'pw-c',
      'CAREGIVER',
      admin.organizationId,
    );
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${doel.accountId}/password`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'EMAIL_NOT_VERIFIED' } });
  });

  it('legt de uitgifte vast in het audit-log (zonder wachtwoord)', async () => {
    const { cookie, caregiver, organizationId } = await seedOrgWithCaregiver();

    const res = await app.inject({
      method: 'POST',
      url: `/admin/accounts/${caregiver.accountId}/password`,
      headers: { cookie },
    });
    const { temporaryPassword } = resetAccountPasswordResponseSchema.parse(res.json());

    const entry = await prisma.auditLog.findFirst({ where: { action: 'account.password_reset' } });
    expect(entry).toMatchObject({
      organizationId,
      targetType: 'account',
      targetId: caregiver.accountId,
      outcome: 'success',
    });
    expect(entry?.metadataJson ?? '').not.toContain(temporaryPassword);
  });
});
