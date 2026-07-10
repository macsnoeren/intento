import { describe, expect, it } from 'vitest';
import { CONFIDENCE_PROPOSE, CONFIDENCE_REFINE, phaseForDecision } from './thresholds.js';

/** Confidence-drempels (T5.2, DESIGN §7.4): de banden <60% / 60–85% / >85%. */
describe('phaseForDecision — confidence-banden (§7.4)', () => {
  it('kiest select onder de verfijndrempel', () => {
    expect(phaseForDecision(0.0, false)).toBe('select');
    expect(phaseForDecision(CONFIDENCE_REFINE - 0.01, false)).toBe('select');
  });

  it('kiest refine tussen de verfijn- en voorsteldrempel', () => {
    expect(phaseForDecision(CONFIDENCE_REFINE, false)).toBe('refine');
    expect(phaseForDecision(CONFIDENCE_PROPOSE - 0.01, false)).toBe('refine');
  });

  it('kiest propose vanaf de voorsteldrempel', () => {
    expect(phaseForDecision(CONFIDENCE_PROPOSE, false)).toBe('propose');
    expect(phaseForDecision(1, false)).toBe('propose');
  });

  it('kiest altijd propose bij een eindconcept, ongeacht de zekerheid', () => {
    expect(phaseForDecision(0.1, true)).toBe('propose');
  });
});
