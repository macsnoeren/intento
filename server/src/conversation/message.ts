/**
 * Gescripte boodschapgeneratie (T4.3, DESIGN §3.1, §3.6, §7.1 taak 4, FR-007).
 *
 * Zet de in een sessie gekozen concepten om naar een natuurlijke Nederlandse zin — **sjabloon-gebaseerd**,
 * zonder AI. Dit is de gescripte tegenhanger van de latere Message Generator uit de AI-orchestrator
 * (§7.2): T5.3 vervangt de logica hierbinnen achter dezelfde smalle interface (`generateMessage`), zonder
 * dat de route-laag verandert.
 *
 * Veiligheidsregel (DESIGN §7.8): de zin blijft **binnen de gekozen concepten** — er komen geen vrije
 * begrippen bij. De functie is een pure functie van de gekozen concepten (de eerste is de intentie), zodat
 * `/generate` en `/confirm` deterministisch dezelfde zin opleveren en de server nooit vrije clienttekst
 * hoeft te vertrouwen.
 */

/** Eén gekozen stap zoals de generator hem nodig heeft: het canonieke concept en de weergavetekst. */
export interface ChosenConcept {
  concept: string;
  label: string;
}

/**
 * Zinsframe per intentie (de eerste keuze op het startscherm). `withRest` bouwt de zin met de
 * verfijnende concepten erin; `withoutRest` is de terugval als er (nog) geen verfijning is gekozen.
 * Onbekende intenties vallen terug op een generiek frame (zie `frameFor`).
 */
interface IntentFrame {
  withRest: (rest: string) => string;
  withoutRest: string;
}

const INTENT_FRAMES: Record<string, IntentFrame> = {
  want: { withRest: (rest) => `Ik wil ${rest}.`, withoutRest: 'Ik wil iets duidelijk maken.' },
  feel: {
    withRest: (rest) => `Ik voel me ${rest}.`,
    withoutRest: 'Ik wil vertellen hoe ik me voel.',
  },
  problem: { withRest: (rest) => `Ik heb ${rest}.`, withoutRest: 'Er is iets aan de hand.' },
  say: {
    withRest: (rest) => `Ik wil iets zeggen over ${rest}.`,
    withoutRest: 'Ik wil iets zeggen.',
  },
  ask: {
    withRest: (rest) => `Ik wil iets vragen over ${rest}.`,
    withoutRest: 'Ik wil een vraag stellen.',
  },
};

/**
 * Natuurlijke zinsfragmenten per concept. Twee soorten:
 * - **structurele tussenconcepten** (`do-activity`, `eat`, `drink`) zijn generieke verfijningsstappen
 *   die in de uiteindelijke zin wegvallen (lege string) — "🎯 willen → 🚶 iets doen → 🌳 buiten" wordt
 *   "Ik wil buiten…", niet "Ik wil iets doen buiten…";
 * - **concrete concepten** dragen een vloeiend fragment ("met mijn hond", "aan mijn hoofd").
 *
 * Een concept dat hier niet in staat valt terug op zijn (lowercase) label, zodat nieuwe seed-concepten
 * altijd nog een leesbare zin geven.
 */
const CONCEPT_PHRASES: Record<string, string> = {
  // Structurele tussenstappen: vallen weg in de zin.
  'do-activity': '',
  eat: '',
  drink: '',
  // Activiteiten en plekken.
  outside: 'buiten',
  walking: 'wandelen',
  cycling: 'fietsen',
  park: 'in het park',
  home: 'thuis',
  toilet: 'naar het toilet',
  // Eten en drinken.
  bread: 'brood',
  apple: 'een appel',
  soup: 'soep',
  water: 'water',
  juice: 'sap',
  coffee: 'koffie',
  milk: 'melk',
  // Gevoelens.
  happy: 'blij',
  sad: 'verdrietig',
  tired: 'moe',
  // Probleem: pijn + lichaamsdeel ("Ik heb pijn aan mijn hoofd").
  pain: 'pijn',
  head: 'aan mijn hoofd',
  belly: 'aan mijn buik',
  leg: 'aan mijn been',
  // Personen en dieren.
  dog: 'met mijn hond',
  mom: 'met mama',
  dad: 'met papa',
};

/** Het zinsfragment van een concept: de map, anders de label-terugval (nooit een vrij begrip). */
function phraseFor(step: ChosenConcept): string {
  const mapped = CONCEPT_PHRASES[step.concept];
  return mapped !== undefined ? mapped : step.label.toLowerCase();
}

/** Het frame van een intentie, met een generieke terugval voor onbekende intenties. */
function frameFor(intent: ChosenConcept): IntentFrame {
  return (
    INTENT_FRAMES[intent.concept] ?? {
      withRest: (rest) => `Ik wil ${rest}.`,
      withoutRest: `${intent.label}.`,
    }
  );
}

/**
 * Vormt de boodschap uit de gekozen concepten (de eerste is de intentie, de rest verfijnt). Blijft
 * strikt binnen de aangeleverde concepten (DESIGN §7.8). Gooit bij een lege route — er valt dan niets
 * voor te stellen (de route-laag weigert dat met een 400).
 */
export function generateMessage(chosen: ChosenConcept[]): string {
  if (chosen.length === 0) {
    throw new Error('Kan geen boodschap vormen zonder gekozen concepten.');
  }
  const [intent, ...refinements] = chosen;
  const frame = frameFor(intent!);
  const rest = refinements
    .map(phraseFor)
    .filter((fragment) => fragment.length > 0)
    .join(' ');
  return rest.length > 0 ? frame.withRest(rest) : frame.withoutRest;
}

/**
 * Zekerheid van het voorstel (DESIGN §7.4). De gescripte engine kent geen echte AI-onzekerheid: een
 * volledig langs de vaste AAC-boom afgelegde route is per definitie zeker. We geven daarom een vaste,
 * hoge waarde boven de voorsteldrempel (>85%). T5.3 vervangt dit door een echte, door het model
 * geleverde confidence.
 */
export const SCRIPTED_CONFIDENCE = 0.95;
