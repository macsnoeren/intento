import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { conceptProposalListResponseSchema, conceptProposalSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { buildSearchText } from '../aac/library.js';
import { validateAiOptions } from '../ai/validation.js';
import { loginCookie, resetAuthData, seedAccount, testEnv } from '../test/auth-helpers.js';

/**
 * AI-conceptvoorstellen: reviewlijst + beoordeling (T7.3, DESIGN §5.2, §6.2, §7.6, FR-016).
 *
 * Dekt de acceptatie: een voorstel (zoals de validatielaag T5.2 het aanmaakt) verschijnt in de lijst;
 * na **goedkeuren** (koppelen aan een pictogram) is het begrip bruikbaar in een gesprek — de
 * validatielaag laat het nu naar de gebruiker; na **afwijzen** blijft het buiten de begrenzing.
 * En de autorisatiegrens: ongeauthenticeerd 401, niet-ADMIN 403.
 */
describe('AI-conceptvoorstellen — /admin/concept-proposals (T7.3)', () => {
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

  /** Maakt een pictogram waaraan een voorstel gekoppeld kan worden. */
  async function seedSymbol(concept: string, label = concept) {
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

  /** Maakt een openstaand voorstel zoals de validatielaag (T5.2) het zou aanmaken. */
  async function seedProposal(concept: string, reason = 'de gebruiker wilde dit') {
    return prisma.conceptProposal.create({ data: { concept, reason, status: 'PENDING' } });
  }

  async function adminCookie(): Promise<string> {
    const admin = await seedAccount('admin@intento.local', 'pw-admin', 'ADMIN');
    return loginCookie(app, admin.email, admin.password);
  }

  it('weigert zonder sessie met 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/concept-proposals' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_AUTHENTICATED' } });
  });

  it('weigert een CAREGIVER met 403', async () => {
    const cg = await seedAccount('cg@intento.local', 'pw-cg', 'CAREGIVER');
    const cookie = await loginCookie(app, cg.email, cg.password);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/concept-proposals',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('toont openstaande voorstellen bovenaan in de reviewlijst', async () => {
    const cookie = await adminCookie();
    await seedProposal('teleporteren');
    // Een reeds afgehandeld voorstel moet ná de openstaande komen.
    await prisma.conceptProposal.create({
      data: { concept: 'zweven', reason: 'oud', status: 'REJECTED' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/concept-proposals',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { proposals } = conceptProposalListResponseSchema.parse(res.json());
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ concept: 'teleporteren', status: 'PENDING' });
    expect(proposals[0].linkedSymbol).toBeNull();
    expect(proposals[1]).toMatchObject({ concept: 'zweven', status: 'REJECTED' });
  });

  it('koppelt bij goedkeuren het begrip aan een pictogram → bruikbaar in een gesprek', async () => {
    const cookie = await adminCookie();
    const symbol = await seedSymbol('walking', 'Wandelen');
    const proposal = await seedProposal('teleporteren');

    // Vóór goedkeuring: de validatielaag houdt het onbekende concept tegen (bereikt de gebruiker niet).
    const before = await validateAiOptions(
      prisma,
      [{ symbol: 'teleporteren', confidence: 0.95 }],
      'test',
    );
    expect(before.valid).toHaveLength(0);
    expect(before.proposed).toContain('teleporteren');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/concept-proposals/${proposal.id}/approve`,
      headers: { cookie },
      payload: { symbolId: symbol.id },
    });
    expect(res.statusCode).toBe(200);
    const approved = conceptProposalSchema.parse(res.json());
    expect(approved.status).toBe('APPROVED');
    expect(approved.linkedSymbol?.id).toBe(symbol.id);

    // Het concept is nu een synoniem van het pictogram.
    const updatedSymbol = await prisma.aacSymbol.findUniqueOrThrow({ where: { id: symbol.id } });
    expect(updatedSymbol.synonyms).toContain('teleporteren');

    // Ná goedkeuring: de validatielaag resolvet het begrip naar het gekoppelde pictogram → het bereikt
    // de gebruiker (bruikbaar in een gesprek).
    const after = await validateAiOptions(
      prisma,
      [{ symbol: 'teleporteren', confidence: 0.95 }],
      'test',
    );
    expect(after.proposed).toHaveLength(0);
    expect(after.valid).toHaveLength(1);
    expect(after.valid[0]?.symbol.id).toBe(symbol.id);
  });

  it('laat een afgewezen begrip buiten de begrenzing (niet bruikbaar)', async () => {
    const cookie = await adminCookie();
    const proposal = await seedProposal('teleporteren');

    const res = await app.inject({
      method: 'POST',
      url: `/admin/concept-proposals/${proposal.id}/reject`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(conceptProposalSchema.parse(res.json()).status).toBe('REJECTED');

    // Het begrip blijft onbekend voor de validatielaag: het bereikt de gebruiker nooit.
    const result = await validateAiOptions(
      prisma,
      [{ symbol: 'teleporteren', confidence: 0.95 }],
      'test',
    );
    expect(result.valid).toHaveLength(0);
    expect(result.proposed).toContain('teleporteren');
    // De upsert in de validatielaag reset een afgewezen voorstel niet terug naar PENDING.
    const stored = await prisma.conceptProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.status).toBe('REJECTED');
  });

  it('weigert goedkeuren met een onbekend pictogram (404) en een onbekend voorstel (404)', async () => {
    const cookie = await adminCookie();
    const proposal = await seedProposal('teleporteren');

    const badSymbol = await app.inject({
      method: 'POST',
      url: `/admin/concept-proposals/${proposal.id}/approve`,
      headers: { cookie },
      payload: { symbolId: 'nope' },
    });
    expect(badSymbol.statusCode).toBe(404);
    expect(badSymbol.json()).toMatchObject({ error: { code: 'SYMBOL_NOT_FOUND' } });

    const symbol = await seedSymbol('walking');
    const badProposal = await app.inject({
      method: 'POST',
      url: `/admin/concept-proposals/does-not-exist/approve`,
      headers: { cookie },
      payload: { symbolId: symbol.id },
    });
    expect(badProposal.statusCode).toBe(404);
    expect(badProposal.json()).toMatchObject({ error: { code: 'PROPOSAL_NOT_FOUND' } });
  });
});
