import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { vocabularyItemPublicSchema, vocabularyListResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedOrganization,
  testEnv,
} from '../test/auth-helpers.js';

/** Eigen afbeelding + woord (N8.1, INTENTO-NEW-DESIGN §15, §53). */

// Een echte 1×1 PNG en het begin van een JPEG (magic bytes); de controle kijkt naar de inhoud.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)]);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00');

const PASSWORD = 'correct horse battery staple';
const BOUNDARY = '----intento-test-boundary';

/** Bouwt een multipart-body zoals een browser hem stuurt. */
function multipart(
  fields: Record<string, string>,
  file?: { name: string; type: string; bytes: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          `Content-Type: ${file.type}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

const FIELDS = {
  label: 'opa',
  synonyms: 'grootvader, opaatje',
  concepts: 'grandfather',
  contexts: 'people',
  rightsConfirmed: 'true',
};

describe('POST /vocabulary/upload', () => {
  let app: FastifyInstance;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'intento-upload-'));
  });

  afterAll(async () => {
    await rm(storageDir, { recursive: true, force: true });
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
  });

  beforeEach(async () => {
    await prisma.vocabularyItem.deleteMany();
    await resetAuthData();
    app = await buildApp({
      env: testEnv({
        STORAGE_DIR: storageDir,
        UPLOAD_MAX_BYTES: '2048',
        LOGIN_RATE_LIMIT_MAX: '100',
      }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function admin(email = 'admin@intento.local', organizationId?: string) {
    const account = await seedAccount(email, PASSWORD, 'ADMIN', organizationId);
    return { ...account, cookie: await loginCookie(app, email, PASSWORD) };
  }

  function upload(
    cookie: string,
    fields: Record<string, string> = FIELDS,
    file: { name: string; type: string; bytes: Buffer } | null = {
      name: 'opa.png',
      type: 'image/png',
      bytes: PNG,
    },
  ) {
    const { payload, headers } = multipart(fields, file ?? undefined);
    return app.inject({
      method: 'POST',
      url: '/vocabulary/upload',
      headers: { ...headers, cookie },
      payload,
    });
  }

  it('slaat een eigen afbeelding + woord op met licentie own, uploader en datum', async () => {
    const { cookie, organizationId, accountId } = await admin();
    const res = await upload(cookie);
    expect(res.statusCode).toBe(201);
    const item = vocabularyItemPublicSchema.parse(res.json());
    expect(item).toMatchObject({
      scope: 'organization',
      labels: ['opa', 'grootvader', 'opaatje'],
      concepts: ['grandfather'],
      contexts: ['people'],
      source: 'own',
      status: 'approved',
      license: { key: 'own' },
    });
    expect(item.imageUrl).toMatch(/^\/assets\//);

    const row = await prisma.vocabularyItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row).toMatchObject({
      organizationId,
      createdById: accountId,
      mimeType: 'image/png',
      bytes: PNG.byteLength,
    });
    expect(row.importedAt).not.toBeNull();
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(storageDir, row.assetPath ?? ''))).toEqual(PNG);

    // De afbeelding is via de ondertekende URL op te halen.
    const image = await app.inject({ method: 'GET', url: item.imageUrl ?? '' });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'vocabulary.upload' } });
    expect(audit).toMatchObject({ targetId: item.id });
  });

  it('weigert alles wat geen PNG, JPEG of WebP is, ook SVG', async () => {
    const { cookie } = await admin();
    for (const file of [
      { name: 'x.gif', type: 'image/gif', bytes: GIF },
      { name: 'x.svg', type: 'image/svg+xml', bytes: SVG },
      { name: 'x.txt', type: 'text/plain', bytes: Buffer.from('hallo') },
    ]) {
      const res = await upload(cookie, FIELDS, file);
      expect(res.statusCode).toBe(415);
      expect(res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_IMAGE' } });
    }
    expect(await prisma.vocabularyItem.count()).toBe(0);
  });

  it('kijkt naar de inhoud, niet naar de extensie', async () => {
    const { cookie } = await admin();
    const fake = await upload(cookie, FIELDS, { name: 'foto.png', type: 'image/png', bytes: SVG });
    expect(fake.statusCode).toBe(415);
    const jpeg = await upload(cookie, FIELDS, { name: 'foto.png', type: 'image/png', bytes: JPEG });
    expect(jpeg.statusCode).toBe(201);
    const row = await prisma.vocabularyItem.findFirstOrThrow();
    expect(row.mimeType).toBe('image/jpeg');
    expect(row.assetPath).toMatch(/\.jpg$/);
  });

  it('weigert een te grote afbeelding', async () => {
    const { cookie } = await admin();
    const big = Buffer.concat([PNG, Buffer.alloc(4096, 0)]);
    const res = await upload(cookie, FIELDS, { name: 'groot.png', type: 'image/png', bytes: big });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'IMAGE_TOO_LARGE' } });
    expect(await prisma.vocabularyItem.count()).toBe(0);
  });

  it('vraagt het vinkje, een woord en geldige concepten', async () => {
    const { cookie } = await admin();
    const withoutRights: Record<string, string> = { ...FIELDS };
    delete withoutRights.rightsConfirmed;
    for (const fields of [
      withoutRights,
      { ...FIELDS, rightsConfirmed: 'false' },
      { ...FIELDS, label: '' },
      { ...FIELDS, concepts: 'Opa Jansen' },
      { ...FIELDS, contexts: 'onzin' },
    ]) {
      const res = await upload(cookie, fields);
      expect(res.statusCode).toBe(400);
    }
    const noFile = await upload(cookie, FIELDS, null);
    expect(noFile.statusCode).toBe(400);
    expect(await prisma.vocabularyItem.count()).toBe(0);
  });

  it('alleen de beheerder', async () => {
    const org = await seedOrganization();
    await seedAccount('begeleider@intento.local', PASSWORD, 'CAREGIVER', org);
    const cookie = await loginCookie(app, 'begeleider@intento.local', PASSWORD);
    const res = await upload(cookie);
    expect(res.statusCode).toBe(403);
    const anonymous = await upload('');
    expect(anonymous.statusCode).toBe(401);
    expect(await prisma.vocabularyItem.count()).toBe(0);
  });

  it('isoleert: een andere organisatie ziet het eigen woord niet', async () => {
    const a = await admin('a@intento.local', await seedOrganization('A'));
    const b = await admin('b@intento.local', await seedOrganization('B'));
    const item = vocabularyItemPublicSchema.parse((await upload(a.cookie)).json());

    const listB = vocabularyListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie: b.cookie } })
      ).json(),
    );
    expect(listB.items.map((i) => i.id)).not.toContain(item.id);
    const listA = vocabularyListResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: '/vocabulary', headers: { cookie: a.cookie } })
      ).json(),
    );
    expect(listA.items.map((i) => i.id)).toContain(item.id);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/vocabulary/${item.id}`,
      headers: { cookie: b.cookie },
      payload: { labels: ['iets anders'] },
    });
    // 403 zonder te verraden of het id bestaat (IDOR-mitigatie, ADR-0005).
    expect(edit.statusCode).toBe(403);
  });
});
