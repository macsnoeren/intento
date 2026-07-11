import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { personalContextListResponseSchema, personalContextPublicSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiProvider, AiPrompt, AiQuestionDecision } from '../ai/provider.js';
import { createEncryptor } from '../crypto/encryption.js';
import {
  deviceCookie,
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Persoonlijke-context-tests (T6.1, DESIGN §6.2, §6.3, §9.4, FR-013/020).
 *
 * Dekt de acceptatie: aanmaken/lezen door begeleider/beheerder, tenant- en begeleider-isolatie,
 * zod-validatie (ongeldige categorie → 400), gevoelige velden **versleuteld** in de db (rauwe-db-test),
 * en het AI-toestemmingsfilter: alleen context met `aiUsageAllowed=true` bereikt de prompt.
 */
describe('persoonlijke context — /users/:id/context (T6.1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('laat een ADMIN context aanmaken en teruglezen (ontsleuteld)', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const create = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: {
        category: 'PERSON',
        name: 'Anna',
        relationship: 'dochter',
        aiUsageAllowed: true,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = personalContextPublicSchema.parse(create.json());
    expect(created).toMatchObject({
      category: 'PERSON',
      name: 'Anna',
      relationship: 'dochter',
      aiUsageAllowed: true,
      userId: user.id,
    });

    const list = await app.inject({
      method: 'GET',
      url: `/users/${user.id}/context`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = personalContextListResponseSchema.parse(list.json());
    expect(body.contexts).toHaveLength(1);
    expect(body.contexts[0]).toMatchObject({ name: 'Anna', relationship: 'dochter' });
  });

  it('slaat naam/relatie versleuteld op — geen plaintext in de db (rauwe-db-test)', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: { category: 'PET', name: 'Rex', relationship: 'hond' },
    });

    // Direct uit de db lezen: de gevoelige velden mogen de plaintext nergens bevatten.
    const row = await prisma.personalContext.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.nameEncrypted).not.toContain('Rex');
    expect(row.relationshipEncrypted).not.toContain('hond');
    expect(row.aiUsageAllowed).toBe(false); // opt-in: standaard geen AI-toestemming
    // Maar met de sleutel wél terug te lezen.
    const enc = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });
    expect(enc.decrypt(row.nameEncrypted)).toBe('Rex');
    expect(enc.decrypt(row.relationshipEncrypted!)).toBe('hond');
  });

  it('weigert een ongeldige categorie met 400 VALIDATION_ERROR', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const user = await seedUser('Sanne', admin.organizationId);

    const res = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: { category: 'ALIEN', name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('weigert context van een gebruiker uit een andere organisatie met 403 (bestaan lekt niet)', async () => {
    const adminA = await seedAccount('admin.a@intento.local', 'pw-a', 'ADMIN');
    const userB = await seedUser('Gebruiker B', await seedOrganization('Org B'));

    const cookie = await loginCookie(app, adminA.email, adminA.password);
    const res = await app.inject({
      method: 'GET',
      url: `/users/${userB.id}/context`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('weigert een niet-gekoppelde CAREGIVER met 403 en staat een gekoppelde toe', async () => {
    const org = await seedOrganization('Org');
    await seedAccount('admin@intento.local', 'pw', 'ADMIN', org);
    const caregiver = await seedAccount('c@intento.local', 'pw-c', 'CAREGIVER', org);
    const user = await seedUser('Sanne', org);

    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    // Niet gekoppeld → 403.
    const denied = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: { category: 'PLACE', name: 'Het park' },
    });
    expect(denied.statusCode).toBe(403);

    // Na koppeling mag het wel (DESIGN §2: begeleider beheert context).
    await linkCaregiver(caregiver.accountId, user.id);
    const allowed = await app.inject({
      method: 'POST',
      url: `/users/${user.id}/context`,
      headers: { cookie },
      payload: { category: 'PLACE', name: 'Het park' },
    });
    expect(allowed.statusCode).toBe(201);
  });

  /**
   * Spy-provider die de laatst ontvangen prompt vasthoudt, zodat we kunnen inspecteren wélke
   * gebruikerscontext de AI daadwerkelijk bereikt (DESIGN §6.3-filter).
   */
  function spyOrchestrator(): { orchestrator: AiOrchestrator; last: () => AiPrompt | null } {
    let captured: AiPrompt | null = null;
    const provider: AiProvider = {
      name: 'spy',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        captured = prompt;
        return Promise.resolve({
          question: 'Wat wil je?',
          confidence: 0.5,
          reason: 'spy',
          options: prompt.availableSymbols.map((ref) => ({ symbol: ref.concept, confidence: 0.5 })),
        });
      },
    };
    return { orchestrator: new AiOrchestrator(provider), last: () => captured };
  }

  it('geeft alléén context met aiUsageAllowed=true door aan de AI-prompt (§6.3-filter)', async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);

    const { orchestrator, last } = spyOrchestrator();
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100' }),
      orchestrator,
    });
    const user = await seedUser('Sanne');

    // Twee context-rijen: één mét, één zonder AI-toestemming.
    const enc = createEncryptor({ ENCRYPTION_KEY: 'test-encryption-key' });
    await prisma.personalContext.create({
      data: {
        userId: user.id,
        category: 'PET',
        nameEncrypted: enc.encrypt('Rex'),
        relationshipEncrypted: enc.encrypt('hond'),
        aiUsageAllowed: true,
      },
    });
    await prisma.personalContext.create({
      data: {
        userId: user.id,
        category: 'PERSON',
        nameEncrypted: enc.encrypt('Geheime Naam'),
        relationshipEncrypted: null,
        aiUsageAllowed: false,
      },
    });

    const cookie = await deviceCookie(app, user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);

    const prompt = last();
    expect(prompt).not.toBeNull();
    // De toegestane context is er (met relatie geformatteerd); de niet-toegestane nergens.
    expect(prompt!.userContext).toEqual([{ kind: 'pet', value: 'Rex (hond)' }]);
    const serialized = JSON.stringify(prompt!.userContext);
    expect(serialized).not.toContain('Geheime Naam');

    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
  });
});
