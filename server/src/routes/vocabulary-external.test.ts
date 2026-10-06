import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { externalSearchResponseSchema, type OpenSymbolsResult } from '@intento/shared';
import { buildApp } from '../app.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  testEnv,
} from '../test/auth-helpers.js';
import type { OpenSymbolsClient } from '../vocabulary/opensymbols.js';

/** Zoeken in een externe bron (N8.4, INTENTO-NEW-DESIGN §15). */

const PASSWORD = 'correct horse battery staple';

function result(id: string, license: string, licenseUrl: string | null = null): OpenSymbolsResult {
  return {
    id,
    name: `symbool ${id}`,
    imageUrl: `https://example.org/${id}.png`,
    extension: 'png',
    license,
    licenseUrl,
    author: 'Iemand',
    authorUrl: null,
    sourceUrl: null,
  };
}

function fakeOpenSymbols(
  results: OpenSymbolsResult[] | Error,
  configured = true,
): OpenSymbolsClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    isConfigured: () => configured,
    search(query) {
      queries.push(query);
      return results instanceof Error ? Promise.reject(results) : Promise.resolve(results);
    },
    fetchImage: () => Promise.reject(new Error('niet in deze test')),
  };
}

describe('GET /vocabulary/external/search', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await resetAuthData();
  });

  async function start(client: OpenSymbolsClient, role = 'ADMIN') {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }), openSymbols: client });
    const org = await seedOrganization();
    await seedAccount('x@intento.local', PASSWORD, role, org);
    return loginCookie(app, 'x@intento.local', PASSWORD);
  }

  function search(cookie: string, q: string) {
    return app.inject({
      method: 'GET',
      url: `/vocabulary/external/search?q=${encodeURIComponent(q)}`,
      headers: { cookie },
    });
  }

  it('geeft resultaten met licentiesleutel en of die toegestaan is', async () => {
    const client = fakeOpenSymbols([
      result('1', 'CC BY-SA', 'https://creativecommons.org/licenses/by-sa/4.0/'),
      result('2', 'CC BY-NC-SA'),
      result('3', 'public domain'),
      result('4', 'onbekend'),
    ]);
    const cookie = await start(client);
    const res = await search(cookie, ' duizelig ');
    expect(res.statusCode).toBe(200);
    const body = externalSearchResponseSchema.parse(res.json());
    expect(body.results.map((r) => [r.id, r.licenseKey, r.allowed])).toEqual([
      ['1', 'CC-BY-SA-4.0', true],
      ['2', 'CC-BY-NC-SA', false],
      ['3', 'CC0', true],
      ['4', 'UNKNOWN', false],
    ]);
    expect(client.queries).toEqual(['duizelig']);
  });

  it('volgt VOCABULARY_ALLOWED_LICENSES', async () => {
    const client = fakeOpenSymbols([result('1', 'CC BY-SA 4.0')]);
    app = await buildApp({
      env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', VOCABULARY_ALLOWED_LICENSES: 'CC0' }),
      openSymbols: client,
    });
    const org = await seedOrganization();
    await seedAccount('x@intento.local', PASSWORD, 'ADMIN', org);
    const cookie = await loginCookie(app, 'x@intento.local', PASSWORD);
    const body = externalSearchResponseSchema.parse((await search(cookie, 'pijn')).json());
    expect(body.results[0]?.allowed).toBe(false);
  });

  it('alleen de beheerder', async () => {
    const client = fakeOpenSymbols([result('1', 'CC0')]);
    const cookie = await start(client, 'CAREGIVER');
    expect((await search(cookie, 'pijn')).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/vocabulary/external/search?q=pijn' })).statusCode,
    ).toBe(401);
    expect(client.queries).toEqual([]);
  });

  it('valideert de zoekopdracht', async () => {
    const cookie = await start(fakeOpenSymbols([]));
    expect((await search(cookie, '   ')).statusCode).toBe(400);
    expect((await search(cookie, 'x'.repeat(101))).statusCode).toBe(400);
  });

  it('503 zonder configuratie, 502 als de bron faalt', async () => {
    const off = await start(fakeOpenSymbols([], false));
    const res = await search(off, 'pijn');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'EXTERNAL_SOURCE_UNAVAILABLE' } });
    await app.close();
    await resetAuthData();

    const failing = await start(fakeOpenSymbols(new Error('ECONNRESET')));
    const broken = await search(failing, 'pijn');
    expect(broken.statusCode).toBe(502);
    expect(broken.json()).toMatchObject({ error: { code: 'EXTERNAL_SEARCH_FAILED' } });
  });
});
