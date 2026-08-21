import type { AacCategory } from '@intento/shared';

/**
 * Seed-dataset voor de AAC-bibliotheek (T3.1, DESIGN §3, §6.2, FR-015).
 *
 * Bewust genoeg concepten voor de voorbeeldflows uit DESIGN §3: intenties (§3.1 startscherm),
 * activiteiten, gevoelens, lichaamsdelen, eten/drinken en personen/plekken. De relaties vormen de
 * begrippenboom waarlangs de latere verfijning loopt, o.a. de route uit §3.1
 * (🎯 iets willen → 🚶 iets doen → 🌳 buiten → 🚶 wandelen → 🐕 met hond) en de drankvraag uit §3.2
 * (🥤 water · 🧃 sap · ☕ koffie · 🥛 melk).
 *
 * `concept` is de canonieke, unieke sleutel (lowercase, taalneutraal); `label` de Nederlandse
 * weergavetekst; `glyph` de emoji waaruit de server een placeholder-pictogram rendert (MVP —
 * echte uploads volgen in T3.2). `synonyms` zijn extra zoektermen.
 */

export interface AacSeedSymbol {
  concept: string;
  label: string;
  category: AacCategory;
  glyph: string;
  synonyms: string[];
}

export interface AacSeedRelation {
  parent: string;
  child: string;
  /** Type relatie; standaard "contains" (ouder bevat kind). */
  relation?: string;
}

export const AAC_SEED_SYMBOLS: AacSeedSymbol[] = [
  // Startscherm-intenties (DESIGN §3.1).
  {
    concept: 'say',
    label: 'Iets zeggen',
    category: 'intent',
    glyph: '🗣️',
    synonyms: ['vertellen', 'praten', 'zeggen'],
  },
  {
    concept: 'feel',
    label: 'Hoe ik mij voel',
    category: 'intent',
    glyph: '❤️',
    synonyms: ['gevoel', 'voelen', 'emotie'],
  },
  {
    concept: 'problem',
    label: 'Er is iets aan de hand',
    category: 'intent',
    glyph: '🤕',
    synonyms: ['probleem', 'hulp', 'mis'],
  },
  {
    concept: 'ask',
    label: 'Een vraag stellen',
    category: 'intent',
    glyph: '❓',
    synonyms: ['vraag', 'vragen'],
  },
  {
    concept: 'want',
    label: 'Iets willen',
    category: 'intent',
    glyph: '🎯',
    synonyms: ['willen', 'wil', 'nodig'],
  },

  // Activiteiten (route §3.1).
  {
    concept: 'do-activity',
    label: 'Iets doen',
    category: 'activity',
    glyph: '🚶',
    synonyms: ['doen', 'activiteit', 'bezig'],
  },
  {
    concept: 'outside',
    label: 'Buiten',
    category: 'place',
    glyph: '🌳',
    synonyms: ['buiten', 'naar buiten', 'tuin'],
  },
  {
    concept: 'walking',
    label: 'Wandelen',
    category: 'activity',
    glyph: '🚶‍♀️',
    synonyms: ['wandelen', 'lopen', 'wandeling'],
  },
  {
    concept: 'cycling',
    label: 'Fietsen',
    category: 'activity',
    glyph: '🚴',
    synonyms: ['fietsen', 'fiets'],
  },

  // Eten en drinken.
  {
    concept: 'eat',
    label: 'Eten',
    category: 'food',
    glyph: '🍽️',
    synonyms: ['eten', 'honger', 'maaltijd'],
  },
  {
    concept: 'bread',
    label: 'Brood',
    category: 'food',
    glyph: '🍞',
    synonyms: ['brood', 'boterham'],
  },
  { concept: 'apple', label: 'Appel', category: 'food', glyph: '🍎', synonyms: ['appel', 'fruit'] },
  { concept: 'soup', label: 'Soep', category: 'food', glyph: '🍲', synonyms: ['soep'] },
  {
    concept: 'drink',
    label: 'Drinken',
    category: 'drink',
    glyph: '🥤',
    synonyms: ['drinken', 'dorst', 'drank'],
  },
  { concept: 'water', label: 'Water', category: 'drink', glyph: '💧', synonyms: ['water'] },
  {
    concept: 'juice',
    label: 'Sap',
    category: 'drink',
    glyph: '🧃',
    synonyms: ['sap', 'vruchtensap'],
  },
  { concept: 'coffee', label: 'Koffie', category: 'drink', glyph: '☕', synonyms: ['koffie'] },
  { concept: 'milk', label: 'Melk', category: 'drink', glyph: '🥛', synonyms: ['melk'] },

  // Gevoelens.
  {
    concept: 'happy',
    label: 'Blij',
    category: 'feeling',
    glyph: '😊',
    synonyms: ['blij', 'vrolijk', 'fijn'],
  },
  {
    concept: 'sad',
    label: 'Verdrietig',
    category: 'feeling',
    glyph: '😢',
    synonyms: ['verdrietig', 'droevig', 'huilen'],
  },
  {
    concept: 'tired',
    label: 'Moe',
    category: 'feeling',
    glyph: '😴',
    synonyms: ['moe', 'slaap', 'vermoeid'],
  },
  { concept: 'pain', label: 'Pijn', category: 'feeling', glyph: '🤕', synonyms: ['pijn', 'zeer'] },

  // Lichaamsdelen (bij "er is iets aan de hand").
  { concept: 'head', label: 'Hoofd', category: 'body', glyph: '🧑', synonyms: ['hoofd', 'kop'] },
  { concept: 'belly', label: 'Buik', category: 'body', glyph: '🤰', synonyms: ['buik', 'maag'] },
  { concept: 'leg', label: 'Been', category: 'body', glyph: '🦵', synonyms: ['been', 'benen'] },

  // Personen, plekken en dieren.
  {
    concept: 'mom',
    label: 'Mama',
    category: 'person',
    glyph: '👩',
    synonyms: ['mama', 'moeder', 'mam'],
  },
  {
    concept: 'dad',
    label: 'Papa',
    category: 'person',
    glyph: '👨',
    synonyms: ['papa', 'vader', 'pap'],
  },
  {
    concept: 'dog',
    label: 'Hond',
    category: 'animal',
    glyph: '🐕',
    synonyms: ['hond', 'hondje', 'met hond'],
  },
  { concept: 'home', label: 'Thuis', category: 'place', glyph: '🏠', synonyms: ['thuis', 'huis'] },
  {
    concept: 'toilet',
    label: 'Toilet',
    category: 'place',
    glyph: '🚽',
    synonyms: ['toilet', 'wc', 'plassen'],
  },
  {
    concept: 'park',
    label: 'Park',
    category: 'place',
    glyph: '🏞️',
    synonyms: ['park', 'speeltuin'],
  },

  // --- T9.11: vraagwoorden, zodat "Een vraag stellen" niet doodloopt maar verfijnd wordt ---
  {
    concept: 'ask-what',
    label: 'Wat?',
    category: 'question',
    glyph: '❔',
    synonyms: ['wat', 'wat is dat', 'welke'],
  },
  {
    concept: 'ask-who',
    label: 'Wie?',
    category: 'question',
    glyph: '🙋',
    synonyms: ['wie', 'wie is dat', 'iemand'],
  },
  {
    concept: 'ask-where',
    label: 'Waar?',
    category: 'question',
    glyph: '📍',
    synonyms: ['waar', 'waarheen', 'plek'],
  },
  {
    concept: 'ask-when',
    label: 'Wanneer?',
    category: 'question',
    glyph: '⏰',
    synonyms: ['wanneer', 'hoe laat', 'tijd'],
  },
  {
    concept: 'ask-may',
    label: 'Mag ik?',
    category: 'question',
    glyph: '🙏',
    synonyms: ['mag ik', 'mag', 'toestemming'],
  },

  // --- T9.11: sociale uitingen, zodat "Iets zeggen" ergens heen leidt ---
  { concept: 'yes', label: 'Ja', category: 'expression', glyph: '👍', synonyms: ['ja', 'klopt'] },
  { concept: 'no', label: 'Nee', category: 'expression', glyph: '👎', synonyms: ['nee', 'niet'] },
  {
    concept: 'thanks',
    label: 'Dank je',
    category: 'expression',
    glyph: '🙏',
    synonyms: ['dank je', 'bedankt', 'dankjewel'],
  },
  {
    concept: 'hello',
    label: 'Hallo',
    category: 'expression',
    glyph: '👋',
    synonyms: ['hallo', 'hoi', 'goedemorgen'],
  },
  {
    concept: 'goodbye',
    label: 'Dag',
    category: 'expression',
    glyph: '👋',
    synonyms: ['dag', 'doei', 'tot ziens'],
  },
  {
    concept: 'stop',
    label: 'Stop',
    category: 'expression',
    glyph: '✋',
    synonyms: ['stop', 'ophouden', 'niet doen'],
  },
  {
    concept: 'again',
    label: 'Nog een keer',
    category: 'expression',
    glyph: '🔁',
    synonyms: ['nog een keer', 'opnieuw', 'meer'],
  },

  // --- T9.11: meer problemen dan alleen pijn ("er is iets aan de hand") ---
  {
    concept: 'afraid',
    label: 'Bang',
    category: 'feeling',
    glyph: '😨',
    synonyms: ['bang', 'eng', 'angst'],
  },
  {
    concept: 'itch',
    label: 'Jeuk',
    category: 'feeling',
    glyph: '🖐️',
    synonyms: ['jeuk', 'kriebel', 'krabben'],
  },
  {
    concept: 'cold',
    label: 'Koud',
    category: 'feeling',
    glyph: '🥶',
    synonyms: ['koud', 'kou', 'rillen'],
  },
  {
    concept: 'hot',
    label: 'Warm',
    category: 'feeling',
    glyph: '🥵',
    synonyms: ['warm', 'heet', 'zweten'],
  },
  {
    concept: 'sick',
    label: 'Ziek',
    category: 'feeling',
    glyph: '🤒',
    synonyms: ['ziek', 'misselijk', 'niet lekker'],
  },
  {
    concept: 'angry',
    label: 'Boos',
    category: 'feeling',
    glyph: '😠',
    synonyms: ['boos', 'kwaad', 'chagrijnig'],
  },
  {
    concept: 'help',
    label: 'Hulp nodig',
    category: 'activity',
    glyph: '🆘',
    synonyms: ['hulp', 'helpen', 'help me'],
  },
  {
    concept: 'broken',
    label: 'Kapot',
    category: 'object',
    glyph: '🧩',
    synonyms: ['kapot', 'stuk', 'werkt niet'],
  },

  // --- T9.11: meer lichaamsdelen; de testvraag ging over nagels knippen ---
  { concept: 'hand', label: 'Hand', category: 'body', glyph: '✋', synonyms: ['hand', 'handen'] },
  {
    concept: 'finger',
    label: 'Vinger',
    category: 'body',
    glyph: '👆',
    synonyms: ['vinger', 'vingers'],
  },
  {
    concept: 'nail',
    label: 'Nagel',
    category: 'body',
    glyph: '💅',
    synonyms: ['nagel', 'nagels', 'knippen'],
  },
  { concept: 'foot', label: 'Voet', category: 'body', glyph: '🦶', synonyms: ['voet', 'voeten'] },
  { concept: 'arm', label: 'Arm', category: 'body', glyph: '💪', synonyms: ['arm', 'armen'] },
  { concept: 'back', label: 'Rug', category: 'body', glyph: '🦴', synonyms: ['rug', 'onderrug'] },
  { concept: 'ear', label: 'Oor', category: 'body', glyph: '👂', synonyms: ['oor', 'oren'] },
  {
    concept: 'tooth',
    label: 'Tand',
    category: 'body',
    glyph: '🦷',
    synonyms: ['tand', 'kies', 'tanden'],
  },
  { concept: 'eye', label: 'Oog', category: 'body', glyph: '👁️', synonyms: ['oog', 'ogen'] },
  {
    concept: 'throat',
    label: 'Keel',
    category: 'body',
    glyph: '🗣️',
    synonyms: ['keel', 'slikken'],
  },

  // --- T9.11: iets meer te eten, te drinken en te doen ---
  {
    concept: 'cookie',
    label: 'Koekje',
    category: 'food',
    glyph: '🍪',
    synonyms: ['koekje', 'koek'],
  },
  {
    concept: 'banana',
    label: 'Banaan',
    category: 'food',
    glyph: '🍌',
    synonyms: ['banaan', 'fruit'],
  },
  {
    concept: 'yoghurt',
    label: 'Yoghurt',
    category: 'food',
    glyph: '🥣',
    synonyms: ['yoghurt', 'kwark', 'toetje'],
  },
  {
    concept: 'tea',
    label: 'Thee',
    category: 'drink',
    glyph: '🍵',
    synonyms: ['thee', 'kruidenthee'],
  },
  {
    concept: 'soda',
    label: 'Fris',
    category: 'drink',
    glyph: '🥤',
    synonyms: ['fris', 'frisdrank', 'limonade'],
  },
  {
    concept: 'tv',
    label: 'Televisie',
    category: 'activity',
    glyph: '📺',
    synonyms: ['televisie', 'tv', 'kijken'],
  },
  {
    concept: 'music',
    label: 'Muziek',
    category: 'activity',
    glyph: '🎵',
    synonyms: ['muziek', 'luisteren', 'liedje'],
  },
  {
    concept: 'game',
    label: 'Spelletje',
    category: 'activity',
    glyph: '🎲',
    synonyms: ['spelletje', 'spelen', 'spel'],
  },
  {
    concept: 'rest',
    label: 'Rusten',
    category: 'activity',
    glyph: '🛏️',
    synonyms: ['rusten', 'slapen', 'liggen'],
  },
  {
    concept: 'caregiver',
    label: 'Begeleider',
    category: 'person',
    glyph: '🧑‍⚕️',
    synonyms: ['begeleider', 'verzorger', 'zuster'],
  },
  {
    concept: 'friend',
    label: 'Vriend',
    category: 'person',
    glyph: '🧑‍🤝‍🧑',
    synonyms: ['vriend', 'vriendin', 'maatje'],
  },
];

export const AAC_SEED_RELATIONS: AacSeedRelation[] = [
  // 🎯 Iets willen → iets doen / eten / drinken (§3.1).
  { parent: 'want', child: 'do-activity' },
  { parent: 'want', child: 'eat' },
  { parent: 'want', child: 'drink' },
  // Iets doen → buiten → wandelen/fietsen → met hond (voorbeeldroute §3.1).
  { parent: 'do-activity', child: 'outside' },
  { parent: 'outside', child: 'walking' },
  { parent: 'outside', child: 'cycling' },
  { parent: 'walking', child: 'dog' },
  { parent: 'walking', child: 'park' },
  // Eten → concrete etenswaren.
  { parent: 'eat', child: 'bread' },
  { parent: 'eat', child: 'apple' },
  { parent: 'eat', child: 'soup' },
  // Drinken → concrete dranken (drankvraag §3.2).
  { parent: 'drink', child: 'water' },
  { parent: 'drink', child: 'juice' },
  { parent: 'drink', child: 'coffee' },
  { parent: 'drink', child: 'milk' },
  // Hoe ik mij voel → gevoelens.
  { parent: 'feel', child: 'happy' },
  { parent: 'feel', child: 'sad' },
  { parent: 'feel', child: 'tired' },
  // Er is iets aan de hand → pijn → lichaamsdeel.
  { parent: 'problem', child: 'pain' },
  { parent: 'pain', child: 'head' },
  { parent: 'pain', child: 'belly' },
  { parent: 'pain', child: 'leg' },

  // --- T9.11: geen doodlopende intenties meer ---
  // Een vraag stellen → vraagwoord → waar de vraag over gaat.
  { parent: 'ask', child: 'ask-what' },
  { parent: 'ask', child: 'ask-who' },
  { parent: 'ask', child: 'ask-where' },
  { parent: 'ask', child: 'ask-when' },
  { parent: 'ask', child: 'ask-may' },
  { parent: 'ask-what', child: 'eat' },
  { parent: 'ask-what', child: 'drink' },
  { parent: 'ask-what', child: 'do-activity' },
  { parent: 'ask-who', child: 'mom' },
  { parent: 'ask-who', child: 'dad' },
  { parent: 'ask-who', child: 'caregiver' },
  { parent: 'ask-who', child: 'friend' },
  { parent: 'ask-where', child: 'mom' },
  { parent: 'ask-where', child: 'dad' },
  { parent: 'ask-where', child: 'toilet' },
  { parent: 'ask-where', child: 'home' },
  { parent: 'ask-where', child: 'dog' },
  { parent: 'ask-when', child: 'eat' },
  { parent: 'ask-when', child: 'drink' },
  { parent: 'ask-when', child: 'outside' },
  { parent: 'ask-when', child: 'rest' },
  { parent: 'ask-may', child: 'outside' },
  { parent: 'ask-may', child: 'eat' },
  { parent: 'ask-may', child: 'drink' },
  { parent: 'ask-may', child: 'tv' },
  { parent: 'ask-may', child: 'music' },

  // Iets zeggen → sociale uitingen (complete boodschappen op zichzelf).
  { parent: 'say', child: 'yes' },
  { parent: 'say', child: 'no' },
  { parent: 'say', child: 'thanks' },
  { parent: 'say', child: 'hello' },
  { parent: 'say', child: 'goodbye' },
  { parent: 'say', child: 'stop' },
  { parent: 'say', child: 'again' },

  // Er is iets aan de hand → breder dan alleen pijn.
  { parent: 'problem', child: 'itch' },
  { parent: 'problem', child: 'tired' },
  { parent: 'problem', child: 'afraid' },
  { parent: 'problem', child: 'sick' },
  { parent: 'problem', child: 'cold' },
  { parent: 'problem', child: 'hot' },
  { parent: 'problem', child: 'help' },
  { parent: 'problem', child: 'broken' },

  // Pijn/jeuk → lichaamsdeel (o.a. de nagels uit de gebruikerstest).
  { parent: 'pain', child: 'hand' },
  { parent: 'pain', child: 'finger' },
  { parent: 'pain', child: 'nail' },
  { parent: 'pain', child: 'foot' },
  { parent: 'pain', child: 'arm' },
  { parent: 'pain', child: 'back' },
  { parent: 'pain', child: 'ear' },
  { parent: 'pain', child: 'tooth' },
  { parent: 'pain', child: 'eye' },
  { parent: 'pain', child: 'throat' },
  { parent: 'itch', child: 'hand' },
  { parent: 'itch', child: 'finger' },
  { parent: 'itch', child: 'nail' },
  { parent: 'itch', child: 'head' },
  { parent: 'itch', child: 'back' },
  { parent: 'itch', child: 'leg' },

  // Hoe ik mij voel → meer gevoelens.
  { parent: 'feel', child: 'afraid' },
  { parent: 'feel', child: 'angry' },
  { parent: 'feel', child: 'sick' },
  { parent: 'feel', child: 'cold' },
  { parent: 'feel', child: 'hot' },

  // Iets willen → meer te doen, te eten en te drinken.
  { parent: 'do-activity', child: 'tv' },
  { parent: 'do-activity', child: 'music' },
  { parent: 'do-activity', child: 'game' },
  { parent: 'do-activity', child: 'rest' },
  { parent: 'eat', child: 'cookie' },
  { parent: 'eat', child: 'banana' },
  { parent: 'eat', child: 'yoghurt' },
  { parent: 'drink', child: 'tea' },
  { parent: 'drink', child: 'soda' },
  // Wandelen → met wie.
  { parent: 'walking', child: 'mom' },
  { parent: 'walking', child: 'dad' },
  { parent: 'walking', child: 'caregiver' },
];
