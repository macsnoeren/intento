import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AiJobModel } from '../generated/prisma/models.js';
import { AI_TASK_GENERATE_MESSAGE, AI_TASK_SELECT_NEXT_QUESTION } from './provider.js';

/**
 * DB-gebackte AI-jobwachtrij (T5.5, DESIGN §7.2, §9.2, ADR-0010).
 *
 * De DB is de bron van waarheid: een herstart of worker-crash verliest geen aanvraag. De service is
 * bewust vrij van HTTP en van de `AiProvider`/orchestrator, zodat alles deterministisch te testen is met
 * een gesimuleerde worker (geen netwerk, geen timers).
 *
 * **Backpressure.** Er is een maximum aan gelijktijdig actieve jobs (`QUEUED` + `CLAIMED`). Onder het
 * maximum wordt een nieuwe aanvraag `QUEUED` (direct claimbaar); erboven `WAITING_FOR_WORKER` met een
 * positie. De aanvrager (de `QueueAiProvider`) krijgt dan meteen een wacht-signaal i.p.v. te blokkeren
 * (DESIGN §9.4). Een WAITING-job wordt gepromoveerd naar QUEUED zodra er capaciteit vrijkomt.
 *
 * **Crash-herstel zonder achtergrond-timer.** Een geclaimde job heeft een lease (`leaseExpiresAt`); de
 * worker verlengt die met heartbeats. Een **opportunistische sweep** (aan het begin van enqueue/claim en
 * tijdens het wachten op een resultaat) legt een verlopen lease terug in de wachtrij (na
 * `AI_WORKER_MAX_ATTEMPTS` teruggaven → `FAILED`) en laat nooit-opgepakte jobs verlopen (`EXPIRED`).
 */

/** Jobstatussen (op de grens gevalideerd; geen native enum i.v.m. SQLite/PostgreSQL-portabiliteit). */
export const JOB_STATUS = {
  /** Over capaciteit: staat in de wachtrij maar is nog niet claimbaar (wacht op een vrij slot). */
  WAITING_FOR_WORKER: 'WAITING_FOR_WORKER',
  /** Claimbaar door een worker. */
  QUEUED: 'QUEUED',
  /** In behandeling bij een worker (met een lease). */
  CLAIMED: 'CLAIMED',
  /** Succesvol afgerond; `resultJson` is gezet. */
  SUCCEEDED: 'SUCCEEDED',
  /** Definitief mislukt (te vaak teruggelegd of expliciet gefaald). */
  FAILED: 'FAILED',
  /** Verlopen voordat een worker de job oppakte (nette wachtrij-timeout). */
  EXPIRED: 'EXPIRED',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** De AI-taken die als job op de wachtrij kunnen (spiegel van de provider-taken, T5.1). */
export const JOB_TASKS = [AI_TASK_SELECT_NEXT_QUESTION, AI_TASK_GENERATE_MESSAGE] as const;
export type JobTask = (typeof JOB_TASKS)[number];

/** Runtime-configuratie van de wachtrij; afgeleid uit de env (`queueConfigFromEnv`). */
export interface QueueConfig {
  /** Maximum aantal gelijktijdig actieve jobs (QUEUED+CLAIMED); daarboven → WAITING_FOR_WORKER. */
  maxConcurrentJobs: number;
  /** Lease-duur (ms) van een geclaimde job. */
  leaseMs: number;
  /** Maximaal aantal claim-pogingen voor een job wordt afgeschreven (FAILED). */
  maxAttempts: number;
  /** Uiterste wachttijd (ms) dat een niet-opgepakte job in de wachtrij mag staan → EXPIRED. */
  queueTtlMs: number;
  /** Poll-interval (ms) voor het wachten op een resultaat en de long-poll-claim. */
  pollIntervalMs: number;
  /** Maximale tijd (ms) dat de backend op een worker-resultaat wacht. */
  waitTimeoutMs: number;
  /** Hoe lang de claim-long-poll op een job wacht voordat hij leeg teruggeeft. */
  claimLongPollMs: number;
}

/** Bouwt de wachtrij-configuratie uit de gevalideerde env. */
export function queueConfigFromEnv(env: Env): QueueConfig {
  return {
    maxConcurrentJobs: env.AI_WORKER_MAX_CONCURRENT_JOBS,
    leaseMs: env.AI_WORKER_LEASE_MS,
    maxAttempts: env.AI_WORKER_MAX_ATTEMPTS,
    queueTtlMs: env.AI_WORKER_QUEUE_TTL_MS,
    pollIntervalMs: env.AI_WORKER_POLL_INTERVAL_MS,
    waitTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    claimLongPollMs: env.AI_WORKER_CLAIM_LONGPOLL_MS,
  };
}

const ACTIVE_STATUSES: JobStatus[] = [JOB_STATUS.QUEUED, JOB_STATUS.CLAIMED];

/** Kleine sleep-helper (zonder de gedeelde shell te blokkeren). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opportunistisch onderhoud: verlopen leases terugleggen/afschrijven, oude wachtrij-items laten verlopen,
 * en wachtende jobs promoveren zodra er capaciteit is. Idempotent en zonder timer — aangeroepen aan het
 * begin van enqueue/claim en tijdens het wachten op een resultaat.
 */
export async function sweepQueue(
  prisma: PrismaClient,
  config: QueueConfig,
  now: Date = new Date(),
): Promise<void> {
  // 1. Verlopen leases die nog pogingen over hebben → terug in de wachtrij (crash-herstel).
  await prisma.aiJob.updateMany({
    where: {
      status: JOB_STATUS.CLAIMED,
      leaseExpiresAt: { lt: now },
      attempts: { lt: config.maxAttempts },
    },
    data: { status: JOB_STATUS.QUEUED, claimedById: null, claimedAt: null, leaseExpiresAt: null },
  });

  // 2. Verlopen leases zonder pogingen meer → definitief afschrijven.
  await prisma.aiJob.updateMany({
    where: {
      status: JOB_STATUS.CLAIMED,
      leaseExpiresAt: { lt: now },
      attempts: { gte: config.maxAttempts },
    },
    data: {
      status: JOB_STATUS.FAILED,
      errorMessage: 'Worker-lease verlopen na maximaal aantal pogingen.',
      claimedById: null,
      leaseExpiresAt: null,
    },
  });

  // 3. Nooit-opgepakte wachtrij-items die hun TTL overschreden → EXPIRED (nette timeout).
  await prisma.aiJob.updateMany({
    where: {
      status: { in: [JOB_STATUS.QUEUED, JOB_STATUS.WAITING_FOR_WORKER] },
      expiresAt: { lt: now },
    },
    data: { status: JOB_STATUS.EXPIRED },
  });

  // 4. Wachtende jobs promoveren tot aan de capaciteit.
  const activeCount = await prisma.aiJob.count({ where: { status: { in: ACTIVE_STATUSES } } });
  const free = config.maxConcurrentJobs - activeCount;
  if (free > 0) {
    const waiting = await prisma.aiJob.findMany({
      where: { status: JOB_STATUS.WAITING_FOR_WORKER },
      orderBy: { createdAt: 'asc' },
      take: free,
      select: { id: true },
    });
    if (waiting.length > 0) {
      await prisma.aiJob.updateMany({
        where: { id: { in: waiting.map((job) => job.id) } },
        data: { status: JOB_STATUS.QUEUED },
      });
    }
  }
}

/** De uitkomst van een enqueue: direct in de rij (QUEUED) of over capaciteit (WAITING_FOR_WORKER). */
export type Admission =
  | { status: 'QUEUED'; jobId: string }
  | { status: 'WAITING_FOR_WORKER'; jobId: string; position: number };

/**
 * Zet een AI-aanvraag op de wachtrij. Onder de capaciteit → `QUEUED`; erboven → `WAITING_FOR_WORKER` met
 * de 1-based positie tussen de wachtende jobs. De `payload` is de door `buildAiPrompt`/`buildMessagePrompt`
 * samengestelde, beperkte context (T5.1); die wordt als JSON opgeslagen.
 */
export async function enqueueJob(
  prisma: PrismaClient,
  config: QueueConfig,
  task: JobTask,
  payload: unknown,
): Promise<Admission> {
  const now = new Date();
  await sweepQueue(prisma, config, now);

  const activeCount = await prisma.aiJob.count({ where: { status: { in: ACTIVE_STATUSES } } });
  const admitted = activeCount < config.maxConcurrentJobs;
  const expiresAt = new Date(now.getTime() + config.queueTtlMs);

  const job = await prisma.aiJob.create({
    data: {
      task,
      status: admitted ? JOB_STATUS.QUEUED : JOB_STATUS.WAITING_FOR_WORKER,
      payloadJson: JSON.stringify(payload),
      expiresAt,
    },
  });

  if (admitted) return { status: 'QUEUED', jobId: job.id };

  // Positie tussen de wachtende jobs (inclusief zichzelf), oplopend op inschrijfmoment.
  const position = await prisma.aiJob.count({
    where: { status: JOB_STATUS.WAITING_FOR_WORKER, createdAt: { lte: job.createdAt } },
  });
  return { status: 'WAITING_FOR_WORKER', jobId: job.id, position };
}

/**
 * Claimt de oudste claimbare job voor een worker (atomair; race-veilig via een guarded `updateMany`).
 * Geeft `null` als er niets claimbaar is. Verhoogt `attempts` zodat een steeds crashende worker de job
 * uiteindelijk laat afschrijven i.p.v. eeuwig terug te leggen.
 */
export async function claimNextJob(
  prisma: PrismaClient,
  config: QueueConfig,
  workerTokenId: string,
): Promise<AiJobModel | null> {
  await sweepQueue(prisma, config);

  // Meerdere kandidaten proberen: verliezen we de race op de oudste, dan pakken we de volgende.
  for (;;) {
    const candidate = await prisma.aiJob.findFirst({
      where: { status: JOB_STATUS.QUEUED },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return null;

    const now = new Date();
    const claimed = await prisma.aiJob.updateMany({
      where: { id: candidate.id, status: JOB_STATUS.QUEUED },
      data: {
        status: JOB_STATUS.CLAIMED,
        claimedById: workerTokenId,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + config.leaseMs),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 1) {
      return prisma.aiJob.findUnique({ where: { id: candidate.id } });
    }
    // Race verloren (een andere worker was net eerder): volgende kandidaat proberen.
  }
}

/**
 * Long-poll-variant van `claimNextJob`: probeert herhaaldelijk te claimen tot er een job is of de
 * long-poll-tijd verstrijkt. Houdt de HTTP-verbinding kort open zodat een worker efficiënt kan wachten
 * (worker-initiated, robuust achter NAT) zonder te bonzen.
 */
export async function claimNextJobLongPoll(
  prisma: PrismaClient,
  config: QueueConfig,
  workerTokenId: string,
): Promise<AiJobModel | null> {
  const deadline = Date.now() + config.claimLongPollMs;
  for (;;) {
    const job = await claimNextJob(prisma, config, workerTokenId);
    if (job) return job;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(config.pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Legt het resultaat van een geclaimde job vast (→ SUCCEEDED). Alleen de worker die de job momenteel
 * bezit mag dit; een worker die zijn lease verloor (job intussen teruggelegd) faalt met `false` en
 * overschrijft niets. `resultJson` is de al met de zod-schema's gevalideerde uitvoer (op de worker-grens).
 */
export async function completeJob(
  prisma: PrismaClient,
  jobId: string,
  workerTokenId: string,
  resultJson: string,
): Promise<boolean> {
  const done = await prisma.aiJob.updateMany({
    where: { id: jobId, status: JOB_STATUS.CLAIMED, claimedById: workerTokenId },
    data: { status: JOB_STATUS.SUCCEEDED, resultJson, leaseExpiresAt: null },
  });
  return done.count === 1;
}

/**
 * Meldt een mislukte job. Zolang er pogingen over zijn gaat de job terug in de wachtrij (QUEUED) zodat een
 * andere worker het opnieuw kan proberen; anders wordt hij afgeschreven (FAILED). Alleen de bezittende
 * worker mag dit. Geeft `false` als de job niet (meer) door deze worker geclaimd is.
 */
export async function failJob(
  prisma: PrismaClient,
  config: QueueConfig,
  jobId: string,
  workerTokenId: string,
  message: string,
): Promise<boolean> {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== JOB_STATUS.CLAIMED || job.claimedById !== workerTokenId) {
    return false;
  }
  const exhausted = job.attempts >= config.maxAttempts;
  const done = await prisma.aiJob.updateMany({
    where: { id: jobId, status: JOB_STATUS.CLAIMED, claimedById: workerTokenId },
    data: exhausted
      ? {
          status: JOB_STATUS.FAILED,
          errorMessage: message.slice(0, 500),
          claimedById: null,
          leaseExpiresAt: null,
        }
      : {
          status: JOB_STATUS.QUEUED,
          errorMessage: message.slice(0, 500),
          claimedById: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
  });
  return done.count === 1;
}

/**
 * Verlengt de lease van een geclaimde job (heartbeat tijdens lange inferentie). Geeft de nieuwe
 * `leaseExpiresAt` terug, of `null` als de job niet (meer) door deze worker geclaimd is (bv. lease
 * verlopen en teruggelegd) — de worker weet dan dat hij moet stoppen.
 */
export async function heartbeatJob(
  prisma: PrismaClient,
  config: QueueConfig,
  jobId: string,
  workerTokenId: string,
): Promise<Date | null> {
  const leaseExpiresAt = new Date(Date.now() + config.leaseMs);
  const done = await prisma.aiJob.updateMany({
    where: { id: jobId, status: JOB_STATUS.CLAIMED, claimedById: workerTokenId },
    data: { leaseExpiresAt },
  });
  return done.count === 1 ? leaseExpiresAt : null;
}

/** De uitkomst van het wachten op een job-resultaat. */
export type JobOutcome =
  { status: 'SUCCEEDED'; resultJson: string } | { status: 'FAILED' | 'EXPIRED' | 'TIMEOUT' };

/**
 * Wacht (pollend) tot een job een resultaat heeft, definitief mislukt/verloopt, of de wachttijd
 * verstrijkt. Sweept tijdens het wachten zodat een gecrashte worker onderweg wordt teruggelegd en een
 * andere worker het kan oppakken. Blokkeert nooit langer dan `waitTimeoutMs`.
 */
export async function waitForJobResult(
  prisma: PrismaClient,
  config: QueueConfig,
  jobId: string,
): Promise<JobOutcome> {
  const deadline = Date.now() + config.waitTimeoutMs;
  for (;;) {
    const job = await prisma.aiJob.findUnique({
      where: { id: jobId },
      select: { status: true, resultJson: true },
    });
    if (!job) return { status: 'FAILED' };
    if (job.status === JOB_STATUS.SUCCEEDED && job.resultJson !== null) {
      return { status: 'SUCCEEDED', resultJson: job.resultJson };
    }
    if (job.status === JOB_STATUS.FAILED) return { status: 'FAILED' };
    if (job.status === JOB_STATUS.EXPIRED) return { status: 'EXPIRED' };
    if (Date.now() >= deadline) return { status: 'TIMEOUT' };

    await sweepQueue(prisma, config);
    await sleep(Math.min(config.pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
}
