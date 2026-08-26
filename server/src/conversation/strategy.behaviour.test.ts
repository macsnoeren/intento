import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { FREE_ROUND_RULES } from '../ai/prompt.js';
import type { AiPrompt, AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { resetAuthData, seedUser } from '../test/auth-helpers.js';
import { decideNextQuestion } from './decision.js';
import {
  CALM_STRATEGY,
  CONTEXT_FIRST_STRATEGY,
  CONVERSATION_STRATEGIES,
  EXPLORE_STRATEGY,
  GUESS_STRATEGY,
  REFINE_STRATEGY,
} from './strategy.js';

/**
 * **Doen de strategieën aantoonbaar iets anders?** (T11.3, DESIGN §7.10)
 *
 * Een abstractie met vier configuraties die op hetzelfde uitkomen, bewijst niets — dan is de keuze voor
 * de begeleider een lege belofte. Deze tests zetten de strategieën daarom naast elkaar op **dezelfde
 * gesprekstoestand** en leggen het onderscheidende gedrag vast. De domeinregels worden hier bewust niet
 * herhaald; die staan in de gedeelde invariant-suite (`strategy.invariants.test.ts`).
 */
describe('gespreksstrategieën — onderscheidend gedrag', () => {
  /** Provider die niets aandraagt: het aanbod komt dan puur uit de kandidatenvolgorde. */
  const silent: AiProvider = {
    name: 'silent',
    selectNextQuestion: () =>
      Promise.resolve<AiQuestionDecision>({
        question: 'Wat bedoel je?',
        options: [],
        reason: 'geen voorkeur',
        confidence: 0.3,
      }),
  };

  /** Provider die zeer zeker is: legt het verschil in voorsteldrempel bloot. */
  const confident: AiProvider = {
    name: 'confident',
    selectNextQuestion: (prompt) =>
      Promise.resolve<AiQuestionDecision>({
        question: 'Bedoel je dit?',
        options: prompt.availableSymbols
          .slice(0, 3)
          .map((ref) => ({ symbol: ref.concept, confidence: 0.9 })),
        reason: 'vrij zeker',
        confidence: 0.9,
      }),
  };

  const silentOrchestrator = new AiOrchestrator(silent);
  const confidentOrchestrator = new AiOrchestrator(confident);
  const steps = (...concepts: string[]) => concepts.map((selectedConcept) => ({ selectedConcept }));
  const conceptsOf = (d: Awaited<ReturnType<typeof decideNextQuestion>>) =>
    (d.question?.options ?? []).map((o) => o.concept);

  let childConcepts: string[] = [];
  let grandchildConcepts: string[] = [];
  let userId = '';

  beforeAll(async () => {
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);

    const children = await prisma.aacConceptRelation.findMany({
      where: { parent: { concept: 'want' } },
      include: { child: true },
    });
    childConcepts = children.map((relation) => relation.child.concept);
    const grandchildren = await prisma.aacConceptRelation.findMany({
      where: { parentId: { in: children.map((relation) => relation.childId) } },
      include: { child: true },
    });
    grandchildConcepts = grandchildren
      .map((relation) => relation.child.concept)
      .filter((concept) => !childConcepts.includes(concept));

    // Een gebruiker met een geleerde voorkeur die **buiten** de tak van "Iets willen" valt: zo is
    // zichtbaar of een strategie de voorkeuren echt vóór de boom zet.
    const user = await seedUser('Strategie-testgebruiker');
    userId = user.id;
    await prisma.preference.create({
      data: { userId, concept: 'dog', confidence: 0.9, count: 5 },
    });
  });

  afterAll(async () => {
    await prisma.preference.deleteMany();
    await resetAuthData();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  it('de testopstelling klopt: "Iets willen" heeft kinderen én kleinkinderen', () => {
    expect(childConcepts.length).toBeGreaterThan(0);
    expect(grandchildConcepts.length).toBeGreaterThan(0);
  });

  /**
   * Een gesprekstoestand waarin er **niets meer te verfijnen** valt: alle kinderen van "want" zijn al
   * gezien en afgewezen. Sinds T10.10 is dat de voorwaarde waaronder de zekerheidsdrempel de doorslag
   * geeft — met openstaande verfijningen stelt geen enkele strategie een boodschap voor.
   */
  const exhaustedRoute = {
    steps: steps('want'),
    rejections: ['eat', 'drink', 'do-activity'].map((concept) => ({
      concept,
      kind: 'no_fitting_option' as const,
    })),
    allowNewConcepts: false,
  };

  // --- explore: concreet vóór abstract ---------------------------------------------------------------

  it('explore zet het concrete niveau vooraan waar refine bij de categorieën begint', async () => {
    const afterRefine = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
    });
    const afterExplore = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: EXPLORE_STRATEGY,
    });

    // Dezelfde gesprekstoestand, andere eerste optie: refine begint bij de verfijning van de boom,
    // explore bij de concrete dingen die daarachter zitten.
    expect(childConcepts).toContain(conceptsOf(afterRefine)[0]);
    expect(grandchildConcepts).toContain(conceptsOf(afterExplore)[0]);
    expect(childConcepts).not.toContain(conceptsOf(afterExplore)[0]);
  });

  it('explore biedt er meer aan dan refine op hetzelfde punt', async () => {
    const afterRefine = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
    });
    const afterExplore = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: EXPLORE_STRATEGY,
    });
    expect(conceptsOf(afterExplore).length).toBeGreaterThan(conceptsOf(afterRefine).length);
  });

  it('explore stelt eerder een boodschap voor dan refine (lagere drempel)', async () => {
    // Een provider die matig zeker is: boven explore's drempel (0,75), onder die van refine (0,85).
    const lukewarm = new AiOrchestrator({
      name: 'lukewarm',
      selectNextQuestion: (prompt) =>
        Promise.resolve<AiQuestionDecision>({
          question: 'Bedoel je dit?',
          options: prompt.availableSymbols
            .slice(0, 2)
            .map((ref) => ({ symbol: ref.concept, confidence: 0.8 })),
          reason: 'redelijk zeker',
          confidence: 0.8,
        }),
    });

    const withRefine = await decideNextQuestion(prisma, lukewarm, {
      ...exhaustedRoute,
      strategy: REFINE_STRATEGY,
    });
    const withExplore = await decideNextQuestion(prisma, lukewarm, {
      ...exhaustedRoute,
      strategy: EXPLORE_STRATEGY,
    });

    expect(withRefine.done).toBe(false);
    expect(withExplore.done).toBe(true);
  });

  // --- calm: minder tegelijk, later voorstellen ------------------------------------------------------

  it('calm biedt aantoonbaar minder opties aan dan refine', async () => {
    const afterRefine = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
    });
    const afterCalm = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: CALM_STRATEGY,
    });

    expect(conceptsOf(afterCalm).length).toBeLessThan(conceptsOf(afterRefine).length);
    expect(conceptsOf(afterCalm).length).toBeLessThanOrEqual(CALM_STRATEGY.maxOffered);
  });

  it('calm stelt later voor: dezelfde zekere AI levert bij refine een voorstel en bij calm nog een vraag', async () => {
    const withRefine = await decideNextQuestion(prisma, confidentOrchestrator, {
      ...exhaustedRoute,
      strategy: REFINE_STRATEGY,
    });
    const withCalm = await decideNextQuestion(prisma, confidentOrchestrator, {
      ...exhaustedRoute,
      strategy: CALM_STRATEGY,
    });

    expect(withRefine.done).toBe(true);
    expect(withCalm.done).toBe(false);
    expect(withCalm.question?.options.length).toBeGreaterThan(0);
  });

  it('calm dempt sterker: dezelfde uitschieter tilt de zekerheid minder ver op', async () => {
    const previous = {
      concepts: ['want'],
      confidence: 0.4,
      reason: 'begin',
      history: [{ stepCount: 0, confidence: 0.4, concepts: ['want'] }],
    };

    const withRefine = await decideNextQuestion(prisma, confidentOrchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
      hypothesis: previous,
    });
    const withCalm = await decideNextQuestion(prisma, confidentOrchestrator, {
      steps: steps('want'),
      strategy: CALM_STRATEGY,
      hypothesis: previous,
    });

    expect(withCalm.confidence).toBeLessThan(withRefine.confidence);
  });

  // --- context-first: de persoon vóór de boom -------------------------------------------------------

  it('context-first zet de geleerde voorkeur vooraan waar refine bij de boom begint', async () => {
    const afterRefine = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
      userId,
    });
    const afterContext = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: CONTEXT_FIRST_STRATEGY,
      userId,
    });

    expect(conceptsOf(afterContext)[0]).toBe('dog');
    expect(conceptsOf(afterRefine)[0]).not.toBe('dog');
    expect(childConcepts).toContain(conceptsOf(afterRefine)[0]);
  });

  it('context-first neemt de begeleidersvraag mee in de retrieval, vóór de boomkinderen', async () => {
    const decision = await decideNextQuestion(prisma, silentOrchestrator, {
      steps: steps('want'),
      strategy: CONTEXT_FIRST_STRATEGY,
      questionContext: 'Wil je koffie of thee?',
      userId,
    });
    // De retrieval-treffer staat vóór de boomkinderen; de boom verdwijnt niet, hij komt later.
    const offered = conceptsOf(decision);
    expect(offered).toContain('coffee');
    const offeredChildren = childConcepts.filter((concept) => offered.includes(concept));
    expect(offeredChildren.length).toBeGreaterThan(0);
    for (const child of offeredChildren) {
      expect(offered.indexOf('coffee')).toBeLessThan(offered.indexOf(child));
    }
  });

  // --- guess: de AI draagt alles zelf aan (T16.2) ---------------------------------------------------

  /** Orchestrator die de ontvangen prompts vasthoudt; zo is te zien wát het model kreeg voorgelegd. */
  function recording(decision: AiQuestionDecision): {
    orchestrator: AiOrchestrator;
    prompts: AiPrompt[];
  } {
    const prompts: AiPrompt[] = [];
    const provider: AiProvider = {
      name: 'recording',
      selectNextQuestion: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(decision);
      },
    };
    return { orchestrator: new AiOrchestrator(provider), prompts };
  }

  const noOptions: AiQuestionDecision = {
    question: 'Wat bedoel je?',
    options: [],
    reason: 'geen voorstel',
    confidence: 0.3,
  };

  it('guess maakt van elke beurt na de eerste keuze een vrije ronde', async () => {
    // De vrije ronde was een noodgreep (er was niets meer over); met `guess` is hij de werkwijze. Het
    // model krijgt geen optielijst maar wél het pad, en de opdracht zelf begrippen aan te dragen.
    for (const route of [steps('want'), steps('want', 'do-activity')]) {
      const { orchestrator, prompts } = recording(noOptions);
      await decideNextQuestion(prisma, orchestrator, { steps: route, strategy: GUESS_STRATEGY });

      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.availableSymbols).toEqual([]);
      expect(prompts[0]!.aacRules).toContain(FREE_ROUND_RULES[0]);
      // En het pad zelf gaat wél mee: raden zonder context is geen raden maar gokken in het wilde weg.
      expect(prompts[0]!.conversationContext.map((ref) => ref.concept)).toEqual(
        route.map((step) => step.selectedConcept),
      );
    }
  });

  it('refine legt op datzelfde punt wél een keuzelijst voor', async () => {
    const { orchestrator, prompts } = recording(noOptions);
    await decideNextQuestion(prisma, orchestrator, {
      steps: steps('want'),
      strategy: REFINE_STRATEGY,
    });

    expect(prompts[0]!.availableSymbols.length).toBeGreaterThan(0);
    expect(prompts[0]!.aacRules).not.toContain(FREE_ROUND_RULES[0]);
  });

  it('guess valt ook op een afgeronde vraagroute niet stil (de tijdsbron zit onder de strategie)', async () => {
    // De tijdsbepalingen (T14.4) werden buiten de strategie om toegevoegd. Daardoor was `available` op
    // "Een vraag stellen → Wat? → Eten" niet leeg en bleef de vrije ronde juist dáár uit.
    const route = steps('ask', 'ask-what', 'eat');

    const guess = recording(noOptions);
    await decideNextQuestion(prisma, guess.orchestrator, {
      steps: route,
      strategy: GUESS_STRATEGY,
    });
    expect(guess.prompts[0]!.availableSymbols).toEqual([]);

    // Bij refine blijft het gedrag van T14.4 staan: de tijdsbepalingen komen als eerste kandidaten.
    const refine = recording(noOptions);
    await decideNextQuestion(prisma, refine.orchestrator, {
      steps: route,
      strategy: REFINE_STRATEGY,
    });
    expect(refine.prompts[0]!.availableSymbols[0]!.concept).toBe('now');
  });

  it('guess houdt het startscherm ongemoeid: de gebruiker kiest de richting', async () => {
    // Raden mag pas nadat de gebruiker een richting koos (DESIGN §3.1, §2); de intentiecategorieën zijn
    // de bodem onder het gesprek en staan buiten de strategie om vast.
    const { orchestrator, prompts } = recording(noOptions);
    const decision = await decideNextQuestion(prisma, orchestrator, {
      steps: steps(),
      strategy: GUESS_STRATEGY,
    });

    const intents = await prisma.aacSymbol.findMany({ where: { category: 'intent' } });
    expect(conceptsOf(decision).sort()).toEqual(intents.map((symbol) => symbol.concept).sort());
    expect(prompts[0]!.availableSymbols.length).toBe(intents.length);
  });

  // --- de uitleg is geen formaliteit ----------------------------------------------------------------

  it('elke strategie draagt een uitleg waarmee een begeleider kan kiezen', () => {
    for (const strategy of CONVERSATION_STRATEGIES) {
      expect(strategy.label.trim().length).toBeGreaterThan(0);
      expect(strategy.description.trim().length).toBeGreaterThan(20);
      // Geen ontwikkelaarstaal: de uitleg zegt voor wie het bedoeld is, niet welke parameter er wijzigt.
      expect(strategy.description).not.toMatch(/confidence|threshold|parameter|smoothing/i);
    }
  });
});
