import { createHash, randomBytes } from 'node:crypto';
import { workerTokenPublicSchema, type WorkerTokenPublic } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { WorkerTokenModel } from '../generated/prisma/models.js';

/**
 * Worker-token: het infrastructuur-credential van een externe AI-worker (T5.5, DESIGN §7.2, §9.4,
 * ADR-0010).
 *
 * Losstaand van gebruiker-/device-/sessietokens: een worker is infrastructuur, geen gebruiker en geen
 * tenant. Dezelfde beveiligingsregel als bij die tokens: het rauwe token staat NOOIT plaintext in de db —
 * we bewaren alleen de SHA-256-hash. Het rauwe token is 256 bit random, dus SHA-256 (i.p.v. argon2)
 * volstaat: er valt geen zwak wachtwoord te beschermen. Het token draagt een **scope** (`ai:process`) en
 * is intrekbaar (`revokedAt`) en optioneel verlopend (`expiresAt`).
 */

/** De enige scope in de MVP: een worker mag AI-jobs verwerken. */
export const WORKER_SCOPE_AI_PROCESS = 'ai:process' as const;

/** Prefix op het rauwe token, puur ter herkenning in logs/config (geen beveiligingsfunctie). */
const TOKEN_PREFIX = 'wrk_';

/** SHA-256-hash (hex); dezelfde functie bij aanmaken en opzoeken van het token. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Genereert een cryptografisch sterk, URL-veilig worker-token (256 bit) met herkenbare prefix. */
export function generateWorkerToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Splitst de opgeslagen komma-gescheiden scopes naar een genormaliseerde set. */
export function parseScopes(scopes: string): Set<string> {
  return new Set(
    scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
  );
}

export interface CreatedWorkerToken {
  record: WorkerTokenModel;
  /** Het rauwe token — alleen hier beschikbaar; daarna kennen we alleen de hash. */
  token: string;
}

/**
 * Maakt een nieuw worker-token en geeft het **rauwe** token één keer terug (daarna alleen de hash bekend).
 * `scopes` standaard alleen `ai:process`; `ttlDays` optioneel (geen waarde = verloopt niet).
 */
export async function createWorkerToken(
  prisma: PrismaClient,
  options: { name: string; scopes?: string[]; ttlDays?: number },
): Promise<CreatedWorkerToken> {
  const token = generateWorkerToken();
  const scopes = (options.scopes ?? [WORKER_SCOPE_AI_PROCESS]).join(',');
  const expiresAt =
    options.ttlDays !== undefined
      ? new Date(Date.now() + options.ttlDays * 24 * 60 * 60 * 1000)
      : null;
  const record = await prisma.workerToken.create({
    data: { name: options.name, tokenHash: sha256(token), scopes, expiresAt },
  });
  return { record, token };
}

/**
 * Serializeert een worker-token naar de **publieke** beheerweergave (T5.8): nooit de hash of het
 * rauwe token, alleen beheer-/diagnosevelden. De status wordt afgeleid uit `revokedAt`/`expiresAt`
 * zodat de beheer-UI in één oogopslag ziet of het token nog werkt.
 */
export function workerTokenToPublic(token: WorkerTokenModel): WorkerTokenPublic {
  const status =
    token.revokedAt !== null
      ? 'revoked'
      : token.expiresAt !== null && token.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'active';
  return workerTokenPublicSchema.parse({
    id: token.id,
    name: token.name,
    scopes: [...parseScopes(token.scopes)],
    status,
    lastSeenAt: token.lastSeenAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
    createdAt: token.createdAt.toISOString(),
  });
}

/** Trekt een worker-token in (idempotent). Daarna weigert `verifyWorkerToken` het. */
export async function revokeWorkerToken(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.workerToken
    .updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

/**
 * De reden waarom een worker-token geweigerd wordt. `missing`/`unknown` → 401 (geen geldig credential);
 * `revoked`/`expired`/`insufficient_scope` → 403 (wel een credential, maar niet (meer) toegestaan).
 */
export type WorkerAuthFailure =
  'missing' | 'unknown' | 'revoked' | 'expired' | 'insufficient_scope';

export type WorkerAuthResult =
  { ok: true; token: WorkerTokenModel } | { ok: false; reason: WorkerAuthFailure };

/**
 * Verifieert een rauw worker-token voor een vereiste scope. Zoekt op hash, controleert intrekking/vervaltijd
 * en scope, en werkt `lastSeenAt` best-effort bij. Geeft een gestructureerd resultaat terug zodat de
 * aanroeper 401 (geen geldig credential) van 403 (niet (meer) toegestaan) kan onderscheiden.
 */
export async function verifyWorkerToken(
  prisma: PrismaClient,
  rawToken: string | undefined | null,
  requiredScope: string,
): Promise<WorkerAuthResult> {
  if (!rawToken) return { ok: false, reason: 'missing' };

  const token = await prisma.workerToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!token) return { ok: false, reason: 'unknown' };
  if (token.revokedAt !== null) return { ok: false, reason: 'revoked' };
  if (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (!parseScopes(token.scopes).has(requiredScope)) {
    return { ok: false, reason: 'insufficient_scope' };
  }

  // Best-effort: het bijwerken van lastSeenAt mag de request nooit laten falen.
  await prisma.workerToken
    .update({ where: { id: token.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  return { ok: true, token };
}
