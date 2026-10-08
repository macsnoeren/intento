import { describe, expect, it } from 'vitest';
import type { StoredOption } from '../communication/provenance.js';
import { tallySession, type TallyObserved, type TallyScreen } from './tally.js';

/** De tellingen van één gesprek uit Presented en Observed (N12.1, §21 laag 1). */

function symbol(item: string, position: number): StoredOption {
  return {
    ref: `opt-${item}`,
    kind: 'symbol',
    vocabularyItemId: item,
    contactId: null,
    concept: item,
    representation: 'exact',
    position,
  };
}

function contact(id: string, position = 0): StoredOption {
  return {
    ref: `contact-${id}`,
    kind: 'contact',
    vocabularyItemId: null,
    contactId: id,
    concept: null,
    representation: 'exact',
    position,
  };
}

function screen(turn: number, kind: string, mode: string, options: StoredOption[]): TallyScreen {
  return { turn, kind, mode, options };
}

function find(tallies: ReturnType<typeof tallySession>, type: string, ref: string) {
  return tallies.find((t) => t.subjectType === type && t.subjectRef === ref);
}

describe('tallySession', () => {
  it('multi-icon: getoond, gekozen en gekozen op de eerste plek per symbool', () => {
    const screens = [
      screen(0, 'question', 'multi', [symbol('pain', 0), symbol('food', 1), symbol('mom', 2)]),
      screen(1, 'question', 'multi', [symbol('head', 0), symbol('belly', 1)]),
      screen(2, 'confirm_message', 'binary', []),
      screen(3, 'done', 'binary', []),
    ];
    const observed: TallyObserved[] = [
      { turn: 0, type: 'start', optionRef: null },
      { turn: 0, type: 'select_option', optionRef: 'opt-pain' },
      { turn: 1, type: 'select_option', optionRef: 'opt-belly' },
      { turn: 2, type: 'answer_yes', optionRef: null },
    ];
    const tallies = tallySession(screens, observed, true);
    expect(find(tallies, 'symbol', 'pain')).toMatchObject({
      presented: 1,
      chosen: 1,
      chosenAtFirstPosition: 1,
    });
    expect(find(tallies, 'symbol', 'belly')).toMatchObject({
      presented: 1,
      chosen: 1,
      chosenAtFirstPosition: 0,
    });
    expect(find(tallies, 'symbol', 'food')).toMatchObject({ presented: 1, chosen: 0 });
    expect(find(tallies, 'mode', 'multi')).toMatchObject({ presented: 1, chosen: 1 });
  });

  it('binary: elke JA telt op de eerste plek; NEE is getoond, niet gekozen', () => {
    const screens = [
      screen(0, 'question', 'binary', [symbol('pain', 0)]),
      screen(1, 'question', 'binary', [symbol('head', 0)]),
      screen(2, 'question', 'binary', [symbol('belly', 0)]),
    ];
    const observed: TallyObserved[] = [
      { turn: 0, type: 'answer_yes', optionRef: 'opt-pain' },
      { turn: 1, type: 'answer_no', optionRef: 'opt-head' },
    ];
    const tallies = tallySession(screens, observed, false);
    expect(find(tallies, 'symbol', 'pain')).toMatchObject({ chosen: 1, chosenAtFirstPosition: 1 });
    expect(find(tallies, 'symbol', 'head')).toMatchObject({ presented: 1, chosen: 0 });
    expect(find(tallies, 'symbol', 'belly')).toMatchObject({ presented: 1, chosen: 0 });
    // Niet bevestigd: de vorm is gebruikt, maar leidde niet tot een boodschap.
    expect(find(tallies, 'mode', 'binary')).toMatchObject({ presented: 1, chosen: 0 });
  });

  it('contacten: één keer per gesprek, gekozen alleen met JA op dát contact', () => {
    const screens = [
      screen(0, 'share_contact', 'binary', [contact('tim')]),
      screen(1, 'share_contact', 'binary', [contact('mama')]),
      screen(2, 'done', 'binary', []),
    ];
    const observed: TallyObserved[] = [
      { turn: 0, type: 'answer_no', optionRef: 'contact-tim' },
      { turn: 1, type: 'answer_yes', optionRef: 'contact-mama' },
    ];
    const tallies = tallySession(screens, observed, true);
    expect(find(tallies, 'contact', 'tim')).toMatchObject({ presented: 1, chosen: 0 });
    // Mama werd als tweede aangeboden: gekozen, maar niet op de eerste plek.
    expect(find(tallies, 'contact', 'mama')).toMatchObject({
      presented: 1,
      chosen: 1,
      chosenAtFirstPosition: 0,
    });
  });

  it('multi-icon: een tegel kiezen is nog niet versturen; pas JA op "Naar … sturen?" telt', () => {
    const screens = [
      screen(0, 'share_contact', 'multi', [contact('tim', 0), contact('mama', 1)]),
      screen(1, 'confirm_send', 'binary', [contact('mama')]),
      screen(2, 'share_contact', 'multi', [contact('tim', 0), contact('mama', 1)]),
      screen(3, 'confirm_send', 'binary', [contact('tim')]),
    ];
    const observed: TallyObserved[] = [
      { turn: 0, type: 'select_option', optionRef: 'contact-mama' },
      { turn: 1, type: 'back', optionRef: null },
      { turn: 2, type: 'select_option', optionRef: 'contact-tim' },
      { turn: 3, type: 'answer_yes', optionRef: 'contact-tim' },
    ];
    const tallies = tallySession(screens, observed, true);
    expect(find(tallies, 'contact', 'tim')).toMatchObject({
      presented: 1,
      chosen: 1,
      chosenAtFirstPosition: 1,
    });
    expect(find(tallies, 'contact', 'mama')).toMatchObject({ presented: 1, chosen: 0 });
  });

  it('de vorm van de laatste vraag vóór de laatste JA op "Bedoel je …?" krijgt de bevestiging', () => {
    const screens = [
      screen(0, 'question', 'binary', [symbol('pain', 0)]),
      screen(1, 'question', 'multi', [symbol('head', 0), symbol('belly', 1)]),
      screen(2, 'confirm_message', 'binary', []),
    ];
    const observed: TallyObserved[] = [
      { turn: 0, type: 'answer_yes', optionRef: 'opt-pain' },
      { turn: 1, type: 'select_option', optionRef: 'opt-head' },
      { turn: 2, type: 'answer_yes', optionRef: null },
    ];
    const tallies = tallySession(screens, observed, true);
    expect(find(tallies, 'mode', 'binary')).toMatchObject({ presented: 1, chosen: 0 });
    expect(find(tallies, 'mode', 'multi')).toMatchObject({ presented: 1, chosen: 1 });
  });

  it('niets getoond: niets geteld', () => {
    expect(tallySession([], [{ turn: 0, type: 'start', optionRef: null }], false)).toEqual([]);
  });
});
