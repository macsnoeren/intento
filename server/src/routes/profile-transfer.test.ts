import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  personalContextListResponseSchema,
  profileExportResponseSchema,
  userPublicSchema,
  type UpdateSettingsRequest,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Profielexport/-import-tests (T8.1, DESIGN §6.4, §8.2, FR-019).
 *
 * Dekt de acceptatie: een roundtrip (export in org A → import in org B) levert een **identiek** profiel;
 * het exportbestand is onleesbaar zonder de omgevingssleutel; en de actie is ADMIN-only en tenant-gebonden.
 */
describe('profielexport/-import (T8.1)', () => {
  let app: FastifyInstance;

  /** Een bewust niet-standaard profiel, zodat de roundtrip elk veld aantoonbaar meeneemt. */
  const CUSTOM_SETTINGS: UpdateSettingsRequest = {
    iconsPerScreen: 8,
    showText: false,
    aiLearningEnabled: false,
    supportMode: true,
    contextIndicator: false,
    // Bewust niet de standaard (T11.4): een strategie die de overdracht niet overleeft, valt stil terug
    // op "stap voor stap verfijnen" en dan gedraagt het profiel zich na verhuizing anders.
    conversationStrategy: 'calm',
  };

  beforeEach(async () => {
    await resetAuthData();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Richt een gebruiker met aangepast profiel, twee stukjes context en één voorkeur in binnen `orgId`. */
  async function seedRichProfile(orgId: string): Promise<string> {
    const user = await seedUser('Emma', orgId);
    await prisma.userCommunicationProfile.update({
      where: { userId: user.id },
      data: CUSTOM_SETTINGS,
    });
    // Persoonlijke context via de admin-route, zodat de velden echt versleuteld at-rest staan.
    return user.id;
  }

  it('exporteert en importeert een identiek profiel in een andere organisatie (roundtrip)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const adminA = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookieA = await loginCookie(app, adminA.email, adminA.password);
    const userId = await seedRichProfile(adminA.organizationId);

    // Twee stukjes context: één met relatie + AI-toestemming, één zonder.
    for (const body of [
      { category: 'PERSON', name: 'Lisa', relationship: 'zus', aiUsageAllowed: true },
      { category: 'FOOD', name: 'Appelmoes' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/users/${userId}/context`,
        headers: { cookie: cookieA },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
    }
    // Eén geleerde voorkeur (rechtstreeks; leren zelf is in T6.3 gedekt).
    await prisma.preference.create({
      data: { userId, concept: 'walking', confidence: 0.6, count: 3, suggestionStatus: 'pending' },
    });

    const exportRes = await app.inject({
      method: 'GET',
      url: `/users/${userId}/export`,
      headers: { cookie: cookieA },
    });
    expect(exportRes.statusCode).toBe(200);
    const { data } = profileExportResponseSchema.parse(exportRes.json());

    // Tweede organisatie/admin importeert het profiel.
    const adminB = await seedAccount('b@intento.local', 'pw', 'ADMIN');
    const cookieB = await loginCookie(app, adminB.email, adminB.password);
    const importRes = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie: cookieB },
      payload: { data },
    });
    expect(importRes.statusCode).toBe(201);
    const imported = userPublicSchema.parse(importRes.json());

    // Nieuwe gebruiker in org B met identieke naam + instellingen.
    expect(imported.organizationId).toBe(adminB.organizationId);
    expect(imported.name).toBe('Emma');
    expect(imported.communicationProfile).toEqual(CUSTOM_SETTINGS);

    // Context roundtript identiek (en blijft versleuteld at-rest in org B).
    const ctxRes = await app.inject({
      method: 'GET',
      url: `/users/${imported.id}/context`,
      headers: { cookie: cookieB },
    });
    const { contexts } = personalContextListResponseSchema.parse(ctxRes.json());
    expect(
      contexts.map((c) => ({
        category: c.category,
        name: c.name,
        relationship: c.relationship,
        aiUsageAllowed: c.aiUsageAllowed,
      })),
    ).toEqual([
      { category: 'PERSON', name: 'Lisa', relationship: 'zus', aiUsageAllowed: true },
      { category: 'FOOD', name: 'Appelmoes', relationship: null, aiUsageAllowed: false },
    ]);
    const rawCtx = await prisma.personalContext.findFirst({ where: { userId: imported.id } });
    expect(rawCtx!.nameEncrypted).not.toContain('Lisa');

    // Voorkeur roundtript identiek.
    const prefs = await prisma.preference.findMany({ where: { userId: imported.id } });
    expect(prefs).toHaveLength(1);
    expect(prefs[0]).toMatchObject({
      concept: 'walking',
      confidence: 0.6,
      count: 3,
      source: 'confirmed_usage',
      suggestionStatus: 'pending',
    });
  });

  it('kan de weergavenaam bij import overschrijven', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const userId = await seedRichProfile(admin.organizationId);

    const { data } = profileExportResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/users/${userId}/export`, headers: { cookie } })
      ).json(),
    );
    const importRes = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie },
      payload: { data, name: 'Emma (kopie)' },
    });
    expect(userPublicSchema.parse(importRes.json()).name).toBe('Emma (kopie)');
  });

  it('maakt een exportbestand dat onleesbaar is zonder de juiste sleutel', async () => {
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', ENCRYPTION_KEY: 'sleutel-een' }),
    });
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);
    const userId = await seedRichProfile(admin.organizationId);
    await app.inject({
      method: 'POST',
      url: `/users/${userId}/context`,
      headers: { cookie },
      payload: { category: 'PERSON', name: 'Geheimnaam' },
    });

    const { data } = profileExportResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/users/${userId}/export`, headers: { cookie } })
      ).json(),
    );
    // De ondoorzichtige payload lekt geen plaintext PII.
    expect(data).not.toContain('Geheimnaam');
    expect(data).not.toContain('Emma');
    await app.close();

    // Een omgeving met een ándere sleutel kan het bestand niet lezen → 400 IMPORT_INVALID.
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', ENCRYPTION_KEY: 'sleutel-twee' }),
    });
    const other = await seedAccount('c@intento.local', 'pw', 'ADMIN');
    const cookie2 = await loginCookie(app, other.email, other.password);
    const res = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie: cookie2 },
      payload: { data },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IMPORT_INVALID');
  });

  it('weigert import van beschadigde/ongeldige data met 400', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie },
      payload: { data: 'dit-is-geen-geldig-exportbestand' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IMPORT_INVALID');
  });

  it('weigert export van een gebruiker uit een andere organisatie (403, bestaan lekt niet)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const adminA = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const cookieA = await loginCookie(app, adminA.email, adminA.password);
    const userB = await seedUser('Bram'); // andere organisatie

    const res = await app.inject({
      method: 'GET',
      url: `/users/${userB.id}/export`,
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(403);
  });

  it('staat export/import alleen toe voor een ADMIN (CAREGIVER → 403)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN');
    const caregiver = await seedAccount(
      'cg@intento.local',
      'pw',
      'CAREGIVER',
      admin.organizationId,
    );
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const userId = await seedRichProfile(admin.organizationId);

    const exportRes = await app.inject({
      method: 'GET',
      url: `/users/${userId}/export`,
      headers: { cookie: cgCookie },
    });
    expect(exportRes.statusCode).toBe(403);

    const importRes = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie: cgCookie },
      payload: { data: 'x' },
    });
    expect(importRes.statusCode).toBe(403);
  });

  it('eist een geverifieerd e-mailadres voor import (onbevestigd → 403)', async () => {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
    const admin = await seedAccount('a@intento.local', 'pw', 'ADMIN', undefined, {
      emailVerified: false,
    });
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({
      method: 'POST',
      url: '/users/import',
      headers: { cookie },
      payload: { data: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
