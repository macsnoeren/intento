import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createWorkerTokenResponseSchema,
  workerTokenListResponseSchema,
  workerTokenPublicSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * Beheer-endpoints voor worker-tokens (T5.8, DESIGN §5.2, §9.4, ADR-0010).
 *
 * Dekt de acceptatie: een **platform-ADMIN** maakt/lijst/trekt een worker-token in via de API; het
 * rauwe token verschijnt alléén bij aanmaken; een ingetrokken token wordt door `workerAuthorize`
 * geweigerd (403). En de autorisatiegrens: een niet-platform-ADMIN krijgt 403, ongeauthenticeerd 401.
 */

/** Maakt de platformorganisatie (isPlatform) + een ADMIN daarin. */
async function seedPlatformAdmin(email = 'ops@intento.local', password = 'pw-platform-admin') {
  const org = await prisma.organization.create({
    data: { name: 'Platform', type: 'family', isPlatform: true },
  });
  return seedAccount(email, password, 'ADMIN', org.id);
}

describe('worker-tokenbeheer — /admin/worker-tokens', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    // Long-poll uit (`…_MS: '0'`): de claim-rooktest mag niet blokkeren als er geen job is (→ 204).
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', AI_WORKER_CLAIM_LONGPOLL_MS: '0' }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('weigert zonder sessie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/worker-tokens' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
  });

  it('weigert een niet-platform-ADMIN met 403 NOT_PLATFORM_ADMIN', async () => {
    // Gewone (zelf-aangemelde) organisatie: admin, maar niet platform.
    const { email, password } = await seedAccount('admin@familie.local', 'pw-familie', 'ADMIN');
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/worker-tokens',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_PLATFORM_ADMIN' } });
  });

  it('weigert een CAREGIVER in de platformorganisatie met 403 FORBIDDEN (rol vóór platform-check)', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Platform', type: 'family', isPlatform: true },
    });
    const { email, password } = await seedAccount('cg@intento.local', 'pw-cg', 'CAREGIVER', org.id);
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/worker-tokens',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('maakt een worker-token aan (rauw token één keer), lijst en trekt het in — ingetrokken token geweigerd door workerAuthorize', async () => {
    const admin = await seedPlatformAdmin();
    const cookie = await loginCookie(app, admin.email, admin.password);

    // Aanmaken → rauw token in de respons.
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/worker-tokens',
      headers: { cookie },
      payload: { name: 'gpu-node-1' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createWorkerTokenResponseSchema.parse(createRes.json());
    expect(created.token).toMatch(/^wrk_/);
    expect(created.workerToken.name).toBe('gpu-node-1');
    expect(created.workerToken.status).toBe('active');
    expect(created.workerToken.scopes).toContain('ai:process');
    const rawToken = created.token;
    const tokenId = created.workerToken.id;

    // Het rauwe token wordt nergens plaintext opgeslagen (alleen de hash in de db).
    const stored = await prisma.workerToken.findUniqueOrThrow({ where: { id: tokenId } });
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.tokenHash).not.toContain(rawToken);

    // Lijst bevat het token, zonder ergens het rauwe token/de hash te lekken.
    const listRes = await app.inject({
      method: 'GET',
      url: '/admin/worker-tokens',
      headers: { cookie },
    });
    expect(listRes.statusCode).toBe(200);
    const list = workerTokenListResponseSchema.parse(listRes.json());
    expect(list.tokens).toHaveLength(1);
    expect(listRes.body).not.toContain(rawToken);
    expect(listRes.body).not.toContain(stored.tokenHash);

    // Vóór intrekken: het token werkt op een worker-endpoint (geen jobs → 204).
    const claimBefore = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(claimBefore.statusCode).toBe(204);

    // Intrekken.
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/admin/worker-tokens/${tokenId}/revoke`,
      headers: { cookie },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(workerTokenPublicSchema.parse(revokeRes.json()).status).toBe('revoked');

    // Ná intrekken: workerAuthorize weigert het token (403 WORKER_TOKEN_INACTIVE).
    const claimAfter = await app.inject({
      method: 'POST',
      url: '/ai/worker/claim',
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(claimAfter.statusCode).toBe(403);
    expect(claimAfter.json()).toMatchObject({ error: { code: 'WORKER_TOKEN_INACTIVE' } });
  });

  it('valideert de invoer (lege naam → 400)', async () => {
    const admin = await seedPlatformAdmin();
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/worker-tokens',
      headers: { cookie },
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('geeft 404 bij intrekken van een onbekend token', async () => {
    const admin = await seedPlatformAdmin();
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/worker-tokens/does-not-exist/revoke',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'WORKER_TOKEN_NOT_FOUND' } });
  });
});
