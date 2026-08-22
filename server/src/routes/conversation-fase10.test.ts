import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { conversationStateResponseSchema } from '@intento/shared';
import { buildApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { MockAiProvider } from '../ai/mock-provider.js';
import type { AiProvider, AiPrompt, AiQuestionDecision } from '../ai/provider.js';
import { deviceCookie, resetAuthData, seedUser, testEnv } from '../test/auth-helpers.js';

/**
 * Fase 10 end-to-end: de AI stuurt het gesprek (T10.2–T10.6, DESIGN §7.3, §7.5, §7.6, ADR-0012).
 *
 * Het ijkpunt is het scenario uit de derde gebruikerstest, dat hiervóór doodliep:
 *
 *   "Iets willen" → drie opties → "staat er niet bij" → **de vijf startcategorieën terug**.
 *
 * Deze tests leggen vast dat dat niet meer gebeurt: de keuzes van de gebruiker blijven staan, er komen
 * andere en verwante opties, de afwijzing bereikt de AI als signaal, en staat het woord er echt niet in
 * de bibliotheek, dan mag de AI het aandragen als nieuw woord.
 */
describe('Fase 10 — de AI stuurt het gesprek', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetAuthData();
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
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

  async function symbolId(concept: string): Promise<string> {
    const symbol = await prisma.aacSymbol.findUnique({ where: { concept } });
    if (!symbol) throw new Error(`Onbekend seed-concept: ${concept}`);
    return symbol.id;
  }

  async function startFor(
    provider: AiProvider = new MockAiProvider(),
    envOverrides: Record<string, string> = {},
  ): Promise<{ cookie: string; sessionId: string; state: ReturnType<typeof parseState> }> {
    app = await buildApp({
      env: testEnv({ DEVICE_LINK_RATE_LIMIT_MAX: '100', ...envOverrides }),
      orchestrator: new AiOrchestrator(provider),
    });
    const user = await seedUser('Sanne');
    const cookie = await deviceCookie(app, user.id);
    const res = await app.inject({
      method: 'POST',
      url: '/conversation/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    return { cookie, sessionId: parseState(res.json()).sessionId, state: parseState(res.json()) };
  }

  function parseState(body: unknown) {
    return conversationStateResponseSchema.parse(body);
  }

  async function next(cookie: string, sessionId: string, concept: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: await symbolId(concept) },
    });
    expect(res.statusCode).toBe(200);
    return parseState(res.json());
  }

  async function noneFit(cookie: string, sessionId: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/correction`,
      headers: { cookie },
      payload: { type: 'no_fitting_option' },
    });
    expect(res.statusCode).toBe(200);
    return parseState(res.json());
  }

  const conceptsOf = (state: ReturnType<typeof parseState>) =>
    (state.question?.options ?? []).map((option) => option.concept);

  // --- T10.2: de kandidaten komen niet meer uit één boomknoop --------------------------------------

  it('biedt na "Iets willen" méér aan dan de drie boomkinderen (T10.2)', async () => {
    const { cookie, sessionId } = await startFor();
    const state = await next(cookie, sessionId, 'want');

    const concepts = conceptsOf(state);
    // De directe verfijningen staan er nog steeds bij — de boom blijft het sterkste signaal.
    expect(concepts).toEqual(expect.arrayContaining(['eat', 'drink', 'do-activity']));
    // Maar de gebruiker zit niet meer vast aan die drie: de concrete dingen erachter zijn bereikbaar.
    expect(concepts.length).toBeGreaterThan(3);

    // De extra opties zijn geen willekeur: het zijn de concepten één niveau dieper (water, muziek,
    // buiten…). Vóór Fase 10 waren die pas na een tweede keuze te bereiken.
    const grandchildren = await prisma.aacConceptRelation.findMany({
      where: { parent: { childLinks: { some: { parent: { concept: 'want' } } } } },
      include: { child: true },
    });
    const grandchildConcepts = grandchildren.map((relation) => relation.child.concept);
    const extras = concepts.filter((concept) => !['eat', 'drink', 'do-activity'].includes(concept));
    expect(extras.length).toBeGreaterThan(0);
    for (const extra of extras) {
      expect(grandchildConcepts).toContain(extra);
    }
  });

  // --- T10.5: "geen van deze past" is een echte uitweg ---------------------------------------------

  it('geeft na "geen van deze past" andere opties in plaats van het startscherm (T10.5)', async () => {
    // Dit is letterlijk het scenario uit de gebruikerstest.
    const { cookie, sessionId } = await startFor();
    const afterWant = await next(cookie, sessionId, 'want');
    const offered = conceptsOf(afterWant);
    expect(offered.length).toBeGreaterThan(0);

    const state = await noneFit(cookie, sessionId);

    // 1. De keuze van de gebruiker blijft staan — geen reset.
    expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want']);
    // 2. Er is een vraag met opties (geen leeg scherm, geen voorstel uit het niets).
    expect(state.done).toBe(false);
    expect(conceptsOf(state).length).toBeGreaterThan(0);
    // 3. Precies wat de gebruiker zag is uitgesloten.
    for (const concept of conceptsOf(state)) {
      expect(offered).not.toContain(concept);
    }
    // 4. En het zijn niet de vijf startcategorieën — dát was de bug.
    expect(conceptsOf(state)).not.toEqual(
      expect.arrayContaining(['say', 'feel', 'problem', 'ask']),
    );
  });

  it('houdt de afwijzing vast over meerdere rondes (§7.5)', async () => {
    const { cookie, sessionId } = await startFor();
    const first = await next(cookie, sessionId, 'want');
    const seen = new Set(conceptsOf(first));

    const second = await noneFit(cookie, sessionId);
    for (const concept of conceptsOf(second)) seen.add(concept);

    const third = await noneFit(cookie, sessionId);
    // Ook na een tweede afwijzing komt niets terug wat de gebruiker al gezien heeft.
    for (const concept of conceptsOf(third)) {
      expect(seen.has(concept)).toBe(false);
    }
    expect(third.history.map((entry) => entry.symbol.concept)).toEqual(['want']);
  });

  // --- T10.4: de afwijzing bereikt de AI ------------------------------------------------------------

  it('geeft de afgewezen concepten en gestelde vragen mee aan de AI (T10.4)', async () => {
    const prompts: AiPrompt[] = [];
    const spy: AiProvider = {
      name: 'spy',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        prompts.push(prompt);
        return Promise.resolve({
          question: 'Wat bedoel je?',
          options: prompt.availableSymbols.slice(0, 2).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.5,
          })),
          confidence: 0.5,
          reason: 'spy',
        });
      },
    };

    const { cookie, sessionId } = await startFor(spy);
    await next(cookie, sessionId, 'want');
    await noneFit(cookie, sessionId);

    const last = prompts.at(-1)!;
    // De AI ziet dát er iets is afgewezen én van welk soort — anders herhaalt ze haar redenering.
    expect(last.rejectedConcepts.length).toBeGreaterThan(0);
    expect(last.rejectedConcepts.every((r) => r.kind === 'no_fitting_option')).toBe(true);
    expect(last.rejectedConcepts.map((r) => r.concept)).toContain('eat');
    // En ze weet welke vraag al gesteld is.
    expect(last.askedQuestions.length).toBeGreaterThan(0);
    // De afgewezen concepten staan niet (meer) tussen de toegestane opties.
    const availableConcepts = last.availableSymbols.map((ref) => ref.concept);
    for (const rejected of last.rejectedConcepts) {
      expect(availableConcepts).not.toContain(rejected.concept);
    }
  });

  // --- T10.3: het aanbod is vastgelegd -------------------------------------------------------------

  it('herstelt met ↩ Terug exact dezelfde opties, ook als de AI anders zou kiezen (T10.3)', async () => {
    // Provider die elke aanroep een ándere volgorde teruggeeft: zonder vastgelegd aanbod zou `/back`
    // een ander scherm tonen dan de gebruiker net zag.
    let call = 0;
    const shuffling: AiProvider = {
      name: 'shuffling',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        call += 1;
        const symbols = [...prompt.availableSymbols];
        if (call % 2 === 0) symbols.reverse();
        return Promise.resolve({
          question: `vraag ${call}`,
          options: symbols.map((ref, index) => ({
            symbol: ref.concept,
            confidence: Math.max(0.3, 0.9 - index * 0.05),
          })),
          confidence: 0.5,
          reason: 'shuffling',
        });
      },
    };

    const { cookie, sessionId } = await startFor(shuffling);
    const start = await app.inject({
      method: 'GET',
      url: '/conversation/pending',
      headers: { cookie },
    });
    expect(start.statusCode).toBe(200);

    const beforeChoice = await next(cookie, sessionId, 'want');
    const shown = conceptsOf(beforeChoice);
    const shownQuestion = beforeChoice.question?.prompt;

    await next(cookie, sessionId, shown[0]!);
    const back = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/back`,
      headers: { cookie },
    });
    expect(back.statusCode).toBe(200);
    const restored = parseState(back.json());

    expect(restored.question?.prompt).toBe(shownQuestion);
    expect(conceptsOf(restored)).toEqual(shown);
  });

  it('weigert een keuze die niet is aangeboden (T10.3)', async () => {
    const { cookie, sessionId } = await startFor();
    const state = await next(cookie, sessionId, 'want');
    const offered = new Set(conceptsOf(state));

    const notOffered = (await prisma.aacSymbol.findMany()).find(
      (symbol) => !offered.has(symbol.concept),
    );
    expect(notOffered).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/next`,
      headers: { cookie },
      payload: { symbolId: notOffered!.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code ?? res.json().code).toBe('INVALID_CHOICE');
  });

  // --- T10.6: een nieuw woord als niets past --------------------------------------------------------

  it('biedt een door de AI verzonnen begrip aan als nieuw woord (T10.6)', async () => {
    // Provider die consequent één begrip aandraagt dat niet in de bibliotheek staat.
    const inventive: AiProvider = {
      name: 'inventive',
      selectNextQuestion(): Promise<AiQuestionDecision> {
        return Promise.resolve({
          question: 'Bedoel je dit?',
          options: [{ symbol: 'nagelknipper', confidence: 0.9 }],
          confidence: 0.5,
          reason: 'de gebruiker wil iets met nagels',
        });
      },
    };

    const { cookie, sessionId } = await startFor(inventive);
    const state = await next(cookie, sessionId, 'want');

    const nieuw = state.question?.options.find((option) => option.concept === 'nagelknipper');
    expect(nieuw).toBeDefined();
    // De gebruiker ziet dat dit geen vertrouwd bibliotheekwoord is, maar kiest het nog steeds zelf.
    expect(nieuw!.isNew).toBe(true);
    // Het staat vooraan: de AI koos het.
    expect(conceptsOf(state)[0]).toBe('nagelknipper');

    // De beheerder ziet het als voorstel én als AI-symbool (T10.7).
    const symbol = await prisma.aacSymbol.findUniqueOrThrow({ where: { concept: 'nagelknipper' } });
    expect(symbol.origin).toBe('ai');
    expect(symbol.reviewStatus).toBe('PENDING');
    const proposal = await prisma.conceptProposal.findUnique({
      where: { concept: 'nagelknipper' },
    });
    expect(proposal?.status).toBe('PENDING');

    // En het is een geldige keuze — het nieuwe woord doet gewoon mee in het gesprek.
    const chosen = await next(cookie, sessionId, 'nagelknipper');
    expect(chosen.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'nagelknipper']);
  });

  it('maakt geen nieuw woord als het begrip al bestaat onder een ander woord (deduplicatie)', async () => {
    const synonymous: AiProvider = {
      name: 'synonymous',
      selectNextQuestion(): Promise<AiQuestionDecision> {
        // "lopen" is een synoniem van het bestaande concept "walking".
        return Promise.resolve({
          question: 'Bedoel je dit?',
          options: [{ symbol: 'lopen', confidence: 0.9 }],
          confidence: 0.5,
          reason: 'synoniem',
        });
      },
    };

    const before = await prisma.aacSymbol.count();
    const { cookie, sessionId } = await startFor(synonymous);
    const state = await next(cookie, sessionId, 'want');

    expect(conceptsOf(state)[0]).toBe('walking');
    expect(await prisma.aacSymbol.count()).toBe(before);
    expect(await prisma.aacSymbol.findUnique({ where: { concept: 'lopen' } })).toBeNull();
  });

  it('laat de bibliotheek hard begrenzend als AI_ALLOW_NEW_CONCEPTS uitstaat', async () => {
    const inventive: AiProvider = {
      name: 'inventive',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        return Promise.resolve({
          question: 'Bedoel je dit?',
          options: [
            { symbol: 'nagelknipper', confidence: 0.9 },
            ...prompt.availableSymbols.slice(0, 1).map((ref) => ({
              symbol: ref.concept,
              confidence: 0.5,
            })),
          ],
          confidence: 0.5,
          reason: 'reden',
        });
      },
    };

    const { cookie, sessionId } = await startFor(inventive, { AI_ALLOW_NEW_CONCEPTS: 'false' });
    const state = await next(cookie, sessionId, 'want');

    expect(conceptsOf(state)).not.toContain('nagelknipper');
    expect(await prisma.aacSymbol.findUnique({ where: { concept: 'nagelknipper' } })).toBeNull();
    // Vastgelegd blijft het wél: de beheerder ziet het begrip als voorstel.
    expect(
      await prisma.conceptProposal.findUnique({ where: { concept: 'nagelknipper' } }),
    ).not.toBeNull();
  });

  // --- T10.8: de hypothese ---------------------------------------------------------------------------

  it('dempt de zekerheid over beurten heen en wist de hypothese bij bevestigen (T10.8)', async () => {
    // Provider die aan het begin onzeker is en daarna in één klap zeer zeker. Zonder demping zou die
    // ene uitschieter meteen een boodschapvoorstel forceren — precies het "voorstel uit het niets".
    const jumpy: AiProvider = {
      name: 'jumpy',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        const sure = prompt.conversationContext.length > 0;
        return Promise.resolve({
          question: 'Bedoel je dit?',
          options: prompt.availableSymbols.slice(0, 3).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.9,
          })),
          confidence: sure ? 0.99 : 0.4,
          reason: sure ? 'nu heel zeker' : 'nog geen idee',
        });
      },
      generateMessage: () => Promise.resolve({ message: 'Ik wil iets.', confidence: 0.9 }),
    };

    const { cookie, sessionId } = await startFor(jumpy);
    const first = await next(cookie, sessionId, 'want');

    // Rauw zou dit 0.99 zijn (ruim boven de voorsteldrempel van 0.85). Gedempt vanaf 0.4 blijft het
    // eronder: er komt nog een vraag in plaats van meteen een boodschap.
    expect(first.done).toBe(false);
    expect(first.confidence!).toBeLessThan(0.85);
    expect(first.confidence!).toBeGreaterThan(0.4);

    // Blijft de AI zeker, dan komt het voorstel er alsnog — demping remt een sprong, ze blokkeert niet.
    const second = await next(cookie, sessionId, conceptsOf(first)[0]!);
    expect(second.confidence!).toBeGreaterThan(first.confidence!);

    const session = await prisma.conversationSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(session.hypothesis).not.toBeNull();

    // Na bevestigen is de hypothese weg: een onzekere aanname is geen bewaarde communicatie (§3.6).
    const confirm = await app.inject({
      method: 'POST',
      url: `/conversation/${sessionId}/confirm`,
      headers: { cookie },
    });
    expect(confirm.statusCode).toBe(200);
    const completed = await prisma.conversationSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(completed.hypothesis).toBeNull();
    expect(completed.pendingOffer).toBeNull();
  });
});
