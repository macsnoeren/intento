import { describe, expect, it } from 'vitest';
import { analyzeCorrection } from './correction.js';

/**
 * Unit-tests voor de correctie op een voorstel (T5.4, herzien in T10.10; DESIGN §3.4, FR-009).
 *
 * ❌ Nee rolt precies **één** stap terug: de laatste keuze van de gebruiker. Nogmaals ❌ rolt de volgende
 * terug. Tot T10.10 probeerde deze laag de foutstap te *bepalen* uit de per-stap-zekerheid, maar die
 * wees systematisch de eerste — en meest bewuste — keuze van de gebruiker aan; zie `correction.ts`.
 */
describe('analyzeCorrection (T5.4/T10.10)', () => {
  function step(order: number, selectedConcept: string) {
    return { order, selectedConcept };
  }

  it('rolt de laatste keuze terug', () => {
    const steps = [step(0, 'want'), step(1, 'eat'), step(2, 'soup')];
    expect(analyzeCorrection(steps)).toEqual({ stepOrder: 2, rejectedConcept: 'soup' });
  });

  it('rolt herhaald aangeroepen de route stap voor stap terug', () => {
    const steps = [step(0, 'want'), step(1, 'eat'), step(2, 'soup')];
    const first = analyzeCorrection(steps);
    const remaining = steps.filter((s) => s.order < first.stepOrder);
    expect(analyzeCorrection(remaining)).toEqual({ stepOrder: 1, rejectedConcept: 'eat' });
  });

  it('raakt een eerdere keuze van de gebruiker nooit in één keer aan', () => {
    // De kern van de T10.10-fix: `want` is de bewuste eerste keuze en mag niet verdwijnen omdat de AI
    // toevallig onzeker was over een latere stap.
    const steps = [step(0, 'want'), step(1, 'eat')];
    expect(analyzeCorrection(steps).rejectedConcept).not.toBe('want');
  });

  it('beschermt het begeleiders-anker in vraagmodus (T9.14)', () => {
    // Stap 0 is het topic-anker van de begeleider; alleen wat de gebruiker zelf koos is corrigeerbaar.
    const steps = [step(0, 'drink'), step(1, 'water')];
    expect(analyzeCorrection(steps, 1)).toEqual({ stepOrder: 1, rejectedConcept: 'water' });
  });

  it('valt terug op de laatste stap als alleen het anker er is', () => {
    // De route-laag vangt dit af met een 400; als terugval wijzen we de laatste stap aan.
    const steps = [step(0, 'drink')];
    expect(analyzeCorrection(steps, 1)).toEqual({ stepOrder: 0, rejectedConcept: 'drink' });
  });
});
