import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { aacSearchResponseSchema, aacTopicListResponseSchema } from '@intento/shared';
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
    const res = await app.inject({
      method: 'GET',
      url: '/aac/search?q=lopen',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = aacSearchResponseSchema.parse(res.json());
    const concepts = body.symbols.map((s) => s.concept);
    expect(concepts).toContain('walking');
    // Het gevonden symbool draagt een bereikbare afbeeldings-URL en zijn synoniemen. Zonder
    // geüploade afbeelding is de URL het kale pad (zonder cache-buster); T3.2 voegt `?v=` toe bij upload.
    const walking = body.symbols.find((s) => s.concept === 'walking');
    expect(walking?.imageUrl).toBe(`/aac/images/${walking?.id}`);
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

  it('serveert pictogrammen met CORP cross-origin zodat een andere origin ze mag laden (T8.7)', async () => {
    // Helmet zet globaal `Cross-Origin-Resource-Policy: same-origin`. De web-client draait op een
    // andere origin dan de API en laadt pictogrammen als `<img src>`: een no-cors resource-load waar
    // CORS niets aan verandert en CORP het plaatje weggooit (echt waargenomen in Firefox, lege
    // vakjes in het gespreksscherm). Alleen deze route is daarom bewust versoepeld.
    const walking = await prisma.aacSymbol.findUnique({ where: { concept: 'walking' } });

    const svg = await app.inject({ method: 'GET', url: `/aac/images/${walking?.id}.svg` });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['cross-origin-resource-policy']).toBe('cross-origin');

    // Ook voor een geüploade afbeelding (andere tak in de handler).
    await prisma.aacSymbol.update({
      where: { id: walking!.id },
      data: { imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]), imageMimeType: 'image/png' },
    });
    const png = await app.inject({ method: 'GET', url: `/aac/images/${walking?.id}` });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('laat geen enkele intentiecategorie doodlopen (T9.11)', async () => {
    // "Een vraag stellen" was in de gebruikerstest meteen een eindpunt: de app sprong naar een voorstel
    // in plaats van uit te zoeken waar de vraag over ging. Elke intentie moet dus verfijning hebben.
    const intents = await prisma.aacSymbol.findMany({ where: { category: 'intent' } });
    expect(intents.length).toBeGreaterThan(0);
    for (const intent of intents) {
      const children = await prisma.aacConceptRelation.count({ where: { parentId: intent.id } });
      expect
        .soft(children, `intentie "${intent.concept}" heeft geen verfijningen`)
        .toBeGreaterThan(0);
    }
  });

  it('kent de lichaamsdelen die de gebruikerstest nodig had (T9.11)', async () => {
    // De echte begeleidersvraag ging over nagels knippen; zonder nagel/vinger/hand was dat niet uit te
    // drukken en liep het gesprek vast op drie lichaamsdelen.
    const painChildren = await prisma.aacConceptRelation.findMany({
      where: { parent: { concept: 'pain' } },
      include: { child: true },
    });
    const concepts = painChildren.map((relation) => relation.child.concept);
    expect(concepts).toEqual(expect.arrayContaining(['nail', 'finger', 'hand', 'tooth']));
  });

  it('geeft als onderwerpen alléén symbolen mét antwoordopties terug (T9.7)', async () => {
    const account = await seedAccount('admin@intento.local', 'pw', 'ADMIN');
    const cookie = await loginCookie(app, account.email, account.password);

    const res = await app.inject({ method: 'GET', url: '/aac/topics', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { topics } = aacTopicListResponseSchema.parse(res.json());
    const concepts = topics.map((topic) => topic.concept);

    // "drink" heeft kinderen (water/sap/koffie/melk) en is dus een bruikbaar vraag-anker; "water" is
    // een eindconcept en mag hier niet in staan — daarop zou `/question/start` 400 geven.
    expect(concepts).toContain('drink');
    expect(concepts).not.toContain('water');
    // Elk onderwerp komt precies één keer voor, ook al heeft het meerdere kinderen.
    expect(new Set(concepts).size).toBe(concepts.length);
    // Alfabetisch op label, zodat de keuzelijst in de begeleiderinterface stabiel is.
    const labels = topics.map((topic) => topic.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('weigert de onderwerpenlijst zonder authenticatie met 401 (T9.7)', async () => {
    const res = await app.inject({ method: 'GET', url: '/aac/topics' });
    expect(res.statusCode).toBe(401);
  });

  it('houdt CORP op same-origin voor niet-afbeeldingsroutes (T8.7)', async () => {
    // De versoepeling is route-scoped: de rest van de API — ook een onbekend pictogram — blijft
    // afgeschermd tegen cross-origin embedden.
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.headers['cross-origin-resource-policy']).toBe('same-origin');

    const missing = await app.inject({ method: 'GET', url: '/aac/images/nonexistent.svg' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});
