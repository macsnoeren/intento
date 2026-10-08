import { describe, expect, it } from 'vitest';
import type { StoredOption } from '../communication/provenance.js';
import { computeBias, type BiasInference, type BiasObserved, type BiasScreen } from './bias.js';

/** Het bias-rapport op vaste testdata (N14.3, INTENTO-NEW-DESIGN §24 B4/B5). */

function symbol(id: string, position: number): StoredOption {
  return {
    ref: `o-${id}`,
    kind: 'symbol',
    vocabularyItemId: id,
    contactId: null,
    concept: id,
    representation: 'exact',
    position,
  };
}

function contact(id: string, position = 0): StoredOption {
  return {
    ref: `c-${id}`,
    kind: 'contact',
    vocabularyItemId: null,
    contactId: id,
    concept: null,
    representation: 'exact',
    position,
  };
}

const tiles = (n: number) => Array.from({ length: n }, (_, i) => symbol(`s${i}`, i));

function screen(
  sessionId: string,
  turn: number,
  kind: string,
  mode: string,
  options: StoredOption[],
) {
  return { sessionId, turn, kind, mode, options } satisfies BiasScreen;
}

function did(sessionId: string, turn: number, type: string, position: number | null = null) {
  return { sessionId, turn, type, position } satisfies BiasObserved;
}

function thought(sessionId: string, turn: number, kind: string, confidence: number | null) {
  return { sessionId, turn, kind, confidence } satisfies BiasInference;
}

describe('computeBias', () => {
  it('eerste plek in tegels, met wat je bij toeval zou verwachten', () => {
    const screens = [
      screen('a', 0, 'question', 'multi', tiles(4)),
      screen('a', 1, 'question', 'multi', tiles(4)),
      screen('a', 2, 'question', 'multi', tiles(2)),
      screen('a', 3, 'question', 'multi', tiles(4)), // "Geen van deze": geen keuze
    ];
    const observed = [
      did('a', 0, 'start'),
      did('a', 0, 'select_option', 0),
      did('a', 1, 'select_option', 0),
      did('a', 2, 'select_option', 1),
      did('a', 3, 'none_of_these'),
    ];
    const report = computeBias(screens, observed, []);
    expect(report.firstPosition).toEqual({
      count: 2,
      of: 3,
      share: 2 / 3,
      expected: (0.25 + 0.25 + 0.5) / 3,
    });
    expect(report.sessions).toBe(1);
  });

  it('JA-aandeel in ja/nee; "Bedoel je …?" en contactvragen tellen niet mee', () => {
    const screens = [
      screen('a', 0, 'question', 'binary', [symbol('pain', 0)]),
      screen('a', 1, 'question', 'binary', [symbol('eat', 0)]),
      screen('a', 2, 'question', 'binary', [symbol('drink', 0)]),
      screen('a', 3, 'confirm_message', 'binary', []),
      screen('b', 0, 'question', 'binary', [symbol('pain', 0)]),
    ];
    const observed = [
      did('a', 0, 'answer_no'),
      did('a', 1, 'answer_no'),
      did('a', 2, 'answer_yes'),
      did('a', 3, 'answer_yes'),
      did('b', 0, 'answer_yes'),
    ];
    expect(computeBias(screens, observed, []).binaryYes).toEqual({ count: 2, of: 4, share: 0.5 });
  });

  it('per contact gekozen en op de eerste plek; een tegel kiezen is nog geen keuze', () => {
    const screens = [
      // Gesprek a: Tim eerst, NEE; Mama JA.
      screen('a', 5, 'share_contact', 'binary', [contact('tim')]),
      screen('a', 6, 'share_contact', 'binary', [contact('mama')]),
      // Gesprek b (tegels): Mama gekozen, dan JA op "Naar Mama sturen?". Mama stond eerst.
      screen('b', 5, 'share_contact', 'multi', [contact('mama', 0), contact('tim', 1)]),
      screen('b', 6, 'confirm_send', 'binary', [contact('mama')]),
      // Gesprek c: Tim eerst, JA.
      screen('c', 5, 'share_contact', 'binary', [contact('tim')]),
    ];
    const observed = [
      did('a', 5, 'answer_no'),
      did('a', 6, 'answer_yes'),
      did('b', 5, 'select_option', 0),
      did('b', 6, 'answer_yes'),
      did('c', 5, 'answer_yes'),
    ];
    const report = computeBias(screens, observed, []);
    expect(report.contacts).toEqual([
      { contactId: 'mama', chosen: 2, chosenAtFirst: 1 },
      { contactId: 'tim', chosen: 1, chosenAtFirst: 1 },
    ]);
    expect(report.contactFirst).toEqual({ count: 2, of: 3, share: 2 / 3 });
  });

  it('vormwisselingen: de startkeuze telt niet', () => {
    const screens = [
      screen('a', 0, 'question', 'binary', [symbol('pain', 0)]),
      screen('b', 3, 'question', 'binary', [symbol('pain', 0)]),
    ];
    const inferences = [
      thought('a', 0, 'mode_change', null),
      thought('a', 4, 'mode_change', null),
      thought('a', 8, 'mode_change', null),
      thought('b', 3, 'mode_change', null),
    ];
    expect(computeBias(screens, [], inferences).modeSwitches).toEqual({ switches: 2, sessions: 1 });
  });

  it('overconfidence: zeker voorstel met NEE, en een plotselinge stijging zonder JA', () => {
    const screens = [screen('a', 0, 'question', 'binary', [symbol('pain', 0)])];
    const observed = [
      did('a', 0, 'answer_no'), // daarna stijgt de zekerheid 0,2 → 0,7: zonder JA
      did('a', 1, 'answer_yes'), // daarna 0,7 → 0,95: met JA, telt niet
      did('a', 2, 'answer_no'), // NEE op een voorstel van 0,95
      did('a', 3, 'answer_yes'), // JA op een voorstel van 0,92
    ];
    const inferences = [
      thought('a', 0, 'intent_hypotheses', 0.2),
      thought('a', 1, 'intent_hypotheses', 0.7),
      thought('a', 2, 'intent_hypotheses', 0.95),
      thought('a', 2, 'proposal', 0.95),
      thought('a', 3, 'proposal', 0.92),
      thought('a', 4, 'proposal', 0.6),
    ];
    expect(computeBias(screens, observed, inferences).overconfidence).toEqual({
      rejectedConfidentProposals: { count: 1, of: 2, share: 0.5 },
      suddenRises: 1,
    });
  });

  it('niets te tellen: aandelen zijn null, geen deling door nul', () => {
    const report = computeBias([], [], []);
    expect(report.firstPosition).toEqual({ count: 0, of: 0, share: null, expected: null });
    expect(report.binaryYes.share).toBeNull();
    expect(report.contactFirst.share).toBeNull();
    expect(report.sessions).toBe(0);
  });
});
