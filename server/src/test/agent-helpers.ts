import {
  AGENT_CONTRACT_VERSION,
  type Presentation,
  type SessionState,
  type TurnRequest,
  type TurnResponse,
  type VocabularyEntry,
} from '@intento/shared';
import { FakeAgentClient } from '../agents/client.js';

/**
 * Een eenvoudige nep-agentdienst voor backendtests: vraagt de Vocabulary-items één voor één af
 * ("{Label}?"), stelt na een JA "Bedoel je: {Label}?" voor en is na een tweede JA klaar. Genoeg om de
 * backend een heel gesprek te laten voeren zonder Python.
 */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function option(entry: VocabularyEntry): Presentation['options'][number] {
  return {
    ref: entry.id,
    kind: 'symbol',
    vocabulary_item_id: entry.id,
    contact_id: null,
    label: entry.labels[0] ?? entry.id,
    concept: entry.concepts[0] ?? null,
    representation: 'exact',
    position: 0,
  };
}

function emptyState(request: TurnRequest): SessionState {
  return {
    session_id: request.session_id,
    phase: 'clarify',
    turn: request.turn,
    interaction_mode: 'binary',
    mode_since_turn: request.turn,
    current_intent: null,
    intent_hypotheses: [],
    questions_asked: [],
    answers: [],
    rejected_concepts: [],
    uncertainties: [],
    assumptions: [],
    proposal: null,
    communication_intent: null,
    share: { contacts_asked: [], sent_to: [] },
    last_presentation: null,
  };
}

export function simpleResponder(request: TurnRequest): TurnResponse {
  const state: SessionState = request.state
    ? { ...structuredClone(request.state), turn: request.turn }
    : emptyState(request);
  const asked = state.questions_asked.length;
  const current = request.vocabulary[Math.max(asked - 1, 0)];
  let presentation: Presentation;

  const ask = (index: number): Presentation => {
    const entry = request.vocabulary[index % request.vocabulary.length];
    if (!entry) throw new Error('lege Vocabulary');
    const label = entry.labels[0] ?? entry.id;
    state.phase = 'clarify';
    state.current_intent = { concept: entry.concepts[0] ?? entry.id, label, confidence: 0.3 };
    state.questions_asked.push({
      turn: request.turn,
      concept: entry.concepts[0],
      text: `${capitalize(label)}?`,
    });
    return {
      kind: 'question',
      mode: 'binary',
      text: `${capitalize(label)}?`,
      options: [option(entry)],
    };
  };

  if (request.event.type === 'start') {
    presentation = ask(0);
  } else if (request.event.type === 'answer_no') {
    state.answers.push({ turn: request.turn, answer: 'no', concepts: [], option_ref: null });
    presentation = ask(asked);
  } else if (state.phase === 'confirm_message' && current) {
    state.answers.push({ turn: request.turn, answer: 'yes', concepts: [], option_ref: null });
    state.phase = 'done';
    const message = capitalize(current.labels[0] ?? current.id);
    presentation = { kind: 'done', mode: 'binary', text: message, options: [], message };
  } else if (current) {
    state.answers.push({ turn: request.turn, answer: 'yes', concepts: [], option_ref: null });
    state.phase = 'confirm_message';
    const message = capitalize(current.labels[0] ?? current.id);
    presentation = {
      kind: 'confirm_message',
      mode: 'binary',
      text: `Bedoel je: ${message}?`,
      options: [option(current)],
      message,
    };
  } else {
    throw new Error('onverwachte gebeurtenis');
  }

  state.last_presentation = presentation;
  return {
    contract_version: AGENT_CONTRACT_VERSION,
    session_id: request.session_id,
    turn: request.turn,
    state,
    presentation,
    inferences: [
      {
        agent: 'intent-agent',
        kind: 'intent_hypotheses',
        payload: { concept: state.current_intent?.concept ?? null },
        confidence: 0.3,
      },
    ],
    decisions: [
      {
        agent: 'question-agent',
        status: 'success',
        model: null,
        prompt_version: 'rules-v1',
        latency_ms: 1,
        validation: 'skipped',
        reason: null,
      },
    ],
    gaps: [],
  };
}

export function fakeAgents(): FakeAgentClient {
  return new FakeAgentClient(simpleResponder);
}
