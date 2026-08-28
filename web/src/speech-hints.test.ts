import { describe, expect, it } from 'vitest';
import { HINT_INTERVAL, HINT_TEXTS, hintText, pickHint, type HintKey } from './speech-hints.ts';

/**
 * Gesproken zetjes bij de bediening (T18.4).
 *
 * De keuze is bewust deterministisch (een teller, geen toeval), en dat is precies wat hier bewezen
 * wordt: hoe vaak er iets klinkt, dat het niet twee keer hetzelfde is, dat het alleen over zichtbare
 * knoppen gaat — en dat er nooit iets over de *inhoud* van het gesprek in zit.
 */
describe('bedieningszetjes', () => {
  /** Loopt `screens` schermen af en geeft terug wat er per scherm geklonken zou hebben. */
  function walk(
    screens: number,
    context: Partial<Parameters<typeof pickHint>[0]> = {},
  ): (HintKey | null)[] {
    let lastHint: HintKey | null = null;
    const heard: (HintKey | null)[] = [];
    for (let screenCount = 1; screenCount <= screens; screenCount += 1) {
      const hint = pickHint({
        screenCount,
        lastHint,
        hasMoreChoices: true,
        canSkip: true,
        canGoBack: screenCount > 1,
        ...context,
      });
      if (hint) lastHint = hint;
      heard.push(hint);
    }
    return heard;
  }

  it('zwijgt op de eerste schermen en klinkt daarna hoogstens eens per interval', () => {
    const heard = walk(10);
    const gesproken = heard.filter((hint) => hint !== null);

    // Tien schermen, één zetje per HINT_INTERVAL: dus hoogstens twee.
    expect(gesproken).toHaveLength(Math.floor(10 / HINT_INTERVAL));
    // De eerste schermen blijven stil; daar is de vraag zelf al nieuw genoeg.
    expect(heard.slice(0, HINT_INTERVAL - 1).every((hint) => hint === null)).toBe(true);
    expect(heard[HINT_INTERVAL - 1]).not.toBeNull();
  });

  it('herhaalt nooit twee keer hetzelfde zetje achter elkaar', () => {
    const gesproken = walk(40).filter((hint): hint is HintKey => hint !== null);
    expect(gesproken.length).toBeGreaterThan(3);
    for (let i = 1; i < gesproken.length; i += 1) {
      expect(gesproken[i]).not.toBe(gesproken[i - 1]);
    }
  });

  it('rouleert over alle beschikbare zetjes in plaats van steeds dezelfde twee', () => {
    const gesproken = new Set(walk(40).filter((hint) => hint !== null));
    expect(gesproken).toEqual(new Set<HintKey>(['more', 'missing', 'back']));
  });

  it('noemt "Meer keuzes" niet als die knop er niet staat', () => {
    const gesproken = walk(40, { hasMoreChoices: false });
    expect(gesproken).not.toContain('more');
  });

  it('noemt "Terug" niet op een scherm zonder geschiedenis', () => {
    const gesproken = walk(40, { canGoBack: false });
    expect(gesproken).not.toContain('back');
  });

  it('zwijgt als er geen enkele knop te noemen valt', () => {
    const gesproken = walk(40, { hasMoreChoices: false, canSkip: false, canGoBack: false });
    expect(gesproken.every((hint) => hint === null)).toBe(true);
  });

  it('gaat alleen over de bediening en nooit over de inhoud', () => {
    // Een zetje mag de gebruiker helpen de knoppen te vinden, maar nooit meedenken over wát hij
    // bedoelt — dat zou de app namens hem laten spreken (DESIGN §7.8).
    const knoppen = ['Meer keuzes', 'Staat er niet bij', 'Terug'];
    for (const [key, text] of Object.entries(HINT_TEXTS)) {
      expect(hintText(key as HintKey)).toBe(text);
      expect(knoppen.some((knop) => text.includes(knop))).toBe(true);
      // Geen AAC-begrip of suggestie over de boodschap.
      expect(text.toLowerCase()).not.toMatch(/drinken|eten|pijn|bedoel|misschien|denk ik/);
    }
  });
});
