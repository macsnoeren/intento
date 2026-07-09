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
];
