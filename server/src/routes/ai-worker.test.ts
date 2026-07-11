import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { resetAuthData, testEnv } from '../test/auth-helpers.js';
import type { Env } from '../env.js';
import { createWorkerToken, revokeWorkerToken } from '../ai/worker-token.js';
import { enqueueJob, queueConfigFromEnv, JOB_STATUS, type QueueConfig } from '../ai/job-queue.js';
import { AI_TASK_SELECT_NEXT_QUESTION } from '../ai/provider.js';

/**
 * Worker-endpoints voor de gedistribueerde AI-wachtrij (T5.5, DESIGN §9.4, ADR-0010).
 *
 * Dekt de acceptatie op HTTP-niveau: claim → resultaat met een geldig worker-token; auth (ontbrekend/
 * ongeldig → 401, ingetrokken/verkeerde-scope → 403); en de validatie op de grens (een verkeerd gevormd
 * resultaat → 400, bereikt de wachtrij nooit).
 */
describe('worker-endpoints — /ai/worker', () => {
  let app: FastifyInstance;
  let env: Env;
  let config: QueueConfig;

  const payload = {
    task: AI_TASK_SELECT_NEXT_QUESTION,
    availableSymbols: [{ concept: 'want', label: 'Iets willen' }],
  };
  const validResult = {
    question: 'Wat wil je?',
    options: [{ symbol: 'want', confidence: 0.9 }],
    reason: 'test',
  };

  beforeEach(async () => {
    await resetAuthData();
    // Long-poll uit zodat claim in tests direct antwoordt.
    env = testEnv({ AI_WORKER_CLAIM_LONGPOLL_MS: '0' });
    config = queueConfigFromEnv(env);
    app = await buildApp({ env });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.$disconnect();
  });

  async function bearer(scopes?: string[]): Promise<string> {
    const { token } = await createWorkerToken(prisma, { name: 'w', scopes });
    return `Bearer ${token}`;
  }

  it('weigert zonder token (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/worker/claim' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('WORKER_UNAUTHENTICATED');
  });

  it('weigert een onbekend token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: 'Bearer wrk_onzin' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('weigert een ingetrokken token (403)', async () => {
    const { record, token } = await createWorkerToken(prisma, { name: 'oud' });
    await revokeWorkerToken(prisma, record.id);
    const res = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WORKER_TOKEN_INACTIVE');
  });

  it('weigert een token zonder de vereiste scope (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: await bearer(['iets:anders']) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WORKER_SCOPE_DENIED');
  });

  it('claim geeft 204 als er niets in de wachtrij staat', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: await bearer() },
    });
    expect(res.statusCode).toBe(204);
  });

  it('volledige route: enqueue → claim (HTTP) → resultaat (HTTP) → job SUCCEEDED', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const auth = await bearer();

    const claim = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: auth },
    });
    expect(claim.statusCode).toBe(200);
    const claimed = claim.json();
    expect(claimed.job.id).toBe(admission.jobId);
    expect(claimed.job.task).toBe(AI_TASK_SELECT_NEXT_QUESTION);
    // De worker krijgt de beperkte prompt-context als payload terug.
    expect(claimed.job.payload.availableSymbols).toEqual(payload.availableSymbols);

    const result = await app.inject({
      method: 'POST',
      url: `/ai/worker/jobs/${admission.jobId}/result`,
      headers: { authorization: auth },
      payload: validResult,
    });
    expect(result.statusCode).toBe(200);

    const job = await prisma.aiJob.findUnique({ where: { id: admission.jobId } });
    expect(job!.status).toBe(JOB_STATUS.SUCCEEDED);
    expect(JSON.parse(job!.resultJson!)).toEqual(validResult);
  });

  it('weigert een verkeerd gevormd resultaat op de grens (400) — bereikt de wachtrij nooit', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const auth = await bearer();
    await app.inject({ method: 'POST', url: '/ai/worker/claim', headers: { authorization: auth } });

    const bad = await app.inject({
      method: 'POST',
      url: `/ai/worker/jobs/${admission.jobId}/result`,
      headers: { authorization: auth },
      // Ongeldig: `options[].confidence` buiten [0,1] en `question` leeg.
      payload: { question: '', options: [{ symbol: 'want', confidence: 2 }], reason: 'x' },
    });
    expect(bad.statusCode).toBe(400);

    const job = await prisma.aiJob.findUnique({ where: { id: admission.jobId } });
    expect(job!.status).toBe(JOB_STATUS.CLAIMED);
    expect(job!.resultJson).toBeNull();
  });

  it('een resultaat op een niet-geclaimde job wordt geweigerd (409)', async () => {
    const admission = await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const res = await app.inject({
      method: 'POST',
      url: `/ai/worker/jobs/${admission.jobId}/result`,
      headers: { authorization: await bearer() },
      payload: validResult,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('JOB_NOT_CLAIMED');
  });

  it('heartbeat verlengt de lease van een geclaimde job', async () => {
    await enqueueJob(prisma, config, AI_TASK_SELECT_NEXT_QUESTION, payload);
    const auth = await bearer();
    const claim = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: auth },
    });
    const jobId = claim.json().job.id;

    const hb = await app.inject({
      method: 'POST',
      url: `/ai/worker/jobs/${jobId}/heartbeat`,
      headers: { authorization: auth },
    });
    expect(hb.statusCode).toBe(200);
    expect(typeof hb.json().leaseExpiresAt).toBe('string');
  });
});
