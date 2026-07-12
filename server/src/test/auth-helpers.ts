import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadEnv, type Env } from '../env.js';
import { prisma } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { createLinkCode } from '../auth/device.js';
import { SESSION_COOKIE_NAME, DEVICE_COOKIE_NAME } from '../auth/cookie.js';

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

/** Verwijdert alle auth-/gebruikersdata (AI-jobs/worker-tokens → gesprekken → koppelingen/apparaten → tokens → sessies → accounts → profielen → gebruikers → organisaties). */
export async function resetAuthData(): Promise<void> {
  // Audit-log (T8.2) staat los van de tenant-boom (geen FK's); apart legen zodat tests schoon starten.
  await prisma.auditLog.deleteMany();
  // AI-wachtrij eerst: AiJob verwijst (SetNull) naar WorkerToken; beide staan los van de tenant-boom.
  await prisma.aiJob.deleteMany();
  await prisma.workerToken.deleteMany();
  await prisma.correctionEvent.deleteMany();
  await prisma.conversationStep.deleteMany();
  await prisma.conversationSession.deleteMany();
  await prisma.personalContext.deleteMany();
  await prisma.preference.deleteMany();
  await prisma.deviceLinkCode.deleteMany();
  await prisma.device.deleteMany();
  await prisma.caregiverAssignment.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
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
 *
 * Standaard **geverifieerd** (T1.4): geseede accounts staan voor reeds ingerichte omgevingen,
 * zodat bestaande tests niet op de verificatie-gate lopen. Zet `emailVerified: false` om een
 * vers-aangemeld, nog niet bevestigd account na te bootsen.
 */
export async function seedAccount(
  email = 'admin@intento.local',
  password = 'correct horse battery staple',
  role = 'ADMIN',
  organizationId?: string,
  options: { emailVerified?: boolean } = {},
): Promise<SeededAccount> {
  const orgId = organizationId ?? (await seedOrganization());
  const account = await prisma.account.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      organizationId: orgId,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
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

/** Koppelt een begeleider-account rechtstreeks aan een gebruiker (voor toegangstests). */
export async function linkCaregiver(accountId: string, userId: string): Promise<void> {
  await prisma.caregiverAssignment.create({ data: { accountId, userId } });
}

/**
 * Koppelt een tablet aan een gebruiker via de echte koppelflow en geeft de device-cookie-header terug
 * die als `Cookie` op vervolgverzoeken kan (gespreks-/apparaatroutes). Eén regel van "gebruiker" naar
 * "gekoppeld apparaat" in tests, zonder de codegeneratie-route (ADMIN) te doorlopen.
 */
export async function deviceCookie(app: FastifyInstance, userId: string): Promise<string> {
  const { code } = await createLinkCode(prisma, userId, 60);
  const res = await app.inject({ method: 'POST', url: '/devices/link', payload: { code } });
  if (res.statusCode !== 201) {
    throw new Error(
      `Apparaat koppelen mislukte voor gebruiker ${userId}: status ${res.statusCode}`,
    );
  }
  const cookie = deviceCookieHeader(res);
  if (!cookie) throw new Error(`Geen device-cookie ontvangen voor gebruiker ${userId}`);
  return cookie;
}

/**
 * Haalt de exacte wire-vorm (`naam=waarde`) van de sessie-cookie uit een response, zodat
 * die 1-op-1 als `Cookie`-header teruggestuurd kan worden (ondertekende waarde intact).
 */
export function sessionCookieHeader(response: LightMyRequestResponse): string | undefined {
  return cookieHeader(response, SESSION_COOKIE_NAME);
}

/** Idem voor de device-cookie (T2.3), zodat een gekoppeld apparaat 1-op-1 kan terugsturen. */
export function deviceCookieHeader(response: LightMyRequestResponse): string | undefined {
  return cookieHeader(response, DEVICE_COOKIE_NAME);
}

function cookieHeader(response: LightMyRequestResponse, name: string): string | undefined {
  const raw = response.headers['set-cookie'];
  const headers = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = headers.find((h) => h.startsWith(`${name}=`));
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
