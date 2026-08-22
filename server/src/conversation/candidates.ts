import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel, ConversationStepModel } from '../generated/prisma/models.js';
import { normalizeSearch } from '../aac/library.js';
import type { AiUserContextItem } from '../ai/provider.js';
import { loadChildSymbols } from './engine.js';
import { defaultStrategy, type StrategyCandidateSource } from './strategy.js';

/**
 * Kandidatenselectie voor de volgende vraag (T10.2, DESIGN §7.3, ADR-0012).
 *
 * **Waarom deze module bestaat.** Tot Fase 10 was de kandidatenset letterlijk `loadChildSymbols(laatste
 * keuze)`: de kinderen van één knoop in de AAC-relatieboom. Dat is de hele wereld die het model per beurt
 * zag. Een intentie met drie kinderen (`want` → eten/drinken/iets doen) liet de AI dus geen enkele ruimte
 * om te achterhalen wat de gebruiker bedoelt — hoe goed het model ook is. In de derde gebruikerstest
 * liep dat vast: "Iets willen" → "staat er niet bij" → terug naar het startscherm.
 *
 * **Wat er nu gebeurt.** De boom blijft het sterkste *signaal*, maar is niet langer de *grens*. De set
 * wordt per beurt samengesteld uit vier bronnen, in deze prioriteitsvolgorde, ontdubbeld en begrensd:
 *
 *  1. **Boomkinderen** van de laatste keuze — de meest directe verfijning.
 *  2. **Kleinkinderen** (twee niveaus diep) — de concrete dingen achter een abstracte tak. Cruciaal bij
 *     een **smalle** knoop: `want` heeft maar drie kinderen (eten/drinken/iets doen), maar daarachter
 *     zitten water, muziek, buiten, tv… Zonder deze bron heeft de AI bij zo'n knoop niets om mee te
 *     werken en loopt "geen van deze past" alsnog dood. Ze staan achter de kinderen, dus de gewone
 *     verfijning blijft voorop.
 *  3. **Retrieval over de héle bibliotheek** — op de genormaliseerde zoekindex (`searchText`), gevoed
 *     door de begeleidersvraag, de toegestane persoonlijke context en de labels van het gekozen pad.
 *  4. **Geleerde voorkeuren** — wat deze gebruiker vaker bevestigde (leeg als leren uitstaat).
 * De volgorde is bewust: de aanroeper (`decision.ts`) laat de AI hierbinnen kiezen en ordenen, en vult
 * bij een te kleine AI-selectie aan in deze volgorde. Zo blijft de boom de ruggengraat van het gesprek
 * terwijl de rest van de bibliotheek bereikbaar wordt.
 *
 * **Welke bronnen meedoen en in welke volgorde, komt sinds T11.2 uit de gespreksstrategie** (§7.10):
 * de volgorde hierboven is die van de standaardstrategie `refine`. Een strategie die concrete dingen
 * vóór categorieën zet, draait `descendants` en `children` om; een strategie die op het dagritme leunt,
 * zet `preference` vooraan. De bronnen zelf en hun betekenis liggen hier vast — een strategie kiest
 * eruit, ze verzint er geen.
 *
 * Wat deze module **niet** doet: terugvallen op de intentiecategorieën als er niets overblijft. Dat was
 * precies de bevinding uit de derde gebruikerstest — "geen van deze past" zette de gebruiker terug op het
 * startscherm. Wat er bij leegte moet gebeuren, hangt af van of de gebruiker al iets gekozen heeft, en
 * die afweging hoort op één plek thuis: `decision.ts`.
 *
 * De module doet **geen** AI-aanroep en is puur leesbaar uit de database — deterministisch te testen.
 */

/** Maximum aantal termen dat we uit de context destilleren (houdt het aantal queries begrensd). */
const MAX_RETRIEVAL_TERMS = 12;

/** Minimale lengte van een zoekterm; korter matcht te grof op een `contains`-index. */
const MIN_TERM_LENGTH = 3;

/**
 * Nederlandse functiewoorden die als zoekterm niets opleveren maar wél ruis matchen ("wil" zit in
 * "willen", "wat" in "watertje"). Bewust een korte, expliciete lijst: geen stemmer, geen taalmodel —
 * dit moet voorspelbaar en testbaar blijven.
 */
const STOP_WORDS = new Set([
  'aan',
  'als',
  'ben',
  'bij',
  'dat',
  'deze',
  'die',
  'dit',
  'door',
  'een',
  'ergens',
  'gaan',
  'gaat',
  'had',
  'heb',
  'hebben',
  'heeft',
  'het',
  'hoe',
  'iets',
  'ik',
  'is',
  'jij',
  'kan',
  'kun',
  'kunt',
  'maar',
  'met',
  'mij',
  'moet',
  'naar',
  'niet',
  'nog',
  'ook',
  'over',
  'van',
  'voor',
  'waar',
  'wanneer',
  'wat',
  'welke',
  'wie',
  'wil',
  'willen',
  'wilt',
  'word',
  'worden',
  'zijn',
  'zou',
]);

/**
 * De herkomst van een kandidaat; puur voor diagnose/logging (T9.15) en de aanvulvolgorde. Dit is de
 * strategiebron (§7.10) plus `intent`: die laatste is geen strategiekeuze maar de gegarandeerde bodem
 * onder het gesprek, en wordt door `decision.ts` toegevoegd.
 */
export type CandidateSource = StrategyCandidateSource | 'intent';

export interface CandidateSet {
  /**
   * Alle gevonden kandidaten in prioriteitsvolgorde, **inclusief** uitgesloten concepten. Dient als
   * labelbron voor de gesprekscontext.
   */
  candidates: AacSymbolModel[];
  /** De bruikbare kandidaten: `candidates` minus de uitgesloten concepten. Dit gaat naar de AI. */
  available: AacSymbolModel[];
  /** Per concept de bron waaruit het kwam (voor diagnose en de aanvulvolgorde). */
  sourceByConcept: Map<string, CandidateSource>;
  /** Aantallen per bron, vóór de uitsluitingen — voor de diagnose-logregel (T9.15). */
  counts: Record<CandidateSource, number>;
  /**
   * Of het laatst gekozen concept een **eindconcept** is: geen kinderen in de boom. Dat is het signaal
   * dat de route af is en er een boodschap voorgesteld mag worden (§7.4), en het verschilt wezenlijk van
   * "wel kinderen, maar allemaal uitgesloten".
   */
  atLeafConcept: boolean;
}

/**
 * Destilleert zoektermen uit de vrije context: de begeleidersvraag, de toegestane persoonlijke context
 * en de labels van het gekozen pad. Splitst op niet-letters, gooit stopwoorden en korte woorden weg,
 * ontdubbelt en begrenst. Bewust simpel en deterministisch — dit is retrieval, geen taalbegrip; het
 * *begrijpen* is precies wat we aan de AI overlaten.
 */
export function retrievalTerms(input: {
  questionContext?: string | null;
  userContext?: AiUserContextItem[];
  pathLabels?: string[];
}): string[] {
  const raw = [
    input.questionContext ?? '',
    ...(input.userContext ?? []).map((item) => item.value),
    ...(input.pathLabels ?? []),
  ].join(' ');

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const word of normalizeSearch(raw).split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < MIN_TERM_LENGTH) continue;
    if (STOP_WORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= MAX_RETRIEVAL_TERMS) break;
  }
  return terms;
}

/**
 * Zoekt symbolen waarvan de genormaliseerde zoekindex een van de termen bevat. Eén query met een
 * `OR` van `contains`-filters: portabel en hoofdletterongevoelig op SQLite én PostgreSQL, omdat
 * `searchText` al lowercase is opgeslagen (zie `buildSearchText`).
 */
async function retrieveByTerms(
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
function matchesAtWordStart(searchText: string, terms: string[]): boolean {
  const words = searchText.split(' ');
  return terms.some((term) => words.some((word) => word.startsWith(term)));
}

/**
 * Is dit concept **open**: heeft nog niemand bepaald wat eronder hoort te vallen? (T10.12)
 *
 * "Geen kinderen in de boom" betekent normaal dat een beheerder besloot dat het concept een eindpunt is
 * — "soep" verfijnt niet verder. Maar een concept dat de AI tijdens een gesprek zelf aandroeg (T10.6)
 * heeft per definitie nog geen relaties: er is nooit iemand aan te pas gekomen. Dat als eindpunt lezen
 * loopt dood, en precies dat gebeurde in de gebruikerstest: de AI kwam met "compliment" — goed bedacht —
 * maar wie het koos, kreeg meteen het voorstelscherm en kon niet meer zeggen *wie* hij lief vindt.
 *
 * Zodra een beheerder het concept heeft beoordeeld (T10.7) telt "geen kinderen" wél als beslissing: dan
 * heeft iemand er bewust naar gekeken.
 */
async function isOpenEnded(
  prisma: PrismaClient,
  last: Pick<ConversationStepModel, 'selectedConcept'>,
): Promise<boolean> {
  const symbol = await prisma.aacSymbol.findUnique({
    where: { concept: last.selectedConcept },
    select: { origin: true, reviewStatus: true },
  });
  return symbol?.origin === 'ai' && symbol.reviewStatus === 'PENDING';
}

/**
 * De **kleinkinderen** van de laatste keuze: de kinderen van elk van haar kinderen. Één query over alle
 * kind-ids tegelijk, gesorteerd op label voor een stabiele volgorde.
 */
async function loadGrandchildSymbols(
  prisma: PrismaClient,
  children: AacSymbolModel[],
  limit: number,
): Promise<AacSymbolModel[]> {
  if (children.length === 0 || limit <= 0) return [];
  const relations = await prisma.aacConceptRelation.findMany({
    where: { parentId: { in: children.map((child) => child.id) } },
    include: { child: true },
    orderBy: { child: { label: 'asc' } },
    take: limit,
  });
  return relations.map((relation) => relation.child);
}

/** Haalt de symbolen op bij de sterkste voorkeuren van deze gebruiker (leeg als leren uitstaat). */
async function loadPreferredSymbols(
  prisma: PrismaClient,
  userId: string,
  limit: number,
): Promise<AacSymbolModel[]> {
  if (limit <= 0) return [];
  const profile = await prisma.userCommunicationProfile.findUnique({ where: { userId } });
  if (!profile || !profile.aiLearningEnabled) return [];

  const prefs = await prisma.preference.findMany({
    where: { userId },
    orderBy: [{ confidence: 'desc' }, { count: 'desc' }, { concept: 'asc' }],
    take: limit,
  });
  if (prefs.length === 0) return [];
  return prisma.aacSymbol.findMany({ where: { concept: { in: prefs.map((p) => p.concept) } } });
}

export interface CollectCandidatesInput {
  /** De reeds gezette stappen, oplopend op `order`. */
  steps: Pick<ConversationStepModel, 'selectedConcept'>[];
  /** Concepten die niet (opnieuw) aangeboden mogen worden: het gekozen pad + afgewezen concepten. */
  excluded: Set<string>;
  /** De gebruiker van deze sessie (voor de voorkeuren-bron). */
  userId: string;
  /** De begeleidersvraag bij vraagmodus; `null`/weggelaten bij een vrij gesprek. */
  questionContext?: string | null;
  /** De toegestane gebruikerscontext (T6.1/T6.3) — voedt de retrieval-termen. */
  userContext?: AiUserContextItem[];
  /** Bovengrens op de set (`maxCandidates` van de strategie, begrensd door env `AI_MAX_CANDIDATES`). */
  limit: number;
  /**
   * Draait er een **verfijnronde** na ❌ Nee (T10.12)? Dan is het laatste concept geen eindpunt, ook al
   * heeft het geen kinderen in de boom: de gebruiker vroeg juist om meer detail ("brood" → chocopasta).
   */
  refining?: boolean;
  /**
   * De bronnen in prioriteitsvolgorde (T11.2, §7.10). Weggelaten = de volgorde van de
   * standaardstrategie, zodat aanroepers die geen strategie kennen (tests, scripts) ongewijzigd werken.
   */
  sources?: readonly StrategyCandidateSource[];
}

/**
 * Stelt de kandidatenset voor de volgende vraag samen (zie de moduletoelichting voor het waarom en de
 * bronvolgorde). Geeft zowel de volledige set als de bruikbare (niet-uitgesloten) set terug.
 *
 * `atLeafConcept` onderscheidt de twee soorten "niets meer": een **eindconcept** (de route is af →
 * boodschap voorstellen, §7.4) versus **alles uitgesloten** (er is nog van alles, maar de gebruiker heeft
 * het gezien en afgewezen → een andere richting zoeken, §7.5).
 */
export async function collectCandidates(
  prisma: PrismaClient,
  input: CollectCandidatesInput,
): Promise<CandidateSet> {
  const { steps, excluded, userId, limit } = input;
  const last = steps.length > 0 ? steps[steps.length - 1]! : null;

  const children = last ? await loadChildSymbols(prisma, last.selectedConcept) : [];
  const atLeafConcept =
    last !== null && children.length === 0 && !input.refining && !(await isOpenEnded(prisma, last));

  // Labels van het gekozen pad voeden de retrieval mee ("pijn" → lichaamsdelen).
  const pathSymbols =
    steps.length > 0
      ? await prisma.aacSymbol.findMany({
          where: { concept: { in: steps.map((step) => step.selectedConcept) } },
          select: { label: true },
        })
      : [];

  const terms = retrievalTerms({
    questionContext: input.questionContext,
    userContext: input.userContext,
    pathLabels: pathSymbols.map((symbol) => symbol.label),
  });

  // Alleen ophalen wat deze strategie ook gebruikt: een bron die niet in de volgorde staat, kost geen
  // query. `children` wordt altijd geladen — `atLeafConcept` hangt ervan af, ongeacht de strategie.
  const sources = input.sources ?? defaultStrategy().candidateSources;
  const wanted = new Set(sources);
  const [grandchildren, retrieved, preferred] = await Promise.all([
    wanted.has('descendants') ? loadGrandchildSymbols(prisma, children, limit) : [],
    wanted.has('retrieval') ? retrieveByTerms(prisma, terms, limit) : [],
    wanted.has('preference') ? loadPreferredSymbols(prisma, userId, limit) : [],
  ]);

  const candidates: AacSymbolModel[] = [];
  const sourceByConcept = new Map<string, CandidateSource>();
  const counts: Record<CandidateSource, number> = {
    children: 0,
    descendants: 0,
    retrieval: 0,
    preference: 0,
    intent: 0,
  };
  const seen = new Set<string>();

  const add = (symbols: AacSymbolModel[], source: CandidateSource): void => {
    for (const symbol of symbols) {
      if (seen.has(symbol.concept)) continue;
      // De bovengrens telt over de héle set; de eerste bronnen krijgen dus voorrang bij krapte.
      if (candidates.length >= limit) return;
      seen.add(symbol.concept);
      candidates.push(symbol);
      sourceByConcept.set(symbol.concept, source);
      counts[source] += 1;
    }
  };

  const symbolsBySource: Record<StrategyCandidateSource, AacSymbolModel[]> = {
    children,
    descendants: grandchildren,
    retrieval: retrieved,
    preference: preferred,
  };
  for (const source of sources) add(symbolsBySource[source], source);

  const available = candidates.filter((symbol) => !excluded.has(symbol.concept));
  return { candidates, available, sourceByConcept, counts, atLeafConcept };
}
