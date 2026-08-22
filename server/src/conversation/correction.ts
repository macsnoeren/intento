import type { ConversationStepModel } from '../generated/prisma/models.js';
import { tippingPoint, type Hypothesis } from './hypothesis.js';

/**
 * Correctie-heranalyse voor de gespreksflow (T5.4, DESIGN §3.4, §7.6, FR-009).
 *
 * Wanneer de gebruiker een voorstel afwijst (❌), gaat Intento **niet** terug naar het begin. In plaats
 * daarvan bepaalt de orchestrator waar de vermoedelijk verkeerde afslag zat en stelt daar een gerichtere
 * vraag. De heranalyse is bewust een **pure functie van de opgeslagen stappen**, zodat ze deterministisch
 * met de mock-provider te testen is en geen extra AI-aanroep nodig heeft.
 *
 * Signaal voor de foutstap, in volgorde van sterkte:
 *
 *  1. **Het kantelpunt van de hypothese** (T10.8): de stap waarna de gedempte zekerheid het sterkst
 *     daalde. Dat is het punt waar de AI het meest van gedachten veranderde — een direct signaal dat het
 *     daar misging, in plaats van een proxy.
 *  2. **De laagste per-stap-zekerheid** (T5.4): de terugval als er (nog) geen hypothesegeschiedenis is,
 *     bijvoorbeeld bij een sessie van vóór Fase 10 of na één enkele beurt.
 *  3. **De laatste stap**, als er van geen enkele stap zekerheid bekend is.
 *
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
  /**
   * Aantal begin-stappen dat niet van de gebruiker komt (T9.14): in vraagmodus zet de begeleider het
   * topic-anker als stap 0. Dat anker mag een correctie nooit terugrollen — anders ontsnapt het gesprek
   * uit de gestelde vraag, precies zoals `/back` het anker al beschermt.
   */
  anchoredSteps = 0,
  /** De lopende hypothese (T10.8); levert het kantelpunt. `null` → terugval op de per-stap-zekerheid. */
  hypothesis: Hypothesis | null = null,
): CorrectionAnalysis {
  const correctable = steps.filter((step) => step.order >= anchoredSteps);
  // Alleen het anker over: er valt niets van de gebruiker terug te rollen. De aanroeper heeft dit al
  // afgevangen; als terugval wijzen we de laatste stap aan zonder hem te beschermen.
  const scope = correctable.length > 0 ? correctable : steps;

  // 1. Het kantelpunt van de hypothese, mits het binnen de corrigeerbare stappen valt (het anker van de
  //    begeleider blijft beschermd, T9.14).
  const tipping = tippingPoint(hypothesis);
  if (tipping !== null) {
    const step = scope.find((candidate) => candidate.order === tipping);
    if (step) return { stepOrder: step.order, rejectedConcept: step.selectedConcept };
  }

  const withConfidence = scope.filter(
    (step): step is (typeof scope)[number] & { confidence: number } =>
      typeof step.confidence === 'number',
  );

  // Geen enkele zekerheid bekend → val terug op de laatste keuze.
  if (withConfidence.length === 0) {
    const last = scope[scope.length - 1]!;
    return { stepOrder: last.order, rejectedConcept: last.selectedConcept };
  }

  let worst = withConfidence[0]!;
  for (const step of withConfidence) {
    // Strikt kleiner → nieuwe laagste; bij gelijkspel houden we de vroegste (steps staat oplopend).
    if (step.confidence < worst.confidence) worst = step;
  }
  return { stepOrder: worst.order, rejectedConcept: worst.selectedConcept };
}
