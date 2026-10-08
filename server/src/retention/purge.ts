import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';

/**
 * De bewaartermijn uitvoeren (N14.2, INTENTO-NEW-DESIGN §53, besluit 12).
 *
 * Per organisatie verdwijnt alles van een gesprek dat ouder is dan de bewaartermijn
 * (`Organization.retentionDays`, anders `RETENTION_DEFAULT_DAYS`): het gesprek met zijn momentopnamen,
 * Presented, Observed, Inferred, agentbeslissingen, de bevestigde boodschap en de verzendingen — die
 * hangen allemaal aan het gesprek (cascade). Een gesprek is "ouder" als het vóór de grens begon.
 *
 * Blijft staan: Experience (tot hij gewist wordt), ontbrekende woorden (geen gebruikersgegevens) en het
 * audit-log (beheeracties, geen gespreksinhoud).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Eén keer per dag; de eerste keer meteen bij het starten. */
export const RETENTION_INTERVAL_MS = DAY_MS;

export interface PurgeResult {
  organizations: number;
  sessions: number;
}

export async function purgeExpired(
  prisma: PrismaClient,
  env: Pick<Env, 'RETENTION_DEFAULT_DAYS'>,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, retentionDays: true },
  });
  let sessions = 0;
  for (const organization of organizations) {
    const days = organization.retentionDays ?? env.RETENTION_DEFAULT_DAYS;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const { count } = await prisma.communicationSession.deleteMany({
      where: { organizationId: organization.id, startedAt: { lt: cutoff } },
    });
    sessions += count;
  }
  return { organizations: organizations.length, sessions };
}

/**
 * Laat de opruimtaak draaien zolang de server luistert: bij het starten en daarna dagelijks. Alleen de
 * echte server roept dit aan, niet elke test-app. Een fout gaat naar de log; de volgende ronde probeert
 * het opnieuw.
 */
export function scheduleRetention(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Pick<Env, 'RETENTION_DEFAULT_DAYS'>,
  intervalMs: number = RETENTION_INTERVAL_MS,
): void {
  const run = (): void => {
    purgeExpired(prisma, env)
      .then((result) => {
        app.log.info(result, 'bewaartermijn uitgevoerd');
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'bewaartermijn uitvoeren mislukt');
      });
  };
  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', () => {
    run();
    timer = setInterval(run, intervalMs);
    timer.unref();
  });
  app.addHook('onClose', () => {
    clearInterval(timer);
  });
}
