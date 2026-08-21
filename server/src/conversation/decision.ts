import type { ConversationQuestion, ConversationPhase } from '@intento/shared';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AacSymbolModel, ConversationStepModel } from '../generated/prisma/models.js';
import { symbolToPublic } from '../aac/library.js';
import type { AiConceptRef, AiUserContextItem } from '../ai/provider.js';
import type { AiOrchestrator } from '../ai/orchestrator.js';
import { validateAiOptions } from '../ai/validation.js';
import {
  CONFIDENCE_PROPOSE,
  CONFIDENCE_REFINE,
  DEFAULT_INTERPRETATION_CONFIDENCE,
} from '../ai/thresholds.js';
import { loadChildSymbols, loadIntentSymbols } from './engine.js';

/**
 * AI-beslissingslaag voor de gespreksflow (T5.2, DESIGN §7.2–7.6, §7.8, FR-002/004/009).
 *
 * Vervangt de gescripte vraagselectie achter `/next` door de AI-orchestrator, met daaromheen de harde
 * waarborgen uit DESIGN §7:
 *
 *  1. **AAC-begrenzing (kandidaten).** De mogelijke opties komen uit de AAC-relatieboom (engine): de
 *     intentie-categorieën bij de start, anders de kinderen van het laatst gekozen concept. Alleen deze
 *     kandidaten gaan als `availableSymbols` naar de AI.
 *  2. **Herhaling vermijden (§7.5).** Concepten die al in het gekozen pad zitten (en optioneel expliciet
 *     uitgesloten concepten, bv. afgewezen keuzes uit een correctie, T5.4) vallen weg — vóór de AI-aanroep
 *     én nogmaals na validatie. Zo wordt nooit een al gekozen/afgewezen concept opnieuw aangeboden. De
 *     terug-functie (`/back`) blijft exact omdat de beslissing een **pure functie van de stappen** is.
 *  3. **Validatielaag (§7.6, §7.8).** Elke door de AI voorgestelde optie wordt tegen de bibliotheek
 *     getoetst (validation.ts): onbekende concepten worden als `ConceptProposal` vastgelegd en
 *     **weggelaten** — ze bereiken de gebruiker nooit.
 *  4. **Confidence-gestuurde selectie (§7.4).** De overgebleven opties worden op zekerheid geordend
 *     (meest waarschijnlijke eerst), en de interpretatie-zekerheid bepaalt de fase
 *     (select/refine/propose). Bij `propose` (>85% of een eindconcept) is er geen vraag meer en kan de
 *     boodschap worden voorgesteld (T5.3) — maar alléén als de **gebruiker** al iets gekozen heeft
 *     (T9.14): in vraagmodus telt het anker van de begeleider daarvoor niet mee.
 *  5. **Ondergrens op de keuze (§3.1, T9.10).** De AI mag kiezen en ordenen, maar niet zó ver snoeien
 *     dat er niets te kiezen valt; onder `MIN_OFFERED_OPTIONS` vullen we aan met de overige kandidaten
 *     uit de bibliotheek, en op het startscherm worden altijd álle intentiecategorieën aangeboden.
 *  6. **Nooit doodlopen (T9.14).** Houdt dit punt geen kandidaten meer over (bv. na een correctie), dan
 *     zoekt de laag een niveau hoger in het afgelegde pad verder in plaats van een boodschap te
 *     verzinnen.
 *
 * De laag is bewust vrij van HTTP: de route laadt de stappen en geeft ze mee, zodat alles deterministisch
 * met de mock-provider te testen is.
 */

/** De uitkomst van de beslissing: de te tonen vraag (of `null`), de fase en de interpretatie-zekerheid. */
export interface ConversationDecision {
  /** De volgende vraag met AAC-begrensde, gevalideerde, geordende opties; `null` bij `propose`/eindconcept. */
  question: ConversationQuestion | null;
  /** Of er een boodschap voorgesteld kan worden (geen vraag meer). Altijd gelijk aan `question === null`. */
  done: boolean;
  /** Fase volgens het confidence-model (§7.4). */
  phase: ConversationPhase;
  /** Interpretatie-zekerheid (0–1) van deze beslissing. */
  confidence: number;
  /** Onbekende concepten die de AI voorstelde en die als `ConceptProposal` zijn afgevangen (weggelaten). */
  proposed: string[];
  /**
   * Diagnose-informatie over deze beslissing (T9.15). Puur AAC-concepten en tellingen — nooit
   * persoonlijke context — zodat de route er een logregel van kan maken en zichtbaar wordt wát de AI
   * eigenlijk deed ("doet de AI wel opties bedenken?").
   */
  diagnostics: {
    /** Aantal AAC-kandidaten op dit punt (na uitsluiting van al gekozen/afgewezen concepten). */
    candidateCount: number;
    /** Aantal opties dat de AI zelf voorstelde en dat de validatielaag overleefde. */
    aiOptionCount: number;
    /** De uiteindelijk aangeboden concepten, in de getoonde volgorde. */
    offered: string[];
    /** Motivering van de AI (vrije tekst uit de provider), of `null`. */
    reason: string | null;
    /** Of de kandidaten een niveau hoger zijn opgehaald omdat dit punt niets meer overhad. */
    widened: boolean;
  };
}

/** Lege diagnose voor de beslissingen die zonder AI-aanroep tot stand komen. */
function noDiagnostics(widened = false): ConversationDecision['diagnostics'] {
  return { candidateCount: 0, aiOptionCount: 0, offered: [], reason: null, widened };
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

/**
 * Zoekt de kandidatenset voor de volgende vraag (T9.12/T9.14).
 *
 * Normaal zijn dat de kinderen van de laatste keuze. Daarbij is het verschil tussen "leeg" en "leeg"
 * bepalend:
 *
 * - **Eindconcept** — het concept heeft in de bibliotheek helemaal geen kinderen. Dan is de route af en
 *   hoort er een boodschap voorgesteld te worden (het bestaande §7.4-gedrag). We zoeken dus niet verder.
 * - **Alles uitgesloten** — er zijn wél kinderen, maar ze zijn allemaal al gekozen of afgewezen (na een
 *   correctie of een "Geen van deze past", T9.12). Dan lopen we **omhoog** door het afgelegde pad en
 *   uiteindelijk naar de intentiecategorieën, zodat er iets te kiezen blijft. Zonder die ladder liep een
 *   ❌-correctie in de gebruikerstest dood: de sessie hield alleen het begeleiders-anker over en de app
 *   stelde een "boodschap" voor die de gebruiker nooit had gekozen.
 *
 * Geeft de eerste bruikbare set terug; `available` is leeg bij een eindconcept of als de hele boom niets
 * meer overhoudt.
 */
export async function findAvailableCandidates(
  prisma: PrismaClient,
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
  excluded: Set<string>,
): Promise<{ candidates: AacSymbolModel[]; available: AacSymbolModel[]; widened: boolean }> {
  // Van de laatste keuze omhoog door het pad; als laatste redmiddel de intentiecategorieën.
  for (let index = steps.length - 1; index >= 0; index--) {
    const candidates = await loadChildSymbols(prisma, steps[index]!.selectedConcept);
    const available = candidates.filter((symbol) => !excluded.has(symbol.concept));
    if (available.length > 0) {
      return { candidates, available, widened: index !== steps.length - 1 };
    }
    // Eindconcept op het diepste punt: niet verder omhoog zoeken — de route is af (§7.4 propose).
    if (candidates.length === 0 && index === steps.length - 1) {
      return { candidates, available, widened: false };
    }
  }
  const intents = await loadIntentSymbols(prisma);
  return {
    candidates: intents,
    available: intents.filter((symbol) => !excluded.has(symbol.concept)),
    widened: steps.length > 0,
  };
}

/**
 * Bepaalt de volgende beslissing voor een sessie, puur uit de opgeslagen stappen. `excludeConcepts` zijn
 * extra uit te sluiten concepten bovenop het gekozen pad (bv. afgewezen keuzes bij een correctie, T5.4);
 * standaard leeg. `anchoredSteps` is het aantal begin-stappen dat **niet** van de gebruiker komt: in
 * vraagmodus (T7.1) zet de begeleider het topic-anker als stap 0. Die stap telt niet als keuze van de
 * gebruiker en mag dus nooit in zijn eentje tot een boodschapvoorstel leiden (T9.14, DESIGN §2).
 */
export async function decideNextQuestion(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
  excludeConcepts: Iterable<string> = [],
  userContext: AiUserContextItem[] = [],
  questionContext: string | null = null,
  anchoredSteps = 0,
): Promise<ConversationDecision> {
  const chosen = steps.map((step) => step.selectedConcept);
  const excluded = new Set<string>([...chosen, ...excludeConcepts]);
  // Heeft de **gebruiker** al iets gekozen? Alleen dan mag er een boodschap voorgesteld worden.
  const userChoices = Math.max(0, steps.length - anchoredSteps);

  // 1. AAC-begrensde kandidaten uit de boom (2. met herhaling/uitsluitingen er al uit), zo nodig een
  //    niveau hoger gezocht.
  const found = await findAvailableCandidates(prisma, steps, excluded);
  const { candidates, widened } = found;
  let available = found.available;

  // Vangnet aan de wortel (T9.12): heeft de gebruiker nog niets gekozen en zijn álle kandidaten
  // uitgesloten (bv. na herhaald "Geen van deze past" op het startscherm), dan zou het scherm leeg
  // blijven én valt er niets voor te stellen. Dan negeren we de uitsluitingen en bieden we de
  // intentiecategorieën gewoon opnieuw aan — een leeg scherm is nooit een geldige uitkomst.
  if (available.length === 0 && userChoices === 0) {
    available = await loadIntentSymbols(prisma);
  }

  // Geen kandidaten meer (eindconcept of alles al gezien) → boodschap voorstellen (§7.4 propose).
  // Alleen als de gebruiker echt iets gekozen heeft; anders valt er niets voor te stellen en is er
  // ook niets meer te vragen (lege bibliotheek).
  if (available.length === 0) {
    return {
      question: null,
      done: true,
      phase: 'propose',
      confidence: CONFIDENCE_PROPOSE,
      proposed: [],
      diagnostics: noDiagnostics(widened),
    };
  }

  // Labelmap voor de gesprekscontext en het terugmappen van gevalideerde concepten naar symbolen.
  const symbolByConcept = new Map<string, AacSymbolModel>(available.map((s) => [s.concept, s]));
  const labelByConcept = new Map<string, string>(candidates.map((s) => [s.concept, s.label]));

  // 3. AI kiest/ordent binnen de kandidaten (verse, beperkte context).
  const aiDecision = await orchestrator.selectNextQuestion({
    conversationContext: toConceptRefs(steps, labelByConcept),
    availableSymbols: available.map((s) => ({ concept: s.concept, label: s.label })),
    userContext,
    questionContext,
  });

  // 4. Validatielaag: onbekende concepten afvangen (ConceptProposal) en weglaten.
  const { valid, proposed } = await validateAiOptions(
    prisma,
    aiDecision.options,
    aiDecision.reason,
  );

  // 5. Herhaling nogmaals afdwingen na een eventuele synoniem-omzetting, en op zekerheid ordenen.
  const filtered = valid.filter(
    (option) => !excluded.has(option.symbol.concept) && symbolByConcept.has(option.symbol.concept),
  );
  filtered.sort((a, b) => b.confidence - a.confidence);

  const confidence = aiDecision.confidence ?? DEFAULT_INTERPRETATION_CONFIDENCE;

  // De AI is zeker genoeg (>85%) én de **gebruiker** heeft al iets gekozen: boodschap voorstellen
  // i.p.v. nog een vraag (§7.4 propose). Aan de start — en in vraagmodus met alleen het anker van de
  // begeleider — stellen we nooit voor: er valt dan niets voor te stellen dat van de gebruiker is.
  const proposeByConfidence = confidence >= CONFIDENCE_PROPOSE && userChoices > 0;
  if (proposeByConfidence) {
    return {
      question: null,
      done: true,
      phase: 'propose',
      confidence,
      proposed,
      diagnostics: {
        candidateCount: available.length,
        aiOptionCount: filtered.length,
        offered: [],
        reason: aiDecision.reason ?? null,
        widened,
      },
    };
  }

  // 6. De AI **ordent**, ze snoeit niet (T9.10). Haar keuzes staan voorop — dat is precies wat er op het
  //    eerste scherm te zien is — maar daarachter volgen alle overige kandidaten van dit punt, in
  //    bibliotheekvolgorde. Reden: in de gebruikerstest gaf een echte AI één optie terug op het
  //    startscherm, en bij "waar heb je pijn?" drie lichaamsdelen waar het juiste niet bij zat; de rest
  //    van de bibliotheek was dan onbereikbaar. De tablet toont er per scherm `iconsPerScreen` van en
  //    houdt de rest bereikbaar via "Meer keuzes" (T9.6), dus het scherm blijft even rustig terwijl geen
  //    enkel bestaand pictogram meer buiten bereik valt. De AAC-begrenzing (§7.6) blijft intact: we
  //    vullen uitsluitend aan met kandidaten die de bibliotheek op dit punt zelf aanbiedt.
  const offered = filtered.map((option) => option.symbol);
  const seen = new Set(offered.map((symbol) => symbol.concept));
  for (const candidate of available) {
    if (seen.has(candidate.concept)) continue;
    offered.push(candidate);
    seen.add(candidate.concept);
  }

  const question: ConversationQuestion = {
    prompt: aiDecision.question,
    options: offered.map(symbolToPublic),
  };
  // We tonen een vraag, dus de fase is `select` (te onzeker, nieuwe vraag) of `refine` (verder
  // verfijnen). `propose` is hierboven al afgehandeld (dan is er geen vraag meer).
  const phase = confidence >= CONFIDENCE_REFINE ? 'refine' : 'select';
  return {
    question,
    done: false,
    phase,
    confidence,
    proposed,
    diagnostics: {
      candidateCount: available.length,
      aiOptionCount: filtered.length,
      offered: offered.map((symbol) => symbol.concept),
      reason: aiDecision.reason ?? null,
      widened,
    },
  };
}
