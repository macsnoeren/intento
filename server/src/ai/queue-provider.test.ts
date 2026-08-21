import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetAuthData } from '../test/auth-helpers.js';
import { createWorkerToken } from './worker-token.js';
import { claimNextJob, completeJob, enqueueJob, type QueueConfig } from './job-queue.js';
import { QueueAiProvider } from './queue-provider.js';
import { AiWorkerBusyError, AiWorkerUnavailableError } from './errors.js';
import {
  AI_TASK_GENERATE_MESSAGE,
  AI_TASK_SELECT_NEXT_QUESTION,
  type AiMessagePrompt,
  type AiPrompt,
} from './provider.js';

/**
 * `QueueAiProvider` (T5.5, ADR-0010): implementeert de `AiProvider`-interface bovenop de wachtrij. Dekt de
 * gelukkige route (queue → gesimuleerde worker → resultaat), de backpressure (busy i.p.v. blokkeren) en
 * de nette time-out wanneer geen worker antwoordt.
 */
const config: QueueConfig = {
  maxConcurrentJobs: 2,
  leaseMs: 500,
  maxAttempts: 3,
  queueTtlMs: 2000,
  pollIntervalMs: 10,
  waitTimeoutMs: 800,
  claimLongPollMs: 0,
};

const selectPrompt = {
  task: AI_TASK_SELECT_NEXT_QUESTION,
  systemRules: [],
  goal: 'g',
  aacRules: [],
  userContext: [],
  conversationContext: [],
  lastChoice: null,
  availableSymbols: [{ concept: 'want', label: 'Iets willen' }],
} satisfies AiPrompt;

const messagePrompt = {
  task: AI_TASK_GENERATE_MESSAGE,
  systemRules: [],
  goal: 'g',
  aacRules: [],
  userContext: [],
  chosenConcepts: [{ concept: 'want', label: 'Iets willen' }],
} satisfies AiMessagePrompt;

/** Simuleert één worker: claimt de eerstvolgende job en levert `resultFor(task)` in. */
async function driveOneJob(tokenId: string, resultFor: (task: string) => unknown): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const job = await claimNextJob(prisma, config, tokenId);
    if (job) {
      await completeJob(prisma, job.id, tokenId, JSON.stringify(resultFor(job.task)));
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Geen job om te verwerken.');
}

describe('QueueAiProvider', () => {
  beforeEach(async () => {
    await resetAuthData();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.$disconnect();
  });

  it('selectNextQuestion: enqueue → worker levert → gevalideerde beslissing terug', async () => {
    const provider = new QueueAiProvider(prisma, config);
    const { record } = await createWorkerToken(prisma, { name: 'w' });

    const [decision] = await Promise.all([
      provider.selectNextQuestion(selectPrompt),
      driveOneJob(record.id, () => ({
        question: 'Wat wil je?',
        options: [{ symbol: 'want', confidence: 0.9 }],
        reason: 'test',
      })),
    ]);

    expect(decision.question).toBe('Wat wil je?');
    expect(decision.options).toEqual([{ symbol: 'want', confidence: 0.9 }]);
  });

  it('generateMessage: enqueue → worker levert → gevalideerd resultaat terug', async () => {
    const provider = new QueueAiProvider(prisma, config);
    const { record } = await createWorkerToken(prisma, { name: 'w' });

    const [result] = await Promise.all([
      provider.generateMessage(messagePrompt),
      driveOneJob(record.id, () => ({ message: 'Ik wil iets.', confidence: 0.9 })),
    ]);

    expect(result.message).toBe('Ik wil iets.');
  });

  it('backpressure: bij een volle wachtrij gooit de provider AiWorkerBusyError i.p.v. te blokkeren', async () => {
    const full: QueueConfig = { ...config, maxConcurrentJobs: 1 };
    const provider = new QueueAiProvider(prisma, full);
    // Vul de enige slot met een claimbare job.
    await enqueueJob(prisma, full, AI_TASK_SELECT_NEXT_QUESTION, selectPrompt);

    await expect(provider.selectNextQuestion(selectPrompt)).rejects.toBeInstanceOf(
      AiWorkerBusyError,
    );
  });

  it('geen worker: de provider valt na de time-out netjes terug met AiWorkerUnavailableError', async () => {
    const provider = new QueueAiProvider(prisma, { ...config, waitTimeoutMs: 120 });
    await expect(provider.selectNextQuestion(selectPrompt)).rejects.toBeInstanceOf(
      AiWorkerUnavailableError,
    );
  });
});
