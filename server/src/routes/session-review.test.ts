import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  communicationTurnSchema,
  sessionListResponseSchema,
  sessionReviewSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  deviceCookie,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';
import { createVocabularyItem } from '../test/vocabulary-helpers.js';
import { fakeAgents } from '../test/agent-helpers.js';

/** Een gesprek terugzien (N14.1, INTENTO-NEW-DESIGN §26, §27, §49). */

const PASSWORD = 'correct horse battery staple';

describe('gesprekken terugzien', () => {
  let app: FastifyInstance;
  let org: string;
  let sanne: { id: string };

  beforeEach(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '1000' }),
      agents: fakeAgents(),
    });
    org = await seedOrganization();
    await createVocabularyItem(prisma, { label: 'pijn', concept: 'pain' });
    sanne = await seedUser('Sanne', org);
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
    await prisma.vocabularyItem.deleteMany();
  });

  async function admin(email: string, organizationId: string): Promise<string> {
    await seedAccount(email, PASSWORD, 'ADMIN', organizationId);
    return loginCookie(app, email, PASSWORD);
  }

  /** Start → JA (pijn) → JA (Bedoel je): klaar. */
  async function conversation(userId: string): Promise<string> {
    const cookie = await deviceCookie(app, userId);
    const res = await app.inject({
      method: 'POST',
      url: '/communication/sessions',
      headers: { cookie },
    });
    let screen = communicationTurnSchema.parse(res.json());
    for (let i = 0; i < 2; i += 1) {
      const next = await app.inject({
        method: 'POST',
        url: `/communication/sessions/${screen.sessionId}/answer`,
        headers: { cookie },
        payload: { turn: screen.turn, answer: 'yes', responseTimeMs: 1500 },
      });
      screen = communicationTurnSchema.parse(next.json());
    }
    expect(screen.presentation.kind).toBe('done');
    return screen.sessionId;
  }

  function review(cookie: string, sessionId: string) {
    return app.inject({
      method: 'GET',
      url: `/communication/sessions/${sessionId}/provenance`,
      headers: { cookie },
    });
  }

  function list(cookie: string, userId: string, query = '') {
    return app.inject({
      method: 'GET',
      url: `/users/${userId}/sessions${query}`,
      headers: { cookie },
    });
  }

  it('per beurt Getoond, Gekozen en Gedacht apart, met de agentbeslissingen; geaudit', async () => {
    const sessionId = await conversation(sanne.id);
    const cookie = await admin('a@intento.local', org);

    const res = await review(cookie, sessionId);
    expect(res.statusCode).toBe(200);
    const body = sessionReviewSchema.parse(res.json());
    expect(body.session).toMatchObject({
      id: sessionId,
      user: { name: 'Sanne' },
      status: 'confirmed',
    });
    expect(body.turns.map((t) => t.turn)).toEqual([0, 1, 2]);

    const [first, second, last] = body.turns;
    expect(first?.presented).toMatchObject({ kind: 'question', mode: 'binary', text: 'Pijn?' });
    expect(first?.presented?.options[0]).toMatchObject({ label: 'pijn', position: 0 });
    expect(first?.observed.map((o) => o.type)).toEqual(['start', 'answer_yes']);
    expect(first?.observed[1]?.responseTimeMs).toBe(1500);
    expect(first?.inferred[0]).toMatchObject({ agent: 'intent-agent', kind: 'intent_hypotheses' });
    expect(first?.decisions[0]).toMatchObject({ agent: 'question-agent', status: 'success' });
    expect(second?.presented?.kind).toBe('confirm_message');
    expect(last?.presented).toMatchObject({ kind: 'done', message: 'Pijn' });
    expect(last?.observed).toEqual([]);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session.view' } });
    expect(audit).toMatchObject({ targetType: 'communicationSession', targetId: sessionId });
    expect(JSON.stringify(audit)).not.toContain('Pijn');
  });

  it('het overzicht: nieuwste eerst, met status en aantal schermen; bladeren', async () => {
    const first = await conversation(sanne.id);
    const second = await conversation(sanne.id);
    const cookie = await admin('a@intento.local', org);

    const body = sessionListResponseSchema.parse((await list(cookie, sanne.id)).json());
    expect(body.total).toBe(2);
    expect(body.items.map((s) => [s.id, s.status, s.screens])).toEqual([
      [second, 'confirmed', 3],
      [first, 'confirmed', 3],
    ]);
    const page2 = sessionListResponseSchema.parse(
      (await list(cookie, sanne.id, '?page=2&pageSize=1')).json(),
    );
    expect(page2.items.map((s) => s.id)).toEqual([first]);
    expect((await list(cookie, sanne.id, '?pageSize=500')).statusCode).toBe(400);
  });

  it('isoleert: een beheerder van een andere organisatie ziet niets (403, ook bij een onbekend id)', async () => {
    const sessionId = await conversation(sanne.id);
    const other = await admin('b@intento.local', await seedOrganization('Ander'));
    expect((await review(other, sessionId)).statusCode).toBe(403);
    expect((await review(other, 'bestaat-niet')).statusCode).toBe(403);
    expect((await list(other, sanne.id)).statusCode).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'session.view' } })).toBe(0);
  });

  it('alleen de beheerder: een begeleider krijgt 403, zonder login 401', async () => {
    const sessionId = await conversation(sanne.id);
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    expect((await review(cookie, sessionId)).statusCode).toBe(403);
    expect((await list(cookie, sanne.id)).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/communication/sessions/${sessionId}/provenance`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
