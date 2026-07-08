import type { LightMyRequestResponse } from 'fastify';
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

/** Verwijdert alle auth-gerelateerde data (sessies → accounts → organisaties). */
export async function resetAuthData(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.organization.deleteMany();
}

export interface SeededAccount {
  organizationId: string;
  accountId: string;
  email: string;
  password: string;
}

/** Maakt een organisatie + account met bekend wachtwoord voor de tests. */
export async function seedAccount(
  email = 'admin@intento.local',
  password = 'correct horse battery staple',
  role = 'ADMIN',
): Promise<SeededAccount> {
  const org = await prisma.organization.create({
    data: { name: 'Testorganisatie', type: 'family' },
  });
  const account = await prisma.account.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role,
      organizationId: org.id,
    },
  });
  return { organizationId: org.id, accountId: account.id, email, password };
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
