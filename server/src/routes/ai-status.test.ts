import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { aiStatusResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createWorkerToken } from '../ai/worker-token.js';
import { WORKER_ONLINE_WINDOW_MS } from './ai-status.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * AI-status (T9.4, DESIGN §7.2, §9.2, §9.4).
 *
 * Toetst de acceptatie: bij `AI_PROVIDER=mock` meldt de status dat er géén echte AI meedenkt, bij
 * `queue` hangt het af van een recent geziene worker. Plus de toegangsgrens (account óf apparaat) en
 * de belofte dat er alleen infrastructuurmetadata uit komt.
 */
describe('AI-status — GET /ai/status (T9.4)', () => {
  let app: FastifyInstance | null = null;

  beforeEach(async () => {
    await resetAuthData();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Bouwt de app in de gevraagde AI-modus en geeft een ingelogde ADMIN-cookie terug. */
  async function withMode(mode: 'mock' | 'queue'): Promise<string> {
    app = await buildApp({
      env: testEnv({ AI_PROVIDER: mode, LOGIN_RATE_LIMIT_MAX: '100' }),
    });
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    return loginCookie(app, admin.email, admin.password);
  }

  it('meldt bij AI_PROVIDER=mock dat er geen echte AI meedenkt', async () => {
    const cookie = await withMode('mock');

    const res = await app!.inject({ method: 'GET', url: '/ai/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(aiStatusResponseSchema.parse(res.json())).toEqual({
      mode: 'mock',
      workerRequired: false,
      workersOnline: 0,
      lastSeenAt: null,
      active: false,
    });
  });

  it('meldt bij queue zonder recent geziene worker dat er geen AI actief is', async () => {
    const cookie = await withMode('queue');

    // Een token dat lang geleden voor het laatst iets deed telt niet mee: die worker is gestopt.
    const { record } = await createWorkerToken(prisma, { name: 'oude-worker' });
    await prisma.workerToken.update({
      where: { id: record.id },
      data: { lastSeenAt: new Date(Date.now() - WORKER_ONLINE_WINDOW_MS - 60_000) },
    });

    const status = aiStatusResponseSchema.parse(
      (await app!.inject({ method: 'GET', url: '/ai/status', headers: { cookie } })).json(),
    );
    expect(status.mode).toBe('queue');
    expect(status.workerRequired).toBe(true);
    expect(status.workersOnline).toBe(0);
    expect(status.active).toBe(false);
    // Het laatste activiteitsmoment blijft wél zichtbaar — handig om te zien wanneer het misging.
    expect(status.lastSeenAt).not.toBeNull();
  });

  it('meldt de AI als actief zodra een worker recent activiteit toonde', async () => {
    const cookie = await withMode('queue');

    const { record } = await createWorkerToken(prisma, { name: 'gpu-node-1' });
    await prisma.workerToken.update({
      where: { id: record.id },
      data: { lastSeenAt: new Date() },
    });

    const status = aiStatusResponseSchema.parse(
      (await app!.inject({ method: 'GET', url: '/ai/status', headers: { cookie } })).json(),
    );
    expect(status.workersOnline).toBe(1);
    expect(status.active).toBe(true);
  });

  it('telt een ingetrokken worker-token niet mee', async () => {
    const cookie = await withMode('queue');

    const { record } = await createWorkerToken(prisma, { name: 'ingetrokken' });
    await prisma.workerToken.update({
      where: { id: record.id },
      data: { lastSeenAt: new Date(), revokedAt: new Date() },
    });

    const status = aiStatusResponseSchema.parse(
      (await app!.inject({ method: 'GET', url: '/ai/status', headers: { cookie } })).json(),
    );
    expect(status.workersOnline).toBe(0);
    expect(status.active).toBe(false);
  });

  it('laat ook de tablet (device-auth) de status opvragen, maar niemand zonder auth', async () => {
    app = await buildApp({
      env: testEnv({ AI_PROVIDER: 'mock', DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
    });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);

    const ok = await app.inject({ method: 'GET', url: '/ai/status', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    // Alleen infrastructuurmetadata: geen tokennaam, gebruiker, organisatie of gespreksinhoud.
    expect(Object.keys(ok.json() as object).sort()).toEqual([
      'active',
      'lastSeenAt',
      'mode',
      'workerRequired',
      'workersOnline',
    ]);

    const anonymous = await app.inject({ method: 'GET', url: '/ai/status' });
    expect(anonymous.statusCode).toBe(401);
  });
});
