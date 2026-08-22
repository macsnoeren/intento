/**
 * Gescripte boodschapgeneratie (T4.3, DESIGN §3.1, §3.6, §7.1 taak 4, FR-007).
 *
 * Zet de in een sessie gekozen concepten om naar een natuurlijke Nederlandse zin — **sjabloon-gebaseerd**,
 * zonder AI. Dit is de gescripte tegenhanger van de latere Message Generator uit de AI-orchestrator
 * (§7.2): T5.3 vervangt de logica hierbinnen achter dezelfde smalle interface (`generateMessage`), zonder
 * dat de route-laag verandert.
 *
 * Veiligheidsregel (DESIGN §7.8): de zin blijft **binnen de gekozen concepten** — er komen geen vrije
 * begrippen bij. De functie is een pure functie van de gekozen concepten — begint de route met een
 * intentiecategorie, dan draagt die het zinsframe; begint ze met een gewoon begrip (T10.9), dan is het
 * onderwerp-frame de basis. Zo leveren `/generate` en `/confirm` deterministisch dezelfde zin op en hoeft
 * de server nooit vrije clienttekst te vertrouwen.
 */

/** Eén gekozen stap zoals de generator hem nodig heeft: het canonieke concept en de weergavetekst. */
export interface ChosenConcept {
  concept: string;
  label: string;
  /**
   * De categorie van het symbool (`intent`, `activity`, `object`, …). Bepaalt of de route met een
   * **intentie** begint (T10.9). Weggelaten = onbekend; dan valt de generator terug op "kennen we een
   * zinsframe voor dit concept?", zodat oudere aanroepers hetzelfde gedrag houden.
   */
  category?: string;
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

/**
 * Het zinsfragment van een concept: de map, anders de label-terugval (nooit een vrij begrip).
 *
 * `isLast` maakt het verschil voor de **structurele tussenconcepten** (`eat`, `drink`, `do-activity`).
 * Middenin een route vallen ze weg — "willen → iets doen → buiten" wordt "Ik wil buiten…", niet "Ik wil
 * iets doen buiten…". Maar sluit de route erop áf, dan zijn ze de hele boodschap: sinds de gebruiker zelf
 * kan afronden (T10.11) is "Ik wil eten." een geldig eindpunt, en dan mag "eten" niet wegvallen — anders
 * blijft er "Ik wil iets duidelijk maken." over, wat precies niets zegt.
 */
function phraseFor(step: ChosenConcept, isLast: boolean): string {
  const mapped = CONCEPT_PHRASES[step.concept];
  if (mapped === undefined) return step.label.toLowerCase();
  return mapped.length > 0 || !isLast ? mapped : step.label.toLowerCase();
}

/**
 * Zinsframe voor een route die **niet** met een intentie begint (T10.9).
 *
 * Sinds T10.6 mag de AI ook op het startscherm een concept aandragen, dus kan een route beginnen met een
 * gewoon begrip ("Nagelknipper") in plaats van met een intentiecategorie. De oude terugval maakte daar
 * `${intent.label}.` van — één los woord, geen zin. Er is dan geen intentie bekend, dus kiezen we het
 * neutraalste frame dat er is: de gebruiker wil iets over dit onderwerp zeggen. Alle gekozen concepten
 * zijn hier **inhoud**; er wordt er geen als frame opgesoupeerd.
 */
const TOPIC_FRAME: IntentFrame = {
  withRest: (rest) => `Ik wil iets zeggen over ${rest}.`,
  withoutRest: 'Ik wil iets duidelijk maken.',
};

/**
 * Begint deze route met een intentiecategorie? De categorie is de bron van waarheid; ontbreekt ze (oudere
 * aanroepers, tests), dan geldt "we kennen een zinsframe voor dit concept" als benadering.
 */
function isIntentStart(first: ChosenConcept): boolean {
  if (first.category !== undefined) return first.category === 'intent';
  return first.concept in INTENT_FRAMES;
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

/** Rijgt de zinsfragmenten van een reeks concepten aaneen; lege (structurele) fragmenten vallen weg. */
function phrasesOf(steps: ChosenConcept[]): string {
  return steps
    .map((step, index) => phraseFor(step, index === steps.length - 1))
    .filter((fragment) => fragment.length > 0)
    .join(' ');
}

/**
 * Vormt de boodschap uit de gekozen concepten. Begint de route met een intentie, dan draagt die het frame
 * en verfijnt de rest; begint ze met een gewoon begrip (T10.9), dan zijn álle concepten inhoud binnen het
 * neutrale onderwerp-frame. Blijft strikt binnen de aangeleverde concepten (DESIGN §7.8). Gooit bij een
 * lege route — er valt dan niets voor te stellen (de route-laag weigert dat met een 400).
 */
export function generateMessage(chosen: ChosenConcept[]): string {
  if (chosen.length === 0) {
    throw new Error('Kan geen boodschap vormen zonder gekozen concepten.');
  }
  const [first, ...refinements] = chosen;
  if (!isIntentStart(first!)) {
    const topic = phrasesOf(chosen);
    return topic.length > 0 ? TOPIC_FRAME.withRest(topic) : TOPIC_FRAME.withoutRest;
  }
  const frame = frameFor(first!);
  const rest = phrasesOf(refinements);
  return rest.length > 0 ? frame.withRest(rest) : frame.withoutRest;
}

/**
 * Zekerheid van het voorstel (DESIGN §7.4). De gescripte engine kent geen echte AI-onzekerheid: een
 * volledig langs de vaste AAC-boom afgelegde route is per definitie zeker. We geven daarom een vaste,
 * hoge waarde boven de voorsteldrempel (>85%). T5.3 vervangt dit door een echte, door het model
 * geleverde confidence.
 */
export const SCRIPTED_CONFIDENCE = 0.95;
