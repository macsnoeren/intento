import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { changePasswordResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * Eigen wachtwoord wijzigen (T2.5, DESIGN §2, §6.2 Account, §9.4).
 *
 * De aanleiding is de begeleider uit T2.4: die logt in met een **tijdelijk** wachtwoord dat de
 * beheerder kent. Deze tests bewaken de drie eigenschappen die dat pas veilig maken:
 * her-authenticatie met het huidige wachtwoord, het intrekken van de **overige** sessies, en dat
 * er nergens een wachtwoord in klare tekst belandt (db noch audit-log).
 */
describe('POST /auth/password — eigen wachtwoord wijzigen', () => {
  let app: FastifyInstance;
  const NEW_PASSWORD = 'een nieuw sterk wachtwoord';

  beforeEach(async () => {
    await resetAuthData();
    // Ruime limieten: deze tests loggen meermaals in en doen meerdere wijzigpogingen. De
    // rate-limiting zelf heeft een eigen describe hieronder.
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', PASSWORD_CHANGE_RATE_LIMIT_MAX: '100' }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function changePassword(cookie: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: body,
      headers: { cookie },
    });
  }

  it('wisselt het wachtwoord: het nieuwe werkt, het oude wordt geweigerd', async () => {
    // Een begeleider met een tijdelijk wachtwoord (T2.4) — precies het scenario uit de taak.
    const { email, password } = await seedAccount(
      'begeleider@intento.local',
      'tijdelijk-wachtwoord-uit-t24',
      'CAREGIVER',
    );
    const cookie = await loginCookie(app, email, password);

    const res = await changePassword(cookie, {
      currentPassword: password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(changePasswordResponseSchema.parse(res.json()).revokedSessions).toBe(0);

    const oud = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(oud.statusCode).toBe(401);

    const nieuw = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: NEW_PASSWORD },
    });
    expect(nieuw.statusCode).toBe(200);
  });

  it('slaat het nieuwe wachtwoord alleen als argon2id-hash op', async () => {
    const { email, password, accountId } = await seedAccount();
    const before = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const cookie = await loginCookie(app, email, password);

    await changePassword(cookie, { currentPassword: password, newPassword: NEW_PASSWORD });

    const after = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(after.passwordHash).not.toContain(NEW_PASSWORD);
  });

  it('weigert een fout huidig wachtwoord met 401 en laat het wachtwoord ongemoeid', async () => {
    const { email, password, accountId } = await seedAccount();
    const cookie = await loginCookie(app, email, password);

    const res = await changePassword(cookie, {
      currentPassword: 'niet het juiste wachtwoord',
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CURRENT_PASSWORD' } });
    // Geen hint over het bestaan/de staat van andere accounts, en geen wachtwoord in de melding.
    expect(JSON.stringify(res.json())).not.toContain(NEW_PASSWORD);

    // Het oorspronkelijke wachtwoord werkt nog; het account is niet stilletjes gewijzigd.
    const nog = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(nog.statusCode).toBe(200);
    // En de sessies zijn niet ingetrokken bij een mislukte poging.
    expect(await prisma.session.count({ where: { accountId } })).toBeGreaterThan(0);
  });

  it('weigert zonder sessie met 401 (niemand wijzigt andermans wachtwoord)', async () => {
    const { password } = await seedAccount();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { currentPassword: password, newPassword: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
  });

  it('weigert een te zwak nieuw wachtwoord en hergebruik van het huidige (400)', async () => {
    const { email, password } = await seedAccount();
    const cookie = await loginCookie(app, email, password);

    const zwak = await changePassword(cookie, { currentPassword: password, newPassword: 'kort' });
    expect(zwak.statusCode).toBe(400);

    const zelfde = await changePassword(cookie, {
      currentPassword: password,
      newPassword: password,
    });
    expect(zelfde.statusCode).toBe(400);
  });

  it('trekt de overige sessies in en laat de huidige sessie geldig', async () => {
    const { email, password, accountId } = await seedAccount();
    // Twee andere apparaten die met hetzelfde (mogelijk gelekte) wachtwoord zijn ingelogd.
    const andereSessie = await loginCookie(app, email, password);
    await loginCookie(app, email, password);
    const huidige = await loginCookie(app, email, password);

    const res = await changePassword(huidige, {
      currentPassword: password,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(changePasswordResponseSchema.parse(res.json()).revokedSessions).toBe(2);
    expect(await prisma.session.count({ where: { accountId } })).toBe(1);

    // De sessie van het andere apparaat is dood…
    const anderNa = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: andereSessie },
    });
    expect(anderNa.statusCode).toBe(401);

    // …en de wijziger blijft gewoon ingelogd.
    const eigenNa = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: huidige },
    });
    expect(eigenNa.statusCode).toBe(200);
  });

  it('laat de sessies van een ánder account met rust', async () => {
    const { organizationId, email, password } = await seedAccount();
    const collega = await seedAccount(
      'collega@intento.local',
      'wachtwoord van de collega',
      'CAREGIVER',
      organizationId,
    );
    const collegaCookie = await loginCookie(app, collega.email, collega.password);
    const cookie = await loginCookie(app, email, password);

    await changePassword(cookie, { currentPassword: password, newPassword: NEW_PASSWORD });

    const na = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: collegaCookie },
    });
    expect(na.statusCode).toBe(200);
    // En het wachtwoord van de collega werkt nog.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: collega.email, password: collega.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('audit de wijziging (en de mislukte poging) zonder ooit een wachtwoord te loggen', async () => {
    const { email, password, accountId, organizationId } = await seedAccount();
    const cookie = await loginCookie(app, email, password);

    await changePassword(cookie, { currentPassword: 'fout', newPassword: NEW_PASSWORD });
    await changePassword(cookie, { currentPassword: password, newPassword: NEW_PASSWORD });

    const logs = await prisma.auditLog.findMany({
      where: { action: 'auth.password_change' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.outcome)).toEqual(['failure', 'success']);
    for (const log of logs) {
      expect(log.accountId).toBe(accountId);
      expect(log.organizationId).toBe(organizationId);
      expect(log.targetId).toBe(accountId);
      expect(log.metadataJson ?? '').not.toContain(NEW_PASSWORD);
      expect(log.metadataJson ?? '').not.toContain(password);
    }
  });
});

describe('POST /auth/password — rate limiting', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', PASSWORD_CHANGE_RATE_LIMIT_MAX: '2' }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('geeft 429 zodra de limiet op wachtwoordwijzigingen wordt overschreden', async () => {
    const { email, password } = await seedAccount();
    const cookie = await loginCookie(app, email, password);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers: { cookie },
        payload: { currentPassword: 'fout raden', newPassword: 'een nieuw sterk wachtwoord' },
      });
      statuses.push(res.statusCode);
    }
    // De eerste twee pogingen komen door (401), daarna dicht: geen ongelimiteerd raden van het
    // huidige wachtwoord vanaf een gekaapte sessie.
    expect(statuses.slice(0, 2).every((s) => s === 401)).toBe(true);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
