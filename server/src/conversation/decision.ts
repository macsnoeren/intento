import type { ConversationQuestion, ConversationPhase } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConversationStepModel } from '../generated/prisma/models.js';
import type { OpenSymbolsClient } from '../aac/opensymbols.js';
import { symbolToPublic } from '../aac/library.js';
import type { AiConceptRef, AiRejectedConcept, AiUserContextItem } from '../ai/provider.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import { validateAiOptions } from '../ai/validation.js';
import { DEFAULT_INTERPRETATION_CONFIDENCE } from '../ai/thresholds.js';
import { collectCandidates, type CandidateSource } from './candidates.js';
import { loadIntentSymbols } from './engine.js';
import { updateHypothesis, type Hypothesis } from './hypothesis.js';
import { defaultStrategy, promptRulesFor, type ConversationStrategy } from './strategy.js';

/**
 * AI-beslissingslaag voor de gespreksflow (T5.2, herzien in Fase 10; DESIGN §7.2–7.6, §7.8, ADR-0012).
 *
 * Deze laag bepaalt de volgende vraag met de harde waarborgen uit DESIGN §7 eromheen:
 *
 *  1. **Kandidaten uit retrieval, niet uit één boomknoop** (T10.2, §7.3). `collectCandidates` stelt de
 *     set samen uit boomkinderen + retrieval over de héle bibliotheek + geleerde voorkeuren, met de
 *     intentiecategorieën als bodem. Vóór Fase 10 was de set letterlijk de kinderen van de laatste
 *     keuze; bij een smalle tak (`want` heeft er drie) had de AI geen enkele ruimte om te achterhalen
 *     wat de gebruiker bedoelt. Op het **startscherm** blijft het bewust bij de intentiecategorieën
 *     (DESIGN §3.1).
 *  2. **Herhaling vermijden** (§7.5). Reeds gekozen en afgewezen concepten vallen weg — vóór de
 *     AI-aanroep én nogmaals na validatie. De afwijzingen reizen daarnaast **expliciet mee in de prompt**
 *     (T10.4), zodat "geen van deze past" een richtingverandering uitlokt in plaats van stil te
 *     verdwijnen.
 *  3. **Validatielaag** (§7.6, §7.8). Elke voorgestelde optie gaat langs de bibliotheek: bestaand
 *     concept → houden, synoniem → omzetten, aantoonbaar nieuw → aanmaken als gemarkeerd nieuw woord +
 *     voorstel voor de beheerder (T10.6). Deduplicatie gaat altijd voor.
 *  4. **Confidence-gestuurde fase** (§7.4), met een over beurten heen **gedempte** zekerheid uit de
 *     hypothese (T10.8) zodat één zelfverzekerd modelantwoord niet meteen een boodschap forceert.
 *  5. **Onder- én bovengrens op het aanbod** (§3.1, T9.10/T10.5). De AI ordent; haar keuzes staan
 *     vooraan en worden aangevuld tot `minOffered` zodat er altijd genoeg te kiezen is. Het aanbod is
 *     óók begrensd (`maxOffered`), zodat "Geen van deze past" niet in één klap de hele kandidatenset
 *     uitsluit en de uitweg herhaalbaar blijft.
 *  6. **Nooit doodlopen** (T9.14/T10.5), in deze volgorde: (a) is er niets meer over, dan volgt een
 *     **vrije ronde** — de AI krijgt geen bestaande opties maar wél de volledige negatieve context en mag
 *     zelf begrippen aandragen (§7.6 trap 3); (b) levert ook dat niets op, dan de intentiecategorieën als
 *     laatste redmiddel; (c) pas als zelfs die leeg zijn, een boodschapvoorstel. Die volgorde is de kern
 *     van de Fase 10-fix: vroeger was (b) de éérste reactie, waardoor "geen van deze past" de gebruiker
 *     terugzette op het startscherm.
 *
 * **De knoppen komen uit de gespreksstrategie** (T11.2, §7.10): bronvolgorde, aanbodgrootte, drempels,
 * demping, promptformulering en of nieuwe concepten mogen. De waarborgen hierboven staan daar bewust
 * *buiten*: ze gelden voor élke strategie en worden afgedwongen door de gedeelde invariant-testsuite.
 * Zonder strategie geldt de standaard (`refine`), waarvan de waarden exact die van vóór T11.2 zijn.
 *
 * De laag is bewust vrij van HTTP: de route laadt de stappen en geeft ze mee, zodat alles deterministisch
 * met de mock-provider te testen is.
 */

/** De uitkomst van de beslissing: de te tonen vraag (of `null`), de fase en de interpretatie-zekerheid. */
export interface ConversationDecision {
  /** De volgende vraag met gevalideerde, geordende opties; `null` bij `propose`/eindconcept. */
  question: ConversationQuestion | null;
  /** Of er een boodschap voorgesteld kan worden (geen vraag meer). Altijd gelijk aan `question === null`. */
  done: boolean;
  /** Fase volgens het confidence-model (§7.4). */
  phase: ConversationPhase;
  /** De (gedempte) interpretatie-zekerheid (0–1) van deze beslissing. */
  confidence: number;
  /** Onbekende concepten die de AI voorstelde en die als `ConceptProposal` zijn vastgelegd. */
  proposed: string[];
  /** Concepten die als **nieuw symbool** zijn aangemaakt en dus als nieuw woord worden aangeboden (T10.6). */
  created: string[];
  /** De bijgewerkte hypothese (T10.8); `null` als er geen AI-beslissing aan te pas kwam. */
  hypothesis: Hypothesis | null;
  /**
   * Diagnose-informatie over deze beslissing (T9.15). Puur AAC-concepten en tellingen — nooit
   * persoonlijke context — zodat de route er een logregel van kan maken en zichtbaar wordt wát de AI
   * eigenlijk deed ("doet de AI wel opties bedenken?").
   */
  diagnostics: {
    /** Aantal kandidaten op dit punt (na uitsluiting van al gekozen/afgewezen concepten). */
    candidateCount: number;
    /** Aantal kandidaten per bron (T10.2): boomkinderen, retrieval, voorkeuren, intenties. */
    candidateSources: Record<CandidateSource, number>;
    /** Aantal opties dat de AI zelf voorstelde en dat de validatielaag overleefde. */
    aiOptionCount: number;
    /** De uiteindelijk aangeboden concepten, in de getoonde volgorde. */
    offered: string[];
    /** Motivering van de AI (vrije tekst uit de provider), of `null`. */
    reason: string | null;
    /** Of de opties van buiten de directe boomkinderen komen (het punt zelf hield niets over). */
    widened: boolean;
  };
}

/** Lege diagnose voor de beslissingen die zonder AI-aanroep tot stand komen. */
function noDiagnostics(widened = false): ConversationDecision['diagnostics'] {
  return {
    candidateCount: 0,
    candidateSources: { children: 0, descendants: 0, retrieval: 0, preference: 0, intent: 0 },
    aiOptionCount: 0,
    offered: [],
    reason: null,
    widened,
  };
}

/** Bouwt de AAC-conceptverwijzingen van het reeds gekozen pad (voor de gesprekscontext van de AI). */
function toConceptRefs(
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
  labelByConcept: Map<string, string>,
): AiConceptRef[] {
  return steps.map((step) => ({
    concept: step.selectedConcept,
    label: labelByConcept.get(step.selectedConcept) ?? step.selectedConcept,
  }));
}

/** Eén afgewezen concept zoals de aanroeper het aanlevert: de sleutel plus het soort afwijzing. */
export interface DecisionRejection {
  concept: string;
  kind: AiRejectedConcept['kind'];
}

export interface DecideNextQuestionInput {
  /** De reeds gezette stappen, oplopend op `order`. */
  steps: Pick<ConversationStepModel, 'selectedConcept'>[];
  /**
   * De in deze sessie afgewezen concepten met hun soort (T10.4). Worden uitgesloten van de opties én
   * meegegeven aan de AI, zodat die van richting kan veranderen.
   */
  rejections?: DecisionRejection[];
  /** De eerder in deze sessie gestelde vragen (T10.4, §7.5) — niet herhalen. */
  askedQuestions?: string[];
  /** De toegestane gebruikerscontext (T6.1/T6.3); alléén met toestemming samengesteld. */
  userContext?: AiUserContextItem[];
  /** De begeleidersvraag bij vraagmodus (T7.1); `null` bij een vrij gesprek. */
  questionContext?: string | null;
  /**
   * Aantal begin-stappen dat **niet** van de gebruiker komt (T9.14): in vraagmodus zet de begeleider het
   * topic-anker als stap 0. Die stap telt niet als keuze van de gebruiker en mag dus nooit in zijn
   * eentje tot een boodschapvoorstel leiden (DESIGN §2).
   */
  anchoredSteps?: number;
  /** De gebruiker van deze sessie; voedt de voorkeuren-bron van de kandidaten. */
  userId?: string;
  /**
   * De actieve gespreksstrategie (T11.2, §7.10); weggelaten = de standaardstrategie. Bepaalt de
   * **zoekwijze**, nooit de waarborgen.
   */
  strategy?: ConversationStrategy;
  /**
   * Operationele bovengrens op de kandidatenset (env `AI_MAX_CANDIDATES`). Werkt als **plafond** boven
   * de strategie: de strikste van de twee wint, zodat een strategie de deployment nooit kan oprekken.
   */
  maxCandidates?: number;
  /**
   * Of de AI een nieuw concept mag aandragen (env `AI_ALLOW_NEW_CONCEPTS`, DESIGN §7.6 trap 3). Ook dit
   * is een **plafond**: beide moeten het toestaan. Een strategie kan het uitzetten, nooit aanzetten.
   */
  allowNewConcepts?: boolean;
  /** Pictogrambron voor een nieuw concept (T10.6); `null`/weggelaten = placeholder-glyph. */
  icons?: OpenSymbolsClient | null;
  /** De lopende hypothese van deze sessie (T10.8); `null` aan het begin. */
  hypothesis?: Hypothesis | null;
}

/**
 * De grenzen op het aanbod (`minOffered`/`maxOffered`) staan sinds T11.2 in de strategie (§7.10).
 *
 * De **ondergrens** (T9.10) houdt in dat de AI mag ordenen en kiezen, maar niet zó ver snoeien dat er
 * niets te kiezen valt. De **bovengrens** (T10.5) bestaat omdat vóór Fase 10 ná de AI-keuze álle overige
 * kandidaten werden aangeplakt: met de bredere kandidatenset (T10.2) wordt het aanbod dan de halve
 * bibliotheek, en sluit "Geen van deze past" in één klap alles uit — waarna het gesprek doodloopt.
 * Een begrensd aanbod maakt de afwijzing weer betekenisvol en de uitweg herhaalbaar.
 *
 * Wat een strategie er níet mee kan: het scherm leegmaken. `minOffered >= 1` is een invariant, geen
 * instelling.
 */

/**
 * Bepaalt de volgende beslissing voor een sessie uit de opgeslagen stappen en de sessiecontext. Zie de
 * moduletoelichting voor de waarborgen; de aanroeper (`routes/conversation.ts`) legt het resultaat vast
 * als **aanbod** zodat het niet per beurt opnieuw wordt afgeleid (T10.3).
 */
export async function decideNextQuestion(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  input: DecideNextQuestionInput,
): Promise<ConversationDecision> {
  const {
    steps,
    rejections = [],
    askedQuestions = [],
    userContext = [],
    questionContext = null,
    anchoredSteps = 0,
    userId = '',
    strategy = defaultStrategy(),
    icons = null,
    hypothesis = null,
  } = input;

  // De strategie stelt voor, de deployment beschikt: bij beide grenzen wint de strikste. Zo kan een
  // strategie de operationele instellingen nooit oprekken — alleen aanscherpen.
  const maxCandidates = Math.min(
    strategy.maxCandidates,
    input.maxCandidates ?? strategy.maxCandidates,
  );
  const allowNewConcepts = (input.allowNewConcepts ?? false) && strategy.allowNewConcepts;

  const chosen = steps.map((step) => step.selectedConcept);
  const excluded = new Set<string>([...chosen, ...rejections.map((r) => r.concept)]);
  // Heeft de **gebruiker** genoeg zelf gekozen? Alleen dan mag er een boodschap voorgesteld worden. Het
  // minimum komt uit de strategie, maar de ondergrens is een domeinregel: nooit nul (DESIGN §2, §7.10).
  const userChoices = Math.max(0, steps.length - anchoredSteps);
  const mayPropose = userChoices >= Math.max(1, strategy.minUserChoicesBeforePropose);

  // 1. Kandidaten. Op het startscherm blijft het bij de intentiecategorieën (DESIGN §3.1): daar hoort de
  //    gebruiker de richting te kiezen, niet de AI — en er is nog geen context om op te retrieven.
  const found =
    steps.length === 0
      ? await intentOnlyCandidates(prisma, excluded)
      : await collectCandidates(prisma, {
          steps,
          excluded,
          userId,
          questionContext,
          userContext,
          limit: maxCandidates,
          sources: strategy.candidateSources,
        });

  const { candidates, atLeafConcept, sourceByConcept, counts } = found;
  let available = found.available;

  // Het laatst gekozen concept is een **eindconcept**: de route is af, dus een boodschap voorstellen
  // (§7.4). Dit verschilt wezenlijk van "alles uitgesloten" — daar valt nog wél wat te vragen.
  if (atLeafConcept && mayPropose) {
    return {
      question: null,
      done: true,
      phase: 'propose',
      confidence: hypothesis?.confidence ?? strategy.confidencePropose,
      proposed: [],
      created: [],
      hypothesis,
      diagnostics: noDiagnostics(false),
    };
  }

  // Vangnet aan de wortel (T9.12): heeft de gebruiker nog niets gekozen en zijn álle kandidaten
  // uitgesloten (bv. na herhaald "Geen van deze past" op het startscherm), dan zou het scherm leeg
  // blijven én valt er niets voor te stellen. Dan negeren we de uitsluitingen en bieden we de
  // intentiecategorieën gewoon opnieuw aan — een leeg scherm is nooit een geldige uitkomst.
  if (available.length === 0 && userChoices === 0) {
    available = await loadIntentSymbols(prisma);
  }

  // Niets meer over terwijl de gebruiker wél iets koos. Vóór Fase 10 werd hier meteen een boodschap
  // voorgesteld. Dat is precies het punt waarop de gebruiker vastliep: hij gaf aan dat zijn woord er niet
  // bij stond en kreeg óf het startscherm óf een boodschap die hij nooit bedoelde. Zijn nieuwe concepten
  // toegestaan (§7.6 trap 3), dan volgt er een **vrije ronde**: de AI krijgt geen bestaande opties maar
  // wél de volledige negatieve context, en mag zelf begrippen aandragen. Levert dat niets op, dan is de
  // boodschap alsnog de uitkomst — maar pas dán.
  const openRound = available.length === 0;
  if (openRound && !allowNewConcepts) {
    // Vrije ronde staat uit: dan is de laatste uitweg de intentiecategorieën — de richting opnieuw laten
    // kiezen. Zijn ook die op, dan valt er echt niets meer te vragen.
    const usable = (await loadIntentSymbols(prisma)).filter(
      (symbol) => !excluded.has(symbol.concept),
    );
    if (usable.length === 0) {
      return {
        question: null,
        done: true,
        phase: 'propose',
        confidence: hypothesis?.confidence ?? strategy.confidencePropose,
        proposed: [],
        created: [],
        hypothesis,
        diagnostics: noDiagnostics(true),
      };
    }
    available = usable;
  }

  // "Verbreed": de aangeboden opties komen niet (meer) uit de directe boomkinderen van de laatste keuze.
  const widened =
    openRound ||
    (counts.children > 0 &&
      !available.some((symbol) => sourceByConcept.get(symbol.concept) === 'children'));

  // Labelmap voor de gesprekscontext en de afwijzingen: de AI moet "Iets willen" lezen, niet de
  // conceptsleutel "want". De reeds gekozen concepten staan per definitie **niet** in de kandidatenset
  // (ze zijn uitgesloten), dus die labels worden apart opgezocht — zonder dat kreeg het model een
  // verarmde context en formuleerde het vragen als 'Wat past het best bij "want"?'.
  const labels = await labelsForConcepts(prisma, [
    ...chosen,
    ...rejections.map((rejection) => rejection.concept),
  ]);
  for (const symbol of candidates) {
    if (!labels.has(symbol.concept)) labels.set(symbol.concept, symbol.label);
  }

  // 2 + 3. AI kiest/ordent binnen de kandidaten, mét de negatieve context (T10.4).
  const aiDecision = await orchestrator.selectNextQuestion({
    conversationContext: toConceptRefs(steps, labels),
    availableSymbols: available.map((s) => ({ concept: s.concept, label: s.label })),
    userContext,
    questionContext,
    askedQuestions,
    // De strategie vult de **inhoud** van doel en AAC-regels; de sleutelset blijft gesloten (§7.7).
    goal: strategy.prompt.goal,
    aacRules: promptRulesFor(strategy),
    rejectedConcepts: rejections.map((rejection) => ({
      concept: rejection.concept,
      label: labels.get(rejection.concept) ?? rejection.concept,
      kind: rejection.kind,
    })),
  });

  // 4. Validatielaag: bestaand → houden, synoniem → omzetten, nieuw → aanmaken (of alleen voorstellen).
  const { valid, proposed, created } = await validateAiOptions(prisma, {
    options: aiDecision.options,
    reason: aiDecision.reason,
    allowNewConcepts,
    icons,
  });

  // 5. Herhaling nogmaals afdwingen na een eventuele synoniem-omzetting, en op zekerheid ordenen.
  //
  //    De enige harde regel hier is de **uitsluiting**: wat de gebruiker al koos of afwees, komt niet
  //    terug (§7.5). De kandidatenset is bewust géén tweede filter: sinds §7.6 trap 3 mag de AI zelfs een
  //    begrip aandragen dat nog niet bestaat, dus haar tegenhouden als ze een bestaand concept noemt dat
  //    toevallig buiten de retrieval viel, zou onsamenhangend zijn — en slechter voor de gebruiker, want
  //    een bestaand pictogram gaat vóór een verzonnen woord. De kandidaten zijn een signaal, geen grens
  //    (DESIGN §7.3).
  const filtered = valid.filter((option) => !excluded.has(option.symbol.concept));
  filtered.sort((a, b) => b.confidence - a.confidence);

  // 6. Hypothese bijwerken: de zekerheid wordt gedempt zodat één zelfverzekerd antwoord de
  //    voorsteldrempel niet in zijn eentje haalt (T10.8, §7.4).
  const rawConfidence = aiDecision.confidence ?? DEFAULT_INTERPRETATION_CONFIDENCE;
  const nextHypothesis = updateHypothesis(hypothesis, {
    stepCount: steps.length,
    rawConfidence,
    concepts: filtered.map((option) => option.symbol.concept),
    reason: aiDecision.reason,
    smoothing: strategy.hypothesisSmoothing,
  });
  const confidence = nextHypothesis.confidence;

  // De AI is zeker genoeg (>85%) én de **gebruiker** heeft al iets gekozen: boodschap voorstellen
  // i.p.v. nog een vraag (§7.4 propose). Aan de start — en in vraagmodus met alleen het anker van de
  // begeleider — stellen we nooit voor: er valt dan niets voor te stellen dat van de gebruiker is.
  if (confidence >= strategy.confidencePropose && mayPropose) {
    return {
      question: null,
      done: true,
      phase: 'propose',
      confidence,
      proposed,
      created,
      hypothesis: nextHypothesis,
      diagnostics: {
        candidateCount: available.length,
        candidateSources: counts,
        aiOptionCount: filtered.length,
        offered: [],
        reason: aiDecision.reason,
        widened,
      },
    };
  }

  // 7. Het aanbod samenstellen. De keuzes van de AI staan voorop — dat is wat er op het eerste scherm te
  //    zien is — en worden aangevuld uit de kandidaten (in de bronvolgorde van de strategie) tot
  //    `minOffered`, zodat er altijd genoeg te kiezen valt (T9.10). Het totaal is begrensd op `maxOffered`,
  //    zodat "Geen van deze past" niet in één klap de hele bibliotheek uitsluit (T10.5).
  const offered = filtered.map((option) => option.symbol).slice(0, strategy.maxOffered);
  const seen = new Set(offered.map((symbol) => symbol.concept));
  const target = Math.min(strategy.maxOffered, Math.max(strategy.minOffered, offered.length));
  for (const candidate of available) {
    if (offered.length >= target) break;
    if (seen.has(candidate.concept)) continue;
    offered.push(candidate);
    seen.add(candidate.concept);
  }

  // Ook de vrije ronde kan niets opleveren (een model dat niets aandraagt, of alleen onbruikbare
  // termen). Dan is er nog één stap vóór het boodschapvoorstel: terug naar de intentiecategorieën.
  // Dat is een zichtbare herstart van de richting — vervelend, maar altijd beter dan een "boodschap van
  // de gebruiker" die hij nooit gekozen heeft (T9.14, DESIGN §2). Pas als zelfs dát leeg is, is er echt
  // niets meer te vragen.
  if (offered.length === 0) {
    const intents = await loadIntentSymbols(prisma);
    const usable = intents.filter((symbol) => !excluded.has(symbol.concept));
    if (usable.length > 0) {
      offered.push(...usable.slice(0, strategy.maxOffered));
    } else {
      return {
        question: null,
        done: true,
        phase: 'propose',
        confidence,
        proposed,
        created,
        hypothesis: nextHypothesis,
        diagnostics: {
          candidateCount: 0,
          candidateSources: counts,
          aiOptionCount: 0,
          offered: [],
          reason: aiDecision.reason,
          widened,
        },
      };
    }
  }

  const question: ConversationQuestion = {
    prompt: aiDecision.question,
    options: offered.map(symbolToPublic),
  };
  // We tonen een vraag, dus de fase is `select` (te onzeker, nieuwe vraag) of `refine` (verder
  // verfijnen). `propose` is hierboven al afgehandeld (dan is er geen vraag meer).
  const phase = confidence >= strategy.confidenceRefine ? 'refine' : 'select';
  return {
    question,
    done: false,
    phase,
    confidence,
    proposed,
    created,
    hypothesis: nextHypothesis,
    diagnostics: {
      candidateCount: available.length,
      candidateSources: counts,
      aiOptionCount: filtered.length,
      offered: offered.map((symbol) => symbol.concept),
      reason: aiDecision.reason,
      widened,
    },
  };
}

/** De kandidatenset van het startscherm: uitsluitend de intentiecategorieën (DESIGN §3.1). */
async function intentOnlyCandidates(
  prisma: PrismaClient,
  excluded: Set<string>,
): Promise<Awaited<ReturnType<typeof collectCandidates>>> {
  const intents = await loadIntentSymbols(prisma);
  return {
    candidates: intents,
    available: intents.filter((symbol) => !excluded.has(symbol.concept)),
    sourceByConcept: new Map(intents.map((symbol) => [symbol.concept, 'intent' as const])),
    counts: { children: 0, descendants: 0, retrieval: 0, preference: 0, intent: intents.length },
    atLeafConcept: false,
  };
}

/** Zoekt de labels bij een set concepten op (voor de leesbare afwijzingen in de prompt). */
async function labelsForConcepts(
  prisma: PrismaClient,
  concepts: string[],
): Promise<Map<string, string>> {
  if (concepts.length === 0) return new Map();
  const symbols = await prisma.aacSymbol.findMany({
    where: { concept: { in: concepts } },
    select: { concept: true, label: true },
  });
  return new Map(symbols.map((symbol) => [symbol.concept, symbol.label]));
}
