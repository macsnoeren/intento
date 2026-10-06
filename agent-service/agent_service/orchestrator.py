"""De orchestrator: één zuivere functie per beurt (INTENTO-NEW-DESIGN §4).

`step(request) -> TurnResponse` krijgt de vorige Session State en de gebeurtenis, en geeft de nieuwe
toestand plus wat de tablet moet tonen. Geen I/O en geen toeval; de klok dient alleen om de duur per
agent te meten (`latency_ms`). De orchestrator is zelf geen LLM; hij bepaalt welke agent aan de beurt
is. Elke agent draait via `run_agent` (§34): een falende agent levert een terugval of `failed` op, nooit
een exceptie.

Fasen (§4.1) in deze versie: `clarify` → `confirm_message` → `done`, en `stopped`. De deelfasen
(`share_ask`, `share_contact`, `confirm_send`) komen in fase N11.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from .agents.envelope import AgentResult, LlmAttempt, run_agent
from .agents.intent import IntentResult, intent_prompt, llm_intent, rules_intent
from .agents.rules import capitalize, rule_icon, rule_question
from .contracts import (
    CONTRACT_VERSION,
    AgentDecision,
    Answer,
    AskedQuestion,
    Hypothesis,
    Inference,
    Presentation,
    Proposal,
    SessionState,
    ShareState,
    TurnRequest,
    TurnResponse,
)
from .llm import LlmProvider
from .vocabulary import VocabularyIndex

#: Tekst van de vraag die volgt als er niets meer te vragen valt.
ASK_STOP_TEXT = "Wil je stoppen?"


class ProtocolError(ValueError):
    """De gebeurtenis past niet bij de toestand (bv. een antwoord zonder lopend gesprek)."""


class _Turn:
    """Verzamelt wat één beurt oplevert: inferences en agentbeslissingen."""

    def __init__(self, clock: Callable[[], float], llm: LlmProvider | None) -> None:
        self.clock = clock
        self.llm = llm
        self.inferences: list[Inference] = []
        self.decisions: list[AgentDecision] = []

    def record(self, result: AgentResult[Any]) -> None:
        self.decisions.append(result.to_decision())


def new_state(request: TurnRequest) -> SessionState:
    return SessionState(
        session_id=request.session_id,
        phase="clarify",
        turn=request.turn,
        interaction_mode="binary",
        mode_since_turn=request.turn,
        current_intent=None,
        intent_hypotheses=[],
        questions_asked=[],
        answers=[],
        rejected_concepts=[],
        uncertainties=[],
        assumptions=[],
        proposal=None,
        communication_intent=None,
        share=ShareState(contacts_asked=[], selected_contact=None, sent_to=[]),
        last_presentation=None,
    )


def step(
    request: TurnRequest,
    llm: LlmProvider | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> TurnResponse:
    """Verwerkt één beurt. Zonder `llm` draaien alle agents op hun regels."""
    vocabulary = VocabularyIndex(request.vocabulary)
    turn = _Turn(clock, llm)
    event = request.event

    if event.type == "start":
        state = new_state(request)
        presentation = _ask_next(state, vocabulary, turn)
    else:
        if request.state is None:
            raise ProtocolError("Een antwoord zonder lopend gesprek.")
        state = request.state.model_copy(deep=True)
        state.turn = request.turn
        last = state.last_presentation
        if last is None:
            raise ProtocolError("Er staat geen vraag open.")
        if state.phase in ("done", "stopped"):
            raise ProtocolError(f"Het gesprek is al afgelopen ({state.phase}).")
        if event.type not in ("answer_yes", "answer_no"):
            # Multi-icon komt in N7; tot dan is elke vraag binary.
            raise ProtocolError(f"Gebeurtenis {event.type} past niet bij een binary vraag.")
        yes = event.type == "answer_yes"

        if last.kind == "ask_stop":
            presentation = _stop(state) if yes else _restart(state, vocabulary, turn)
        elif state.phase == "confirm_message":
            presentation = _confirm(state, yes, vocabulary, turn)
        else:
            presentation = _answer_question(state, yes, vocabulary, turn)

    state.last_presentation = presentation
    return TurnResponse(
        contract_version=CONTRACT_VERSION,
        session_id=request.session_id,
        turn=request.turn,
        state=state,
        presentation=presentation,
        inferences=turn.inferences,
        decisions=turn.decisions,
        gaps=[],
    )


# --- clarify ----------------------------------------------------------------------------------------


def _update_hypotheses(state: SessionState, vocabulary: VocabularyIndex, turn: _Turn) -> None:
    attempt: LlmAttempt[IntentResult] | None = None
    if turn.llm is not None:
        provider, prompt = turn.llm, intent_prompt()
        attempt = LlmAttempt(
            run=lambda: llm_intent(provider, prompt, state, vocabulary),
            model=provider.model,
            prompt_version=prompt.id,
        )
    result = run_agent(
        "intent-agent",
        rules=lambda: rules_intent(state, vocabulary),
        llm=attempt,
        rules_reason="startconcepten in vaste volgorde",
        confidence=lambda r: r.hypotheses[0].confidence if r.hypotheses else None,
        clock=turn.clock,
    )
    turn.record(result)
    intent = result.value or IntentResult(hypotheses=[])
    hypotheses = intent.hypotheses
    state.intent_hypotheses = hypotheses
    state.current_intent = hypotheses[0] if hypotheses else None
    state.assumptions = intent.assumptions
    turn.inferences.append(
        Inference(
            agent="intent-agent",
            kind="intent_hypotheses",
            payload={
                "hypotheses": [
                    {"concept": h.concept, "label": h.label, "confidence": h.confidence}
                    for h in hypotheses
                ],
                "assumptions": intent.assumptions,
                "needs_clarification": intent.needs_clarification,
            },
            confidence=hypotheses[0].confidence if hypotheses else None,
        )
    )


def _ask_next(state: SessionState, vocabulary: VocabularyIndex, turn: _Turn) -> Presentation:
    """Volgende vraag in `clarify`; zijn de concepten op, dan "Wil je stoppen?"."""
    state.phase = "clarify"
    _update_hypotheses(state, vocabulary, turn)
    if state.current_intent is None:
        return _ask_stop()
    intent = state.current_intent
    question_result = run_agent(
        "question-agent",
        rules=lambda: rule_question(intent),
        rules_reason="één concept per vraag",
        clock=turn.clock,
    )
    turn.record(question_result)
    question = question_result.value
    if question is None:
        return _ask_stop()
    icon_result = run_agent(
        "icon-agent",
        rules=lambda: rule_icon(question.concept, intent.label, vocabulary),
        rules_reason="exact",
        clock=turn.clock,
    )
    turn.record(icon_result)
    option = icon_result.value
    if option is None:
        # Zonder pictogram geen binary vraag (I4): dan liever "Wil je stoppen?" dan een leeg scherm.
        return _ask_stop()
    state.questions_asked.append(
        AskedQuestion(turn=state.turn, concept=question.concept, text=question.text)
    )
    return Presentation(kind="question", mode="binary", text=question.text, options=[option])


def _answer_question(
    state: SessionState, yes: bool, vocabulary: VocabularyIndex, turn: _Turn
) -> Presentation:
    intent = state.current_intent
    if intent is None:
        raise ProtocolError("Er staat geen vraag over een concept open.")
    state.answers.append(
        Answer(
            turn=state.turn,
            answer="yes" if yes else "no",
            concepts=[intent.concept],
            option_ref=_first_option_ref(state),
        )
    )
    if not yes:
        state.rejected_concepts.append(intent.concept)
        return _ask_next(state, vocabulary, turn)
    return _propose(state, intent, vocabulary, turn)


def _first_option_ref(state: SessionState) -> str | None:
    last = state.last_presentation
    return last.options[0].ref if last and last.options else None


# --- confirm_message --------------------------------------------------------------------------------


def _propose(
    state: SessionState, intent: Hypothesis, vocabulary: VocabularyIndex, turn: _Turn
) -> Presentation:
    """JA op een concept → "Bedoel je: {Label}?" (§31). De zin is nog een inference."""
    message = capitalize(intent.label)
    state.phase = "confirm_message"
    state.proposal = Proposal(message=message, concepts=[intent.concept], confidence=0.9)
    turn.record(
        run_agent(
            "intent-agent", rules=lambda: message, rules_reason="voorstel na JA", clock=turn.clock
        )
    )
    turn.inferences.append(
        Inference(
            agent="intent-agent",
            kind="proposal",
            payload={"message": message, "concepts": [intent.concept]},
            confidence=0.9,
        )
    )
    option = rule_icon(intent.concept, intent.label, vocabulary)
    return Presentation(
        kind="confirm_message",
        mode="binary",
        text=f"Bedoel je: {message}?",
        options=[option],
        message=message,
    )


def _confirm(
    state: SessionState, yes: bool, vocabulary: VocabularyIndex, turn: _Turn
) -> Presentation:
    proposal = state.proposal
    if proposal is None:
        raise ProtocolError("Er staat geen voorstel open.")
    state.answers.append(
        Answer(
            turn=state.turn,
            answer="yes" if yes else "no",
            concepts=list(proposal.concepts),
            option_ref=_first_option_ref(state),
        )
    )
    if yes:
        # De backend legt de bevestigde boodschap vast (I2); dit is alleen de toestand van het gesprek.
        state.phase = "done"
        state.communication_intent = proposal
        state.proposal = None
        return Presentation(
            kind="done",
            mode="binary",
            text=proposal.message,
            options=[],
            message=proposal.message,
        )
    # NEE op het voorstel: die hypothese telt als afgewezen, terug naar clarify.
    state.rejected_concepts.extend(c for c in proposal.concepts if c not in state.rejected_concepts)
    state.proposal = None
    return _ask_next(state, vocabulary, turn)


# --- stoppen ----------------------------------------------------------------------------------------


def _ask_stop() -> Presentation:
    return Presentation(kind="ask_stop", mode="binary", text=ASK_STOP_TEXT, options=[])


def _stop(state: SessionState) -> Presentation:
    state.phase = "stopped"
    return Presentation(kind="stopped", mode="binary", text="Gestopt.", options=[])


def _restart(state: SessionState, vocabulary: VocabularyIndex, turn: _Turn) -> Presentation:
    """NEE op "Wil je stoppen?": opnieuw beginnen bij de startconcepten."""
    state.rejected_concepts = []
    return _ask_next(state, vocabulary, turn)
