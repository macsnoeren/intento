import type { ConversationStepModel } from '../generated/prisma/models.js';

/**
 * Correctie op een voorstel (❌ Nee) voor de gespreksflow (T5.4, herzien in T10.10; DESIGN §3.4, FR-009).
 *
 * Wanneer de gebruiker een voorstel afwijst, gaat Intento **niet** terug naar het begin: er wordt precies
 * **één stap** teruggerold — de laatste — en het daar gekozen concept wordt de rest van de sessie
 * uitgesloten (§7.5). Nogmaals ❌ rolt de volgende stap terug. Zo loopt de gebruiker zijn eigen route
 * stap voor stap terug, in zijn eigen tempo.
 *
 * **Waarom niet slimmer?** Tot T10.10 probeerde deze laag te *bepalen* waar de verkeerde afslag zat: het
 * kantelpunt van de hypothese (T10.8), anders de stap met de laagste per-stap-zekerheid (T5.4). Dat pakte
 * in de praktijk verkeerd uit. Sinds T10.3 is `ConversationStep.confidence` de zekerheid waarmee de vraag
 * werd **aangeboden**, en die stijgt gaandeweg een gesprek — dus was de eerste stap vrijwel altijd de
 * "laagste", en bij gelijkspel won de vroegste stap sowieso. Gereproduceerd: route `want > eat`, ❌ Nee →
 * beide keuzes weg, `want` permanent uitgesloten, gebruiker terug op het startscherm.
 *
 * Dat is de omkering van DESIGN §2: de onzekerheid van de AI werd afgewenteld op de keuzes die de
 * gebruiker juist zelf en bewust had aangetikt. Eén stap tegelijk terugrollen is voorspelbaar, altijd
 * herhaalbaar, en gooit nooit meer weg dan de gebruiker op dat moment aanwijst. Voor iemand die met moeite
 * communiceert weegt voorspelbaarheid zwaarder dan een slimme gok.
 *
 * De functie blijft een **pure functie van de opgeslagen stappen**: deterministisch te testen, geen
 * AI-aanroep.
 */

/** De uitkomst van de correctie: welke stap wordt teruggerold en welk concept wordt afgewezen. */
export interface CorrectionAnalysis {
  /** De `order`-index van de terug te rollen stap; deze en alles erna verdwijnt. */
  stepOrder: number;
  /** Het op die stap gekozen (en nu afgewezen) AAC-concept; blijft de rest van de sessie uitgesloten. */
  rejectedConcept: string;
}

/**
 * Wijst de terug te rollen stap aan: de **laatste** keuze van de gebruiker. `steps` moet op `order`
 * oplopend gesorteerd zijn en niet leeg (de aanroeper garandeert dat er iets terug te rollen valt).
 */
export function analyzeCorrection(
  steps: Pick<ConversationStepModel, 'order' | 'selectedConcept'>[],
  /**
   * Aantal begin-stappen dat niet van de gebruiker komt (T9.14): in vraagmodus zet de begeleider het
   * topic-anker als stap 0. Dat anker mag een correctie nooit terugrollen — anders ontsnapt het gesprek
   * uit de gestelde vraag, precies zoals `/back` het anker al beschermt.
   */
  anchoredSteps = 0,
): CorrectionAnalysis {
  const correctable = steps.filter((step) => step.order >= anchoredSteps);
  // Alleen het anker over: er valt niets van de gebruiker terug te rollen. De aanroeper heeft dit al
  // afgevangen; als terugval wijzen we de laatste stap aan zonder hem te beschermen.
  const scope = correctable.length > 0 ? correctable : steps;

  const last = scope[scope.length - 1]!;
  return { stepOrder: last.order, rejectedConcept: last.selectedConcept };
}
