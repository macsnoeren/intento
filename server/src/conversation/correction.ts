import type { ConversationStepModel } from '../generated/prisma/models.js';

/**
 * Correctie-heranalyse voor de gespreksflow (T5.4, DESIGN §3.4, §7.6, FR-009).
 *
 * Wanneer de gebruiker een voorstel afwijst (❌), gaat Intento **niet** terug naar het begin. In plaats
 * daarvan bepaalt de orchestrator waar de vermoedelijk verkeerde afslag zat en stelt daar een gerichtere
 * vraag. De heranalyse is bewust een **pure functie van de opgeslagen stappen**, zodat ze deterministisch
 * met de mock-provider te testen is en geen extra AI-aanroep nodig heeft.
 *
 * Signaal voor de foutstap: de per-stap vastgelegde **interpretatie-zekerheid** (`ConversationStep.
 * confidence`, §7.4), die tijdens `/next` uit de AI-beslissing komt. De stap met de **laagste** zekerheid
 * is het punt waar het model het minst zeker was over de intentie — de meest waarschijnlijke misstap.
 * Deze materialiseert de "heranalyse van eerdere keuzes" uit DESIGN §3.4 zonder een aparte AI-call.
 */

/** De uitkomst van de heranalyse: welke stap wordt teruggerold en welk concept wordt afgewezen. */
export interface CorrectionAnalysis {
  /** De `order`-index van de als foutstap aangemerkte stap; deze en alles erna wordt teruggerold. */
  stepOrder: number;
  /** Het op die stap gekozen (en nu afgewezen) AAC-concept; blijft de rest van de sessie uitgesloten. */
  rejectedConcept: string;
}

/**
 * Bepaalt de vermoedelijke foutstap uit de afgelegde stappen. Kiest de stap met de **laagste**
 * `confidence`; bij gelijke zekerheid wint de **vroegste** stap (dichter bij de wortel van het
 * misverstand). Stappen zonder vastgelegde zekerheid (`null`, bv. via de save-only `/choice`) tellen
 * als "onbekend" en worden alleen gekozen als er geen enkele stap zekerheid heeft — dan valt de analyse
 * terug op de **laatste** stap (de meest recente keuze). `steps` moet op `order` oplopend gesorteerd zijn
 * en niet leeg (de aanroeper garandeert dat er iets terug te rollen valt).
 */
export function analyzeCorrection(
  steps: Pick<ConversationStepModel, 'order' | 'selectedConcept' | 'confidence'>[],
): CorrectionAnalysis {
  const withConfidence = steps.filter(
    (step): step is typeof step & { confidence: number } => typeof step.confidence === 'number',
  );

  // Geen enkele zekerheid bekend → val terug op de laatste keuze.
  if (withConfidence.length === 0) {
    const last = steps[steps.length - 1]!;
    return { stepOrder: last.order, rejectedConcept: last.selectedConcept };
  }

  let worst = withConfidence[0]!;
  for (const step of withConfidence) {
    // Strikt kleiner → nieuwe laagste; bij gelijkspel houden we de vroegste (steps staat oplopend).
    if (step.confidence < worst.confidence) worst = step;
  }
  return { stepOrder: worst.order, rejectedConcept: worst.selectedConcept };
}
