import type { FastifyInstance } from 'fastify';
import { aiStatusResponseSchema, type AiStatusResponse } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../env.js';
import { authorizeAccountOrDevice } from '../auth/account-or-device.js';

export interface AiStatusRoutesDeps {
  prisma: PrismaClient;
  env: Env;
}

/**
 * Hoe lang na de laatste worker-activiteit we een worker nog als "online" tellen.
 *
 * Een worker long-pollt continu op `/ai/worker/claim` (standaard 20 s per poging) en elke
 * geauthenticeerde worker-request werkt `WorkerToken.lastSeenAt` bij. Eén gemiste ronde mag dus geen
 * knipperende indicator geven — 60 s geeft ruimte voor een trage ronde zonder een allang gestopte
 * worker minutenlang als actief te tonen.
 */
export const WORKER_ONLINE_WINDOW_MS = 60_000;

/**
 * AI-status (T9.4, DESIGN §7.2, §9.2, §9.4, ADR-0010).
 *
 * `GET /ai/status` — draait er echt een AI mee, en zo ja: is er een worker actief?
 *
 * Aanleiding is de gebruikerstest: de backend draaide op `AI_PROVIDER=mock` (de deterministische
 * mock-provider, géén AI) en niets in de tablet of de beheeromgeving liet dat zien — het leek simpelweg
 * of de AI niets deed. Hetzelfde geldt voor `queue` zonder draaiende worker: elk gesprek blijft dan in
 * de wachtstand hangen zonder dat iemand weet waarom.
 *
 * Toegang: een ingelogd account **of** een gekoppeld apparaat (de tablet toont de indicator ook). De
 * respons bevat uitsluitend **infrastructuurmetadata** — modus, aantal recent geziene workers en het
 * laatste activiteitsmoment. Nooit prompts, communicatie-inhoud, tokennamen of tenantgegevens, zodat
 * ook een tablet dit veilig mag opvragen.
 */
export function registerAiStatusRoutes(
  app: FastifyInstance,
  { prisma, env }: AiStatusRoutesDeps,
): void {
  app.get(
    '/ai/status',
    { preHandler: authorizeAccountOrDevice(prisma) },
    async (): Promise<AiStatusResponse> => {
      const mode = env.AI_PROVIDER;
      const workerRequired = mode === 'queue';

      // Alleen bij `queue` bestaat het begrip "actieve worker"; bij `mock` rekent de backend zelf en
      // is een db-query overbodig.
      let workersOnline = 0;
      let lastSeenAt: Date | null = null;
      if (workerRequired) {
        const since = new Date(Date.now() - WORKER_ONLINE_WINDOW_MS);
        const [online, latest] = await Promise.all([
          prisma.workerToken.count({
            where: { revokedAt: null, lastSeenAt: { gte: since } },
          }),
          prisma.workerToken.findFirst({
            where: { revokedAt: null, lastSeenAt: { not: null } },
            orderBy: { lastSeenAt: 'desc' },
            select: { lastSeenAt: true },
          }),
        ]);
        workersOnline = online;
        lastSeenAt = latest?.lastSeenAt ?? null;
      }

      return aiStatusResponseSchema.parse({
        mode,
        workerRequired,
        workersOnline,
        lastSeenAt: lastSeenAt?.toISOString() ?? null,
        // Er denkt alleen écht een AI mee als de wachtrij draait én er een worker leeft.
        active: workerRequired && workersOnline > 0,
      });
    },
  );
}
