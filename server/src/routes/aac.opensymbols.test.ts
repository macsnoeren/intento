import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { aacSymbolAdminSchema, openSymbolsSearchResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import {
  assertSafeImageUrl,
  mapOpenSymbolsResults,
  type FetchedImage,
  type OpenSymbolsClient,
} from '../aac/opensymbols.js';
import { HttpError } from '../errors.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * Tests voor de OpenSymbols-integratie (T3.3, DESIGN §6.2, §8.2, FR-015).
 *
 * Dekt de acceptatie: een beheerder zoekt op een concept en ziet OpenSymbols-resultaten; koppelt er
 * één en de afbeelding wordt lokaal opgeslagen met licentie/bron; externe fout of leeg resultaat
 * wordt netjes afgehandeld; geen niet-https-URL passeert de validatie. De externe dienst is een
 * injecteerbare mock — er gaat geen echt netwerkverkeer naartoe.
 */

/** Bouwbare mock-client; per test in te stellen op resultaten, image-bytes of fouten. */
function mockOpenSymbols(overrides: Partial<OpenSymbolsClient> = {}): OpenSymbolsClient {
  return {
    isConfigured: () => true,
    search: () =>
      Promise.resolve([
        {
          id: 'os-1',
          name: 'hond',
          imageUrl: 'https://cdn.example.org/os-1.png',
          extension: 'png',
          license: 'CC BY-SA',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          author: 'ARASAAC',
          authorUrl: 'https://arasaac.org',
          sourceUrl: 'https://www.opensymbols.org/symbols/os-1',
        },
      ]),
    fetchImage: (): Promise<FetchedImage> =>
      Promise.resolve({ contentType: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) }),
    ...overrides,
  };
}

describe('OpenSymbols-integratie — /admin/aac/opensymbols', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminEmail: string;
  let adminPassword: string;

  async function rebuildApp(openSymbols: OpenSymbolsClient): Promise<void> {
    if (app) await app.close();
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }),
      openSymbols,
    });
    adminCookie = await loginCookie(app, adminEmail, adminPassword);
  }

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    const admin = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    adminEmail = admin.email;
    adminPassword = admin.password;
    await rebuildApp(mockOpenSymbols());
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  it('geeft OpenSymbols-zoekresultaten terug (proxy)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/opensymbols/search?q=hond',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { results } = openSymbolsSearchResponseSchema.parse(res.json());
    expect(results).toHaveLength(1);
    expect(results[0]!.imageUrl.startsWith('https://')).toBe(true);
  });

  it('koppelt een gekozen afbeelding lokaal met licentie/bron en serveert die daarna', async () => {
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: {
        imageUrl: 'https://cdn.example.org/os-1.png',
        license: 'CC BY-SA',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        author: 'ARASAAC',
        authorUrl: 'https://arasaac.org',
        sourceUrl: 'https://www.opensymbols.org/symbols/os-1',
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = aacSymbolAdminSchema.parse(res.json());
    expect(updated.hasImage).toBe(true);
    expect(updated.imageUrl).toContain('?v=');
    expect(updated.attribution).toMatchObject({ license: 'CC BY-SA', author: 'ARASAAC' });

    // De bytes worden nu lokaal geserveerd (geen externe redirect).
    const img = await app.inject({ method: 'GET', url: `/aac/images/${dog!.id}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);

    // In de db staat de bron/licentie vast (attributie reist mee).
    const stored = await prisma.aacSymbol.findUnique({ where: { id: dog!.id } });
    expect(stored!.imageLicense).toBe('CC BY-SA');
    expect(stored!.imageSourceUrl).toBe('https://www.opensymbols.org/symbols/os-1');
  });

  it('weigert een niet-https bron-URL (400)', async () => {
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: { imageUrl: 'http://cdn.example.org/os-1.png', license: 'CC BY-SA' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('weigert een https-URL naar een interne/loopback-host (SSRF, 400)', async () => {
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: { imageUrl: 'https://127.0.0.1/secret.png', license: 'CC BY-SA' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_IMAGE_URL');
  });

  it('weigert een niet-ondersteund content-type van de bron (415)', async () => {
    await rebuildApp(
      mockOpenSymbols({
        fetchImage: () =>
          Promise.resolve({ contentType: 'image/svg+xml', bytes: new Uint8Array([1, 2]) }),
      }),
    );
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: { imageUrl: 'https://cdn.example.org/os-1.svg', license: 'CC BY-SA' },
    });
    expect(res.statusCode).toBe(415);
  });

  it('weigert een te grote afbeelding (413)', async () => {
    await rebuildApp(
      mockOpenSymbols({
        fetchImage: () =>
          Promise.resolve({ contentType: 'image/png', bytes: new Uint8Array(2_000_000) }),
      }),
    );
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: { imageUrl: 'https://cdn.example.org/big.png', license: 'CC BY-SA' },
    });
    expect(res.statusCode).toBe(413);
  });

  it('geeft 502 bij een externe fout tijdens ophalen', async () => {
    await rebuildApp(
      mockOpenSymbols({ fetchImage: () => Promise.reject(new Error('netwerk kapot')) }),
    );
    const dog = await prisma.aacSymbol.findUnique({ where: { concept: 'dog' } });
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${dog!.id}/opensymbols`,
      headers: { cookie: adminCookie },
      payload: { imageUrl: 'https://cdn.example.org/os-1.png', license: 'CC BY-SA' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('OPENSYMBOLS_ERROR');
  });

  it('geeft 502 bij een externe fout tijdens zoeken', async () => {
    await rebuildApp(mockOpenSymbols({ search: () => Promise.reject(new Error('down')) }));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/opensymbols/search?q=hond',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(502);
  });

  it('geeft 503 als OpenSymbols niet geconfigureerd is', async () => {
    await rebuildApp(mockOpenSymbols({ isConfigured: () => false }));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/opensymbols/search?q=hond',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('OPENSYMBOLS_UNAVAILABLE');
  });

  it('geeft een lege resultatenlijst netjes terug', async () => {
    await rebuildApp(mockOpenSymbols({ search: () => Promise.resolve([]) }));
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/opensymbols/search?q=nietsgevonden',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(openSymbolsSearchResponseSchema.parse(res.json()).results).toEqual([]);
  });

  it('weigert een niet-admin (caregiver) met 403', async () => {
    const caregiver = await seedAccount('cg@intento.local', 'pw', 'CAREGIVER');
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/opensymbols/search?q=hond',
      headers: { cookie: cgCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('OpenSymbols-hulpfuncties', () => {
  it('laat alleen https-afbeeldings-URL’s door de sanering (mapOpenSymbolsResults)', () => {
    const results = mapOpenSymbolsResults([
      { id: 1, name: 'ok', image_url: 'https://cdn.example.org/a.png', license: 'CC0' },
      { id: 2, name: 'onveilig-http', image_url: 'http://cdn.example.org/b.png', license: 'CC0' },
      { id: 3, name: 'geen-url', license: 'CC0' },
    ]);
    expect(results.map((r) => r.name)).toEqual(['ok']);
    expect(results[0]!.imageUrl.startsWith('https://')).toBe(true);
  });

  it('assertSafeImageUrl weigert niet-https en interne hosts', () => {
    expect(() => assertSafeImageUrl('http://example.org/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://localhost/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://10.0.0.5/a.png')).toThrow(HttpError);
    expect(() => assertSafeImageUrl('https://[::1]/a.png')).toThrow(HttpError);
    // Een normale publieke https-URL is prima.
    expect(assertSafeImageUrl('https://cdn.example.org/a.png').hostname).toBe('cdn.example.org');
  });
});
