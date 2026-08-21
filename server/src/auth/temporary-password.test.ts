import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { accountListResponseSchema, authResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * Tijdelijk-wachtwoord-markering en -gate (T2.6, DESIGN §2, §6.2 Account, §9.4).
 *
 * Een begeleider die het tijdelijke wachtwoord uit T2.4 nooit vervangt, blijft draaien op een
 * wachtwoord dat zijn beheerder kent — het account is dan feitelijk van twee mensen. Deze tests
 * bewaken de hele keten: het account wordt bij aanmaken **gemarkeerd**, de beheerder ziet die
 * markering in zijn accountlijst, de gate laat de houder alléén zijn eigen account bekijken en
 * zijn wachtwoord wijzigen, en na dat wijzigen verdwijnt zowel de markering als de gate.
 */
describe('tijdelijk wachtwoord — markering en gate', () => {
  let app: FastifyInstance;
  const NEW_PASSWORD = 'een zelfgekozen sterk wachtwoord';

  beforeEach(async () => {
    await resetAuthData();
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

  /**
   * Doorloopt de echte flow: een ADMIN maakt een begeleider aan (T2.4) en die logt in met het
   * server-gegenereerde wachtwoord. Geeft de cookie van beide terug plus het tijdelijke wachtwoord.
   */
  async function createCaregiverAndLogin(): Promise<{
    adminCookie: string;
    caregiverCookie: string;
    caregiverEmail: string;
    temporaryPassword: string;
    caregiverId: string;
  }> {
    const admin = await seedAccount('admin@intento.local', 'wachtwoord van de beheerder', 'ADMIN');
    const adminCookie = await loginCookie(app, admin.email, admin.password);

    const created = await app.inject({
      method: 'POST',
      url: '/admin/accounts',
      payload: { name: 'Sam', email: 'sam@intento.local' },
      headers: { cookie: adminCookie },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { account: { id: string }; temporaryPassword: string };

    const caregiverCookie = await loginCookie(app, 'sam@intento.local', body.temporaryPassword);
    return {
      adminCookie,
      caregiverCookie,
      caregiverEmail: 'sam@intento.local',
      temporaryPassword: body.temporaryPassword,
      caregiverId: body.account.id,
    };
  }

  it('markeert een nieuw begeleider-account (T2.4) als "tijdelijk wachtwoord"', async () => {
    const { caregiverId } = await createCaregiverAndLogin();

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: caregiverId } });
    expect(stored.mustChangePassword).toBe(true);
  });

  it('laat de beheerder de markering zien in zijn accountlijst', async () => {
    const { adminCookie, caregiverId } = await createCaregiverAndLogin();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/accounts',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { accounts } = accountListResponseSchema.parse(res.json());

    // De begeleider is gemarkeerd, de beheerder (eigen wachtwoord) juist niet.
    expect(accounts.find((a) => a.id === caregiverId)?.mustChangePassword).toBe(true);
    expect(accounts.find((a) => a.role === 'ADMIN')?.mustChangePassword).toBe(false);
  });

  it('blokkeert alle overige acties met 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const { caregiverCookie } = await createCaregiverAndLogin();

    // Een route die deze rol normaal gesproken wél mag (vraagmodus, T7.1): de weigering komt dus
    // van de gate en niet van de rolcontrole.
    const res = await app.inject({
      method: 'GET',
      url: '/question/users',
      headers: { cookie: caregiverCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });
  });

  it('laat het eigen account bekijken, mét de markering in het antwoord', async () => {
    const { caregiverCookie } = await createCaregiverAndLogin();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: caregiverCookie },
    });
    expect(res.statusCode).toBe(200);
    const { account } = authResponseSchema.parse(res.json());
    expect(account.mustChangePassword).toBe(true);
  });

  it('laat het wijzigen zelf altijd toe en heft daarmee markering én gate op', async () => {
    const { caregiverCookie, caregiverId, temporaryPassword } = await createCaregiverAndLogin();

    const changed = await app.inject({
      method: 'POST',
      url: '/auth/password',
      payload: { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD },
      headers: { cookie: caregiverCookie },
    });
    expect(changed.statusCode).toBe(200);

    // Markering weg — in de db en in het eigen antwoord.
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: caregiverId } });
    expect(stored.mustChangePassword).toBe(false);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: caregiverCookie },
    });
    expect(authResponseSchema.parse(me.json()).account.mustChangePassword).toBe(false);

    // En de eerder geblokkeerde route mag weer — dezelfde sessie, geen nieuwe login nodig.
    const after = await app.inject({
      method: 'GET',
      url: '/question/users',
      headers: { cookie: caregiverCookie },
    });
    expect(after.statusCode).toBe(200);
  });

  it('markeert een zelf gekozen wachtwoord niet en zet die accounts dus niet achter de gate', async () => {
    // Zelfaanmelding (T1.3): de admin kiest zijn eigen wachtwoord — dat kent niemand anders.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        organizationName: 'Familie Jansen',
        organizationType: 'family',
        adminName: 'Ann',
        email: 'ann@intento.local',
        password: 'een eigen sterk wachtwoord',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(authResponseSchema.parse(res.json()).account.mustChangePassword).toBe(false);

    const cookie = await loginCookie(app, 'ann@intento.local', 'een eigen sterk wachtwoord');
    const users = await app.inject({ method: 'GET', url: '/admin/users', headers: { cookie } });
    expect(users.statusCode).toBe(200);
  });
});
