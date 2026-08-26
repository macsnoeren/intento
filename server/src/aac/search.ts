import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel } from '../generated/prisma/models.js';
import { normalizeSearch } from './library.js';

/**
 * Zoeken over de AAC-bibliotheek: één zoekindex, twee gebruikers (T16.1, DESIGN §7.3, §7.6).
 *
 * De genormaliseerde zoekindex (`AacSymbol.searchText` = concept + label + synoniemen, zie
 * `buildSearchText`) wordt op twee plekken geraadpleegd:
 *
 *  - **vóór** het model, als kandidatenbron (`retrieveByTerms`, `conversation/candidates.ts`): welke
 *    bestaande symbolen sluiten aan bij de begeleidersvraag, de context en het gekozen pad?
 *  - **ná** het model, als deduplicatie (`findSimilarSymbol`, `ai/validation.ts` trap 2½): draagt de AI
 *    een begrip aan dat geen exacte sleutel-, label- of synoniemtreffer heeft, dan wordt het eerst tegen
 *    diezelfde index gehouden voordat het een nieuw concept wordt.
 *
 * Dat ze dezelfde index gebruiken is de hele bedoeling. Was retrieval alleen een **voorfilter**, dan
 * bereikt een vrije ronde (§7.6 trap 3) de bibliotheek nog uitsluitend via naamcollisie: zegt het model
 * "boterhammen" waar de bibliotheek "brood" met synoniem "boterham" kent, dan ontstaat er een
 * bijna-duplicaat — precies wat §7.6 trap 1/2 wil voorkomen. Met een tweede grens ná het model zoeken
 * beide kanten in hetzelfde begrippenveld en ontstaat er geen tweede begrip van "lijkt op".
 *
 * De module is puur leesbaar uit de database en doet geen AI-aanroep — deterministisch te testen.
 */

/** Minimale lengte van een zoekterm; korter matcht te grof op een `contains`-index. */
export const MIN_TERM_LENGTH = 3;

/**
 * Zoekt symbolen waarvan de genormaliseerde zoekindex een van de termen bevat. Eén query met een
 * `OR` van `contains`-filters: portabel en hoofdletterongevoelig op SQLite én PostgreSQL, omdat
 * `searchText` al lowercase is opgeslagen (zie `buildSearchText`).
 */
export async function retrieveByTerms(
  prisma: PrismaClient,
  terms: string[],
  limit: number,
): Promise<AacSymbolModel[]> {
  if (terms.length === 0 || limit <= 0) return [];
  // De `contains`-query is een goedkope voorfilter in de database; hij matcht op een **ruwe** substring.
  const rough = await prisma.aacSymbol.findMany({
    where: { OR: terms.map((term) => ({ searchText: { contains: term } })) },
    orderBy: [{ label: 'asc' }],
  });
  return rough.filter((symbol) => matchesAtWordStart(symbol.searchText, terms)).slice(0, limit);
}

/**
 * Komt één van de termen vóór aan het begin van een woord in de zoekindex?
 *
 * Zonder deze controle matcht een ruwe substring midden in een woord, en dat levert onzin op: in de
 * rooktest van T10.10 verscheen bij "Wat wil je eten?" een **voet** tussen de opties, omdat "eten" in
 * "vo*eten*" zit — en "warm", omdat het synoniem "zw*eten*" is. Dat is precies het soort optie dat een
 * gebruiker doet twijfelen aan het hele scherm.
 *
 * Bewust een **woordbegin** en geen exacte match: zo blijft "hand" wél "handen" vinden, wat de retrieval
 * juist bruikbaar maakt.
 */
export function matchesAtWordStart(searchText: string, terms: string[]): boolean {
  const words = searchText.split(' ');
  return terms.some((term) => words.some((word) => word.startsWith(term)));
}

/**
 * De drempel waarboven "lijkt op" als **treffer** geldt bij de deduplicatie (T16.1).
 *
 * De score (zie `similarity`) is het aandeel woorden dat aan beide kanten op zijn plaats valt, gedeeld
 * door de langste van de twee kanten. Daarmee betekent 0,6 concreet:
 *
 *  - één woord tegenover één woord moet lijnrecht matchen (1,0) — "boterhammen" ↔ "boterham";
 *  - twee van de drie woorden volstaat (0,67) — "warme kop koffie" ↔ "kop koffie";
 *  - één van de twee is te weinig (0,5) — "brood met kaas" wordt géén "brood".
 *
 * Die laatste is de reden dat de drempel boven 0,5 ligt: een term die één bestaand begrip *bevat* is
 * daarmee nog niet hetzelfde begrip, en stilzwijgend samenvoegen zou de gebruiker een woord afnemen dat
 * hij net aangeboden kreeg. Lager dan 0,6 zou dat toestaan, hoger dan 0,67 laat de gewone
 * meervoud-/verkleinvormen weer door de mazen vallen — precies de duplicaten waarvoor deze stap bestaat.
 */
export const SIMILARITY_THRESHOLD = 0.6;

/**
 * Hoeveel langer een verbogen vorm mag zijn dan het grondwoord. Nederlandse meervouden en
 * verkleinvormen groeien met hooguit drie letters ("hand" → "handen", "boterham" → "boterhammen",
 * "brood" → "broodje"). Zonder die grens zou elk woord dat toevallig met een bestaand begrip begint
 * ermee samenvallen — "nagelknipper" is geen "nagel".
 */
const MAX_INFLECTION_SUFFIX = 3;

/** Splitst tekst in genormaliseerde, bruikbare woorden (te korte woorden dragen geen betekenis). */
function words(value: string): string[] {
  return normalizeSearch(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_TERM_LENGTH);
}

/** Zijn dit hetzelfde woord, op een Nederlandse verbuiging na? */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < MIN_TERM_LENGTH) return false;
  if (long.length - short.length > MAX_INFLECTION_SUFFIX) return false;
  return long.startsWith(short);
}

/**
 * Overeenkomst tussen de aangedragen term en één veld van een symbool (concept, label of synoniem):
 * het aantal termwoorden dat in het veld terugkomt, gedeeld door de **langste** van de twee kanten. Zo
 * telt zowel wat de term mist als wat het veld extra heeft — "brood" en "brood met kaas" zijn niet
 * hetzelfde begrip, in welke richting je ook kijkt.
 */
function similarity(termWords: string[], fieldWords: string[]): number {
  if (termWords.length === 0 || fieldWords.length === 0) return 0;
  const matched = termWords.filter((term) =>
    fieldWords.some((field) => sameWord(term, field)),
  ).length;
  return matched / Math.max(termWords.length, fieldWords.length);
}

/** De velden waartegen een term wordt gehouden: dezelfde bronnen als de zoekindex. */
function fieldsOf(symbol: AacSymbolModel): string[] {
  const synonyms = Array.isArray(symbol.synonyms) ? symbol.synonyms : [];
  return [
    symbol.concept,
    symbol.label,
    ...synonyms.filter((synonym): synonym is string => typeof synonym === 'string'),
  ];
}

/**
 * Zoekt het bestaande symbool dat het dichtst bij een aangedragen term ligt, of `null` als niets de
 * drempel haalt (`SIMILARITY_THRESHOLD`). Dit is de **semantische** kant van de deduplicatie: waar trap
 * 1 en 2 exact matchen, vangt deze stap de bijna-duplicaten af (verbuigingen, woordvolgorde).
 *
 * De voorfilter in de database is bewust ruim (het eerste stukje van elk woord); de score beslist. Zo
 * kost de stap één query en blijft de beslissing in code — testbaar en uitlegbaar.
 */
export async function findSimilarSymbol(
  prisma: PrismaClient,
  term: string,
): Promise<AacSymbolModel | null> {
  const termWords = words(term);
  if (termWords.length === 0) return null;

  const rough = await prisma.aacSymbol.findMany({
    where: {
      OR: termWords.map((word) => ({ searchText: { contains: word.slice(0, MIN_TERM_LENGTH) } })),
    },
    orderBy: [{ label: 'asc' }],
  });

  let best: { symbol: AacSymbolModel; score: number } | null = null;
  for (const symbol of rough) {
    const score = Math.max(
      ...fieldsOf(symbol).map((field) => similarity(termWords, words(field))),
      0,
    );
    // Strikt groter: bij gelijke score wint het symbool dat als eerste komt (label oplopend), zodat de
    // uitkomst stabiel is en niet van de rijvolgorde in de database afhangt.
    if (score >= SIMILARITY_THRESHOLD && (best === null || score > best.score)) {
      best = { symbol, score };
    }
  }
  return best?.symbol ?? null;
}
