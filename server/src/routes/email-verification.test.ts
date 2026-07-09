import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { verifyEmailResponseSchema, type RegisterRequest } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { MemoryMailTransport } from '../mail/transport.js';
import { resetAuthData, sessionCookieHeader, testEnv } from '../test/auth-helpers.js';

/**
 * Tests voor de e-mailverificatie-routes (T1.4): inwisselen via POST én GET, opnieuw versturen
 * (rate-limited, neutraal), en de verificatie-gate op gevoelige acties (gebruiker aanmaken).
 */

const registerBody: RegisterRequest = {
  organizationName: 'Familie Test',
  organizationType: 'family',
  adminName: 'Test Admin',
  email: 'admin@intento.local',
  password: 'sterk-wachtwoord-123',
};

/** Haalt het rauwe verificatietoken uit de laatst verstuurde mail (uit de `?token=`-URL). */
function tokenFromMail(mail: MemoryMailTransport): string {
  const text = mail.last()?.text ?? '';
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Geen verificatietoken in de mail gevonden');
  return match[1];
}

describe('email-verification routes', () => {
  let app: FastifyInstance;
  let mail: MemoryMailTransport;

  beforeEach(async () => {
    await resetAuthData();
    mail = new MemoryMailTransport();
    app = await buildApp({
      env: testEnv({
        REGISTER_RATE_LIMIT_MAX: '100',
        LOGIN_RATE_LIMIT_MAX: '100',
        RESEND_RATE_LIMIT_MAX: '100',
      }),
      mail,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function register(overrides: Partial<RegisterRequest> = {}) {
    return app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...registerBody, ...overrides },
    });
  }

  it('verifieert een geldig token via POST en maakt het account geverifieerd', async () => {
    await register();
    const token = tokenFromMail(mail);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = verifyEmailResponseSchema.parse(res.json());
    expect(body.verified).toBe(true);
    expect(body.account.emailVerified).toBe(true);

    const account = await prisma.account.findUnique({ where: { email: registerBody.email } });
    expect(account?.emailVerifiedAt).not.toBeNull();
  });

  it('verifieert ook via een directe GET-link (?token=)', async () => {
    await register();
    const token = tokenFromMail(mail);

    const res = await app.inject({
      method: 'GET',
      url: `/auth/verify-email?token=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(verifyEmailResponseSchema.parse(res.json()).verified).toBe(true);
  });

  it('weigert een gebruikt token de tweede keer (eenmalig)', async () => {
    await register();
    const token = tokenFromMail(mail);

    expect(
      (await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } }))
        .statusCode,
    ).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token },
    });
    expect(second.statusCode).toBe(400);
    expect((second.json().error as { code: string }).code).toBe('INVALID_VERIFICATION_TOKEN');
  });

  it('weigert een ongeldig/onbekend token met een neutrale 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'volstrekt-onbekend' },
    });
    expect(res.statusCode).toBe(400);
    const error = res.json().error as { code: string; message: string };
    expect(error.code).toBe('INVALID_VERIFICATION_TOKEN');
    // Lekt niet of het token/adres bestond.
    expect(error.message.toLowerCase()).not.toContain('bestaat');
  });

  it('stuurt bij resend een nieuwe mail voor een onbevestigd account en antwoordt neutraal', async () => {
    await register();
    expect(mail.sent).toHaveLength(1);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: registerBody.email },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { message: string }).message.length).toBeGreaterThan(0);
    // Een tweede mail is verstuurd; het nieuwe token werkt, het oude niet meer.
    expect(mail.sent).toHaveLength(2);
  });

  it('geeft bij resend voor een onbekend adres dezelfde neutrale respons zonder mail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: 'onbekend@intento.local' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { message: string }).message.length).toBeGreaterThan(0);
    // Geen mail verstuurd naar een onbekend adres.
    expect(mail.sent).toHaveLength(0);
  });

  it('stuurt geen mail bij resend voor een reeds geverifieerd account (maar antwoordt neutraal)', async () => {
    await register();
    const token = tokenFromMail(mail);
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } });
    const mailCountBefore = mail.sent.length;

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: { email: registerBody.email },
    });
    expect(res.statusCode).toBe(200);
    expect(mail.sent).toHaveLength(mailCountBefore); // geen nieuwe mail
  });

  it('blokkeert het aanmaken van een gebruiker tot het e-mailadres is geverifieerd (gate)', async () => {
    const reg = await register();
    const cookie = sessionCookieHeader(reg)!;

    // Ongeverifieerd: gebruiker aanmaken → 403 EMAIL_NOT_VERIFIED.
    const blocked = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie },
      payload: { name: 'Nieuwe gebruiker' },
    });
    expect(blocked.statusCode).toBe(403);
    expect((blocked.json().error as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');

    // Na verificatie mag het wél.
    const token = tokenFromMail(mail);
    await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } });

    const allowed = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie },
      payload: { name: 'Nieuwe gebruiker' },
    });
    expect(allowed.statusCode).toBe(201);
  });
});

describe('email-verification resend rate limiting', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({
      env: testEnv({ RESEND_RATE_LIMIT_MAX: '2' }),
      mail: new MemoryMailTransport(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('geeft 429 zodra de resend-rate-limit wordt overschreden', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-email/resend',
        payload: { email: 'iemand@intento.local' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 2).every((s) => s !== 429)).toBe(true);
  });
});
