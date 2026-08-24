import type { PrismaClient } from '../generated/prisma/client.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import type { AiUserContextItem } from '../ai/provider.js';
import { DEFAULT_MESSAGE_CONFIDENCE } from '../ai/thresholds.js';
import { normalizeSearch } from '../aac/library.js';
import {
  generateMessage,
  isQuestionRoute,
  SCRIPTED_CONFIDENCE,
  type ChosenConcept,
} from './message.js';

/**
 * AI-boodschapgeneratie met veiligheidsvangnet (T5.3, DESIGN §3.1, §7.1 taak 4, §7.4, §7.8, FR-007/008).
 *
 * Dit is de conversatie-laag rond de Message Generator: waar `decideNextQuestion` (decision.ts) de
 * volgende vraag door de orchestrator laat kiezen, laat `composeMessage` de orchestrator de **zin**
 * formuleren — met dezelfde harde waarborg dat een provider (en straks een externe worker) nooit buiten
 * de AAC-begrenzing kan treden:
 *
 *  1. **Sjabloon als veilige bodem.** De deterministische `generateMessage(chosen)` (message.ts) vormt
 *     altijd een zin die per constructie **binnen de gekozen concepten** blijft (§7.8). Die is de
 *     terugval wanneer de provider geen zin kan leveren of een onveilige zin teruggeeft.
 *  2. **AI formuleert (optioneel).** Kan de provider het (`orchestrator.canGenerateMessage`), dan vraagt
 *     de orchestrator een zin met verse, beperkte context (buildMessagePrompt) en valideert de **vorm**.
 *  3. **Safety-controle (§7.8).** De AI-zin mag **geen concept bevatten dat niet in de sessie is gekozen**.
 *     `messageIntroducesForeignConcept` scant de zin tegen de hele AAC-bibliotheek: duikt het label of een
 *     synoniem van een níet-gekozen symbool op, dan is de zin onveilig en valt hij terug op de sjabloon.
 *     Zo bereikt een verzonnen/buiten-de-sessie begrip de gebruiker **nooit** — ook niet bij een
 *     onbetrouwbare provider. De scan kijkt daarbij alleen naar **betekenisdragende** woorden (T10.9): een
 *     functiewoord als "wil" is gewone Nederlandse zinsbouw en geen bewijs dat het concept `want` de zin
 *     is binnengeslopen. De scan herkent daarbij ook korte **buigingsvormen** (T10.10): "warms" telt als
 *     bewijs voor het concept `hot` ("Warm").
 *
 * De laag is bewust vrij van HTTP: de route levert de gekozen concepten aan en gebruikt het resultaat,
 * zodat alles deterministisch met de mock (of een test-provider) te testen is.
 */

/** Uitkomst van de generatie: de zin, de zekerheid (§7.4) en of hij van de AI of het sjabloon komt. */
export interface ComposedMessage {
  message: string;
  confidence: number;
  /** `ai` = door de provider geformuleerd en veilig bevonden; `scripted` = deterministische terugval. */
  source: 'ai' | 'scripted';
}

/**
 * Splitst tekst in genormaliseerde woorden (lowercase, niet-letters worden scheidingstekens) en levert
 * een met spaties omrande string terug, zodat een hele-woord-/frase-match met `includes(' term ')` werkt
 * (ook voor meerwoordige labels als "met hond"). Unicode-letterklasse zodat accenten meetellen.
 */
function normalizedHaystack(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return ` ${cleaned} `;
}

/**
 * Nederlandse **functiewoorden**: lidwoorden, voornaamwoorden, voorzetsels, voegwoorden en hulp-/koppel-
 * werkwoorden. Ze dragen geen AAC-betekenis maar zijn wel het cement van elke Nederlandse zin — inclusief
 * de zinsframes van `message.ts` zelf ("**Ik wil** buiten wandelen").
 *
 * Waarom deze lijst bestaat (T10.9): verschillende AAC-symbolen dragen zo'n woord als synoniem. `want`
 * ("Iets willen") heeft "wil" en "willen"; daardoor keurde de safety-laag de volstrekt onschuldige zin
 * "Ik wil de nagelknipper." af zodra `want` niet in de route zat, en viel elke zin over een AI-aangedragen
 * concept terug op het sjabloon. De fail-safe was daar te grof: hij bewees niet dat er een *begrip* was
 * binnengeslopen, alleen dat er Nederlands werd gesproken.
 *
 * De lijst is bewust een **gesloten woordklasse** en geen lengteregel: korte contentwoorden ("sap",
 * "mam") blijven gewoon meetellen als bewijs, en de harde regel — geen concept in de zin dat de gebruiker
 * niet koos — blijft daarmee volledig overeind.
 */
const FUNCTION_WORDS = new Set([
  // Lidwoorden en aanwijzende/onbepaalde woorden.
  'de',
  'het',
  'een',
  'deze',
  'die',
  'dat',
  'dit',
  'er',
  'daar',
  'wat',
  'welke',
  // Persoonlijke en bezittelijke voornaamwoorden.
  'ik',
  'je',
  'jij',
  'jou',
  'jouw',
  'u',
  'uw',
  'hij',
  'zij',
  'ze',
  'we',
  'wij',
  'me',
  'mij',
  'mijn',
  'zijn',
  'haar',
  'ons',
  'onze',
  'hem',
  'hen',
  'hun',
  'zich',
  // Voorzetsels en voegwoorden.
  'aan',
  'als',
  'bij',
  'door',
  'en',
  'in',
  'maar',
  'met',
  'naar',
  'of',
  'om',
  'op',
  'over',
  'te',
  'tot',
  'uit',
  'van',
  'voor',
  'want',
  'dus',
  // Hulp-, koppel- en modale werkwoorden (de vormen die in gegenereerde zinnen voorkomen).
  'ben',
  'bent',
  'is',
  'was',
  'waren',
  'heb',
  'hebt',
  'heeft',
  'hebben',
  'had',
  'hadden',
  'word',
  'wordt',
  'worden',
  'werd',
  'zal',
  'zult',
  'zullen',
  'zou',
  'zouden',
  'kan',
  'kun',
  'kunt',
  'kunnen',
  'mag',
  'mogen',
  'moet',
  'moeten',
  'wil',
  'wilt',
  'willen',
  'wou',
  'ga',
  'gaat',
  'gaan',
  'doe',
  'doet',
  'doen',
  // Bijwoorden van graad/ontkenning die niets over een concept zeggen.
  'niet',
  'geen',
  'nog',
  'wel',
  'ook',
  'heel',
  'erg',
  'graag',
  'even',
  'meer',
  'iets',
]);

/**
 * Is deze zoekterm betekenisdragend genoeg om als bewijs van een concept te gelden (T10.9)? Een term
 * telt mee zodra er **één** woord in staat dat geen functiewoord is; "naar buiten" blijft dus bewijs voor
 * `outside`, terwijl "wil" dat voor `want` niet is.
 */
export function isMeaningBearingTerm(term: string): boolean {
  const words = term.split(' ').filter((word) => word.length > 0);
  return words.some((word) => !FUNCTION_WORDS.has(word));
}

/**
 * Maximale lengte van een Nederlandse buigingsuitgang die we nog als hetzelfde woord tellen (T10.10):
 * "warm" → "warms"/"warme"/"warmte", "hand" → "handen". Twee tekens dekt de gangbare uitgangen
 * (-s/-e/-en/-te/-de) zonder hele woordfamilies aan elkaar te knopen.
 */
const MAX_INFLECTION_SUFFIX = 2;

/**
 * Minimale lengte van een term voordat we buigingsvormen meenemen. Bij korte woorden ("bed", "oog")
 * levert een prefix-match te veel valse treffers op ("bedoeling"), en die kosten elke keer een
 * onnodige sjabloon-terugval.
 */
const MIN_STEM_LENGTH = 4;

/**
 * Komt `needle` als heel woord in de zin voor, of als datzelfde woord met een korte Nederlandse
 * buigingsuitgang (T10.10)?
 *
 * Waarom dit nodig is: de check matchte op hele woorden, dus de zin "Ik wil iets **warms** eten."
 * ontsnapte terwijl `hot` het label "Warm" en het synoniem "warm" draagt. Zo kwam een concept dat de
 * gebruiker nooit gekozen had tóch in zijn boodschap — precies wat §7.8 hoort te verhinderen, en meteen
 * de reden dat zo'n zin vaag aanvoelt.
 *
 * Meerwoordige termen ("met hond") blijven exact matchen: daar is de frase zelf al het bewijs, en
 * buiging aan het eind van een frase komt in de bibliotheek niet voor.
 */
export function containsTerm(haystack: string, needle: string): boolean {
  if (haystack.includes(` ${needle} `)) return true;
  if (needle.includes(' ') || needle.length < MIN_STEM_LENGTH) return false;

  for (const word of haystack.split(' ')) {
    if (word.length <= needle.length) continue;
    if (word.length - needle.length > MAX_INFLECTION_SUFFIX) continue;
    if (word.startsWith(needle)) return true;
  }
  return false;
}

/**
 * Bepaalt of een geformuleerde zin een concept bevat dat **niet** in de sessie is gekozen (§7.8). Loopt
 * de AAC-bibliotheek langs; voor elk symbool waarvan het concept niet gekozen is, checkt het of een
 * **betekenisdragend** label of synoniem in de zin voorkomt — als heel woord of in een korte
 * buigingsvorm (T10.10). Bewust conservatief (fail-safe): een twijfelgeval leidt tot de veilige
 * sjabloon-terugval, niet tot een mogelijk buiten-de-sessie begrip.
 */
async function messageIntroducesForeignConcept(
  prisma: PrismaClient,
  message: string,
  chosenConcepts: Set<string>,
): Promise<boolean> {
  const haystack = normalizedHaystack(message);
  if (haystack.trim().length === 0) return false;

  const symbols = await prisma.aacSymbol.findMany({
    select: { concept: true, label: true, synonyms: true },
  });
  for (const symbol of symbols) {
    if (chosenConcepts.has(symbol.concept)) continue;
    const synonyms = Array.isArray(symbol.synonyms) ? symbol.synonyms : [];
    const terms = [symbol.label, ...synonyms.filter((s): s is string => typeof s === 'string')];
    for (const term of terms) {
      const needle = normalizeSearch(term).replace(/\s+/g, ' ').trim();
      if (needle.length === 0) continue;
      if (!isMeaningBearingTerm(needle)) continue;
      if (containsTerm(haystack, needle)) return true;
    }
  }
  return false;
}

/**
 * Vormt de voor te stellen boodschap uit de gekozen concepten. Probeert eerst de AI-orchestrator; valt
 * terug op de deterministische sjabloon-zin wanneer de provider het niet kan, een lege zin levert, of een
 * zin met een concept buiten de sessie (§7.8). De gekozen concepten mogen niet leeg zijn (de route
 * weigert dat met een 400).
 */
export async function composeMessage(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  chosen: ChosenConcept[],
  userContext: AiUserContextItem[] = [],
  /**
   * Het gesprek waar deze boodschap bij hoort (T12.2). Puur administratie voor het AI-activiteitscherm:
   * zonder dit valt de afsluitende boodschap-job buiten de draad van het gesprek. Bereikt het model
   * nooit — het reist buiten de prompt om (§7.7).
   */
  sessionId?: string,
): Promise<ComposedMessage> {
  // Veilige bodem: altijd beschikbaar, altijd binnen de gekozen concepten.
  const scripted = generateMessage(chosen);
  const scriptedResult: ComposedMessage = {
    message: scripted,
    confidence: SCRIPTED_CONFIDENCE,
    source: 'scripted',
  };

  if (!orchestrator.canGenerateMessage) return scriptedResult;

  const aiResult = await orchestrator.generateMessage(
    {
      chosenConcepts: chosen.map((c) => ({ concept: c.concept, label: c.label })),
      userContext,
      // Een vraagroute krijgt een ander doel mee (T14.1): de ik-vorm zou de vraag verbieden.
      questionRoute: isQuestionRoute(chosen),
    },
    sessionId ? { sessionId } : undefined,
  );
  if (!aiResult) return scriptedResult;

  const message = aiResult.message.trim();
  if (message.length === 0) return scriptedResult;

  const chosenSet = new Set(chosen.map((c) => c.concept));
  if (await messageIntroducesForeignConcept(prisma, message, chosenSet)) {
    return scriptedResult;
  }

  return {
    message,
    confidence: aiResult.confidence ?? DEFAULT_MESSAGE_CONFIDENCE,
    source: 'ai',
  };
}
