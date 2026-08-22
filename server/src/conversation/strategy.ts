import {
  CONVERSATION_STRATEGY_CATALOG,
  conversationStrategySchema,
  DEFAULT_CONVERSATION_STRATEGY,
  type ConversationStrategyKey,
} from '@intento/shared';
import { AAC_RULES, GOAL } from '../ai/prompt.js';
import { CONFIDENCE_PROPOSE, CONFIDENCE_REFINE } from '../ai/thresholds.js';
import { HYPOTHESIS_SMOOTHING } from './hypothesis.js';

/**
 * Gespreksstrategieën (T11.2, DESIGN §5.3, §7.3, §7.4, §7.10, ADR-0013).
 *
 * **Waarom deze module bestaat.** De manier waarop de AI probeert te achterhalen wat de gebruiker
 * bedoelt lag als losse constanten verspreid over vijf modules: de bronvolgorde in `candidates.ts`, de
 * aanbodgrootte in `decision.ts`, de drempels in `ai/thresholds.ts`, de demping in `hypothesis.ts` en de
 * promptformulering in `ai/prompt.ts`. Wie de aanpak wilde wijzigen, raakte vijf plekken aan.
 *
 * Erger dan de spreiding is wat die waarden *betekenen*: ze coderen een **aanname over de persoon**. De
 * huidige set gaat uit van iemand die categorieën begrijpt en stapsgewijs verfijnt. Voor iemand die snel
 * overprikkeld raakt zijn twaalf opties te veel; voor iemand die concrete dingen wél herkent maar niet
 * kan categoriseren is "eerst kiezen tussen eten/drinken/iets doen" een omweg. Eén aanpak voor iedereen
 * botst met DESIGN §5.3 (instellingen per gebruiker) en met de belofte van §7.3 ("gepersonaliseerd op
 * basis van profiel en historie").
 *
 * **Wat een strategie is.** Een waarde: sleutel, label, uitleg voor de begeleider en de parameters
 * hieronder. Eén pijplijn leest eruit — er zijn geen aparte code-paden per strategie (ADR-0013): dat is
 * veiliger en testbaarder, want de waarborgen zitten op één plek en kunnen dus ook maar op één plek
 * sneuvelen. Het type laat ruimte voor een latere strategie met eigen kandidaat-logica zonder dat de
 * aanroepplekken veranderen.
 *
 * **Wat een strategie NOOIT varieert** (DESIGN §7.10; domeinregels, geen instellingen): de gebruiker is
 * eigenaar en bevestigt zelf · deduplicatie tegen bestaande concepten gaat altijd voor · afgewezen
 * concepten komen nooit terug · geen boodschapvoorstel zonder een keuze van de **gebruiker** · de
 * gesloten promptsleutelset (een strategie vult de *inhoud* van `goal`/`aacRules`, nooit de *vorm*) ·
 * nooit een leeg scherm. Een strategie verandert de **zoekwijze**, niet de **garanties** — en dat wordt
 * afgedwongen met de gedeelde invariant-testsuite (`strategy.invariants.test.ts`), die over élke
 * geregistreerde strategie draait.
 *
 * Strategieën zijn **ingebouwd**: code met een stabiele sleutel, niet beheerd in de database. Dat houdt
 * multi-tenant-isolatie buiten beeld; per organisatie bewerkbare strategieën staan bewust bij de
 * post-MVP.
 */

/**
 * De kandidatenbronnen die een strategie mag ordenen (DESIGN §7.3). `intent` staat er bewust **niet**
 * bij: de intentiecategorieën zijn de gegarandeerde bodem onder het gesprek ("nooit een leeg scherm") en
 * worden door `decision.ts` beheerd — geen keuze van een strategie.
 */
export type StrategyCandidateSource = 'children' | 'descendants' | 'retrieval' | 'preference';

/** De promptfragmenten die een strategie vult: de **inhoud** van het doel en de extra AAC-regels. */
export interface StrategyPrompt {
  /** Het doel zoals het model het meekrijgt (DESIGN §7.7). */
  goal: string;
  /** De AAC-regels; de harde regels uit `AAC_RULES` staan er altijd bij (zie `promptRulesFor`). */
  extraAacRules: readonly string[];
}

/** Eén benoemde aanpak: sleutel + uitleg + de parameters van de pijplijn (DESIGN §7.10). */
export interface ConversationStrategy {
  /** Stabiele sleutel; wordt opgeslagen bij de gebruiker/het gesprek en in de logregel getoond. */
  key: ConversationStrategyKey;
  /** Korte naam voor de begeleider ("Rustig en bevestigend"). */
  label: string;
  /** Uitleg in begrijpelijke taal: de begeleider kiest de strategie, niet een ontwikkelaar. */
  description: string;
  /** De kandidatenbronnen in prioriteitsvolgorde; bronnen die ontbreken doen niet mee. */
  candidateSources: readonly StrategyCandidateSource[];
  /** Bovengrens op de kandidatenset die aan het model wordt voorgelegd. */
  maxCandidates: number;
  /** Ondergrens op het aanbod: zoveel opties krijgt de gebruiker te zien zolang er kandidaten zijn. */
  minOffered: number;
  /** Bovengrens op het aanbod: zoveel opties tegelijk, zodat één afwijzing niet alles uitsluit. */
  maxOffered: number;
  /** Vanaf deze zekerheid: verfijnen in plaats van een nieuwe brede vraag (DESIGN §7.4). */
  confidenceRefine: number;
  /** Vanaf deze zekerheid: een boodschap voorstellen (DESIGN §7.4). */
  confidencePropose: number;
  /** Gewicht van het nieuwste modelantwoord in de gedempte zekerheid (0–1; lager = trager). */
  hypothesisSmoothing: number;
  /** Of nieuwe concepten mogen (DESIGN §7.6 trap 3). De env-schakelaar blijft er hard overheen gaan. */
  allowNewConcepts: boolean;
  /** Hoeveel keuzes de **gebruiker** zelf gemaakt moet hebben voordat er iets voorgesteld wordt. */
  minUserChoicesBeforePropose: number;
  /** De promptformulering van deze strategie. */
  prompt: StrategyPrompt;
}

/**
 * Naam en uitleg van een strategie komen uit de **gedeelde catalogus** (`@intento/shared`): de
 * beheer-UI toont dezelfde tekst als waar de server op stuurt, zodat een strategie nooit onder twee
 * namen rondloopt. De parameters blijven server-intern — de client hoeft niet te weten met welke
 * drempels er gezocht wordt, alleen wát er te kiezen valt.
 */
function presentationOf(key: ConversationStrategyKey): {
  key: ConversationStrategyKey;
  label: string;
  description: string;
} {
  const entry = CONVERSATION_STRATEGY_CATALOG.find((item) => item.key === key);
  if (!entry) throw new Error(`Geen catalogusvermelding voor strategie ${key}`);
  return { key: entry.key, label: entry.label, description: entry.description };
}

/**
 * De huidige aanpak, nu als benoemde strategie: van categorie naar detail, met de boom als ruggengraat.
 * De waarden zijn letterlijk die van vóór T11.2 — deze strategie is het bewijs dat de abstractie het
 * bestaande gedrag exact vasthoudt.
 */
export const REFINE_STRATEGY: ConversationStrategy = {
  ...presentationOf('refine'),
  candidateSources: ['children', 'descendants', 'retrieval', 'preference'],
  maxCandidates: 30,
  minOffered: 8,
  maxOffered: 12,
  confidenceRefine: CONFIDENCE_REFINE,
  confidencePropose: CONFIDENCE_PROPOSE,
  hypothesisSmoothing: HYPOTHESIS_SMOOTHING,
  allowNewConcepts: true,
  minUserChoicesBeforePropose: 1,
  prompt: { goal: GOAL, extraAacRules: [] },
};

/**
 * **Breed verkennen** — voor wie concrete dingen wél herkent maar moeilijk categoriseert.
 *
 * De abstracte tussenstap is voor deze persoon de horde: "eerst kiezen tussen eten / drinken / iets
 * doen" vraagt precies het vermogen dat ontbreekt, terwijl "water", "koffie" en "buiten" meteen
 * herkenbaar zijn. Daarom staan de **kleinkinderen vóór de kinderen**: het concrete niveau komt eerst in
 * beeld. Het aanbod is groter (meer kans dat het juiste ding er meteen bij staat) en de voorsteldrempel
 * ligt lager, want deze route komt met minder tussenstappen bij de bedoeling uit.
 */
export const EXPLORE_STRATEGY: ConversationStrategy = {
  ...presentationOf('explore'),
  candidateSources: ['descendants', 'children', 'retrieval', 'preference'],
  maxCandidates: 30,
  minOffered: 10,
  maxOffered: 16,
  confidenceRefine: 0.55,
  confidencePropose: 0.75,
  hypothesisSmoothing: 0.7,
  allowNewConcepts: true,
  minUserChoicesBeforePropose: 1,
  prompt: {
    goal:
      'Achterhaal wat de gebruiker wil zeggen en kies daarvoor zo snel mogelijk **concrete** ' +
      'pictogrammen: voorwerpen, activiteiten, plekken en personen die je kunt aanwijzen. Sla abstracte ' +
      'tussenstappen over als een concreet begrip de bedoeling al kan vangen. Kijk naar wat de gebruiker ' +
      'al koos én naar wat hij afwees — een afwijzing wijst je een andere kant op. Formuleer de vraag in ' +
      'het Nederlands, kort en eenvoudig, en richt je rechtstreeks tot de gebruiker.',
    extraAacRules: [
      'Geef de voorkeur aan concrete, aanwijsbare begrippen boven verzamelnamen of categorieën.',
      'Bied liever een paar opties meer aan dan te weinig: de gebruiker herkent het juiste ding sneller ' +
        'dan dat hij het kan omschrijven.',
    ],
  },
};

/**
 * **Rustig en bevestigend** — voor wie snel overprikkeld raakt.
 *
 * Twaalf pictogrammen tegelijk zijn hier geen rijkdom maar ruis. Het aanbod is klein (sluit aan op een
 * lage `iconsPerScreen`), de kandidatenset blijft dicht bij de laatste keuze, en er wordt **later**
 * voorgesteld: de voorsteldrempel ligt hoog en de demping is sterk, zodat één zelfverzekerd
 * modelantwoord niet meteen tot een boodschap leidt. Liever één stap extra dan een voorstel dat de
 * gebruiker moet afwijzen — een afwijzing kost deze persoon het meest.
 *
 * Het minimum aantal gebruikerskeuzes blijft bewust 1: nóg later voorstellen zou bij een korte route
 * (een eindconcept na één keuze) juist extra vragen opleveren, en dat is precies wat deze strategie
 * probeert te vermijden. "Later" komt hier uit de drempel en de demping, niet uit extra stappen.
 */
export const CALM_STRATEGY: ConversationStrategy = {
  ...presentationOf('calm'),
  candidateSources: ['children', 'descendants', 'retrieval', 'preference'],
  maxCandidates: 12,
  minOffered: 2,
  maxOffered: 4,
  confidenceRefine: 0.6,
  confidencePropose: 0.92,
  hypothesisSmoothing: 0.35,
  allowNewConcepts: true,
  minUserChoicesBeforePropose: 1,
  prompt: {
    goal:
      'Achterhaal rustig wat de gebruiker wil zeggen. Stel één duidelijke vraag tegelijk en bied maar ' +
      'een paar goed onderscheidende opties aan — liever een stap extra dan de gebruiker overvragen. ' +
      'Kijk naar wat de gebruiker al koos én naar wat hij afwees. Formuleer de vraag in het Nederlands, ' +
      'kort, in eenvoudige woorden, en richt je rechtstreeks tot de gebruiker.',
    extraAacRules: [
      'Stel precies één vraag per beurt; combineer nooit twee vragen in één zin.',
      'Bied weinig, duidelijk verschillende opties aan; opties die op elkaar lijken maken kiezen ' +
        'moeilijker in plaats van makkelijker.',
      'Blijf dicht bij wat de gebruiker net koos; maak geen onverwachte sprong naar een ander onderwerp.',
    ],
  },
};

/**
 * **Context eerst** — voor wie een sterk vast dagritme heeft.
 *
 * Bij deze persoon is de begrippenboom niet het beste startpunt: wat hij bedoelt hangt vooral samen met
 * zijn eigen patroon (de koffie 's ochtends, de hond, de vaste wandeling). Daarom staan de **geleerde
 * voorkeuren en de retrieval over de toegestane persoonlijke context vóór de boomkinderen**. De boom
 * blijft er als ruggengraat achter staan — hij verdwijnt niet, hij komt later.
 *
 * Privacy verandert er niets aan: er gaat alleen context mee waarvoor toestemming is gegeven (§6.3), en
 * voorkeuren tellen alleen mee als leren aanstaat (§3.8).
 */
export const CONTEXT_FIRST_STRATEGY: ConversationStrategy = {
  ...presentationOf('context-first'),
  candidateSources: ['preference', 'retrieval', 'children', 'descendants'],
  maxCandidates: 30,
  minOffered: 6,
  maxOffered: 10,
  confidenceRefine: CONFIDENCE_REFINE,
  confidencePropose: CONFIDENCE_PROPOSE,
  hypothesisSmoothing: HYPOTHESIS_SMOOTHING,
  allowNewConcepts: true,
  minUserChoicesBeforePropose: 1,
  prompt: {
    goal:
      'Achterhaal wat de gebruiker wil zeggen en vertrek daarbij vanuit zijn eigen dagritme: de mensen, ' +
      'plekken en gewoonten die in de context staan, en de dingen die hij vaker kiest. Sluit de volgende ' +
      'vraag daarop aan in plaats van op een algemene indeling. Kijk naar wat de gebruiker al koos én ' +
      'naar wat hij afwees. Formuleer de vraag in het Nederlands, kort en eenvoudig, en richt je ' +
      'rechtstreeks tot de gebruiker.',
    extraAacRules: [
      'Gebruik de gebruikerscontext actief: sluit aan bij de personen, plekken en gewoonten die erin ' +
        'staan, in plaats van bij een algemene categorie-indeling.',
      'Voeg nooit context toe die niet is meegegeven; wat er niet staat, weet je niet.',
    ],
  },
};

/** Alle ingebouwde strategieën. Volgorde = weergavevolgorde voor de begeleider. */
export const CONVERSATION_STRATEGIES: readonly ConversationStrategy[] = [
  REFINE_STRATEGY,
  EXPLORE_STRATEGY,
  CALM_STRATEGY,
  CONTEXT_FIRST_STRATEGY,
];

/** De sleutel van de standaardstrategie; geldt als een gebruiker/gesprek er geen gekozen heeft. */
export const DEFAULT_STRATEGY_KEY: ConversationStrategyKey = DEFAULT_CONVERSATION_STRATEGY;

const BY_KEY = new Map<string, ConversationStrategy>(
  CONVERSATION_STRATEGIES.map((strategy) => [strategy.key, strategy]),
);

/** Alle geldige sleutels (voor de zod-validatie op de API-grens en de keuzelijst in de UI). */
export function strategyKeys(): ConversationStrategyKey[] {
  return CONVERSATION_STRATEGIES.map((strategy) => strategy.key);
}

/** De strategie bij een sleutel, of `null` als de sleutel onbekend is. */
export function findStrategy(key: string | null | undefined): ConversationStrategy | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * De standaardstrategie. Gooit als de registry hem niet kent — dat is een programmeerfout die meteen
 * zichtbaar moet zijn, niet een stille terugval op "de eerste die we tegenkomen".
 */
export function defaultStrategy(): ConversationStrategy {
  const strategy = BY_KEY.get(DEFAULT_STRATEGY_KEY);
  if (!strategy) throw new Error(`Onbekende standaardstrategie: ${DEFAULT_STRATEGY_KEY}`);
  return strategy;
}

/**
 * Zod-schema voor een strategiesleutel op een API-grens (T11.4/T11.5). Een onbekende sleutel wordt
 * geweigerd in plaats van stil op de standaard terug te vallen: een half toegepaste strategie is erger
 * dan een geweigerde request. Het schema komt uit `@intento/shared`, zodat client en server dezelfde
 * sleutels kennen.
 */
export const conversationStrategyKeySchema = conversationStrategySchema;

/**
 * Lost op **welke strategie dit gesprek voert** (T11.4, DESIGN §7.10).
 *
 * De volgorde is gebruiker → standaard; T11.5 zet het gesprek er nog vóór. Eén plek, omdat de resolutie
 * anders per aanroeper subtiel gaat verschillen — en dan is "welke aanpak draaide er?" niet meer te
 * beantwoorden. Een sleutel die de registry niet (meer) kent, valt hier terug op de standaard: de
 * *invoer* wordt op de API-grens geweigerd (`conversationStrategyKeySchema`), maar een bestaande rij in
 * de database mag een lopend gesprek nooit laten crashen.
 */
export function resolveStrategy(input: {
  /** De strategie van de gebruiker (`UserCommunicationProfile.conversationStrategy`). */
  user?: string | null;
}): ConversationStrategy {
  return findStrategy(input.user) ?? defaultStrategy();
}

/**
 * De AAC-regels die met deze strategie meegaan: de harde regels uit `AAC_RULES` (DESIGN §7.6, §7.8)
 * **plus** de extra regels van de strategie. De harde regels staan voorop en zijn niet weg te
 * configureren — een strategie vult aan, ze vervangt niet.
 */
export function promptRulesFor(strategy: ConversationStrategy): string[] {
  return [...AAC_RULES, ...strategy.prompt.extraAacRules];
}
