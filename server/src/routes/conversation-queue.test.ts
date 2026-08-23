import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { QueueAiProvider } from '../ai/queue-provider.js';
import { createWorkerToken } from '../ai/worker-token.js';
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  queueConfigFromEnv,
  type QueueConfig,
} from '../ai/job-queue.js';
import { AI_TASK_SELECT_NEXT_QUESTION } from '../ai/provider.js';

/**
 * Gespreksflow op de gedistribueerde AI-wachtrij (T5.5, ADR-0010). Bewijst de twee harde eisen end-to-end:
 *
 *  1. **Een onbekend concept van een worker bereikt de gebruiker nooit.** De worker levert een optie met
 *     een concept dat niet in de AAC-bibliotheek bestaat; de validatielaag (T5.2) vangt het af als
 *     `ConceptProposal` en laat het weg — precies zoals bij elke andere provider (nooit vertrouwen).
 *  2. **Backpressure geeft een WAITING-signaal i.p.v. te blokkeren.** Bij een volle wachtrij krijgt de
 *     client 503 `AI_WORKER_BUSY` met een positie, niet een hangende request.
 */
describe('gespreksflow op de AI-wachtrij — /conversation (queue-provider)', () => {
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await resetAuthData();
    await prisma.$disconnect();
  });

  function buildQueueApp(overrides: Record<string, string> = {}): {
    env: ReturnType<typeof testEnv>;
    config: QueueConfig;
    ready: Promise<FastifyInstance>;
  } {
    const env = testEnv({
      DEVICE_LINK_RATE_LIMIT_MAX: '100',
      AI_WORKER_CLAIM_LONGPOLL_MS: '0',
      AI_WORKER_POLL_INTERVAL_MS: '10',
      AI_REQUEST_TIMEOUT_MS: '1500',
      ...overrides,
    });
    const config = queueConfigFromEnv(env);
    const orchestrator = new AiOrchestrator(new QueueAiProvider(prisma, config));
    return { env, config, ready: buildApp({ env, orchestrator }) };
  }

  /** Simuleert één worker: claimt de eerstvolgende job en levert `result` in. */
  async function driveOneJob(config: QueueConfig, tokenId: string, result: unknown): Promise<void> {
    for (let i = 0; i < 300; i++) {
      const job = await claimNextJob(prisma, config, tokenId);
      if (job) {
        await completeJob(prisma, job.id, tokenId, JSON.stringify(result));
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('Geen job om te verwerken.');
  }

  it('een onbekend concept van een worker bereikt de gebruiker nooit (afgevangen als voorstel)', async () => {
    const { config, ready } = buildQueueApp();
    app = await ready;
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const { record } = await createWorkerToken(prisma, { name: 'w' });

    // De worker antwoordt met een geldig intentieconcept (`want`) én een onbekend concept.
    const startP = app.inject({ method: 'POST', url: '/conversation/start', headers: { cookie } });
    await driveOneJob(config, record.id, {
      question: 'Wat wil je duidelijk maken?',
      options: [
        { symbol: 'want', confidence: 0.9 },
        { symbol: 'zzz_onbekend_concept', confidence: 0.8 },
      ],
      reason: 'test met onbekend concept',
    });
    const res = await startP;

    expect(res.statusCode).toBe(201);
    const concepts = res.json().question.options.map((o: { concept: string }) => o.concept);
    expect(concepts).toContain('want');
    expect(concepts).not.toContain('zzz_onbekend_concept');

    // Het onbekende concept is als voorstel voor de beheerder vastgelegd (T5.2).
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'zzz_onbekend_concept' },
    });
    expect(proposal).not.toBeNull();
  });

  it('schrijft het gesprek bij de job zodat de losse aanvragen één draad vormen (T12.2)', async () => {
    const { config, ready } = buildQueueApp();
    app = await ready;
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const { record } = await createWorkerToken(prisma, { name: 'w' });

    const startP = app.inject({ method: 'POST', url: '/conversation/start', headers: { cookie } });
    await driveOneJob(config, record.id, {
      question: 'Wat wil je duidelijk maken?',
      options: [{ symbol: 'want', confidence: 0.9 }],
      reason: 'test',
    });
    const res = await startP;
    expect(res.statusCode).toBe(201);
    const sessionId = res.json().sessionId as string;

    // De sleutel reist buiten de prompt om mee (§7.7): hij staat op de job, niet in de payload.
    const jobs = await prisma.aiJob.findMany({ where: { sessionId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payloadJson).not.toContain(sessionId);
  });

  it('bij een volle wachtrij krijgt de client een WAITING-signaal (503) i.p.v. te blokkeren', async () => {
    const { config, ready } = buildQueueApp({ AI_WORKER_MAX_CONCURRENT_JOBS: '1' });
    app = await ready;
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    // Bezet de enige slot met een claimbare job zodat de volgende aanvraag over capaciteit is.
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, {
      task: AI_TASK_SELECT_NEXT_QUESTION,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe('AI_WORKER_BUSY');
    expect(body.waiting).toBe(true);
    expect(body.position).toBeGreaterThanOrEqual(1);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
