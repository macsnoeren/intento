import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadEnv, type Env } from '../env.js';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';

/**
 * Testhulpjes voor de auth-tests. Bouwen een geldige env (met overrides), maken accounts
 * aan en halen de sessie-cookie uit een login-response.
 */

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    SIGNING_SECRET: 'test-signing-secret',
    ENCRYPTION_KEY: 'test-encryption-key',
    ...overrides,
  });
}

/** Verwijdert alle auth-/gebruikersdata (sessies → accounts → profielen → gebruikers → organisaties). */
export async function resetAuthData(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.userCommunicationProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}

export interface SeededAccount {
  organizationId: string;
  accountId: string;
  email: string;
  password: string;
}

/** Maakt een losse organisatie aan (tenant-root) voor isolatietests. */
export async function seedOrganization(name = 'Testorganisatie'): Promise<string> {
  const org = await prisma.organization.create({ data: { name, type: 'family' } });
  return org.id;
}

/**
 * Maakt een account met bekend wachtwoord voor de tests. Zonder `organizationId` wordt er
 * een nieuwe organisatie aangemaakt; geef er één mee om meerdere accounts in dezélfde
 * organisatie te zetten (nodig om tenant-isolatie tussen twee organisaties aan te tonen).
 */
export async function seedAccount(
  email = 'admin@intento.local',
  password = 'correct horse battery staple',
  role = 'ADMIN',
  organizationId?: string,
): Promise<SeededAccount> {
  const orgId = organizationId ?? (await seedOrganization());
  const account = await prisma.account.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      organizationId: orgId,
    },
  });
  return { organizationId: orgId, accountId: account.id, email, password };
}

/**
 * Maakt een gebruiker (met standaard-communicatieprofiel) in de opgegeven organisatie. Zonder
 * `organizationId` wordt er een nieuwe organisatie aangemaakt. Handig om isolatie tussen
 * organisaties aan te tonen (org A ziet nooit gebruikers van org B).
 */
export async function seedUser(
  name = 'Testgebruiker',
  organizationId?: string,
): Promise<{ id: string; organizationId: string }> {
  const orgId = organizationId ?? (await seedOrganization());
  const user = await prisma.user.create({
    data: { name, organizationId: orgId, communicationProfile: { create: {} } },
  });
  return { id: user.id, organizationId: orgId };
}

/**
 * Haalt de exacte wire-vorm (`naam=waarde`) van de sessie-cookie uit een response, zodat
 * die 1-op-1 als `Cookie`-header teruggestuurd kan worden (ondertekende waarde intact).
 */
export function sessionCookieHeader(response: LightMyRequestResponse): string | undefined {
  const raw = response.headers['set-cookie'];
  const headers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = headers.find((h) => h.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match?.split(';', 1)[0];
}

/**
 * Logt in en geeft de sessie-cookie-header terug die als `Cookie` op vervolgverzoeken kan.
 * Herbruikbaar in autorisatie-/isolatietests: één regel van "account" naar "geauthenticeerd
 * verzoek". Gooit als de login niet slaagt, zodat een testfout meteen zichtbaar is.
 */
export async function loginCookie(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login mislukte voor ${email}: status ${res.statusCode}`);
  }
  const cookie = sessionCookieHeader(res);
  if (!cookie) throw new Error(`Geen sessie-cookie ontvangen voor ${email}`);
  return cookie;
}
