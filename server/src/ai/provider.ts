import { z } from 'zod';

/**
 * Provider-agnostische AI-interface + gestructureerde in-/uitvoer (T5.1, DESIGN §7.2, §7.7, §9.2).
 *
 * De backend praat namens de client met de LLM — de client **nooit** rechtstreeks (DESIGN §8.1). Alle
 * concrete providers (deterministische mock nu; self-hosted LLM later) implementeren dezelfde smalle
 * `AiProvider`-interface, zodat het model vervangbaar is (DESIGN §9.1) en tests deterministisch draaien.
 * Zie ADR-0008 voor de keuze en de begrenzing.
 *
 * Bewust **niet** in `@intento/shared`: deze schema's horen bij de interne interface backend ↔
 * AI-orchestrator/worker (DESIGN §8.2, `POST /ai/next-decision`). De web-client kent ze niet — hij praat
 * nooit met de AI. Alle AI-uitvoer wordt met deze zod-schema's opnieuw gevalideerd: een provider (en
 * straks een externe worker, T5.5) wordt **nooit** vertrouwd.
 */

/**
 * Verwijzing naar één AAC-concept in de AI-context: de canonieke conceptsleutel + de weergavetekst.
 * De AI werkt bewust in **concept-ruimte** (taalneutrale, stabiele sleutels), niet met symbool-id's of
 * vrije tekst — zo blijft de uitvoer koppelbaar aan de AAC-bibliotheek (DESIGN §7.6) en portabel.
 */
export const aiConceptRefSchema = z.object({
  concept: z.string().min(1),
  label: z.string(),
});
export type AiConceptRef = z.infer<typeof aiConceptRefSchema>;

/**
 * Eén stuk gebruikerscontext dat de AI **mag** zien (DESIGN §7.7). In deze fase leeg; de persoonlijke
 * context met toestemmingsfilter volgt in T6.1 (alleen `aiUsageAllowed=true` bereikt ooit dit veld).
 * Bewust een gesloten, platte vorm — geen ruwe PII-blobs, geen vrije tekst buiten een korte waarde.
 */
export const aiUserContextItemSchema = z.object({
  kind: z.string().min(1),
  value: z.string(),
});
export type AiUserContextItem = z.infer<typeof aiUserContextItemSchema>;

/** De enige AI-taak in T5.1: de volgende pictogramvraag kiezen (DESIGN §7.1 taak 2). */
export const AI_TASK_SELECT_NEXT_QUESTION = 'select_next_question' as const;

/**
 * De **beperkte, verse context** die per aanroep wordt samengesteld (DESIGN §7.7):
 * `systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze`, plus de
 * toegestane opties. Bewust **géén** chatgeschiedenis of vrije invoer — de sleutelset is gesloten, zodat
 * aantoonbaar alléén toegestane context de provider bereikt (T5.1-acceptatie). `buildAiPrompt` (prompt.ts)
 * is de enige plek die dit object vormt.
 */
export const aiPromptSchema = z.object({
  task: z.literal(AI_TASK_SELECT_NEXT_QUESTION),
  /** Harde systeem-/veiligheidsregels (DESIGN §7.8) — bewust een vaste, gesloten lijst. */
  systemRules: z.array(z.string()),
  /** Het doel van Intento in deze aanroep. */
  goal: z.string(),
  /** AAC-begrenzingsregels (DESIGN §7.6): binnen de bibliotheek blijven, geen vrije concepten. */
  aacRules: z.array(z.string()),
  /** Toegestane gebruikerscontext (leeg in deze fase; T6.1 vult dit met toestemming). */
  userContext: z.array(aiUserContextItemSchema),
  /** De tot nu toe gekozen concepten — géén chatgeschiedenis, alleen de AAC-route. */
  conversationContext: z.array(aiConceptRefSchema),
  /** De laatste keuze (of `null` aan het begin). */
  lastChoice: aiConceptRefSchema.nullable(),
  /** De op dit moment toegestane opties (AAC-begrensd). */
  availableSymbols: z.array(aiConceptRefSchema),
});
export type AiPrompt = z.infer<typeof aiPromptSchema>;

/** Eén door de AI voorgestelde optie: een concept + zekerheid (DESIGN §7.4, §7.7). */
export const aiOptionSchema = z.object({
  /** De conceptsleutel van het voorgestelde symbool (moet in T5.2 bestaan in de bibliotheek). */
  symbol: z.string().min(1),
  /** Zekerheid tussen 0 en 1 (de drempels uit DESIGN §7.4 worden in T5.2 toegepast). */
  confidence: z.number().min(0).max(1),
});
export type AiOption = z.infer<typeof aiOptionSchema>;

/**
 * De gestructureerde AI-uitvoer voor `select_next_question` (DESIGN §7.7): de volgende vraag, de
 * voorgestelde opties met zekerheid en een korte onderbouwing. De orchestrator dwingt deze vorm af met
 * `aiQuestionDecisionSchema.parse(...)` — vrije/ongestructureerde modeluitvoer bereikt de flow nooit.
 */
export const aiQuestionDecisionSchema = z.object({
  question: z.string().min(1),
  options: z.array(aiOptionSchema),
  reason: z.string(),
});
export type AiQuestionDecision = z.infer<typeof aiQuestionDecisionSchema>;

/**
 * De provider-agnostische AI-interface. Elke provider (mock, later een self-hosted LLM of een
 * wachtrij-worker) implementeert dit. De implementatie levert **ruwe** gestructureerde uitvoer terug;
 * de orchestrator valideert die opnieuw met `aiQuestionDecisionSchema` (nooit vertrouwen).
 */
export interface AiProvider {
  /** Naam van de provider (voor logging/diagnose). */
  readonly name: string;
  /** Kiest de volgende pictogramvraag op basis van de beperkte context. */
  selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision>;
}
