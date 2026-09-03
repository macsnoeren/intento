import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authResponseSchema, type RegisterRequest } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { MemoryMailTransport } from '../mail/transport.js';
import { resetAuthData, seedAccount, sessionCookieHeader, testEnv } from '../test/auth-helpers.js';

/**
 * Tests voor de zelfaanmelding (T1.3, `POST /auth/register`): een nieuwe bezoeker maakt in één
 * transactie een organisatie + eerste ADMIN-account en is meteen ingelogd. Dekt de happy path,
 * de veiligheidseisen (geen account-enumeratie, wachtwoordsterkte, rate limiting) en de
 * tenant-isolatie van de nieuwe organisatie.
 */

const validBody: RegisterRequest = {
  organizationName: 'Familie De Vries',
  organizationType: 'family',
  adminName: 'Kim de Vries',
  email: 'kim@intento.local',
  password: 'sterk-wachtwoord-123',
};

describe('register-routes', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;

  beforeEach(async () => {
    await resetAuthData();
    mail = new MemoryMailTransport();
    // Ruime rate-limit zodat de functionele tests er niet tegenaan lopen (aparte test hieronder).
    app = await buildApp({
      env: testEnv({ REGISTER_RATE_LIMIT_MAX: '100', LOGIN_RATE_LIMIT_MAX: '100' }),
      mail,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function register(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/auth/register', payload: body });
  }

  it('geeft de eerste aanmelding standaard GEEN platformrol', async () => {
    // De vlag staat uit tenzij je hem aanzet, en zelfaanmelding is publiek: zonder deze stand zou
    // op elke verse installatie de zwaarste rol van het platform zijn voor wie hem als eerste
    // opeist.
    const res = await register(validBody);

    expect(res.statusCode).toBe(201);
    const body = authResponseSchema.parse(res.json());
    expect(body.account.isOperator).toBe(false);
    const org = await prisma.organization.findUnique({
      where: { id: body.account.organizationId },
      select: { isPlatform: true },
    });
    expect(org?.isPlatform).toBe(false);
  });

  describe('met BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR aan', () => {
    beforeEach(async () => {
      await app.close();
      await resetAuthData();
      app = await buildApp({
        env: testEnv({
          REGISTER_RATE_LIMIT_MAX: '100',
          LOGIN_RATE_LIMIT_MAX: '100',
          BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR: 'true',
        }),
        mail,
      });
    });

    it('maakt van de allereerste aanmelding een werkende platform-operator', async () => {
      const res = await register(validBody);
      expect(res.statusCode).toBe(201);
      const body = authResponseSchema.parse(res.json());

      // Beide helften van de dubbele voorwaarde uit `auth/operator.ts` — één ervan alleen levert
      // een account op dat operator heet en het niet is.
      expect(body.account.isOperator).toBe(true);
      const org = await prisma.organization.findUnique({
        where: { id: body.account.organizationId },
        select: { isPlatform: true },
      });
      expect(org?.isPlatform).toBe(true);

      // En dan de assertie die er echt toe doet: komt hij de console ook binnen? Twee booleans in
      // een tabel zeggen niets als de guard ze anders leest. E-mail eerst bevestigen, want de
      // operatorguard blokkeert een onbevestigd adres — juist hier.
      await prisma.account.update({
        where: { id: body.account.id },
        data: { emailVerifiedAt: new Date() },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: validBody.email, password: validBody.password },
      });
      const console_ = await app.inject({
        method: 'GET',
        url: '/operator/organizations',
        headers: { cookie: sessionCookieHeader(login) ?? '' },
      });
      expect(console_.statusCode).toBe(200);

      // Terug te vinden zijn hoort erbij: er komt geen menselijke handeling aan te pas, dus dit is
      // het enige spoor dat de zwaarste rol van het platform is uitgedeeld.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'auth.register', accountId: body.account.id },
        select: { metadataJson: true },
      });
      expect(audit?.metadataJson).toContain('grantedOperator');
    });

    it('geeft de TWEEDE aanmelding niets — de vlag ontwapent zichzelf', async () => {
      await register(validBody);

      const second = await register({
        ...validBody,
        email: 'tweede@intento.local',
        organizationName: 'Familie Jansen',
      });
      expect(second.statusCode).toBe(201);
      const body = authResponseSchema.parse(second.json());
      expect(body.account.isOperator).toBe(false);

      const org = await prisma.organization.findUnique({
        where: { id: body.account.organizationId },
        select: { isPlatform: true },
      });
      expect(org?.isPlatform).toBe(false);

      // En er is er precies één, niet twee.
      expect(await prisma.organization.count({ where: { isPlatform: true } })).toBe(1);
    });

    it('doet niets meer zodra er al een account bestaat, ook niet in een lege organisatie', async () => {
      await seedAccount('bestaand@intento.local');

      const res = await register(validBody);
      expect(res.statusCode).toBe(201);
      expect(authResponseSchema.parse(res.json()).account.isOperator).toBe(false);
    });
  });

  it('maakt een organisatie + admin, zet een sessie-cookie en logt meteen in', async () => {
    const res = await register(validBody);

    expect(res.statusCode).toBe(201);
    const body = authResponseSchema.parse(res.json());
    expect(body.account.email).toBe(validBody.email);
    expect(body.account.role).toBe('ADMIN');

    // Organisatie is aangemaakt met het gekozen type; account hangt eronder met de admin-naam.
    const org = await prisma.organization.findUnique({
      where: { id: body.account.organizationId },
    });
    expect(org?.name).toBe(validBody.organizationName);
    expect(org?.type).toBe('family');
    const account = await prisma.account.findUnique({ where: { email: validBody.email } });
    expect(account?.name).toBe(validBody.adminName);
    expect(account?.role).toBe('ADMIN');
    // Wachtwoord staat als argon2-hash, nooit plaintext.
    expect(account?.passwordHash).not.toContain(validBody.password);
    expect(account?.passwordHash.startsWith('$argon2')).toBe(true);

    // Meteen ingelogd: de cookie geeft toegang tot /auth/me.
    const cookie = sessionCookieHeader(res);
    expect(cookie).toBeDefined();
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(200);
    expect(authResponseSchema.parse(me.json()).account.email).toBe(validBody.email);

    // Sessietoken staat gehasht in de db, niet plaintext in de cookie.
    const stored = await prisma.session.findFirst();
    expect(stored).not.toBeNull();
    expect(cookie).not.toContain(stored?.tokenHash);

    // Nieuw account is nog niet geverifieerd; er is een verificatiemail verstuurd (T1.4).
    expect(body.account.emailVerified).toBe(false);
    expect(mail.sent).toHaveLength(1);
    expect(mail.last()?.to).toBe(validBody.email);
    // Het token staat gehasht in de db, nooit plaintext in de verzonden mail.
    const tokenRow = await prisma.emailVerificationToken.findFirst();
    expect(tokenRow).not.toBeNull();
    expect(mail.last()?.text).not.toContain(tokenRow?.tokenHash);
  });

  it('normaliseert de e-mail naar lowercase', async () => {
    const res = await register({ ...validBody, email: 'Kim@Intento.Local' });
    expect(res.statusCode).toBe(201);
    expect(authResponseSchema.parse(res.json()).account.email).toBe('kim@intento.local');
  });

  it('weigert een tweede registratie met hetzelfde e-mailadres zonder te lekken', async () => {
    const first = await register(validBody);
    expect(first.statusCode).toBe(201);

    // Zelfde e-mail (andere organisatie): geweigerd met een generieke melding.
    const second = await register({ ...validBody, organizationName: 'Andere familie' });
    expect(second.statusCode).toBe(409);
    const error = second.json().error as { code: string; message: string };
    expect(error.code).toBe('REGISTRATION_FAILED');
    // Lekt niet of het adres bestaat en herhaalt het e-mailadres niet in de melding.
    expect(error.message.toLowerCase()).not.toContain('bestaat');
    expect(error.message).not.toContain(validBody.email);

    // De mislukte tweede poging heeft geen tweede organisatie achtergelaten (transactie teruggerold).
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });

  it('weigert een reeds bestaand e-mailadres van een ander account net zo generiek', async () => {
    await seedAccount(validBody.email);
    const res = await register(validBody);
    expect(res.statusCode).toBe(409);
    expect((res.json().error as { code: string }).code).toBe('REGISTRATION_FAILED');
  });

  it('weigert een ongeldig organisatietype met 400', async () => {
    const res = await register({ ...validBody, organizationType: 'bedrijf' });
    expect(res.statusCode).toBe(400);
    expect((res.json().error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(await prisma.organization.count()).toBe(0);
  });

  it('weigert een te zwak wachtwoord met 400', async () => {
    const res = await register({ ...validBody, password: 'kort' });
    expect(res.statusCode).toBe(400);
    expect((res.json().error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(await prisma.account.count()).toBe(0);
  });

  it('weigert een ongeldig e-mailadres met 400', async () => {
    const res = await register({ ...validBody, email: 'geen-email' });
    expect(res.statusCode).toBe(400);
  });

  it('isoleert de nieuwe organisatie van bestaande organisaties (tenant-isolatie)', async () => {
    // Bestaande organisatie met een account en gebruiker.
    const other = await seedAccount('bestaand@intento.local');
    await prisma.user.create({
      data: { name: 'Bestaande gebruiker', organizationId: other.organizationId },
    });

    const res = await register(validBody);
    expect(res.statusCode).toBe(201);
    const cookie = sessionCookieHeader(res)!;

    // De verse admin ziet in zijn eigen (lege) organisatie geen gebruikers van de andere org.
    const users = await app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });
    expect(users.statusCode).toBe(200);
    expect((users.json() as { users: unknown[] }).users).toHaveLength(0);

    const accounts = await app.inject({
      method: 'GET',
      url: '/admin/accounts',
      headers: { cookie },
    });
    expect(accounts.statusCode).toBe(200);
    // Alleen het eigen admin-account, niet dat van de andere organisatie.
    expect((accounts.json() as { accounts: unknown[] }).accounts).toHaveLength(1);
  });
});

describe('register-routes rate limiting', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({
      env: testEnv({ REGISTER_RATE_LIMIT_MAX: '3' }),
      mail: new MemoryMailTransport(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('geeft 429 zodra de registratie-rate-limit wordt overschreden', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          organizationName: `Org ${i}`,
          organizationType: 'family',
          adminName: 'Admin',
          email: `admin${i}@intento.local`,
          password: 'sterk-wachtwoord-123',
        },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
  });
});
