import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { seedAacLibrary } from '../aac/library.js';
import { AiOrchestrator } from '../ai/orchestrator.js';
import { AAC_RULES } from '../ai/prompt.js';
import type { AiPrompt, AiProvider, AiQuestionDecision } from '../ai/provider.js';
import { decideNextQuestion } from './decision.js';
import {
  CONVERSATION_STRATEGIES,
  DEFAULT_STRATEGY_KEY,
  defaultStrategy,
  findStrategy,
  promptRulesFor,
  strategyKeys,
  type ConversationStrategy,
} from './strategy.js';

/**
 * **Gedeelde invariant-testsuite over álle gespreksstrategieën** (T11.2, DESIGN §7.10, ADR-0013).
 *
 * Een strategie verandert de **zoekwijze**, nooit de **garanties**. Zonder een suite die dat afdwingt is
 * elke nieuwe strategie een plek waar een waarborg stilletjes wegvalt: iemand zet een drempel anders, een
 * bron eruit of een minimum op nul, en het gesprek verliest een belofte die nergens meer getoetst wordt.
 *
 * Daarom draaien deze tests over de **registry**, niet over één strategie: een nieuwe strategie
 * toevoegen betekent automatisch deze suite halen. De domeinregels die hier bewaakt worden komen
 * rechtstreeks uit DESIGN §7.10:
 *
 *  - nooit een leeg scherm;
 *  - geen boodschapvoorstel zonder een keuze van de **gebruiker**;
 *  - afgewezen concepten komen nooit terug;
 *  - deduplicatie tegen bestaande concepten gaat altijd voor;
 *  - de promptsleutelset blijft gesloten.
 */
describe('gespreksstrategieën — de registry', () => {
  it('heeft een geldige standaard', () => {
    expect(findStrategy(DEFAULT_STRATEGY_KEY)).not.toBeNull();
    expect(defaultStrategy().key).toBe(DEFAULT_STRATEGY_KEY);
  });

  it('heeft unieke sleutels en kent ze allemaal op', () => {
    const keys = strategyKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(findStrategy(key)?.key).toBe(key);
  });

  it('kent een onbekende sleutel niet (die mag nooit stil op de standaard terugvallen)', () => {
    expect(findStrategy('bestaat-niet')).toBeNull();
    expect(findStrategy(null)).toBeNull();
    expect(findStrategy('')).toBeNull();
  });
});

describe.each(CONVERSATION_STRATEGIES.map((s) => [s.key, s] as const))(
  'invarianten — strategie %s',
  (_key, strategy: ConversationStrategy) => {
    // --- Parameters: de grenzen waarbinnen een strategie mag bewegen ---------------------------------

    it('heeft een label en een uitleg in begrijpelijke taal (de begeleider kiest hem)', () => {
      expect(strategy.label.trim().length).toBeGreaterThan(0);
      expect(strategy.description.trim().length).toBeGreaterThan(20);
    });

    it('kan het scherm niet leegmaken', () => {
      expect(strategy.minOffered).toBeGreaterThanOrEqual(1);
      expect(strategy.maxOffered).toBeGreaterThanOrEqual(strategy.minOffered);
      expect(strategy.maxCandidates).toBeGreaterThanOrEqual(strategy.maxOffered);
      expect(strategy.candidateSources.length).toBeGreaterThan(0);
      expect(new Set(strategy.candidateSources).size).toBe(strategy.candidateSources.length);
    });

    it('houdt de drempels in de juiste volgorde en de demping werkzaam', () => {
      expect(strategy.confidenceRefine).toBeGreaterThan(0);
      expect(strategy.confidencePropose).toBeGreaterThanOrEqual(strategy.confidenceRefine);
      expect(strategy.confidencePropose).toBeLessThanOrEqual(1);
      expect(strategy.hypothesisSmoothing).toBeGreaterThan(0);
      expect(strategy.hypothesisSmoothing).toBeLessThanOrEqual(1);
    });

    it('vraagt altijd minstens één keuze van de gebruiker vóór een voorstel', () => {
      expect(strategy.minUserChoicesBeforePropose).toBeGreaterThanOrEqual(1);
    });

    it('vult de AAC-regels aan maar vervangt de harde regels niet', () => {
      const rules = promptRulesFor(strategy);
      for (const rule of AAC_RULES) expect(rules).toContain(rule);
    });
  },
);

describe('invarianten in de gespreksflow (per strategie)', () => {
  const steps = (...concepts: string[]) => concepts.map((selectedConcept) => ({ selectedConcept }));
  const conceptsOf = (d: Awaited<ReturnType<typeof decideNextQuestion>>) =>
    (d.question?.options ?? []).map((o) => o.concept);

  /** Provider die precies teruggeeft wat de test wil, en de ontvangen prompt vasthoudt. */
  function stub(decide: (prompt: AiPrompt) => AiQuestionDecision): {
    orchestrator: AiOrchestrator;
    prompts: AiPrompt[];
  } {
    const prompts: AiPrompt[] = [];
    const provider: AiProvider = {
      name: 'invariant-stub',
      selectNextQuestion: (prompt) => {
        prompts.push(prompt);
        return Promise.resolve(decide(prompt));
      },
    };
    return { orchestrator: new AiOrchestrator(provider), prompts };
  }

  beforeAll(async () => {
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await seedAacLibrary(prisma);
  });

  beforeEach(async () => {
    await prisma.conceptProposal.deleteMany();
  });

  afterAll(async () => {
    await prisma.conceptProposal.deleteMany();
    await prisma.aacConceptRelation.deleteMany();
    await prisma.aacSymbol.deleteMany();
    await prisma.$disconnect();
  });

  for (const strategy of CONVERSATION_STRATEGIES) {
    describe(strategy.key, () => {
      it('toont nooit een leeg scherm, ook niet als de AI niets aandraagt', async () => {
        const { orchestrator } = stub(() => ({
          question: 'Wat bedoel je?',
          options: [],
          reason: 'geen idee',
          confidence: 0.1,
        }));

        for (const route of [steps(), steps('want'), steps('want', 'do-activity')]) {
          const decision = await decideNextQuestion(prisma, orchestrator, {
            steps: route,
            strategy,
          });
          // Ofwel een vraag met opties, ofwel een voorstel — maar nooit een vraag zonder iets te kiezen.
          if (decision.question) {
            expect(decision.question.options.length).toBeGreaterThan(0);
          } else {
            expect(decision.done).toBe(true);
          }
        }
      });

      it('biedt op het startscherm álle intentiecategorieën aan (DESIGN §3.1)', async () => {
        // Een strategie mag het aanbod klein houden, maar niet de richtingkeuze inperken: zou `calm`
        // met zijn aanbod van vier één intentie wegsnoeien, dan is "Iets willen" in dat hele gesprek
        // onbereikbaar. Hoeveel er tegelijk op het scherm passen regelt de tablet (`iconsPerScreen`).
        const { orchestrator } = stub((prompt) => ({
          question: 'Waar gaat het over?',
          // Een AI die maar één categorie noemt, mag de andere niet doen verdwijnen.
          options: prompt.availableSymbols.slice(0, 1).map((ref) => ({
            symbol: ref.concept,
            confidence: 0.5,
          })),
          reason: 'eerste indruk',
          confidence: 0.3,
        }));

        const intents = await prisma.aacSymbol.findMany({ where: { category: 'intent' } });
        const decision = await decideNextQuestion(prisma, orchestrator, {
          steps: steps(),
          strategy,
        });
        expect(conceptsOf(decision).sort()).toEqual(intents.map((s) => s.concept).sort());
      });

      it('stelt geen boodschap voor zonder een keuze van de gebruiker', async () => {
        // Een provider die volstrekt zeker is: alleen de domeinregel houdt het voorstel tegen.
        const { orchestrator } = stub((prompt) => ({
          question: 'Bedoel je dit?',
          options: prompt.availableSymbols.slice(0, 2).map((ref) => ({
            symbol: ref.concept,
            confidence: 1,
          })),
          reason: 'zeer zeker',
          confidence: 1,
        }));

        const atStart = await decideNextQuestion(prisma, orchestrator, {
          steps: steps(),
          strategy,
        });
        expect(atStart.done).toBe(false);

        // Vraagmodus: het anker van de begeleider is géén keuze van de gebruiker (T9.14, DESIGN §2).
        const anchoredOnly = await decideNextQuestion(prisma, orchestrator, {
          steps: steps('want'),
          anchoredSteps: 1,
          strategy,
        });
        expect(anchoredOnly.done).toBe(false);
      });

      it('biedt een afgewezen concept nooit opnieuw aan, ook niet als de AI erop staat', async () => {
        const { orchestrator } = stub(() => ({
          question: 'Bedoel je dit?',
          options: [
            { symbol: 'eat', confidence: 0.9 },
            { symbol: 'drink', confidence: 0.8 },
          ],
          reason: 'toch nog een keer',
          confidence: 0.5,
        }));

        const decision = await decideNextQuestion(prisma, orchestrator, {
          steps: steps('want'),
          rejections: [
            { concept: 'eat', kind: 'no_fitting_option' },
            { concept: 'drink', kind: 'wrong_guess' },
          ],
          strategy,
        });

        expect(conceptsOf(decision)).not.toContain('eat');
        expect(conceptsOf(decision)).not.toContain('drink');
        // Ook het reeds gekozen pad komt niet terug.
        expect(conceptsOf(decision)).not.toContain('want');
      });

      it('dedupliceert vóór het aanmaken van een nieuw begrip', async () => {
        // "lopen" is een synoniem van het bestaande concept `walking`.
        const { orchestrator } = stub(() => ({
          question: 'Bedoel je dit?',
          options: [{ symbol: 'lopen', confidence: 0.9 }],
          reason: 'synoniem',
          confidence: 0.5,
        }));

        const before = await prisma.aacSymbol.count();
        const decision = await decideNextQuestion(prisma, orchestrator, {
          steps: steps('want'),
          strategy,
          allowNewConcepts: true,
          icons: null,
        });

        expect(conceptsOf(decision)).toContain('walking');
        expect(await prisma.aacSymbol.findUnique({ where: { concept: 'lopen' } })).toBeNull();
        expect(await prisma.aacSymbol.count()).toBe(before);
      });

      it('houdt de promptsleutelset gesloten (een strategie vult inhoud, geen velden)', async () => {
        const { orchestrator, prompts } = stub(() => ({
          question: 'Wat bedoel je?',
          options: [],
          reason: '',
          confidence: 0.2,
        }));

        await decideNextQuestion(prisma, orchestrator, { steps: steps('want'), strategy });

        expect(prompts).toHaveLength(1);
        expect(Object.keys(prompts[0]!).sort()).toEqual(
          [
            'aacRules',
            'askedQuestions',
            'availableSymbols',
            'conversationContext',
            'goal',
            'lastChoice',
            'questionContext',
            'rejectedConcepts',
            'systemRules',
            'task',
            'userContext',
          ].sort(),
        );
        // De strategie levert de inhoud van doel en regels — de harde AAC-regels blijven erin staan.
        expect(prompts[0]!.goal).toBe(strategy.prompt.goal);
        for (const rule of AAC_RULES) expect(prompts[0]!.aacRules).toContain(rule);
      });

      it('kan de operationele grenzen niet oprekken (env blijft plafond)', async () => {
        const { orchestrator } = stub(() => ({
          question: 'Bedoel je dit?',
          options: [{ symbol: 'nagelknipperinvariant', confidence: 0.9 }],
          reason: 'nieuw begrip',
          confidence: 0.4,
        }));

        // env zegt nee → geen nieuw symbool, ongeacht wat de strategie wil.
        const decision = await decideNextQuestion(prisma, orchestrator, {
          steps: steps('want'),
          strategy,
          allowNewConcepts: false,
        });

        expect(conceptsOf(decision)).not.toContain('nagelknipperinvariant');
        expect(
          await prisma.aacSymbol.findUnique({ where: { concept: 'nagelknipperinvariant' } }),
        ).toBeNull();
      });
    });
  }
});
