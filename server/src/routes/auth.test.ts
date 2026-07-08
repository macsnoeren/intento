import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { resetAuthData, seedAccount, sessionCookieHeader, testEnv } from '../test/auth-helpers.js';

describe('auth-routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    // Ruime rate-limit zodat lockout-/logintests er niet tegenaan lopen; aparte test hieronder.
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', LOGIN_MAX_ATTEMPTS: '3' }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function login(email: string, password: string) {
    return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  }

  it('logt in met het juiste wachtwoord, zet een httpOnly-cookie en geeft het account terug', async () => {
    const { email, password, organizationId } = await seedAccount();

    const res = await login(email, password);

    expect(res.statusCode).toBe(200);
    const body = authResponseSchema.parse(res.json());
    expect(body.account.email).toBe(email.toLowerCase());
    expect(body.account.role).toBe('ADMIN');
    expect(body.account.organizationId).toBe(organizationId);

    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain('intento_session=');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    // Sessietoken staat gehasht in de db, niet als klare tekst in de cookie-waarde.
    const stored = await prisma.session.findFirst();
    expect(stored).not.toBeNull();
    expect(setCookie).not.toContain(stored?.tokenHash);
  });

  it('accepteert e-mail hoofdletter-ongevoelig', async () => {
    const { password } = await seedAccount('Admin@Intento.Local');
    const res = await login('ADMIN@intento.local', password);
    expect(res.statusCode).toBe(200);
  });

  it('weigert een fout wachtwoord met 401 (generieke code)', async () => {
    const { email } = await seedAccount();
    const res = await login(email, 'fout-wachtwoord');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('weigert een onbekende e-mail met dezelfde 401 (lekt geen bestaan)', async () => {
    const res = await login('niemand@intento.local', 'wat-dan-ook');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('valideert de body met zod (400 bij ongeldige e-mail)', async () => {
    const res = await login('geen-email', 'x');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('blokkeert het account na te veel mislukte pogingen (lockout → 423)', async () => {
    const { email, password } = await seedAccount();

    // LOGIN_MAX_ATTEMPTS = 3: drie mislukte pogingen triggeren de lockout.
    for (let i = 0; i < 3; i++) {
      const res = await login(email, 'fout');
      expect(res.statusCode).toBe(i < 2 ? 401 : 423);
    }

    // Zelfs met het JUISTE wachtwoord blijft het geblokkeerd tijdens de lockout.
    const locked = await login(email, password);
    expect(locked.statusCode).toBe(423);
    expect(locked.json()).toMatchObject({ error: { code: 'ACCOUNT_LOCKED' } });
  });

  it('herstelt de teller na een geslaagde login', async () => {
    const { email, password } = await seedAccount();

    await login(email, 'fout'); // 1 mislukt
    const ok = await login(email, password); // geslaagd → reset
    expect(ok.statusCode).toBe(200);

    const account = await prisma.account.findUnique({ where: { email: email.toLowerCase() } });
    expect(account?.failedLoginAttempts).toBe(0);
    expect(account?.lockedUntil).toBeNull();
  });

  it('geeft via /auth/me het ingelogde account terug en na logout 401', async () => {
    const { email, password } = await seedAccount();
    const loginRes = await login(email, password);
    const cookie = sessionCookieHeader(loginRes);
    expect(cookie).toBeDefined();

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(200);
    expect(authResponseSchema.parse(me.json()).account.email).toBe(email.toLowerCase());

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookie! },
    });
    expect(logout.statusCode).toBe(204);
    expect(await prisma.session.count()).toBe(0);

    const meAfter = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookie! },
    });
    expect(meAfter.statusCode).toBe(401);
  });

  it('weigert /auth/me zonder cookie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
  });

  it('negeert een geknoeide (ongeldig ondertekende) sessie-cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'intento_session=geknoeid.handtekening' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth-routes rate limiting', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '3' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('geeft 429 zodra de login-rate-limit wordt overschreden', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'iemand@intento.local', password: 'x' },
      });
      statuses.push(res.statusCode);
    }
    // Eerste 3 verzoeken komen door (401), daarna 429.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
  });
});
