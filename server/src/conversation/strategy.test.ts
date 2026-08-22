import { describe, expect, it } from 'vitest';
import { AAC_RULES, GOAL } from '../ai/prompt.js';
import { CONFIDENCE_PROPOSE, CONFIDENCE_REFINE } from '../ai/thresholds.js';
import { HYPOTHESIS_SMOOTHING } from './hypothesis.js';
import {
  conversationStrategyKeySchema,
  promptRulesFor,
  REFINE_STRATEGY,
  type ConversationStrategy,
} from './strategy.js';

/**
 * De strategie `refine` is de huidige aanpak, één op één (T11.2, DESIGN §7.10).
 *
 * Deze test pint de waarden vast op wat er vóór T11.2 verspreid in de code stond. Niet uit
 * behoudzucht: `refine` is de enige strategie waarvan we weten hoe ze zich in gebruikerstests gedraagt,
 * en de bestaande gespreks- en beslissingstests bewijzen alleen iets over "het gedrag is niet veranderd"
 * zolang die waarden ook echt de oude zijn. Wijzigt iemand er één, dan is dat een keuze die hier
 * zichtbaar wordt in plaats van een stille verschuiving in de kwaliteit van elk gesprek.
 */
describe('strategie refine — de huidige aanpak, benoemd', () => {
  it('draagt de waarden die vóór T11.2 in vijf modules verspreid stonden', () => {
    expect(REFINE_STRATEGY.key).toBe('refine');
    expect(REFINE_STRATEGY.candidateSources).toEqual([
      'children',
      'descendants',
      'retrieval',
      'preference',
    ]);
    expect(REFINE_STRATEGY.maxCandidates).toBe(30); // env-default AI_MAX_CANDIDATES
    expect(REFINE_STRATEGY.minOffered).toBe(8); // was MIN_OFFERED_OPTIONS
    expect(REFINE_STRATEGY.maxOffered).toBe(12); // was MAX_OFFERED_OPTIONS
    expect(REFINE_STRATEGY.confidenceRefine).toBe(CONFIDENCE_REFINE);
    expect(REFINE_STRATEGY.confidencePropose).toBe(CONFIDENCE_PROPOSE);
    expect(REFINE_STRATEGY.hypothesisSmoothing).toBe(HYPOTHESIS_SMOOTHING);
    expect(REFINE_STRATEGY.minUserChoicesBeforePropose).toBe(1);
    expect(REFINE_STRATEGY.prompt.goal).toBe(GOAL);
    expect(REFINE_STRATEGY.prompt.extraAacRules).toEqual([]);
  });

  it('levert precies de bestaande AAC-regels op (geen extra regels)', () => {
    expect(promptRulesFor(REFINE_STRATEGY)).toEqual([...AAC_RULES]);
  });
});

describe('strategiesleutel op de API-grens', () => {
  it('accepteert een bestaande sleutel', () => {
    expect(conversationStrategyKeySchema.parse('refine')).toBe('refine');
  });

  it('weigert een onbekende sleutel (nooit een halve strategie)', () => {
    expect(conversationStrategyKeySchema.safeParse('verzonnen').success).toBe(false);
    expect(conversationStrategyKeySchema.safeParse('').success).toBe(false);
  });

  it('typeert een strategie als leesbare waarde, niet als losse constanten', () => {
    const strategy: ConversationStrategy = REFINE_STRATEGY;
    expect(strategy.label.length).toBeGreaterThan(0);
  });
});
