import { z } from 'zod';

/**
 * Contracten v1 tussen backend en agentdienst (INTENTO-NEW-DESIGN §5, §34, §51) — de zod-kant.
 *
 * Dezelfde vormen staan aan de Python-kant in pydantic (`agent-service/agent_service/contracts.py`).
 * Beide kanten worden getest tegen dezelfde voorbeeldbestanden in `contracts/fixtures/`, zodat ze niet
 * uit elkaar lopen. Elke vorm is **strict**: een veld dat maar aan één kant bestaat, valt meteen op.
 * Het contract heeft geen enkel veld waarmee de agentdienst de Vocabulary of contacten kan wijzigen (I8),
 * en een contact heeft nooit een e-mailadres (V6).
 */

export const AGENT_CONTRACT_VERSION = 1 as const;

const confidence = z.number().min(0).max(1);
const ref = z.string().min(1).max(200);
const shortText = z.string().min(1).max(300);
const nonNegative = z.number().int().min(0);

export const agentPhaseSchema = z.enum([
  'clarify',
  'confirm_message',
  'share_ask',
  'share_contact',
  'confirm_send',
  'done',
  'stopped',
]);
export type AgentPhase = z.infer<typeof agentPhaseSchema>;

export const interactionModeSettingSchema = z.enum(['binary', 'multi', 'ai']);
export const interactionModeSchema = z.enum(['binary', 'multi']);
export const questionStrategyKeySchema = z.enum([
  'general_to_specific',
  'concrete_first',
  'short_and_calm',
]);
export const representationSchema = z.enum(['exact', 'stand_in']);

// --- Wat de backend meestuurt ----------------------------------------------------------------------

export const agentSettingsSchema = z.strictObject({
  interaction_mode: interactionModeSettingSchema,
  options_per_screen: z.number().int().min(2).max(8),
  question_strategy: questionStrategyKeySchema,
  max_questions: z.number().int().min(5).max(30),
  experience_enabled: z.boolean(),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

export const vocabularyEntrySchema = z.strictObject({
  id: ref,
  labels: z.array(shortText).min(1),
  concepts: z.array(ref).min(1),
  contexts: z.array(ref),
  part_of_speech: ref.nullable().optional(),
  is_start: z.boolean(),
  sort_order: z.number().int(),
});
export type VocabularyEntry = z.infer<typeof vocabularyEntrySchema>;

export const contactEntrySchema = z.strictObject({
  id: ref,
  name: shortText,
  vocabulary_item_id: ref.nullable().optional(),
  sort_order: z.number().int(),
});
export type ContactEntry = z.infer<typeof contactEntrySchema>;

export const experienceCountSchema = z.strictObject({
  ref,
  presented: nonNegative,
  chosen: nonNegative,
  chosen_at_first_position: nonNegative,
});
export type ExperienceCount = z.infer<typeof experienceCountSchema>;

export const experienceSummarySchema = z.strictObject({
  symbols: z.array(experienceCountSchema),
  contacts: z.array(experienceCountSchema),
  modes: z.array(experienceCountSchema),
});
export type ExperienceSummary = z.infer<typeof experienceSummarySchema>;

export const agentEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('answer_yes') }),
  z.strictObject({ type: z.literal('answer_no') }),
  z.strictObject({ type: z.literal('select_option'), option_ref: ref }),
  z.strictObject({ type: z.literal('none_of_these') }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

// --- Presentatie: wat de tablet toont (§33) ---------------------------------------------------------

export const presentationOptionSchema = z.strictObject({
  ref,
  kind: z.enum(['symbol', 'contact']),
  vocabulary_item_id: ref.nullable().optional(),
  contact_id: ref.nullable().optional(),
  label: shortText,
  concept: ref.nullable().optional(),
  representation: representationSchema,
  position: nonNegative,
});
export type PresentationOption = z.infer<typeof presentationOptionSchema>;

export const presentationKindSchema = z.enum([
  'question',
  'confirm_message',
  'share_ask',
  'share_contact',
  'confirm_send',
  'ask_stop',
  'done',
  'stopped',
]);
export type PresentationKind = z.infer<typeof presentationKindSchema>;

export const presentationSchema = z.strictObject({
  kind: presentationKindSchema,
  mode: interactionModeSchema,
  text: shortText,
  options: z.array(presentationOptionSchema),
  message: shortText.nullable().optional(),
});
export type Presentation = z.infer<typeof presentationSchema>;

// --- Session State (§5) -----------------------------------------------------------------------------

export const hypothesisSchema = z.strictObject({ concept: ref, label: shortText, confidence });

export const proposalSchema = z.strictObject({
  message: shortText,
  concepts: z.array(ref).min(1),
  confidence,
});
export type Proposal = z.infer<typeof proposalSchema>;

export const sessionStateSchema = z.strictObject({
  session_id: ref,
  phase: agentPhaseSchema,
  turn: nonNegative,
  interaction_mode: interactionModeSchema,
  mode_since_turn: nonNegative,
  current_intent: hypothesisSchema.nullable().optional(),
  intent_hypotheses: z.array(hypothesisSchema),
  questions_asked: z.array(
    z.strictObject({ turn: nonNegative, concept: ref.nullable().optional(), text: shortText }),
  ),
  answers: z.array(
    z.strictObject({
      turn: nonNegative,
      answer: z.enum(['yes', 'no', 'selected', 'none_of_these']),
      concepts: z.array(ref),
      option_ref: ref.nullable().optional(),
    }),
  ),
  rejected_concepts: z.array(ref),
  uncertainties: z.array(shortText),
  assumptions: z.array(shortText),
  proposal: proposalSchema.nullable().optional(),
  communication_intent: proposalSchema.nullable().optional(),
  share: z.strictObject({
    contacts_asked: z.array(ref),
    selected_contact: ref.nullable().optional(),
    sent_to: z.array(ref),
  }),
  last_presentation: presentationSchema.nullable().optional(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

// --- Wat de agentdienst teruggeeft ------------------------------------------------------------------

export const inferenceSchema = z.strictObject({
  agent: ref,
  kind: ref,
  payload: z.record(z.string(), z.json()),
  confidence: confidence.nullable().optional(),
});
export type Inference = z.infer<typeof inferenceSchema>;

export const agentDecisionSchema = z.strictObject({
  agent: ref,
  status: z.enum(['success', 'fallback', 'failed']),
  model: ref.nullable().optional(),
  prompt_version: ref.nullable().optional(),
  latency_ms: nonNegative,
  validation: z.enum(['valid', 'invalid', 'skipped']).nullable().optional(),
  reason: shortText.nullable().optional(),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;

export const vocabularyGapSchema = z.strictObject({
  type: z.literal('vocabulary_gap'),
  concept: ref,
  label: shortText,
  context: ref.nullable().optional(),
  best_available_item_id: ref.nullable().optional(),
  confidence,
});
export type VocabularyGap = z.infer<typeof vocabularyGapSchema>;

/** Hooguit zoveel recente handelingen in een `TurnRequest`; de wisselregels kijken er hooguit 4 terug. */
export const MAX_RECENT_EVENTS = 12;

/**
 * Wat de gebruiker op een eerder scherm deed, zoals de backend het vastlegde (Observed, §26). Ook ↩ Terug,
 * dat de agentdienst zelf nooit ziet. Nodig voor de wisselregels van "AI kiest" (§14).
 */
export const recentEventSchema = z.strictObject({
  turn: nonNegative,
  screen: z.enum([
    'question',
    'confirm_message',
    'share_ask',
    'share_contact',
    'confirm_send',
    'ask_stop',
  ]),
  mode: interactionModeSchema,
  event: z.enum(['answer_yes', 'answer_no', 'select_option', 'none_of_these', 'back']),
});
export type RecentEvent = z.infer<typeof recentEventSchema>;

export const turnRequestSchema = z.strictObject({
  contract_version: z.literal(AGENT_CONTRACT_VERSION),
  session_id: ref,
  turn: nonNegative,
  event: agentEventSchema,
  state: sessionStateSchema.nullable().optional(),
  settings: agentSettingsSchema,
  vocabulary: z.array(vocabularyEntrySchema).min(1),
  contacts: z.array(contactEntrySchema),
  experience: experienceSummarySchema.nullable().optional(),
  /** De laatste handelingen in dit gesprek, oudste eerst, inclusief die van deze beurt. */
  recent: z.array(recentEventSchema).max(MAX_RECENT_EVENTS),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const turnResponseSchema = z.strictObject({
  contract_version: z.literal(AGENT_CONTRACT_VERSION),
  session_id: ref,
  turn: nonNegative,
  state: sessionStateSchema,
  presentation: presentationSchema,
  inferences: z.array(inferenceSchema),
  decisions: z.array(agentDecisionSchema),
  gaps: z.array(vocabularyGapSchema),
});
export type TurnResponse = z.infer<typeof turnResponseSchema>;

// --- Na afloop: de Experience Agent (§21 laag 2, N12.4) --------------------------------------------

/** Hooguit zoveel schermen per gesprek; meer zegt een observatie niets extra. */
export const MAX_EXPERIENCE_SCREENS = 60;
/** Hooguit zoveel observaties per gesprek. */
export const MAX_EXPERIENCE_NOTES = 5;

/** Een symbool zoals het op het scherm stond. Geen contacten: die gaan nooit naar een LLM (V6). */
export const experienceOptionSchema = z.strictObject({
  label: shortText,
  concept: ref.nullable().optional(),
  representation: representationSchema,
  position: nonNegative,
});

/**
 * Eén scherm van het afgeronde gesprek (Presented) met wat de gebruiker deed (Observed). Schermen over
 * contacten (`share_contact`, `confirm_send`) gaan nooit mee: daar staan namen op.
 */
export const experienceScreenSchema = z.strictObject({
  turn: nonNegative,
  kind: z.enum(['question', 'confirm_message', 'share_ask', 'ask_stop']),
  mode: interactionModeSchema,
  text: shortText,
  options: z.array(experienceOptionSchema).max(8),
  answer: z.enum(['yes', 'no', 'selected', 'none_of_these', 'back', 'stop']).nullable().optional(),
  chosen_position: nonNegative.nullable().optional(),
  response_time_ms: nonNegative.nullable().optional(),
});
export type ExperienceScreen = z.infer<typeof experienceScreenSchema>;

export const experienceRequestSchema = z.strictObject({
  contract_version: z.literal(AGENT_CONTRACT_VERSION),
  session_id: ref,
  settings: agentSettingsSchema,
  outcome: z.enum(['confirmed', 'stopped']),
  sent: z.boolean(),
  screens: z.array(experienceScreenSchema).min(1).max(MAX_EXPERIENCE_SCREENS),
});
export type ExperienceRequest = z.infer<typeof experienceRequestSchema>;

/** Een observatie over het gesprek: geen waarheid (§21, §36), en in de MVP stuurt ze niets bij. */
export const experienceNoteSchema = z.strictObject({
  about: z.enum(['mode', 'question', 'symbol', 'flow']),
  text: shortText,
  confidence,
});
export type ExperienceNote = z.infer<typeof experienceNoteSchema>;

export const experienceResponseSchema = z.strictObject({
  contract_version: z.literal(AGENT_CONTRACT_VERSION),
  session_id: ref,
  notes: z.array(experienceNoteSchema).max(MAX_EXPERIENCE_NOTES),
  decision: agentDecisionSchema,
});
export type ExperienceResponse = z.infer<typeof experienceResponseSchema>;
