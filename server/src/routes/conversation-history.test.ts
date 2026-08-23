import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  conversationListResponseSchema,
  conversationTranscriptResponseSchema,
} from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import {
  linkCaregiver,
  loginCookie,
  resetAuthData,
  seedAccount,
  seedUser,
  testEnv,
} from '../test/auth-helpers.js';

/**
 * Gespreksverloop terugzien (T12.1, DESIGN §3.1, §3.6, §9.1, §9.4).
 *
 * Twee dingen worden hier vastgelegd: dat het verloop klopt met wát de gebruiker zag (vraag → aanbod →
 * keuze, in volgorde), en dat het de organisatie niet verlaat. Dat tweede is geen formaliteit: dit is de
 * eerste beheerweergave die **communicatie-inhoud** toont, dus de tenant- en begeleidersgrens is hier
 * even belangrijk als de inhoud zelf.
 */
describe('gespreksverloop — /admin/users/:id/conversations en /admin/conversations/:id (T12.1)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
    app = await buildApp({ env: testEnv() });
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  /** Legt een afgerond gesprek vast zoals de gespreksflow dat doet: stappen met aanbod + keuze. */
  async function seedConversation(
    userId: string,
    options: { offered?: string[][]; message?: string | null } = {},
  ): Promise<string> {
    const offered = options.offered ?? [
      ['want', 'say', 'feel'],
      ['eat', 'drink', 'do-activity'],
    ];
    const chosen = ['want', 'eat'];
    const session = await prisma.conversationSession.create({
      data: { userId, status: 'COMPLETED', strategy: 'refine' },
    });
    for (const [index, concepts] of offered.entries()) {
      await prisma.conversationStep.create({
        data: {
          sessionId: session.id,
          order: index,
          question: index === 0 ? 'Wat wil je?' : 'Wat wil je doen?',
          selectedConcept: chosen[index]!,
          offeredConcepts: concepts,
          confidence: 0.4 + index * 0.2,
        },
      });
    }
    if (options.message !== null) {
      await prisma.generatedMessage.create({
        data: {
          sessionId: session.id,
          message: options.message ?? 'Ik wil eten.',
          confirmed: true,
        },
      });
    }
    await prisma.correctionEvent.create({
      data: { sessionId: session.id, type: 'wrong_guess', stepOrder: 1, rejectedConcept: 'drink' },
    });
    return session.id;
  }

  it('toont per stap de vraag, het aanbod en de keuze — in volgorde', async () => {
    const { organizationId, email, password } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const sessionId = await seedConversation(user.id);
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/conversations/${sessionId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const transcript = conversationTranscriptResponseSchema.parse(res.json());

    expect(transcript.steps.map((step) => step.order)).toEqual([0, 1]);
    expect(transcript.steps[0]!.question).toBe('Wat wil je?');
    expect(transcript.steps[0]!.options.map((option) => option.concept)).toEqual([
      'want',
      'say',
      'feel',
    ]);
    // Precies één optie per stap is de keuze van de gebruiker.
    expect(transcript.steps[0]!.options.filter((option) => option.chosen)).toHaveLength(1);
    expect(transcript.steps[0]!.options.find((option) => option.chosen)?.concept).toBe('want');
    expect(transcript.steps[1]!.chosenConcept).toBe('eat');
    // De labels komen uit de bibliotheek, zodat de terugblik leesbaar is zonder conceptsleutels.
    expect(transcript.steps[1]!.options.find((option) => option.concept === 'drink')?.label).toBe(
      'Drinken',
    );

    // De rest van het verhaal: de correctie en de bevestigde boodschap.
    expect(transcript.corrections).toEqual([
      expect.objectContaining({ type: 'wrong_guess', stepOrder: 1, rejectedConcept: 'drink' }),
    ]);
    expect(transcript.message).toBe('Ik wil eten.');
    expect(transcript.strategy).toEqual({ key: 'refine', label: expect.any(String) });
  });

  it('breekt niet op een concept dat intussen uit de bibliotheek is', async () => {
    // De bibliotheek is muteerbaar (T10.7: samenvoegen/verwijderen). De terugblik moet blijven kloppen
    // met wat de gebruiker zag, dus een verdwenen optie blijft staan als sleutel in plaats van weg te
    // vallen — anders lijkt het scherm achteraf anders dan het was.
    const { organizationId, email, password } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const sessionId = await seedConversation(user.id, {
      offered: [['want', 'verdwenen-concept'], ['eat']],
    });
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/conversations/${sessionId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const transcript = conversationTranscriptResponseSchema.parse(res.json());

    const gone = transcript.steps[0]!.options.find(
      (option) => option.concept === 'verdwenen-concept',
    );
    expect(gone).toBeDefined();
    expect(gone!.missing).toBe(true);
    expect(gone!.label).toBe('verdwenen-concept');
  });

  it('geeft de gesprekken van één gebruiker, nieuwste eerst', async () => {
    const { organizationId, email, password } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const first = await seedConversation(user.id, { message: 'Ik wil eten.' });
    const second = await seedConversation(user.id, { message: 'Ik wil drinken.' });
    const cookie = await loginCookie(app, email, password);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/conversations`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const { conversations } = conversationListResponseSchema.parse(res.json());

    expect(conversations.map((conversation) => conversation.id)).toEqual([second, first]);
    expect(conversations[0]!.stepCount).toBe(2);
    expect(conversations[0]!.correctionCount).toBe(1);
    expect(conversations[0]!.message).toBe('Ik wil drinken.');
  });

  it('laat een beheerder van een andere organisatie niets zien (tenant-isolatie)', async () => {
    const eigen = await seedAccount('a@intento.local', 'pw-a-organisatie');
    const user = await seedUser('Sanne', eigen.organizationId);
    const sessionId = await seedConversation(user.id);

    const vreemde = await seedAccount('b@intento.local', 'pw-b-organisatie');
    const cookie = await loginCookie(app, vreemde.email, vreemde.password);

    const lijst = await app.inject({
      method: 'GET',
      url: `/admin/users/${user.id}/conversations`,
      headers: { cookie },
    });
    expect(lijst.statusCode).toBe(403);

    const verloop = await app.inject({
      method: 'GET',
      url: `/admin/conversations/${sessionId}`,
      headers: { cookie },
    });
    // Dezelfde 403 als voor een onbestaand gesprek: het bestaan van een gesprek in een andere
    // organisatie mag niet uit de statuscode af te leiden zijn (IDOR).
    expect(verloop.statusCode).toBe(403);
    expect(JSON.stringify(verloop.json())).not.toContain('Ik wil eten.');
    const onbekend = await app.inject({
      method: 'GET',
      url: '/admin/conversations/bestaat-niet',
      headers: { cookie },
    });
    expect(onbekend.statusCode).toBe(403);
  });

  it('weigert een begeleider die niet aan deze gebruiker gekoppeld is', async () => {
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const sessionId = await seedConversation(user.id);
    const begeleider = await seedAccount(
      'zorg@intento.local',
      'pw-begeleider-zonder',
      'CAREGIVER',
      organizationId,
    );
    const cookie = await loginCookie(app, begeleider.email, begeleider.password);

    const verloop = await app.inject({
      method: 'GET',
      url: `/admin/conversations/${sessionId}`,
      headers: { cookie },
    });
    expect(verloop.statusCode).toBe(403);

    // Mét koppeling mag het wél: de grens zit op de koppeling, niet op de rol.
    await linkCaregiver(begeleider.accountId, user.id);
    const opnieuw = await app.inject({
      method: 'GET',
      url: `/admin/conversations/${sessionId}`,
      headers: { cookie },
    });
    expect(opnieuw.statusCode).toBe(200);
  });

  it('weigert zonder sessie met 401', async () => {
    const { organizationId } = await seedAccount();
    const user = await seedUser('Sanne', organizationId);
    const sessionId = await seedConversation(user.id);

    const res = await app.inject({ method: 'GET', url: `/admin/conversations/${sessionId}` });
    expect(res.statusCode).toBe(401);
  });
});
