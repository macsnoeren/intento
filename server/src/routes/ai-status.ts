import type { FastifyInstance } from 'fastify';
import {
  aiJobListResponseSchema,
  aiStatusResponseSchema,
  type AiJobListResponse,
  type AiJobSummary,
  type AiStatusResponse,
} from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AiJobModel } from '../generated/prisma/models.js';
import type { Env } from '../env.js';
import { authorize, requirePlatformOrg } from '../auth/authorize.js';
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
 * `GET /admin/ai/jobs` — wat de AI de laatste tijd deed (T9.15), voor platformbeheer.
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
/** Aantal AI-jobs dat het activiteitenoverzicht toont: genoeg om een gesprek terug te zien, niet meer. */
const AI_JOB_PAGE_SIZE = 25;

/**
 * Vat het door de worker ingeleverde resultaat samen voor het activiteitenoverzicht (T9.15).
 *
 * Het resultaat is al op de worker-grens gevalideerd, maar we lezen het hier bewust **defensief**: een
 * oud of half resultaat mag het beheerscherm niet laten omvallen. Alles wat niet herkend wordt, valt weg
 * in plaats van door te lekken. De **prompt** (`payloadJson`) raken we niet aan: daar zit persoonlijke
 * context in (T6.1) en die hoort niet in een beheerscherm.
 */
function summarizeResult(
  job: AiJobModel,
): Pick<AiJobSummary, 'question' | 'options' | 'reason' | 'confidence'> {
  const empty = { question: null, options: [], reason: null, confidence: null };
  if (!job.resultJson) return empty;

  let parsed: unknown;
  try {
    parsed = JSON.parse(job.resultJson);
  } catch {
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null) return empty;

  const result = parsed as Record<string, unknown>;
  const rawOptions = Array.isArray(result.options) ? result.options : [];
  return {
    question: typeof result.question === 'string' ? result.question : null,
    reason: typeof result.reason === 'string' ? result.reason : null,
    confidence: typeof result.confidence === 'number' ? result.confidence : null,
    options: rawOptions.flatMap((option) => {
      if (typeof option !== 'object' || option === null) return [];
      const entry = option as Record<string, unknown>;
      if (typeof entry.symbol !== 'string') return [];
      return [
        {
          concept: entry.symbol,
          confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
        },
      ];
    }),
  };
}

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

  // AI-activiteit (T9.15): "doet de AI wel opties bedenken?" — de recentste jobs met wat eruit kwam.
  //
  // Dezelfde grens als het worker-tokenbeheer (T5.8): `AiJob` is **platform-infrastructuur** en niet
  // tenant-gebonden, dus de rijen kunnen bij gesprekken van elke organisatie horen. Alleen een ADMIN van
  // de platformorganisatie komt erbij; een gewone organisatie-ADMIN krijgt 403. De **prompt** verlaat de
  // server nooit — daar zit persoonlijke context in — alleen de resultaatsamenvatting en metadata.
  app.get(
    '/admin/ai/jobs',
    { preHandler: [authorize(prisma, { roles: ['ADMIN'] }), requirePlatformOrg(prisma)] },
    async (): Promise<AiJobListResponse> => {
      const jobs = await prisma.aiJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: AI_JOB_PAGE_SIZE,
        include: { claimedBy: { select: { name: true } } },
      });

      return aiJobListResponseSchema.parse({
        jobs: jobs.map((job) => ({
          id: job.id,
          task: job.task,
          status: job.status,
          attempts: job.attempts,
          createdAt: job.createdAt.toISOString(),
          durationMs: Math.max(0, job.updatedAt.getTime() - job.createdAt.getTime()),
          worker: job.claimedBy?.name ?? null,
          error: job.errorMessage,
          ...summarizeResult(job),
        })),
      });
    },
  );
}
