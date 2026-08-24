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

/**
 * Eén door de gebruiker **afgewezen** concept, met het soort afwijzing (T10.4, DESIGN §7.5, ADR-0012).
 *
 * Tot Fase 10 werden afgewezen concepten alleen lokaal weggefilterd; het model kreeg simpelweg een
 * kortere lijst en wist niet dát er iets was afgewezen — laat staan wát of waarom. Daardoor herhaalde
 * het zijn redenering in dezelfde richting. De twee soorten vragen om verschillend gedrag:
 *
 * - `wrong_guess` — de gebruiker wees een **voorstel** af (❌ Nee): de afgelegde route klopte niet.
 * - `no_fitting_option` — het juiste pictogram stond **niet tussen de aangeboden opties**: de gebruiker
 *   weet het beter dan de aangeboden set, dus er moeten *andere* concepten komen — maar wél binnen
 *   hetzelfde onderwerp (T14.3). Tot dan las de prompt dit als "verkeerde richting" en sprong het model
 *   naar een ander onderwerp: op "Een vraag stellen → Wat? → Eten" leverde 🤷 opties als "nagel" op.
 */
export const aiRejectedConceptSchema = z.object({
  concept: z.string().min(1),
  label: z.string(),
  kind: z.enum(['wrong_guess', 'no_fitting_option']),
});
export type AiRejectedConcept = z.infer<typeof aiRejectedConceptSchema>;

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
  /**
   * De eerder in deze sessie **gestelde vragen** (T10.4, DESIGN §7.5). Geen chatgeschiedenis: dit zijn
   * uitsluitend door het systeem geformuleerde vragen, geen gebruikersinvoer. Doel: niet dezelfde vraag
   * in andere bewoordingen opnieuw stellen.
   */
  askedQuestions: z.array(z.string()),
  /**
   * De in deze sessie **afgewezen** concepten met het soort afwijzing (T10.4, DESIGN §7.5). Deze staan
   * bewust *niet* meer in `availableSymbols`; ze reizen mee zodat het model weet waaróm de lijst korter
   * is en zijn richting kan verleggen.
   */
  rejectedConcepts: z.array(aiRejectedConceptSchema),
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
/**
 * **Metadata over de aanroep** (T11.6, DESIGN §7.10, §9.4) — nadrukkelijk geen promptinhoud.
 *
 * De gespreksstrategie bepaalt *hoe* er gezocht wordt en hoort daarom bij het antwoord op "waarom deed
 * de AI dit?", maar ze is geen context voor het model: ze reist buiten de prompt om mee, zodat de
 * gesloten sleutelset van `aiPromptSchema` ongemoeid blijft. Alleen de wachtrij-administratie gebruikt
 * dit (`AiJob.strategy`), zodat het beheerscherm AI-activiteit kan tonen welke aanpak draaide. Bewust
 * uitsluitend de sleutel: geen promptinhoud, geen persoonlijke context.
 */
export interface AiCallMeta {
  /** De sleutel van de actieve gespreksstrategie, of weggelaten als de aanroeper er geen kent. */
  strategy?: string;
  /**
   * Het gesprek waar deze aanvraag bij hoort (T12.2). Net als de strategie puur administratie: het
   * beheerscherm kan de losse jobs zo als één draad tonen. Bereikt het model nooit.
   */
  sessionId?: string;
}

export interface AiProvider {
  /** Naam van de provider (voor logging/diagnose). */
  readonly name: string;
  /**
   * Kiest de volgende pictogramvraag op basis van de beperkte context. `meta` is optionele
   * administratie over de aanroep (T11.6) en bereikt het model nooit; een provider mag hem negeren.
   */
  selectNextQuestion(prompt: AiPrompt, meta?: AiCallMeta): Promise<AiQuestionDecision>;
  /**
   * Vormt een natuurlijke zin uit de bevestigde concepten (T5.3, §7.1 taak 4). `meta` is dezelfde
   * administratie als bij `selectNextQuestion` en bereikt het model nooit. **Optioneel**: een
   * provider die deze taak niet kan (bv. een pure vraagselector), laat de methode weg — de
   * conversatie-laag valt dan terug op de deterministische sjabloon-zin. De uitvoer wordt hoe dan ook
   * opnieuw gevalideerd (vorm + AAC-begrenzing), dus een provider wordt ook hier nooit vertrouwd.
   */
  generateMessage?(prompt: AiMessagePrompt, meta?: AiCallMeta): Promise<AiMessageResult>;
}
