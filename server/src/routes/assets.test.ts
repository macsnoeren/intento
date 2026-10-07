import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { testEnv } from '../test/auth-helpers.js';
import { resolveStoragePath, StoragePathError, writeStoredFile } from '../storage/files.js';
import { signedAssetUrl, verifyAssetSignature } from '../vocabulary/assets.js';
import { searchFields } from '../vocabulary/repository.js';

/**
 * Afbeeldingen via ondertekende, vervallende URL's (N2.2, INTENTO-NEW-DESIGN §20, §51, §53).
 */

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('GET /assets/:id', () => {
  let app: FastifyInstance;
  let storageDir: string;
  let env: ReturnType<typeof testEnv>;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'intento-assets-'));
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
    await prisma.vocabularyItem.deleteMany();
  });

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    env = testEnv({ STORAGE_DIR: storageDir, ASSET_URL_SECRET: 'test-asset-secret' });
    app = await buildApp({ env });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createItem(opts: {
    assetPath: string;
    mimeType: string;
    bytes: Uint8Array;
    status?: string;
  }): Promise<string> {
    await writeStoredFile(storageDir, opts.assetPath, opts.bytes);
    const item = await prisma.vocabularyItem.create({
      data: {
        labels: ['pijn'],
        concepts: ['pain'],
        contexts: [],
        ...searchFields(['pijn'], ['pain']),
        source: 'seed',
        licenseKey: 'CC-BY-SA-4.0',
        status: opts.status ?? 'approved',
        assetPath: opts.assetPath,
        mimeType: opts.mimeType,
      },
    });
    return item.id;
  }

  it('serveert een SVG met een geldige URL, met een CSP zonder scripts', async () => {
    const id = await createItem({
      assetPath: 'seed/pain.svg',
      mimeType: 'image/svg+xml',
      bytes: Buffer.from(SVG),
    });
    const res = await app.inject({ method: 'GET', url: signedAssetUrl(env, { id }) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(res.body).toBe(SVG);
  });

  it('serveert een PNG met het juiste content-type', async () => {
    const id = await createItem({ assetPath: 'own/a.png', mimeType: 'image/png', bytes: PNG });
    const res = await app.inject({ method: 'GET', url: signedAssetUrl(env, { id }) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('weigert een verlopen URL met 403', async () => {
    const id = await createItem({ assetPath: 'x.png', mimeType: 'image/png', bytes: PNG });
    const longAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const res = await app.inject({ method: 'GET', url: signedAssetUrl(env, { id }, longAgo) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_ASSET_SIGNATURE' } });
  });

  it('weigert een gemanipuleerde URL met 403', async () => {
    const id = await createItem({ assetPath: 'y.png', mimeType: 'image/png', bytes: PNG });
    const other = await createItem({ assetPath: 'z.png', mimeType: 'image/png', bytes: PNG });
    const url = signedAssetUrl(env, { id });
    const forged = [
      url.replace(/sig=[^&]+/, 'sig=AAAA'),
      url.replace(/exp=\d+/, (m) => `exp=${Number(m.slice(4)) + 3600}`),
      url.replace(`/assets/${id}`, `/assets/${other}`),
      url.split('?')[0]!,
    ];
    for (const target of forged) {
      expect((await app.inject({ method: 'GET', url: target })).statusCode, target).toBe(403);
    }
  });

  it('serveert een ingetrokken item niet meer (404)', async () => {
    const id = await createItem({
      assetPath: 'r.png',
      mimeType: 'image/png',
      bytes: PNG,
      status: 'retired',
    });
    const res = await app.inject({ method: 'GET', url: signedAssetUrl(env, { id }) });
    expect(res.statusCode).toBe(404);
  });

  it('geeft 404 voor een onbekend item, ook met een geldige handtekening', async () => {
    const res = await app.inject({
      method: 'GET',
      url: signedAssetUrl(env, { id: 'bestaat-niet' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('accepteert geen handtekening die met een ander geheim gemaakt is', async () => {
    const id = await createItem({ assetPath: 's.png', mimeType: 'image/png', bytes: PNG });
    const url = signedAssetUrl({ ...env, ASSET_URL_SECRET: 'ander-geheim' }, { id });
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
  });
});

describe('opslagpaden en handtekeningen', () => {
  it('weigert paden buiten de opslagmap', () => {
    for (const bad of ['../etc/passwd', '/etc/passwd', 'a/../../b', '', 'a\0b', '..']) {
      expect(() => resolveStoragePath('/data/storage', bad), bad).toThrow(StoragePathError);
    }
    expect(resolveStoragePath('/data/storage', 'seed/mulberry/1.svg')).toBe(
      '/data/storage/seed/mulberry/1.svg',
    );
  });

  it('verifieert in constante tijd en kijkt naar de vervaldatum', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const url = new URL(
      signedAssetUrl({ ASSET_URL_SECRET: 'g', ASSET_URL_TTL_SECONDS: 3600 }, { id: 'a' }, now),
      'http://x',
    );
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(verifyAssetSignature('g', 'a', exp, sig, now)).toBe(true);
    expect(verifyAssetSignature('g', 'a', exp, sig, new Date((exp + 1) * 1000))).toBe(false);
    expect(verifyAssetSignature('g', 'b', exp, sig, now)).toBe(false);
    expect(verifyAssetSignature('g', 'a', exp, `${sig}x`, now)).toBe(false);
  });
});
