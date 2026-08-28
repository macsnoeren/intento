/**
 * Gesproken zetjes bij de bediening (T18.4, DESIGN §5.1, §5.4, §7.8).
 *
 * Waarom: op het keuzescherm staan grote pictogrammen én een paar knoppen eromheen. Uit de
 * gebruikerstests bleek dat die knoppen over het hoofd gezien worden — wie de juiste keuze niet ziet
 * staan, blijft zitten in plaats van "Meer keuzes" of "Staat er niet bij" te gebruiken.
 *
 * De regels zijn belangrijker dan de zinnen:
 * - **Af en toe**, niet elk scherm: één zetje per `HINT_INTERVAL` keuzeschermen.
 * - **Nooit twee keer dezelfde achter elkaar** — dan wordt het behang.
 * - **Alleen over knoppen die op dat moment zichtbaar zijn.**
 * - **Alleen over de bediening, nooit over de inhoud.** Geen "misschien bedoel je drinken?": dat zou
 *   de app namens de gebruiker laten meedenken over de boodschap (DESIGN §7.8), en de keuze is van de
 *   gebruiker.
 *
 * De keuze is bewust **deterministisch** (een teller, geen toeval): zo is in een test te controleren
 * hoe vaak en wanneer er een zetje klinkt, en hoort een gebruiker hetzelfde ritme.
 */

/** De sleutels van de bedieningszetjes; stabiel, want ze staan in tests en logregels. */
export type HintKey = 'more' | 'missing' | 'back';

/** Om de hoeveel keuzeschermen er hoogstens één zetje klinkt. */
export const HINT_INTERVAL = 4;

/** De zinnen zelf. Kort, in de je-vorm, en ze noemen de knop precies zoals hij op het scherm heet. */
export const HINT_TEXTS: Record<HintKey, string> = {
  more: 'Wil je andere keuzes? Tik op Meer keuzes.',
  missing: 'Staat het er niet bij? Tik op Staat er niet bij.',
  back: 'Klopt het niet? Tik op Terug.',
};

/** Wat er op dít scherm te bedienen valt; een zetje mag alleen over een zichtbare knop gaan. */
export interface HintContext {
  /** Hoeveel keuzeschermen er in dit gesprek al getoond zijn (1 bij het eerste scherm). */
  screenCount: number;
  /** Het zetje dat als laatste geklonken heeft, zodat het niet herhaald wordt. */
  lastHint: HintKey | null;
  /** Staat de knop "Meer keuzes" op het scherm? */
  hasMoreChoices: boolean;
  /** Staat "Staat er niet bij" op het scherm? */
  canSkip: boolean;
  /** Staat "Terug" op het scherm? */
  canGoBack: boolean;
}

/** De volgorde waarin zetjes aan de beurt komen: eerst de uitweg die het vaakst gemist wordt. */
const HINT_ORDER: readonly HintKey[] = ['more', 'missing', 'back'];

/**
 * Kiest het zetje voor dit scherm, of `null` als er nu geen hoort te klinken.
 *
 * Het eerste scherm blijft altijd stil: daar is de vraag zelf al nieuw genoeg.
 */
export function pickHint(context: HintContext): HintKey | null {
  const { screenCount, lastHint, hasMoreChoices, canSkip, canGoBack } = context;
  if (screenCount < HINT_INTERVAL || screenCount % HINT_INTERVAL !== 0) return null;

  const beschikbaar: Record<HintKey, boolean> = {
    more: hasMoreChoices,
    missing: canSkip,
    back: canGoBack,
  };
  const kandidaten = HINT_ORDER.filter((key) => beschikbaar[key]);
  if (kandidaten.length === 0) return null;

  // Roteer over de beschikbare zetjes in plaats van steeds bij de eerste te beginnen: anders hoort de
  // gebruiker altijd dezelfde twee en nooit de derde. De ronde volgt uit de teller, dus geen toeval.
  const ronde = Math.floor(screenCount / HINT_INTERVAL) - 1;
  const gedraaid = kandidaten.map(
    (_, index) => kandidaten[(index + ronde) % kandidaten.length] as HintKey,
  );

  // Nooit hetzelfde zetje twee keer op rij — tenzij er niets anders te zeggen valt, en dan zwijgen we.
  const anders = gedraaid.filter((key) => key !== lastHint);
  return anders[0] ?? null;
}

/** De uit te spreken zin bij een zetje. */
export function hintText(key: HintKey): string {
  return HINT_TEXTS[key];
}
