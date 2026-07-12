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

/** De volgende pictogramvraag kiezen (DESIGN §7.1 taak 2) — de kern-taak sinds T5.1. */
export const AI_TASK_SELECT_NEXT_QUESTION = 'select_next_question' as const;

/** Een natuurlijke zin vormen uit de bevestigde concepten (DESIGN §7.1 taak 4) — T5.3. */
export const AI_TASK_GENERATE_MESSAGE = 'generate_message' as const;

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
  /**
   * De letterlijke begeleidersvraag bij de **vraagmodus** (T7.1, DESIGN §3.2): de AI gebruikt die als
   * context om de antwoorden te beperken/ordenen ("Wat wil je drinken?" → dranken). `null` bij een vrij
   * gesprek. Bewust een enkel, kort tekstveld — het is geen chatgeschiedenis en geen vrije opdracht.
   */
  questionContext: z.string().nullable(),
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
 *
 * `confidence` is de **interpretatie-zekerheid** (DESIGN §7.4): hoe zeker het model is dat het de intentie
 * van de gebruiker nu begrijpt (los van de per-optie-zekerheid, die over de *volgende* keuze gaat). De
 * confidence-drempels (<60% nieuwe vraag, 60–85% verfijnen, >85% voorstel) worden hierop toegepast
 * (`phaseForDecision`, thresholds.ts). Optioneel zodat een provider die geen interpretatie-zekerheid
 * levert niet faalt; de beslissingslaag valt dan terug op een neutrale waarde.
 */
export const aiQuestionDecisionSchema = z.object({
  question: z.string().min(1),
  options: z.array(aiOptionSchema),
  reason: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});
export type AiQuestionDecision = z.infer<typeof aiQuestionDecisionSchema>;

/**
 * De **beperkte, verse context** voor de boodschapgeneratie (T5.3, DESIGN §7.1 taak 4, §7.7, §7.8):
 * `systeemregels + doel + AAC-regels + gebruikerscontext + de bevestigde concepten`. Bewust **géén**
 * chatgeschiedenis of vrije invoer — de sleutelset is gesloten. `chosenConcepts` is de volledige route
 * (de eerste is de intentie); het model mag hier uitsluitend een zin uit vormen (§7.8: nooit een concept
 * toevoegen dat niet in deze lijst staat). De safety-controle in de conversatie-laag dwingt dat na afloop
 * nogmaals hard af.
 */
export const aiMessagePromptSchema = z.object({
  task: z.literal(AI_TASK_GENERATE_MESSAGE),
  /** Harde systeem-/veiligheidsregels (DESIGN §7.8) — dezelfde vaste lijst als bij vraagselectie. */
  systemRules: z.array(z.string()),
  /** Het doel van deze aanroep: een natuurlijke zin binnen de gekozen concepten. */
  goal: z.string(),
  /** AAC-begrenzingsregels (DESIGN §7.6): binnen de gekozen concepten blijven, niets toevoegen. */
  aacRules: z.array(z.string()),
  /** Toegestane gebruikerscontext (leeg in deze fase; T6.1 vult dit met toestemming). */
  userContext: z.array(aiUserContextItemSchema),
  /** De bevestigde concepten waaruit de zin gevormd wordt (eerste = intentie), op volgorde. */
  chosenConcepts: z.array(aiConceptRefSchema),
});
export type AiMessagePrompt = z.infer<typeof aiMessagePromptSchema>;

/**
 * De gestructureerde uitvoer van de boodschapgeneratie (T5.3): de geformuleerde `message` en een
 * optionele `confidence` (DESIGN §7.4). De orchestrator dwingt deze vorm af met zod; de conversatie-laag
 * toetst de zin daarna tegen de AAC-bibliotheek (§7.8) en valt bij twijfel terug op de deterministische
 * sjabloon-zin. Een provider die geen zekerheid levert, faalt niet — dan geldt een neutrale terugval.
 */
export const aiMessageResultSchema = z.object({
  message: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type AiMessageResult = z.infer<typeof aiMessageResultSchema>;

/**
 * De provider-agnostische AI-interface. Elke provider (mock, later een self-hosted LLM of een
 * wachtrij-worker) implementeert dit. De implementatie levert **ruwe** gestructureerde uitvoer terug;
 * de orchestrator valideert die opnieuw met de zod-schema's (nooit vertrouwen).
 */
export interface AiProvider {
  /** Naam van de provider (voor logging/diagnose). */
  readonly name: string;
  /** Kiest de volgende pictogramvraag op basis van de beperkte context. */
  selectNextQuestion(prompt: AiPrompt): Promise<AiQuestionDecision>;
  /**
   * Vormt een natuurlijke zin uit de bevestigde concepten (T5.3, §7.1 taak 4). **Optioneel**: een
   * provider die deze taak niet kan (bv. een pure vraagselector), laat de methode weg — de
   * conversatie-laag valt dan terug op de deterministische sjabloon-zin. De uitvoer wordt hoe dan ook
   * opnieuw gevalideerd (vorm + AAC-begrenzing), dus een provider wordt ook hier nooit vertrouwd.
   */
  generateMessage?(prompt: AiMessagePrompt): Promise<AiMessageResult>;
}
