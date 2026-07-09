import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  aacSymbolAdminSchema,
  aacSymbolListResponseSchema,
  aacSearchResponseSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * Beheertests voor de AAC-bibliotheek (T3.2, DESIGN §5.2, §6.2, §8.2, FR-015).
 *
 * Dekt de acceptatie: een beheerder voegt een symbool met relatie toe en vindt het terug via
 * zoeken; upload wordt gevalideerd (mime-allowlist + groottelimiet). Daarnaast: rolcontrole
 * (alleen ADMIN), unieke concepten, geen zelfrelatie/dubbele relatie, en cascaderend verwijderen.
 */

/** Bouwt een multipart/form-data body met één bestandsveld "file". */
function multipartBody(
  boundary: string,
  filename: string,
  contentType: string,
  content: Buffer,
): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, content, tail]);
}

describe('AAC-beheer — /admin/aac', () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let adminEmail: string;
  let adminPassword: string;

  /** (Her)bouwt de app met optionele env-overrides en logt de (reeds geseede) admin opnieuw in. */
  async function rebuildApp(envOverrides: Record<string, string> = {}): Promise<void> {
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100', ...envOverrides }) });
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
    await rebuildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  it('laat een beheerder een symbool met relatie toevoegen en terugvinden via zoeken', async () => {
    // Nieuw symbool aanmaken.
    const create = await app.inject({
      method: 'POST',
      url: '/admin/aac/symbols',
      headers: { cookie: adminCookie },
      payload: {
        concept: 'reading',
        label: 'Lezen',
        category: 'activity',
        glyph: '📖',
        synonyms: ['boek lezen', 'lezen'],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = aacSymbolAdminSchema.parse(create.json());
    expect(created.concept).toBe('reading');
    expect(created.hasImage).toBe(false);

    // Relatie leggen: bestaand "do-activity" (ouder) → nieuw "reading" (kind).
    const parent = await prisma.aacSymbol.findUnique({ where: { concept: 'do-activity' } });
    const relation = await app.inject({
      method: 'POST',
      url: '/admin/aac/relations',
      headers: { cookie: adminCookie },
      payload: { parentId: parent!.id, childId: created.id },
    });
    expect(relation.statusCode).toBe(201);
    const updatedParent = aacSymbolAdminSchema.parse(relation.json());
    expect(updatedParent.children.map((c) => c.symbol.concept)).toContain('reading');

    // Terugvinden via de zoek-API op synoniem.
    const search = await app.inject({
      method: 'GET',
      url: '/aac/search?q=boek',
      headers: { cookie: adminCookie },
    });
    expect(search.statusCode).toBe(200);
    const body = aacSearchResponseSchema.parse(search.json());
    expect(body.symbols.map((s) => s.concept)).toContain('reading');
  });

  it('weigert een niet-admin (caregiver) met 403', async () => {
    const caregiver = await seedAccount('cg@intento.local', 'pw', 'CAREGIVER');
    const cgCookie = await loginCookie(app, caregiver.email, caregiver.password);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/aac/symbols',
      headers: { cookie: cgCookie },
      payload: { concept: 'x', label: 'X', category: 'object', glyph: '❓', synonyms: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('weigert een dubbel concept met 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/aac/symbols',
      headers: { cookie: adminCookie },
      // "water" bestaat al in de seed.
      payload: { concept: 'water', label: 'Water', category: 'drink', glyph: '💧', synonyms: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONCEPT_EXISTS');
  });

  it('weigert een ongeldig concept (hoofdletters/spaties) met 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/aac/symbols',
      headers: { cookie: adminCookie },
      payload: { concept: 'Met Spatie', label: 'X', category: 'object', glyph: '❓', synonyms: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bewerkt een symbool en past de zoekindex aan', async () => {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'apple' } });
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/aac/symbols/${symbol!.id}`,
      headers: { cookie: adminCookie },
      payload: {
        concept: 'apple',
        label: 'Appel',
        category: 'food',
        glyph: '🍎',
        synonyms: ['appel', 'handappel'],
      },
    });
    expect(res.statusCode).toBe(200);

    const search = await app.inject({
      method: 'GET',
      url: '/aac/search?q=handappel',
      headers: { cookie: adminCookie },
    });
    expect(aacSearchResponseSchema.parse(search.json()).symbols.map((s) => s.concept)).toContain(
      'apple',
    );
  });

  it('verwijdert een symbool en zijn relaties (cascade)', async () => {
    const walking = await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } });
    // "walking" heeft in de seed relaties (outside→walking, walking→dog/park).
    const relBefore = await prisma.aacConceptRelation.count({
      where: { OR: [{ parentId: walking!.id }, { childId: walking!.id }] },
    });
    expect(relBefore).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/aac/symbols/${walking!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.aacSymbol.findUnique({ where: { id: walking!.id } })).toBeNull();
    const relAfter = await prisma.aacConceptRelation.count({
      where: { OR: [{ parentId: walking!.id }, { childId: walking!.id }] },
    });
    expect(relAfter).toBe(0);
  });

  it('weigert een zelfrelatie (400) en een dubbele relatie (409)', async () => {
    const drink = await prisma.aacSymbol.findUnique({ where: { concept: 'drink' } });
    const water = await prisma.aacSymbol.findUnique({ where: { concept: 'water' } });

    const self = await app.inject({
      method: 'POST',
      url: '/admin/aac/relations',
      headers: { cookie: adminCookie },
      payload: { parentId: drink!.id, childId: drink!.id },
    });
    expect(self.statusCode).toBe(400);

    // drink→water bestaat al in de seed.
    const dup = await app.inject({
      method: 'POST',
      url: '/admin/aac/relations',
      headers: { cookie: adminCookie },
      payload: { parentId: drink!.id, childId: water!.id },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('RELATION_EXISTS');
  });

  it('verwijdert een relatie', async () => {
    const drink = await prisma.aacSymbol.findUnique({ where: { concept: 'drink' } });
    const water = await prisma.aacSymbol.findUnique({ where: { concept: 'water' } });
    const rel = await prisma.aacConceptRelation.findFirst({
      where: { parentId: drink!.id, childId: water!.id },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/aac/relations/${rel!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.aacConceptRelation.findUnique({ where: { id: rel!.id } })).toBeNull();
  });

  it('filtert de beheerlijst op categorie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/symbols?category=drink',
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const { symbols } = aacSymbolListResponseSchema.parse(res.json());
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every((s) => s.category === 'drink')).toBe(true);
  });

  it('accepteert een geldige afbeeldingsupload en serveert die daarna', async () => {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'apple' } });
    const boundary = 'x-boundary-ok';
    const content = Buffer.from('fake-png-bytes');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${symbol!.id}/image`,
      headers: {
        cookie: adminCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, 'apple.png', 'image/png', content),
    });
    expect(res.statusCode).toBe(200);
    const updated = aacSymbolAdminSchema.parse(res.json());
    expect(updated.hasImage).toBe(true);
    // De afbeeldings-URL draagt nu een cache-buster (?v=…).
    expect(updated.imageUrl).toContain('?v=');

    // Serving levert de geüploade bytes met het juiste content-type.
    const img = await app.inject({ method: 'GET', url: `/aac/images/${symbol!.id}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.equals(content)).toBe(true);
  });

  it('weigert een niet-toegestaan bestandstype met 415', async () => {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'apple' } });
    const boundary = 'x-boundary-type';
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${symbol!.id}/image`,
      headers: {
        cookie: adminCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, 'note.txt', 'text/plain', Buffer.from('hello')),
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
  });

  it('weigert een te grote afbeelding met 413', async () => {
    // Aparte app met een minieme limiet, zodat een kleine payload de limiet al overschrijdt.
    await app.close();
    await rebuildApp({ AAC_IMAGE_MAX_BYTES: '16' });

    const symbol = await prisma.aacSymbol.findUnique({ where: { concept: 'apple' } });
    const boundary = 'x-boundary-big';
    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/symbols/${symbol!.id}/image`,
      headers: {
        cookie: adminCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, 'big.png', 'image/png', Buffer.alloc(64, 1)),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('IMAGE_TOO_LARGE');
  });
});
