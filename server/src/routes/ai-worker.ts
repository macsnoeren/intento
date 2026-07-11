import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { workerAuthorize, requireWorkerToken } from '../auth/worker.js';
import {
  claimNextJobLongPoll,
  completeJob,
  failJob,
  heartbeatJob,
  queueConfigFromEnv,
  JOB_TASKS,
  type QueueConfig,
} from '../ai/job-queue.js';
import {
  AI_TASK_GENERATE_MESSAGE,
  AI_TASK_SELECT_NEXT_QUESTION,
  aiMessageResultSchema,
  aiQuestionDecisionSchema,
} from '../ai/provider.js';

export interface AiWorkerRoutesDeps {
  env: Env;
  prisma: PrismaClient;
}

/** Route-parameter: het job-id uit het pad. */
const jobParamsSchema = z.object({ id: z.string().min(1) });

/** Optionele foutmelding bij `…/fail` (kort; nooit een interne stacktrace). */
const failRequestSchema = z.object({ message: z.string().max(500).optional() }).default({});

/** Wat de worker bij een claim terugkrijgt: het job-id, de taak en de beperkte prompt-context. */
const claimResponseSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    task: z.enum(JOB_TASKS),
    payload: z.unknown(),
  }),
});

/**
 * Kiest het juiste zod-schema om het door de worker ingeleverde resultaat te valideren, op basis van de
 * job-taak. Zo wordt worker-uitvoer op de grens **opnieuw** getoetst (nooit vertrouwen, T5.1/T5.2): een
 * verkeerd gevormd resultaat wordt met 400 geweigerd en bereikt de flow nooit.
 */
function resultSchemaForTask(task: string) {
  switch (task) {
    case AI_TASK_SELECT_NEXT_QUESTION:
      return aiQuestionDecisionSchema;
    case AI_TASK_GENERATE_MESSAGE:
      return aiMessageResultSchema;
    default:
      return null;
  }
}

/**
 * Worker-endpoints voor de gedistribueerde AI-wachtrij (T5.5, DESIGN §7.2, §9.2, §9.4, ADR-0010).
 *
 * **Worker-initiated** (long-poll): de worker opent altijd de verbinding — robuust achter NAT. Alle routes
 * lopen op `workerAuthorize` (bearer worker-token, scope `ai:process`) en zijn per IP rate-limited. De
 * client praat nog steeds nooit rechtstreeks met de AI: de worker is backend-infrastructuur.
 *
 * - `POST /ai/worker/claim` — claim de oudste wachtende job (long-poll); 200 met job of 204 (leeg).
 * - `POST /ai/worker/jobs/:id/heartbeat` — lease verlengen tijdens lange inferentie.
 * - `POST /ai/worker/jobs/:id/result` — gestructureerd resultaat inleveren (op de grens gevalideerd).
 * - `POST /ai/worker/jobs/:id/fail` — nette teruggave bij een fout (terug in de wachtrij of afgeschreven).
 */
export function registerAiWorkerRoutes(
  app: FastifyInstance,
  { env, prisma }: AiWorkerRoutesDeps,
): void {
  const config: QueueConfig = queueConfigFromEnv(env);
  const rateLimit = {
    max: env.AI_WORKER_RATE_LIMIT_MAX,
    timeWindow: env.AI_WORKER_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  };

  // Job claimen (long-poll). Geeft 204 als er binnen de long-poll-tijd niets claimbaar is.
  app.post(
    '/ai/worker/claim',
    { preHandler: workerAuthorize(prisma), config: { rateLimit } },
    async (request, reply) => {
      const worker = requireWorkerToken(request);
      const job = await claimNextJobLongPoll(prisma, config, worker.id);
      if (!job) {
        reply.status(204);
        return null;
      }
      const payload: unknown = JSON.parse(job.payloadJson);
      return claimResponseSchema.parse({
        job: { id: job.id, task: job.task, payload },
      });
    },
  );

  // Heartbeat: lease verlengen. 409 als de job niet (meer) door deze worker geclaimd is.
  app.post(
    '/ai/worker/jobs/:id/heartbeat',
    { preHandler: workerAuthorize(prisma), config: { rateLimit } },
    async (request) => {
      const worker = requireWorkerToken(request);
      const { id } = jobParamsSchema.parse(request.params);
      const leaseExpiresAt = await heartbeatJob(prisma, config, id, worker.id);
      if (!leaseExpiresAt) {
        throw new HttpError(409, 'JOB_NOT_CLAIMED', 'Job niet (meer) door deze worker geclaimd.');
      }
      return { leaseExpiresAt: leaseExpiresAt.toISOString() };
    },
  );

  // Resultaat inleveren. Het lichaam wordt tegen het bij de taak horende schema gevalideerd (400 bij een
  // verkeerde vorm) en pas dan opgeslagen — worker-uitvoer wordt op de grens nooit vertrouwd.
  app.post(
    '/ai/worker/jobs/:id/result',
    { preHandler: workerAuthorize(prisma), config: { rateLimit } },
    async (request) => {
      const worker = requireWorkerToken(request);
      const { id } = jobParamsSchema.parse(request.params);

      const job = await prisma.aiJob.findUnique({ where: { id } });
      if (!job || job.status !== 'CLAIMED' || job.claimedById !== worker.id) {
        throw new HttpError(409, 'JOB_NOT_CLAIMED', 'Job niet (meer) door deze worker geclaimd.');
      }

      const schema = resultSchemaForTask(job.task);
      if (!schema) {
        // Zou niet mogen: een job bestaat alleen met een bekende taak. Defensief afvangen.
        throw new HttpError(422, 'UNKNOWN_TASK', 'Onbekende taak voor dit resultaat.');
      }
      const result = schema.parse(request.body);

      const stored = await completeJob(prisma, id, worker.id, JSON.stringify(result));
      if (!stored) {
        // Race: de lease verliep tussen de check en de opslag; job intussen teruggelegd.
        throw new HttpError(409, 'JOB_NOT_CLAIMED', 'Job niet (meer) door deze worker geclaimd.');
      }
      return { status: 'ok' as const };
    },
  );

  // Mislukking melden: terug in de wachtrij (pogingen over) of afgeschreven.
  app.post(
    '/ai/worker/jobs/:id/fail',
    { preHandler: workerAuthorize(prisma), config: { rateLimit } },
    async (request) => {
      const worker = requireWorkerToken(request);
      const { id } = jobParamsSchema.parse(request.params);
      const { message } = failRequestSchema.parse(request.body ?? {});

      const handled = await failJob(
        prisma,
        config,
        id,
        worker.id,
        message ?? 'Worker meldde een fout.',
      );
      if (!handled) {
        throw new HttpError(409, 'JOB_NOT_CLAIMED', 'Job niet (meer) door deze worker geclaimd.');
      }
      return { status: 'ok' as const };
    },
  );
}
