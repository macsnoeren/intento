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
 * Vraagframes per vraagwoord (T14.1, DESIGN §3.1, §7.1 taak 4).
 *
 * **Waarom dit bestaat.** Tot T14.1 werd élke route als een wens behandeld. De route
 * `ask → ask-what → eat` — "Ik wil wat vragen", "Wat?", "Eten" — leverde daardoor letterlijk
 * `"Ik wil iets vragen over wat? eten."`: het vraagwoord werd als lijdend voorwerp aan het
 * `ask`-frame geplakt. Gemeld in de zesde gebruikerstest, waar de gebruiker gewoon
 * *"Wat eten we vandaag?"* wilde vragen.
 *
 * Een vraag heeft een andere bouw dan een wens: het **vraagwoord** is het frame en het gekozen
 * onderwerp vult het in — niet andersom. Daarom per vraagwoord een eigen bouwer.
 *
 * Dit sjabloon is de **veilige bodem**, niet het eindstation: de AI mag het beter formuleren
 * (`MESSAGE_QUESTION_GOAL`), en de veiligheidslaag houdt haar binnen de gekozen concepten (§7.8). De
 * bodem hoeft dus niet perfect te zijn — hij moet grammaticaal zijn, herleidbaar tot de pictogrammen,
 * en nooit onzin opleveren.
 */

/**
 * Werkwoordsvormen voor de onderwerpen die als *handeling* in een vraag terechtkomen ("Wat **eten** we?").
 * Onderwerpen die hier niet in staan zijn zelfstandig naamwoorden en gaan via `QUESTION_NOUNS`.
 */
const QUESTION_VERBS: Record<string, string> = {
  eat: 'eten',
  drink: 'drinken',
  'do-activity': 'doen',
  rest: 'rusten',
  outside: 'naar buiten',
  tv: 'televisie kijken',
  music: 'muziek luisteren',
};

/**
 * Naamwoordsvormen mét lidwoord voor de onderwerpen die in een vraag als *ding* of *persoon* voorkomen
 * ("Waar is **het toilet**?"). Een concept dat hier niet in staat valt terug op zijn label in kleine
 * letters, zodat een nieuw bibliotheekconcept altijd nog een leesbare zin geeft.
 */
const QUESTION_NOUNS: Record<string, string> = {
  toilet: 'het toilet',
  home: 'thuis',
  dog: 'de hond',
  mom: 'mama',
  dad: 'papa',
  caregiver: 'de begeleider',
  friend: 'mijn vriend',
  tv: 'de televisie',
  music: 'de muziek',
  outside: 'buiten',
};

interface QuestionFrame {
  /** Bouwt de vraag uit het onderwerp; `tail` zijn eventuele verdere verfijningen ("vandaag"). */
  build: (topic: ChosenConcept, tail: { text: string; flows: boolean }[]) => string;
  /** De vraag zonder gekozen onderwerp — nog steeds een echte vraag, geen half woord. */
  withoutTopic: string;
}

/**
 * Plakt de staart (verdere verfijningen) achter de kern en sluit af met een vraagteken.
 *
 * Een **tijdsbepaling** ("vandaag") hoort vloeiend in de zin: "Wat eten we vandaag?". Elk ander concept
 * is geen bijwoord maar een tweede inhoudelijk begrip, en dat lezen als deel van de zin levert onzin op
 * ("Wat eten we brood?"). Zulke concepten komen er met een komma achter — telegrafisch, maar wél een
 * eerlijke weergave van wat de gebruiker aantikte ("Wat eten we, brood?").
 */
function question(core: string, tail: { text: string; flows: boolean }[]): string {
  const zin = tail.reduce(
    (acc, part) => (part.flows ? `${acc} ${part.text}` : `${acc}, ${part.text}`),
    core,
  );
  return `${zin}?`;
}

/** Vloeit dit concept mee in de zin (een tijdsbepaling) of hoort het er met een komma achter? */
function flowsInSentence(step: ChosenConcept): boolean {
  return step.category === 'time';
}

const verbOf = (topic: ChosenConcept): string | undefined => QUESTION_VERBS[topic.concept];
const nounOf = (topic: ChosenConcept): string =>
  QUESTION_NOUNS[topic.concept] ?? topic.label.toLowerCase();

const QUESTION_FRAMES: Record<string, QuestionFrame> = {
  'ask-what': {
    withoutTopic: 'Wat is dat?',
    build: (topic, tail) => {
      const verb = verbOf(topic);
      return verb ? question(`Wat ${verb} we`, tail) : question(`Wat is ${nounOf(topic)}`, tail);
    },
  },
  'ask-who': {
    withoutTopic: 'Wie is dat?',
    build: (topic, tail) => question(`Wie is ${nounOf(topic)}`, tail),
  },
  'ask-where': {
    withoutTopic: 'Waar is dat?',
    build: (topic, tail) => question(`Waar is ${nounOf(topic)}`, tail),
  },
  'ask-when': {
    withoutTopic: 'Wanneer is dat?',
    build: (topic, tail) => {
      const verb = verbOf(topic);
      return verb
        ? question(`Wanneer gaan we ${verb}`, tail)
        : question(`Wanneer is ${nounOf(topic)}`, tail);
    },
  },
  'ask-may': {
    withoutTopic: 'Mag ik iets vragen?',
    build: (topic, tail) => {
      const verb = verbOf(topic);
      return verb ? question(`Mag ik ${verb}`, tail) : question(`Mag ik ${nounOf(topic)}`, tail);
    },
  },
};

/**
 * Kent deze route een vraagwoord als tweede stap? Dan is het een vraag en geen wens.
 *
 * Neemt bewust alléén de conceptsleutels aan, zodat ook de beslissingslaag (die met opgeslagen stappen
 * werkt en geen labels bij de hand heeft) dezelfde vraag kan stellen.
 */
export function isQuestionRoute(chosen: { concept: string }[]): boolean {
  return (
    chosen[0]?.concept === 'ask' && chosen[1] !== undefined && chosen[1].concept in QUESTION_FRAMES
  );
}

/**
 * Is de vraag **af**: staat er een vraagwoord én een onderwerp (T14.2)? Dan is "Wat eten we?" een
 * volwaardige boodschap en hoeft er niet doorgevraagd te worden.
 *
 * Dat verschil met een wens is wezenlijk. "Ik wil eten." is vaag — daar hoort de AI door te vragen wát
 * (T10.10). Maar "Wat eten we?" ís de vraag; doorvragen naar appel of brood maakt er "Wat eten we,
 * brood?" van en verandert de betekenis. Verfijnen mag nog steeds (een tijdsbepaling maakt de vraag
 * scherper), maar is niet langer verplicht.
 */
export function isCompleteQuestion(chosen: { concept: string }[]): boolean {
  return isQuestionRoute(chosen) && chosen.length >= 3;
}

/**
 * Vormt de vraag uit `ask → vraagwoord → onderwerp → …`. Het vraagwoord draagt het frame, het eerste
 * concept erna is het onderwerp en alles daarachter is verfijning ("vandaag"). Geeft `null` als de route
 * geen vraagroute is, zodat de aanroeper zijn gewone frames gebruikt.
 */
function questionSentence(chosen: ChosenConcept[]): string | null {
  if (!isQuestionRoute(chosen)) return null;
  const frame = QUESTION_FRAMES[chosen[1]!.concept]!;
  const [topic, ...rest] = chosen.slice(2);
  if (!topic) return frame.withoutTopic;
  const tail = rest
    .map((step) => ({ text: nounOf(step), flows: flowsInSentence(step) }))
    .filter((part) => part.text.length > 0);
  return frame.build(topic, tail);
}

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
  // Een vraagroute (T14.1) heeft een eigen bouw: het vraagwoord is het frame, niet het onderwerp.
  const asQuestion = questionSentence(chosen);
  if (asQuestion !== null) return asQuestion;

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
