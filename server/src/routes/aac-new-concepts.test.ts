import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { aacSymbolAdminSchema, aiConceptReviewListResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { buildSearchText } from '../aac/library.js';
import {
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Beheer van door de AI aangedragen concepten — `/admin/aac/new-concepts` (T10.7, DESIGN §7.6 trap 4).
 *
 * De AI mag tijdens een gesprek een begrip aandragen dat nog niet bestond; dat wordt meteen een
 * bruikbaar (gemarkeerd) pictogram, want de gebruiker moet zijn woord kúnnen kiezen. Wat blijvend in de
 * beheerde bibliotheek terechtkomt, blijft aan de beheerder: behouden, samenvoegen of verwijderen.
 */
describe('nieuwe AI-concepten beoordelen — /admin/aac/new-concepts (T10.7)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    app = await buildApp({ env: testEnv({ LOGIN_RATE_LIMIT_MAX: '100' }) });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /** Een gewoon bibliotheeksymbool (herkomst `library`). */
  async function seedLibrarySymbol(concept: string, label = concept) {
    return prisma.aacSymbol.create({
      data: {
        concept,
        label,
        category: 'activity',
        glyph: '🚶',
        synonyms: [],
        searchText: buildSearchText({ concept, label, synonyms: [] }),
      },
    });
  }

  /** Een door de AI aangedragen, nog niet beoordeeld symbool + het bijbehorende voorstel. */
  async function seedAiConcept(concept: string, label = concept) {
    const symbol = await prisma.aacSymbol.create({
      data: {
        concept,
        label,
        category: 'object',
        glyph: '🆕',
        synonyms: [],
        searchText: buildSearchText({ concept, label, synonyms: [] }),
        origin: 'ai',
        reviewStatus: 'PENDING',
      },
    });
    await prisma.conceptProposal.create({
      data: { concept, reason: 'de gebruiker wil iets met nagels', status: 'PENDING' },
    });
    return symbol;
  }

  async function adminCookie(): Promise<string> {
    const admin = await seedAccount('admin@intento.local', 'pw-admin', 'ADMIN');
    return loginCookie(app, admin.email, admin.password);
  }

  it('toont de nog niet beoordeelde AI-concepten met reden en gebruik', async () => {
    const cookie = await adminCookie();
    const symbol = await seedAiConcept('nagelknipper', 'Nagelknipper');
    await seedLibrarySymbol('walking', 'Wandelen');

    // Het begrip is in een gesprek gekozen; dat telt mee als signaal voor de beheerder.
    const user = await seedUser('Sanne');
    const session = await prisma.conversationSession.create({
      data: { userId: user.id, status: 'ACTIVE' },
    });
    await prisma.conversationStep.create({
      data: {
        sessionId: session.id,
        order: 0,
        question: 'Wat wil je?',
        selectedConcept: 'nagelknipper',
        selectedSymbolId: symbol.id,
        offeredConcepts: ['nagelknipper'],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/aac/new-concepts',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { concepts } = aiConceptReviewListResponseSchema.parse(res.json());

    // Alleen het AI-concept staat erin — een gewoon bibliotheeksymbool hoort hier niet.
    expect(concepts).toHaveLength(1);
    expect(concepts[0]!.symbol.concept).toBe('nagelknipper');
    expect(concepts[0]!.symbol.isNew).toBe(true);
    expect(concepts[0]!.timesChosen).toBe(1);
    expect(concepts[0]!.reason).toBe('de gebruiker wil iets met nagels');
  });

  it('behoudt een concept: de nieuw-markering verdwijnt en het voorstel is goedgekeurd', async () => {
    const cookie = await adminCookie();
    const symbol = await seedAiConcept('nagelknipper', 'Nagelknipper');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/new-concepts/${symbol.id}/keep`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(aacSymbolAdminSchema.parse(res.json()).isNew).toBe(false);

    const stored = await prisma.aacSymbol.findUniqueOrThrow({ where: { id: symbol.id } });
    expect(stored.reviewStatus).toBe('APPROVED');
    // In de gebruikersapp is het nu een gewoon bibliotheekwoord, niet langer gemarkeerd.
    const proposal = await prisma.conceptProposal.findUniqueOrThrow({
      where: { concept: 'nagelknipper' },
    });
    expect(proposal.status).toBe('APPROVED');

    // En het verdwijnt uit de beoordeellijst.
    const list = await app.inject({
      method: 'GET',
      url: '/admin/aac/new-concepts',
      headers: { cookie },
    });
    expect(aiConceptReviewListResponseSchema.parse(list.json()).concepts).toHaveLength(0);
  });

  it('voegt een concept samen met een bestaand pictogram (wordt synoniem, verdwijnt als concept)', async () => {
    const cookie = await adminCookie();
    const aiSymbol = await seedAiConcept('lopen', 'Lopen');
    const target = await seedLibrarySymbol('walking', 'Wandelen');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/aac/new-concepts/${aiSymbol.id}/merge`,
      headers: { cookie },
      payload: { targetSymbolId: target.id },
    });
    expect(res.statusCode).toBe(200);
    expect(aacSymbolAdminSchema.parse(res.json()).id).toBe(target.id);

    // Het losse concept is weg — zo blijft de bibliotheek vrij van bijna-duplicaten.
    expect(await prisma.aacSymbol.findUnique({ where: { id: aiSymbol.id } })).toBeNull();

    // En het begrip resolvet voortaan naar het bestaande pictogram (synoniem + zoekindex).
    const merged = await prisma.aacSymbol.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.synonyms).toContain('lopen');
    expect(merged.searchText).toContain('lopen');
  });

  it('verwijdert een onbruikbaar concept en wijst het voorstel af', async () => {
    const cookie = await adminCookie();
    const symbol = await seedAiConcept('flauwekul');

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/aac/new-concepts/${symbol.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    expect(await prisma.aacSymbol.findUnique({ where: { id: symbol.id } })).toBeNull();
    const proposal = await prisma.conceptProposal.findUniqueOrThrow({
      where: { concept: 'flauwekul' },
    });
    expect(proposal.status).toBe('REJECTED');
  });

  it('behandelt een gewoon bibliotheeksymbool niet via het beoordeelpad (404)', async () => {
    // Het beoordeelpad mag geen sluipweg zijn om bibliotheeksymbolen te wijzigen of te verwijderen.
    const cookie = await adminCookie();
    const symbol = await seedLibrarySymbol('walking', 'Wandelen');

    for (const call of [
      { method: 'POST' as const, url: `/admin/aac/new-concepts/${symbol.id}/keep`, payload: {} },
      { method: 'DELETE' as const, url: `/admin/aac/new-concepts/${symbol.id}` },
    ]) {
      const res = await app.inject({ ...call, headers: { cookie } });
      expect(res.statusCode).toBe(404);
    }
    expect(await prisma.aacSymbol.findUnique({ where: { id: symbol.id } })).not.toBeNull();
  });

  it('weigert een niet-ADMIN (403) en een ongeauthenticeerd verzoek (401)', async () => {
    const caregiver = await seedAccount('cg@intento.local', 'pw-cg', 'CAREGIVER');
    const cookie = await loginCookie(app, caregiver.email, caregiver.password);

    const forbidden = await app.inject({
      method: 'GET',
      url: '/admin/aac/new-concepts',
      headers: { cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const anonymous = await app.inject({ method: 'GET', url: '/admin/aac/new-concepts' });
    expect(anonymous.statusCode).toBe(401);
  });
});
