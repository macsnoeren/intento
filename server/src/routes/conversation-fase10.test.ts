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

  // --- T10.9: de boodschapzin loopt mee met de vrijere route ----------------------------------------

  describe('een route die met een AI-aangedragen concept begint (T10.9)', () => {
    /**
     * Provider die meteen op het **startscherm** een begrip aandraagt dat niet in de bibliotheek staat —
     * de rooktest van T10.6. De route begint dan met `nagelknipper` in plaats van met een intentie.
     */
    function clipperProvider(message?: string): AiProvider {
      return {
        name: 'clipper',
        selectNextQuestion(): Promise<AiQuestionDecision> {
          return Promise.resolve({
            question: 'Bedoel je dit?',
            options: [{ symbol: 'nagelknipper', confidence: 0.9 }],
            confidence: 0.5,
            reason: 'de gebruiker wil iets met nagels',
          });
        },
        ...(message
          ? { generateMessage: () => Promise.resolve({ message, confidence: 0.9 }) }
          : {}),
      };
    }

    /** Kiest het nieuwe woord als eerste stap en levert het boodschapvoorstel op. */
    async function proposeAfterClipper(provider: AiProvider): Promise<string> {
      const { cookie, sessionId, state } = await startFor(provider);
      // De AI draagt het nieuwe woord al op het startscherm aan; de gebruiker kiest het zelf.
      expect(conceptsOf(state)).toContain('nagelknipper');

      const chosen = await next(cookie, sessionId, 'nagelknipper');
      expect(chosen.history.map((entry) => entry.symbol.concept)).toEqual(['nagelknipper']);

      const generated = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/generate`,
        headers: { cookie },
      });
      expect(generated.statusCode).toBe(200);
      return generated.json().message as string;
    }

    it('levert een lopende zin in plaats van één los woord', async () => {
      // Vóór T10.9 was dit letterlijk "Nagelknipper." — de sjabloon kende alleen intentie-frames.
      const message = await proposeAfterClipper(clipperProvider());
      expect(message).toBe('Ik wil iets zeggen over nagelknipper.');
    });

    it('laat de AI-zin "Ik wil de nagelknipper." door de safety-laag', async () => {
      // "wil" is een synoniem van het niet-gekozen concept `want`, maar bovenal gewone zinsbouw.
      const message = await proposeAfterClipper(clipperProvider('Ik wil de nagelknipper.'));
      expect(message).toBe('Ik wil de nagelknipper.');
    });

    it('weigert een AI-zin met een begrip dat de gebruiker niet koos', async () => {
      const message = await proposeAfterClipper(clipperProvider('Ik wil buiten wandelen.'));
      expect(message).toBe('Ik wil iets zeggen over nagelknipper.');
    });
  });

  // --- T10.10: het scenario uit de derde gebruikerstest ----------------------------------------------

  describe('doorvragen in plaats van vaag voorstellen (T10.10)', () => {
    /** Provider die al na "eten" zeer zeker is — precies het gemelde gedrag van een echte AI. */
    const eagerProvider: AiProvider = {
      name: 'eager',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        const chosen = prompt.conversationContext.map((ref) => ref.concept);
        return Promise.resolve({
          question: 'Wat wil je?',
          options: prompt.availableSymbols.slice(0, 3).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.9,
          })),
          confidence: chosen.includes('eat') ? 0.99 : 0.5,
          reason: 'heel zeker dat het om eten gaat',
        });
      },
      generateMessage: () =>
        Promise.resolve({ message: 'Ik wil iets warms eten.', confidence: 0.9 }),
    };

    it('blijft doorvragen op "eten" in plaats van een vage boodschap voor te stellen', async () => {
      // De melding: "Ik wil iets warms eten." kwam als voorstel, terwijl de bibliotheek onder "eten"
      // zes concrete dingen kent. Zeker weten dát iemand wil eten is niet hetzelfde als weten wát.
      const { cookie, sessionId } = await startFor(eagerProvider);
      await next(cookie, sessionId, 'want');
      const state = await next(cookie, sessionId, 'eat');

      expect(state.done).toBe(false);
      expect(conceptsOf(state)).toEqual(expect.arrayContaining(['soup', 'bread', 'apple']));
    });

    async function reject(cookie: string, sessionId: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/correction`,
        headers: { cookie },
        payload: { type: 'wrong_guess' },
      });
      expect(res.statusCode).toBe(200);
      return parseState(res.json());
    }

    it('❌ Nee verfijnt eerst en houdt de hele route intact (T10.12)', async () => {
      // De melding: op "Ik wil brood eten." wilde de gebruiker zeggen dat hij er chocopasta op wil, maar
      // ❌ leverde appel en banaan op — de bróértjes van brood. De eerste ❌ betekent nu "nog niet precies
      // genoeg" en laat de route staan.
      const { cookie, sessionId } = await startFor(eagerProvider);
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      await next(cookie, sessionId, 'soup');

      const state = await reject(cookie, sessionId);

      expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat', 'soup']);
      expect(state.question).not.toBeNull();
    });

    it('rolt bij de tweede ❌ één stap terug en blijft binnen wat de gebruiker koos', async () => {
      // De melding uit de derde ronde: na ❌ kwam "Wat wil je drinken?" terwijl de gebruiker juist iets
      // over het eten wilde zeggen. Oorzaak was dat de correctie de héle route terugrolde en "eten"
      // uitsloot.
      const { cookie, sessionId } = await startFor(eagerProvider);
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      await next(cookie, sessionId, 'soup');

      await reject(cookie, sessionId);
      const state = await reject(cookie, sessionId);

      // "eten" staat er nog: de gebruiker koos dat zelf en het wordt niet weggegooid.
      expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat']);
      // En de vervolgvraag gaat over eten, niet over drinken.
      expect(state.question).not.toBeNull();
      expect(conceptsOf(state)).not.toContain('soup');
      expect(conceptsOf(state)).toEqual(expect.arrayContaining(['bread', 'apple']));
      expect(conceptsOf(state)).not.toContain('drink');
    });

    it('laat geen concept in de boodschap dat de gebruiker niet koos (§7.8)', async () => {
      // "warms" glipte langs de hele-woord-check terwijl `hot` het label "Warm" draagt.
      const { cookie, sessionId } = await startFor(eagerProvider);
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      await next(cookie, sessionId, 'soup');

      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/generate`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const message = String(res.json().message);
      expect(message).not.toContain('warm');
      expect(message.toLowerCase()).toContain('soep');
    });
  });

  // --- T10.11: "Dit is genoeg" ----------------------------------------------------------------------

  describe('de gebruiker rondt zelf af (T10.11)', () => {
    async function enough(cookie: string, sessionId: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/enough`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      return parseState(res.json());
    }

    it('gaat naar het voorstelscherm met de route zoals hij is', async () => {
      // "Ik wil eten." is in AAC een volwaardige boodschap; sinds T10.10 blijft de AI op "eten" juist
      // doorvragen. Deze uitweg geeft dat oordeel terug aan de gebruiker (DESIGN §2).
      const { cookie, sessionId } = await startFor();
      await next(cookie, sessionId, 'want');
      const refining = await next(cookie, sessionId, 'eat');
      expect(refining.done).toBe(false);
      expect(refining.canFinish).toBe(true);

      const state = await enough(cookie, sessionId);
      expect(state.done).toBe(true);
      expect(state.question).toBeNull();
      expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat']);

      const generated = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/generate`,
        headers: { cookie },
      });
      expect(generated.statusCode).toBe(200);
      expect(String(generated.json().message).toLowerCase()).toContain('eten');
    });

    it('mag niet vóór de eerste keuze van de gebruiker', async () => {
      const { cookie, sessionId } = await startFor();
      const start = await app.inject({
        method: 'GET',
        url: '/conversation/pending',
        headers: { cookie },
      });
      expect(start.statusCode).toBe(200);

      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/enough`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('NO_STEPS_TO_GENERATE');
    });

    it('meldt canFinish pas zodra de gebruiker zelf iets koos', async () => {
      const { cookie, sessionId, state } = await startFor();
      expect(state.canFinish).toBe(false);

      const afterChoice = await next(cookie, sessionId, 'want');
      expect(afterChoice.canFinish).toBe(true);
    });

    it('vervalt zodra de route verandert (❌ Nee)', async () => {
      const { cookie, sessionId } = await startFor();
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      expect((await enough(cookie, sessionId)).done).toBe(true);

      // ❌ op het voorstel: het "genoeg"-oordeel vervalt en er volgt weer een vraag (T10.12: eerst een
      // verfijnronde, dus de route blijft nog staan).
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/correction`,
        headers: { cookie },
        payload: { type: 'wrong_guess' },
      });
      expect(res.statusCode).toBe(200);
      const state = parseState(res.json());
      expect(state.done).toBe(false);
      expect(state.question).not.toBeNull();
      expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat']);
    });

    it('vervalt ook na ↩ Terug', async () => {
      const { cookie, sessionId } = await startFor();
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      await enough(cookie, sessionId);

      const back = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/back`,
        headers: { cookie },
      });
      expect(back.statusCode).toBe(200);
      const state = parseState(back.json());
      expect(state.done).toBe(false);
      expect(state.question).not.toBeNull();
    });
  });

  // --- T10.12/T10.13: een vers AI-concept is geen eindpunt, en de vrije ronde is écht vrij -----------

  describe('doorpraten over een door de AI aangedragen begrip (T10.12/T10.13)', () => {
    /**
     * Provider die zich gedraagt als een echt model: na "Iets zeggen" komt "compliment", en op een punt
     * zonder bestaande opties (`availableSymbols` leeg) draagt hij zélf begrippen aan — hier bewust onder
     * een ándere naam dan de conceptsleutel ("mama"), zodat de validatielaag die moet omzetten.
     */
    const complimentProvider: AiProvider = {
      name: 'compliment',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        const chosen = prompt.conversationContext.map((ref) => ref.concept);
        if (chosen.length === 1 && chosen[0] === 'say') {
          return Promise.resolve({
            question: 'Wil je iemand een compliment geven?',
            options: [{ symbol: 'compliment', confidence: 0.9 }],
            confidence: 0.6,
            reason: 'de gebruiker wil iets aardigs zeggen',
          });
        }
        if (prompt.availableSymbols.length === 0) {
          return Promise.resolve({
            question: 'Over wie gaat het?',
            options: [
              { symbol: 'mama', confidence: 0.8 },
              { symbol: 'papa', confidence: 0.7 },
            ],
            confidence: 0.6,
            reason: 'wie krijgt het compliment',
          });
        }
        return Promise.resolve({
          question: 'Over wie gaat het?',
          options: prompt.availableSymbols.slice(0, 3).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.7,
          })),
          confidence: 0.6,
          reason: 'wie krijgt het compliment',
        });
      },
    };

    it('loopt niet dood op een nieuw AI-begrip zonder relaties (T10.12)', async () => {
      // Gemeld: de AI kwam terecht met "compliment", maar wie het koos kreeg meteen het voorstelscherm
      // en kon niet meer zeggen wíe hij lief vindt. Een vers AI-concept heeft per definitie geen kinderen
      // in de boom; dat als "eindpunt" lezen loopt dood.
      const { cookie, sessionId } = await startFor(complimentProvider);
      const afterSay = await next(cookie, sessionId, 'say');
      expect(conceptsOf(afterSay)).toContain('compliment');

      const afterCompliment = await next(cookie, sessionId, 'compliment');

      expect(afterCompliment.done).toBe(false);
      expect(afterCompliment.question).not.toBeNull();
      expect(conceptsOf(afterCompliment).length).toBeGreaterThan(0);
      expect(afterCompliment.history.map((entry) => entry.symbol.concept)).toEqual([
        'say',
        'compliment',
      ]);
    });

    it('geeft de AI géén optielijst als de bibliotheek niets specifiekers kent (T10.13)', async () => {
      // De kern van T10.13: op zo'n punt kreeg het model een greep uit de bibliotheek, en omdat de
      // AAC-regels zeggen "kies bij voorkeur uit de aangeboden opties" koos het braaf iets willekeurigs.
      // Nu is de lijst leeg en staat de opdracht in de regels.
      let seen: AiPrompt | null = null;
      const spy: AiProvider = {
        name: 'spy',
        selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
          seen = prompt;
          return complimentProvider.selectNextQuestion(prompt);
        },
      };
      const { cookie, sessionId } = await startFor(spy);
      await next(cookie, sessionId, 'say');
      await next(cookie, sessionId, 'compliment');

      const prompt = seen as AiPrompt | null;
      expect(prompt).not.toBeNull();
      expect(prompt!.availableSymbols).toEqual([]);
      expect(prompt!.aacRules.join(' ')).toContain('availableSymbols');
      expect(prompt!.aacRules.some((rule) => rule.includes('Draag twee tot vijf'))).toBe(true);
    });

    it('zet de zelf aangedragen begrippen om naar bestaande symbolen (T10.13)', async () => {
      // Zonder optielijst blijft de bibliotheek gewoon bereikbaar: de AI noemt "mama", de validatielaag
      // herkent het synoniem en de gebruiker krijgt het beheerde pictogram `mom` te zien — geen tweede,
      // bijna-identiek nieuw woord.
      const { cookie, sessionId } = await startFor(complimentProvider);
      await next(cookie, sessionId, 'say');
      const state = await next(cookie, sessionId, 'compliment');

      expect(conceptsOf(state)).toEqual(['mom', 'dad']);
      const created = await prisma.aacSymbol.findMany({ where: { origin: 'ai' } });
      expect(created.map((symbol) => symbol.concept)).toEqual(['compliment']);
    });

    it('vult het scherm niet aan met onverwante bibliotheekconcepten (T10.13)', async () => {
      // De gebruikerstest: op "Iets willen → Eten → Brood" leverde ❌ Nee een verfijnronde op met "beleg"
      // (goed) — maar er stonden ook "pijn", "nagel" en "er is iets aan de hand" bij, en de vraag sloeg om
      // naar "Wat wil je drinken?". Die opties kwamen uit de aanvulling, niet uit de AI.
      const { cookie, sessionId } = await startFor(complimentProvider);
      await next(cookie, sessionId, 'say');
      const state = await next(cookie, sessionId, 'compliment');

      // Precies wat de AI aandroeg, niets erbij: geen lichaamsdelen, geen intentiecategorieën.
      expect(conceptsOf(state)).toEqual(['mom', 'dad']);
    });
  });

  // --- T10.13: het gemelde brood/beleg-scenario, van begin tot eind --------------------------------

  describe('doorpraten over beleg (T10.13)', () => {
    /**
     * Provider die zich gedraagt als een model dat de opdracht leest: tijdens de verfijnronde draagt hij
     * "beleg" aan, en op het punt daarna — waar de bibliotheek niets specifiekers kent — komt hij met wat
     * er logisch op brood gaat. Precies wat de gebruiker verwachtte: "drinken, bang, appel" hoort daar
     * niet bij.
     */
    const belegProvider: AiProvider = {
      name: 'beleg',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        const chosen = prompt.conversationContext.map((ref) => ref.concept);
        if (chosen.includes('beleg')) {
          return Promise.resolve({
            question: 'Wat wil je op je brood?',
            options: [
              { symbol: 'chocopasta', confidence: 0.9 },
              { symbol: 'kaas', confidence: 0.8 },
            ],
            confidence: 0.6,
            reason: 'wat gaat er op het brood',
          });
        }
        if (chosen.includes('bread')) {
          return Promise.resolve({
            question: 'Wil je er iets op?',
            options: [{ symbol: 'beleg', confidence: 0.9 }],
            confidence: 0.6,
            reason: 'brood is nog niet precies genoeg',
          });
        }
        return Promise.resolve({
          question: 'Wat wil je?',
          options: prompt.availableSymbols.slice(0, 4).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.7,
          })),
          confidence: 0.4,
          reason: 'richting bepalen',
        });
      },
    };

    async function wrongGuess(cookie: string, sessionId: string) {
      const res = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/correction`,
        headers: { cookie },
        payload: { type: 'wrong_guess' },
      });
      expect(res.statusCode).toBe(200);
      return parseState(res.json());
    }

    it('blijft na "beleg" bij het brood in plaats van bij pijn en nagels', async () => {
      // Het gemelde verloop: "Ik wil brood eten." → ❌ Nee → verfijnronde met "beleg" (goed) → beleg
      // gekozen → en dan stonden er "pijn", "nagel" en "er is iets aan de hand" op het scherm, met de
      // vraag "Wat wil je drinken?".
      const { cookie, sessionId } = await startFor(belegProvider);
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      const afterBread = await next(cookie, sessionId, 'bread');
      expect(afterBread.done).toBe(true);

      const refine = await wrongGuess(cookie, sessionId);
      expect(conceptsOf(refine)).toContain('beleg');
      // De route blijft staan: ❌ verfijnt eerst (T10.12).
      expect(refine.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat', 'bread']);

      const afterBeleg = await next(cookie, sessionId, 'beleg');

      expect(afterBeleg.done).toBe(false);
      expect(conceptsOf(afterBeleg)).toEqual(['chocopasta', 'kaas']);
      expect(afterBeleg.question?.prompt).toBe('Wat wil je op je brood?');
      // De kern van de melding: geen greep uit de bibliotheek meer op het scherm.
      for (const vreemd of ['pain', 'hand', 'nail', 'problem', 'drink']) {
        expect(conceptsOf(afterBeleg)).not.toContain(vreemd);
      }
    });
  });

  // --- T14.3: "Staat er niet bij" blijft in de gesprekslijn ------------------------------------------

  describe('na 🤷 blijft de opdracht binnen het onderwerp (T14.3)', () => {
    it('geeft het model de opdracht in dezelfde gesprekslijn te blijven', async () => {
      // Gemeld in de zesde gebruikerstest: op "Een vraag stellen → Wat? → Eten" leverde 🤷 opties als
      // "nagel" op. De prompt bevatte twee instructies die elkaar uitsloten — "blijf bij het onderwerp"
      // tegenover "je zocht in de verkeerde richting: verleg de invalshoek". Deze test bewijst dat de
      // juiste opdracht ook in de **echte flow** bij het model aankomt, niet alleen in een losse
      // prompt-unittest.
      const prompts: AiPrompt[] = [];
      const spy: AiProvider = {
        name: 'spy',
        selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
          prompts.push(prompt);
          // Volgt de regels: blijft binnen het onderwerp en draagt zelf iets aan.
          if (prompt.availableSymbols.length === 0) {
            return Promise.resolve({
              question: 'Wat wil je op je brood?',
              options: [{ symbol: 'pannenkoek', confidence: 0.9 }],
              confidence: 0.6,
              reason: 'binnen de eetlijn blijven',
            });
          }
          return Promise.resolve({
            question: 'Wat wil je?',
            options: prompt.availableSymbols.slice(0, 6).map((ref) => ({
              symbol: ref.concept,
              confidence: 0.7,
            })),
            confidence: 0.5,
            reason: 'aanbod ordenen',
          });
        },
      };

      const { cookie, sessionId } = await startFor(spy);
      await next(cookie, sessionId, 'want');
      await next(cookie, sessionId, 'eat');
      // Alle getoonde eetopties worden in één druk uitgesloten; het punt is daarna leeg → vrije ronde.
      const state = await noneFit(cookie, sessionId);

      const laatste = prompts[prompts.length - 1]!;
      expect(laatste.availableSymbols).toEqual([]);
      expect(laatste.rejectedConcepts.some((r) => r.kind === 'no_fitting_option')).toBe(true);

      const opdracht = [laatste.goal, ...laatste.aacRules].join(' ');
      expect(opdracht).toMatch(/blijf in dezelfde gesprekslijn/i);
      expect(opdracht).toMatch(/blijf bij het onderwerp/i);
      // En nergens de tegengestelde opdracht die de sprong naar nagels veroorzaakte.
      expect(opdracht).not.toMatch(/verleg de invalshoek/i);
      expect(opdracht).not.toMatch(/verkeerde richting/i);

      // De route blijft staan en het aanbod is wat de AI binnen de lijn aandroeg.
      expect(state.history.map((entry) => entry.symbol.concept)).toEqual(['want', 'eat']);
      expect(conceptsOf(state)).toEqual(['pannenkoek']);
    });
  });

  // --- T14.1/T14.2: de gemelde vraagroute, van startscherm tot boodschap ----------------------------

  describe('een vraag stellen (T14.1/T14.2)', () => {
    /** Provider die de aangeboden opties ordent en zeker genoeg is om een voorstel te laten volgen. */
    const zeker: AiProvider = {
      name: 'zeker',
      selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision> {
        return Promise.resolve({
          question: 'Waar gaat je vraag over?',
          options: prompt.availableSymbols.slice(0, 6).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.9,
          })),
          confidence: 0.95,
          reason: 'de route is duidelijk',
        });
      },
    };

    it('komt via "Wat?" en "Eten" bij de vraag "Wat eten we?"', async () => {
      // Het gemelde verloop uit de zesde gebruikerstest. Vóór T14.1/T14.2 liep dit twee keer vast: de
      // beslissingslaag eiste eerst verfijning van "eten" (zes kinderen), en het voorstel luidde
      // vervolgens "Ik wil iets vragen over wat? eten."
      const { cookie, sessionId } = await startFor(zeker);
      const naVraag = await next(cookie, sessionId, 'ask');
      expect(conceptsOf(naVraag)).toContain('ask-what');

      const naWat = await next(cookie, sessionId, 'ask-what');
      expect(conceptsOf(naWat)).toContain('eat');

      const naEten = await next(cookie, sessionId, 'eat');
      // De vraag is af: geen verplichte vervolgvraag meer (T14.2).
      expect(naEten.done).toBe(true);

      const bevestigd = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/confirm`,
        headers: { cookie },
      });
      expect(bevestigd.statusCode).toBe(200);
      expect(bevestigd.json().message).toBe('Wat eten we?');
    });

    it('kan de vraag in de tijd plaatsen (T14.4)', async () => {
      const { cookie, sessionId } = await startFor(zeker);
      await next(cookie, sessionId, 'ask');
      await next(cookie, sessionId, 'ask-what');
      const naEten = await next(cookie, sessionId, 'eat');
      expect(naEten.done).toBe(true);

      // De gebruiker wil preciezer zijn: ❌ opent een verfijnronde, en dáár staan de tijdsbepalingen.
      const verfijn = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/correction`,
        headers: { cookie },
        payload: { type: 'wrong_guess' },
      });
      expect(verfijn.statusCode).toBe(200);
      const opties = conceptsOf(parseState(verfijn.json()));
      expect(opties).toContain('today');

      const naVandaag = await next(cookie, sessionId, 'today');
      expect(naVandaag.history.map((entry) => entry.symbol.concept)).toEqual([
        'ask',
        'ask-what',
        'eat',
        'today',
      ]);

      const bevestigd = await app.inject({
        method: 'POST',
        url: `/conversation/${sessionId}/confirm`,
        headers: { cookie },
      });
      expect(bevestigd.json().message).toBe('Wat eten we vandaag?');
    });

    it('blijft bij een wens gewoon doorvragen', async () => {
      // De tegenproef bij T14.2: "Ik wil eten." is nog steeds te vaag voor een voorstel (T10.10).
      const { cookie, sessionId } = await startFor(zeker);
      await next(cookie, sessionId, 'want');
      const naEten = await next(cookie, sessionId, 'eat');
      expect(naEten.done).toBe(false);
      expect(naEten.question).not.toBeNull();
    });
  });
});
