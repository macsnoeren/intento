import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetAuthData } from '../test/auth-helpers.js';
import { createWorkerToken } from './worker-token.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  sweepQueue,
  waitForJobResult,
  JOB_STATUS,
  type QueueConfig,
} from './job-queue.js';
import { AI_TASK_SELECT_NEXT_QUESTION } from './provider.js';

/**
 * DB-gebackte AI-jobwachtrij (T5.5, DESIGN §7.2, §9.2, ADR-0010).
 *
 * Dekt de kernacceptatie op serviceniveau: queue → claim → resultaat, backpressure (WAITING boven de
 * capaciteit met positie i.p.v. blokkeren), crash-herstel (verlopen lease → teruggelegd), en de nette
 * wachtrij-timeout (EXPIRED). Deterministisch: geen timers, tijd wordt via de db gemanipuleerd.
 */
const config: QueueConfig = {
  maxConcurrentJobs: 2,
  leaseMs: 200,
  maxAttempts: 3,
  queueTtlMs: 1000,
  pollIntervalMs: 10,
  waitTimeoutMs: 1000,
  claimLongPollMs: 0,
};

/** Minimale, geldige prompt-payload; de service serialiseert deze alleen. */
const payload = { task: AI_TASK_SELECT_NEXT_QUESTION };

/** Een geldig `select_next_question`-resultaat als JSON-string. */
function decisionJson(concept = 'want'): string {
  return JSON.stringify({
    question: 'Wat wil je?',
    options: [{ symbol: concept, confidence: 0.9 }],
    reason: 'test',
  });
}

async function workerId(name = 'w'): Promise<string> {
  const { record } = await createWorkerToken(prisma, { name });
  return record.id;
}

describe('AI-jobwachtrij — service', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.$disconnect();
  });

  it('enqueue → claim → resultaat: de volledige gelukkige route', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    expect(admission.status).toBe('QUEUED');

    const tokenId = await workerId();
    const job = await claimNextJob(prisma, config, tokenId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe(JOB_STATUS.CLAIMED);
    expect(job!.attempts).toBe(1);
    expect(job!.claimedById).toBe(tokenId);

    const stored = await completeJob(prisma, job!.id, tokenId, decisionJson());
    expect(stored).toBe(true);

    const outcome = await waitForJobResult(prisma, config, job!.id);
    expect(outcome).toEqual({ status: 'SUCCEEDED', resultJson: decisionJson() });
  });

  it('backpressure: boven het maximum krijgt een aanvraag WAITING_FOR_WORKER met een positie', async () => {
    // Vul de capaciteit (max = 2) met claimbare jobs.
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);

    const first = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const second = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);

    expect(first.status).toBe('WAITING_FOR_WORKER');
    expect(second.status).toBe('WAITING_FOR_WORKER');
    if (first.status === 'WAITING_FOR_WORKER' && second.status === 'WAITING_FOR_WORKER') {
      expect(first.position).toBe(1);
      expect(second.position).toBe(2);
    }
  });

  it('promoveert een wachtende job zodra er capaciteit vrijkomt', async () => {
    const tokenId = await workerId();
    const a = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const waiting = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    expect(waiting.status).toBe('WAITING_FOR_WORKER');

    // Eén actieve job afronden → een slot komt vrij.
    const job = await claimNextJob(prisma, config, tokenId);
    await completeJob(prisma, job!.id, tokenId, decisionJson());
    if (a.status === 'QUEUED') void a;

    await sweepQueue(prisma, config);
    const promoted = await prisma.aiJob.findUnique({ where: { id: waiting.jobId } });
    expect(promoted!.status).toBe(JOB_STATUS.QUEUED);
  });

  it('crash-herstel: een verlopen lease wordt teruggelegd en opnieuw claimbaar', async () => {
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const tokenId = await workerId();
    const job = await claimNextJob(prisma, config, tokenId);
    expect(job!.attempts).toBe(1);

    // Lease in het verleden zetten (worker "gecrasht").
    await prisma.aiJob.update({
      where: { id: job!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await sweepQueue(prisma, config);

    const requeued = await prisma.aiJob.findUnique({ where: { id: job!.id } });
    expect(requeued!.status).toBe(JOB_STATUS.QUEUED);
    expect(requeued!.claimedById).toBeNull();

    // Opnieuw claimbaar; de pogingsteller loopt op.
    const again = await claimNextJob(prisma, config, tokenId);
    expect(again!.id).toBe(job!.id);
    expect(again!.attempts).toBe(2);
  });

  it('een gecrashte worker kan zijn oude job niet meer voltooien nadat die is teruggelegd', async () => {
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const crashed = await workerId('crashed');
    const job = await claimNextJob(prisma, config, crashed);

    await prisma.aiJob.update({
      where: { id: job!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await sweepQueue(prisma, config);

    // De gecrashte worker probeert alsnog te voltooien → geweigerd (lease kwijt).
    const stored = await completeJob(prisma, job!.id, crashed, decisionJson());
    expect(stored).toBe(false);
  });

  it('schrijft een job af als hij te vaak is teruggelegd (maxAttempts)', async () => {
    const small: QueueConfig = { ...config, maxAttempts: 1 };
    await enqueueJob(prisma, small, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const tokenId = await workerId();
    const job = await claimNextJob(prisma, small, tokenId);

    const handled = await failJob(prisma, small, job!.id, tokenId, 'model down');
    expect(handled).toBe(true);
    const failed = await prisma.aiJob.findUnique({ where: { id: job!.id } });
    expect(failed!.status).toBe(JOB_STATUS.FAILED);
  });

  it('failJob met pogingen over legt de job terug in de wachtrij', async () => {
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const tokenId = await workerId();
    const job = await claimNextJob(prisma, config, tokenId);

    const handled = await failJob(prisma, config, job!.id, tokenId, 'tijdelijke fout');
    expect(handled).toBe(true);
    const requeued = await prisma.aiJob.findUnique({ where: { id: job!.id } });
    expect(requeued!.status).toBe(JOB_STATUS.QUEUED);
  });

  it('heartbeat verlengt de lease en faalt voor een niet-eigenaar', async () => {
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const owner = await workerId('owner');
    const other = await workerId('other');
    const job = await claimNextJob(prisma, config, owner);

    const extended = await heartbeatJob(prisma, config, job!.id, owner);
    expect(extended).toBeInstanceOf(Date);

    const denied = await heartbeatJob(prisma, config, job!.id, other);
    expect(denied).toBeNull();
  });

  it('laat een nooit-opgepakte job verlopen na de wachtrij-TTL (EXPIRED)', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    await prisma.aiJob.update({
      where: { id: admission.jobId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await sweepQueue(prisma, config);
    const expired = await prisma.aiJob.findUnique({ where: { id: admission.jobId } });
    expect(expired!.status).toBe(JOB_STATUS.EXPIRED);
  });

  it('waitForJobResult wacht tot een worker het resultaat inlevert', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const tokenId = await workerId();

    // Achtergrond-"worker": claimt en voltooit terwijl waitForJobResult pollt.
    const worker = (async () => {
      const job = await claimNextJob(prisma, config, tokenId);
      await completeJob(prisma, job!.id, tokenId, decisionJson('feel'));
    })();

    const [outcome] = await Promise.all([
      waitForJobResult(prisma, config, admission.jobId),
      worker,
    ]);
    expect(outcome).toEqual({ status: 'SUCCEEDED', resultJson: decisionJson('feel') });
  });
});
