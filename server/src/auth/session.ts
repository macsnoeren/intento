import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Sessiebeheer (DESIGN §9.4, CLAUDE.md security-checklist).
 *
 * Het rauwe sessietoken gaat als httpOnly+Secure cookie naar de client en wordt **nooit**
 * plaintext opgeslagen. In de db bewaren we alleen de SHA-256-hash (`tokenHash`). Bij een
 * request hashen we de cookie en zoeken op die hash. Zo levert db-lekkage geen bruikbare
 * tokens op. SHA-256 (i.p.v. argon2) volstaat: het token is 256 bit random, dus niet te
 * brute-forcen — er valt geen zwak wachtwoord te beschermen.
 */

/** Genereert een cryptografisch sterk, URL-veilig sessietoken (256 bit). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256-hash (hex) van een token; dezelfde functie bij aanmaken en opzoeken. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/**
 * Maakt een nieuwe sessie voor een account en geeft het rauwe token terug (alleen hier
 * beschikbaar; daarna kennen we alleen de hash). De aanroeper zet het token in de cookie.
 */
export async function createSession(
  prisma: PrismaClient,
  accountId: string,
  ttlHours: number,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), accountId, expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Zoekt de sessie bij een rauw token en geeft het bijbehorende account terug, of `null`
 * als het token onbekend of verlopen is. Verlopen sessies worden opgeruimd.
 */
export async function findAccountBySessionToken(prisma: PrismaClient, token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { account: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.account;
}

/** Verwijdert de sessie bij een rauw token (logout). Onbekende tokens zijn een no-op. */
export async function deleteSessionByToken(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session
    .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
    .catch(() => undefined);
}
