import { describe, expect, it } from 'vitest';
import { analyzeCorrection } from './correction.js';

/**
 * Unit-tests voor de correctie-heranalyse (T5.4, DESIGN §3.4, FR-009). De heranalyse is een pure
 * functie van de stappen: ze kiest de stap met de laagste interpretatie-zekerheid als vermoedelijke
 * foutstap (§7.4-signaal), met deterministische tie-break.
 */
describe('analyzeCorrection (T5.4)', () => {
  function step(order: number, selectedConcept: string, confidence: number | null) {
    return { order, selectedConcept, confidence };
  }

  it('kiest de stap met de laagste zekerheid als vermoedelijke foutstap', () => {
    const steps = [step(0, 'want', 0.7), step(1, 'do-activity', 0.2), step(2, 'outside', 0.6)];
    expect(analyzeCorrection(steps)).toEqual({ stepOrder: 1, rejectedConcept: 'do-activity' });
  });

  it('kiest bij gelijke zekerheid de vroegste stap (wortel van het misverstand)', () => {
    const steps = [step(0, 'want', 0.5), step(1, 'do-activity', 0.5), step(2, 'outside', 0.9)];
    expect(analyzeCorrection(steps)).toEqual({ stepOrder: 0, rejectedConcept: 'want' });
  });

  it('negeert stappen zonder zekerheid zolang er wél zekerheid bekend is', () => {
    const steps = [step(0, 'want', null), step(1, 'do-activity', 0.4), step(2, 'outside', null)];
    expect(analyzeCorrection(steps)).toEqual({ stepOrder: 1, rejectedConcept: 'do-activity' });
  });

  it('valt terug op de laatste stap als geen enkele stap zekerheid heeft', () => {
    const steps = [step(0, 'want', null), step(1, 'do-activity', null)];
    expect(analyzeCorrection(steps)).toEqual({ stepOrder: 1, rejectedConcept: 'do-activity' });
  });
});
