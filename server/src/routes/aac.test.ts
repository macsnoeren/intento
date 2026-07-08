import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { aacSearchResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { createLinkCode } from '../auth/device.js';
import { seedAacLibrary } from '../aac/library.js';
import {
  deviceCookieHeader,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * AAC-bibliotheektests (T3.1, DESIGN §6.2, §8.2, FR-015).
 *
 * Dekt de acceptatie: seed draait schoon, de zoek-API vindt op synoniem (hoofdletterongevoelig),
 * pictogramafbeeldingen zijn bereikbaar, en de bibliotheek is niet publiek — een ingelogd account
 * óf een gekoppeld apparaat mag zoeken, anders 401.
 */
describe('AAC-bibliotheek — /aac', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    // AAC is niet tenant-gebonden en wordt door resetAuthData niet aangeraakt; idempotent (her)seeden.
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  it('seedt de bibliotheek met symbolen én relaties (voorbeeldroute §3.1)', async () => {
    const symbolCount = await prisma.aacSymbol.count();
    const relationCount = await prisma.aacConceptRelation.count();
    expect(symbolCount).toBeGreaterThan(20);
    expect(relationCount).toBeGreaterThan(0);

    // De route uit DESIGN §3.1 moet als relatie bestaan: "buiten" → "wandelen".
    const outside = await prisma.aacSymbol.findUnique({ where: { concept: 'outside' } });
    const walking = await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } });
    const relation = await prisma.aacConceptRelation.findFirst({
      where: { parentId: outside?.id, childId: walking?.id },
    });
    expect(relation).not.toBeNull();
  });

  it('herseeden is idempotent (geen dubbele symbolen of relaties)', async () => {
    const before = await prisma.aacSymbol.count();
    const relBefore = await prisma.aacConceptRelation.count();
    await seedAacLibrary(prisma);
    expect(await prisma.aacSymbol.count()).toBe(before);
    expect(await prisma.aacConceptRelation.count()).toBe(relBefore);
  });

  it('vindt een symbool op synoniem', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    // "lopen" is een synoniem van concept "walking" (label "Wandelen").
    const res = await app.inject({ method: 'GET', url: '/aac/search?q=lopen', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = aacSearchResponseSchema.parse(res.json());
    const concepts = body.symbols.map((s) => s.concept);
    expect(concepts).toContain('walking');
    // Het gevonden symbool draagt een bereikbare afbeeldings-URL en zijn synoniemen.
    const walking = body.symbols.find((s) => s.concept === 'walking');
    expect(walking?.imageUrl).toBe(`/aac/images/${walking?.id}.svg`);
    expect(walking?.synonyms).toContain('lopen');
  });

  it('zoekt hoofdletterongevoelig en ook op concept en label', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    for (const q of ['LOPEN', 'walking', 'Wandelen']) {
      const res = await app.inject({
        method: 'GET',
        url: `/aac/search?q=${encodeURIComponent(q)}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = aacSearchResponseSchema.parse(res.json());
      expect(body.symbols.map((s) => s.concept)).toContain('walking');
    }
  });

  it('weigert een lege zoekterm met 400', async () => {
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, admin.email, admin.password);

    const res = await app.inject({ method: 'GET', url: '/aac/search?q=', headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it('weigert zoeken zonder authenticatie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/aac/search?q=lopen' });
    expect(res.statusCode).toBe(401);
  });

  it('laat een gekoppeld apparaat (device-token) zoeken', async () => {
    const user = await seedUser('Sanne');
    const { code } = await createLinkCode(prisma, user.id, 15);
    const linkRes = await app.inject({
      method: 'POST',
      url: '/devices/link',
      payload: { code },
    });
    expect(linkRes.statusCode).toBe(201);
    const deviceCookie = deviceCookieHeader(linkRes);
    expect(deviceCookie).toBeDefined();

    const res = await app.inject({
      method: 'GET',
      url: '/aac/search?q=water',
      headers: { cookie: deviceCookie! },
    });
    expect(res.statusCode).toBe(200);
    const body = aacSearchResponseSchema.parse(res.json());
    expect(body.symbols.map((s) => s.concept)).toContain('water');
  });

  it('serveert een pictogram als SVG en is bereikbaar zonder login', async () => {
    const walking = await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } });
    const res = await app.inject({ method: 'GET', url: `/aac/images/${walking?.id}.svg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Wandelen');
  });

  it('geeft 404 voor een onbekend pictogram', async () => {
    const res = await app.inject({ method: 'GET', url: '/aac/images/nonexistent.svg' });
    expect(res.statusCode).toBe(404);
  });
});
