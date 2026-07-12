import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuditAction } from './actions.js';

/**
 * Audit-logging voor gevoelige acties (T8.2, DESIGN §9.4).
 *
 * Eén herbruikbaar `recordAudit(...)` schrijft een append-only regel over wie-wat-wanneer op
 * beveiligings-/beheerrelevante handelingen. Ontwerpuitgangspunten:
 *
 * - **Nooit blokkerend, nooit falend voor de aanroeper.** Auditing is een neveneffect: als het
 *   schrijven mislukt, mag de hoofdactie daar niet op stuklopen. We vangen fouten en loggen ze via
 *   de request-logger, maar gooien ze niet door.
 * - **Actor uit de request.** `accountId`/`organizationId` komen standaard van het door `authorize()`
 *   geverifieerde `request.account`; het IP uit `request.ip` (achter de geconfigureerde proxy-hops).
 *   Pre-auth acties (mislukte login) geven de actor expliciet mee of laten hem leeg.
 * - **Geen communicatie-inhoud of vrije-tekst-PII.** Alleen een stabiele `action`-sleutel, de
 *   uitkomst en objectverwijzingen; `metadata` bevat hoogstens kleine, niet-gevoelige context.
 */
export interface AuditEntry {
  action: AuditAction;
  /** Uitkomst; standaard "success". "failure" markeert bv. een mislukte login. */
  outcome?: 'success' | 'failure';
  /** Actor-account; standaard `request.account?.id`. Expliciet `null` voor een onbekende actor. */
  accountId?: string | null;
  /** Tenant; standaard `request.account?.organizationId`. */
  organizationId?: string | null;
  /** Type doelobject, bv. "user" | "workerToken". */
  targetType?: string | null;
  /** Id van het doelobject. */
  targetId?: string | null;
  /** Kleine, niet-gevoelige extra context. NOOIT communicatie-inhoud of vrije-tekst-PII. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Schrijft één audit-regel. Best-effort: fouten worden gelogd maar nooit doorgegooid, zodat een
 * hapering in de audit-tabel de hoofdactie (login, opslaan, verwijderen, …) niet laat mislukken.
 */
export async function recordAudit(
  prisma: PrismaClient,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  const account = request.account;
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome ?? 'success',
        accountId: entry.accountId !== undefined ? entry.accountId : (account?.id ?? null),
        organizationId:
          entry.organizationId !== undefined
            ? entry.organizationId
            : (account?.organizationId ?? null),
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: request.ip ?? null,
        metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (error) {
    request.log.error({ err: error, action: entry.action }, 'Audit-logging mislukt');
  }
}
