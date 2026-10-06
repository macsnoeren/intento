import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vocabularyItemPublicSchema, type OpenSymbolsResult } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../errors.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  testEnv,
} from '../test/auth-helpers.js';
import type { OpenSymbolsClient } from '../vocabulary/opensymbols.js';

/** Importeren uit een externe bron (N8.5, INTENTO-NEW-DESIGN §15, §53). */

const PASSWORD = 'correct horse battery staple';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);
const HOST = 'd18vdu4p71yql0.cloudfront.net';

function symbol(overrides: Partial<OpenSymbolsResult> = {}): OpenSymbolsResult {
  return {
    id: 'os-42',
    name: 'dizzy',
    imageUrl: `https://${HOST}/libraries/x/dizzy.png`,
    extension: 'png',
    license: 'CC BY-SA',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    author: 'Iemand',
    authorUrl: 'https://example.org/iemand',
    sourceUrl: 'https://example.org/bron',
    ...overrides,
  };
}

function fakeClient(
  result: OpenSymbolsResult,
  image: Uint8Array | Error = PNG,
): OpenSymbolsClient & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    isConfigured: () => true,
    search: () => Promise.resolve([result]),
    fetchImage(url) {
      fetched.push(url);
      return image instanceof Error
        ? Promise.reject(image)
        : Promise.resolve({ contentType: 'image/png', bytes: image });
    },
  };
}

const BODY = {
  query: 'duizelig',
  id: 'os-42',
  label: 'duizelig',
  synonyms: ['draaierig'],
  concepts: ['dizziness'],
  contexts: ['health'],
};

describe('POST /vocabulary/import', () => {
  let app: FastifyInstance;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'intento-import-'));
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
  });

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
  });

  afterEach(async () => {
    await app.close();
  });

  async function start(client: OpenSymbolsClient, role = 'ADMIN', email = 'x@intento.local') {
    app = await buildApp({
      env: testEnv({
        STORAGE_DIR: storageDir,
        LOGIN_RATE_LIMIT_MAX: '100',
        UPLOAD_MAX_BYTES: '4096',
      }),
      openSymbols: client,
    });
    const org = await seedOrganization(email);
    await seedAccount(email, PASSWORD, role, org);
    return { cookie: await loginCookie(app, email, PASSWORD), org };
  }

  function importIt(cookie: string, body: Record<string, unknown> = BODY) {
    return app.inject({
      method: 'POST',
      url: '/vocabulary/import',
      headers: { cookie },
      payload: body,
    });
  }

  it('importeert met licentie, auteur en bron van de bron zelf, en kopieert de afbeelding', async () => {
    const client = fakeClient(symbol());
    const { cookie, org } = await start(client);
    const res = await importIt(cookie);
    expect(res.statusCode).toBe(201);
    const item = vocabularyItemPublicSchema.parse(res.json());
    expect(item).toMatchObject({
      scope: 'organization',
      labels: ['duizelig', 'draaierig'],
      concepts: ['dizziness'],
      source: 'external',
      license: {
        key: 'CC-BY-SA-4.0',
        author: 'Iemand',
        sourceName: 'OpenSymbols',
        url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
    });
    const row = await prisma.vocabularyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row).toMatchObject({
      organizationId: org,
      sourceRef: `${org}/os-42`,
      mimeType: 'image/png',
    });
    expect(await readFile(join(storageDir, row.assetPath ?? ''))).toEqual(PNG);
    expect(client.fetched).toEqual([`https://${HOST}/libraries/x/dizzy.png`]);
    expect(await prisma.auditLog.count({ where: { action: 'vocabulary.import' } })).toBe(1);

    // Twee keer hetzelfde symbool in dezelfde organisatie: 409.
    expect((await importIt(cookie)).statusCode).toBe(409);
  });

  it('weigert een niet-toegestane of onbekende licentie (422)', async () => {
    for (const license of ['CC BY-NC-SA', 'onbekend']) {
      const client = fakeClient(symbol({ license, licenseUrl: null }));
      const { cookie } = await start(client, 'ADMIN', `${license.length}@intento.local`);
      const res = await importIt(cookie);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'LICENSE_NOT_ALLOWED' } });
      expect(client.fetched).toEqual([]);
      await app.close();
    }
    app = await buildApp({ env: testEnv() });
  });

  it('weigert een andere host (422)', async () => {
    const client = fakeClient(symbol({ imageUrl: 'https://evil.example.com/x.png' }));
    const { cookie } = await start(client);
    const res = await importIt(cookie);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'IMAGE_HOST_NOT_ALLOWED' } });
    expect(client.fetched).toEqual([]);
  });

  it('weigert een te grote afbeelding (422)', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(8192)]);
    const { cookie } = await start(fakeClient(symbol(), big));
    const res = await importIt(cookie);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'IMAGE_TOO_LARGE' } });
    await app.close();
    await resetAuthData();
    const announced = new HttpError(413, 'IMAGE_TOO_LARGE', 'Afbeelding is te groot.');
    const second = await start(fakeClient(symbol(), announced));
    expect((await importIt(second.cookie)).statusCode).toBe(422);
    expect(await prisma.vocabularyItem.count()).toBe(0);
  });

  it('weigert iets anders dan PNG, JPEG of WebP (422)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
    const { cookie } = await start(fakeClient(symbol(), svg));
    const res = await importIt(cookie);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_IMAGE' } });
  });

  it('een symbool dat de bron niet (meer) heeft: 404; een begeleider: 403', async () => {
    const { cookie } = await start(fakeClient(symbol({ id: 'ander-id' })));
    expect((await importIt(cookie)).statusCode).toBe(404);
    await app.close();
    await resetAuthData();
    const caregiver = await start(fakeClient(symbol()), 'CAREGIVER');
    expect((await importIt(caregiver.cookie)).statusCode).toBe(403);
  });

  it('elke organisatie importeert voor zichzelf', async () => {
    const client = fakeClient(symbol());
    const a = await start(client, 'ADMIN', 'a@intento.local');
    expect((await importIt(a.cookie)).statusCode).toBe(201);
    const orgB = await seedOrganization('B');
    await seedAccount('b@intento.local', PASSWORD, 'ADMIN', orgB);
    const b = await loginCookie(app, 'b@intento.local', PASSWORD);
    expect((await importIt(b)).statusCode).toBe(201);
    expect(await prisma.vocabularyItem.count()).toBe(2);
  });
});
