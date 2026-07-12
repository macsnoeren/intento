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
 *     boodschap worden voorgesteld (T5.3).
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
 * Bepaalt de volgende beslissing voor een sessie, puur uit de opgeslagen stappen. `excludeConcepts` zijn
 * extra uit te sluiten concepten bovenop het gekozen pad (bv. afgewezen keuzes bij een correctie, T5.4);
 * standaard leeg.
 */
export async function decideNextQuestion(
  prisma: PrismaClient,
  orchestrator: AiOrchestrator,
  steps: Pick<ConversationStepModel, 'selectedConcept'>[],
  excludeConcepts: Iterable<string> = [],
  userContext: AiUserContextItem[] = [],
  questionContext: string | null = null,
): Promise<ConversationDecision> {
  const chosen = steps.map((step) => step.selectedConcept);
  const excluded = new Set<string>([...chosen, ...excludeConcepts]);

  // 1. AAC-begrensde kandidaten uit de boom.
  const last = steps.length > 0 ? steps[steps.length - 1]!.selectedConcept : null;
  const candidates: AacSymbolModel[] =
    last === null ? await loadIntentSymbols(prisma) : await loadChildSymbols(prisma, last);

  // 2. Herhaling vermijden: al gekozen/uitgesloten concepten wegfilteren.
  const available = candidates.filter((symbol) => !excluded.has(symbol.concept));

  // Geen kandidaten meer (eindconcept of alles al gezien) → boodschap voorstellen (§7.4 propose).
  if (available.length === 0) {
    return {
      question: null,
      done: true,
      phase: 'propose',
      confidence: CONFIDENCE_PROPOSE,
      proposed: [],
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

  // Geen bruikbare opties over (alles weggevallen), of de AI is zeker genoeg (>85%) én er is al een
  // route: boodschap voorstellen i.p.v. nog een vraag (§7.4 propose). Aan de start (geen stappen)
  // stellen we nooit voor — er valt dan niets voor te stellen.
  const proposeByConfidence = confidence >= CONFIDENCE_PROPOSE && steps.length > 0;
  if (filtered.length === 0 || proposeByConfidence) {
    return { question: null, done: true, phase: 'propose', confidence, proposed };
  }

  const question: ConversationQuestion = {
    prompt: aiDecision.question,
    options: filtered.map((option) => symbolToPublic(option.symbol)),
  };
  // We tonen een vraag, dus de fase is `select` (te onzeker, nieuwe vraag) of `refine` (verder
  // verfijnen). `propose` is hierboven al afgehandeld (dan is er geen vraag meer).
  const phase = confidence >= CONFIDENCE_REFINE ? 'refine' : 'select';
  return { question, done: false, phase, confidence, proposed };
}
