"""De orchestrator: één zuivere functie per beurt (INTENTO-NEW-DESIGN §4).

`step(request) -> TurnResponse` krijgt de vorige Session State en de gebeurtenis, en geeft de nieuwe
toestand plus wat de tablet moet tonen. Geen I/O en geen toeval; de klok dient alleen om de duur per
agent te meten (`latency_ms`). De orchestrator is zelf geen LLM; hij bepaalt welke agent aan de beurt
is. Elke agent draait via `run_agent` (§34): een falende agent levert een terugval of `failed` op, nooit
een exceptie.

Fasen (§4.1) in deze versie: `clarify` → `confirm_message` → `share_ask` (alleen met een bevestigd
contact) → `done`, en `stopped`. `share_contact` en `confirm_send` volgen in N11.2 en N11.5; tot dan
eindigt ook JA op "Wil je dit sturen?" in `done`, zonder iets te versturen.
"""

from __future__ import annotations

import dataclasses
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any

from .agents.envelope import RULES_VERSION, AgentMeta, AgentResult, LlmAttempt, run_agent
from .agents.icon import (
    ICON_TIMEOUT_SECONDS,
    IconMatch,
    closest_match,
    exact_match,
    icon_prompt,
    no_image,
)
from .agents.intent import (
    INTENT_TIMEOUT_SECONDS,
    IntentResult,
    intent_prompt,
    llm_intent,
    rules_intent,
)
from .agents.question import (
    QUESTION_TIMEOUT_SECONDS,
    RULES_MULTI_TEXT,
    llm_multi_question,
    llm_question,
    multi_question_prompt,
    question_prompt,
)
from .agents.rules import Question, capitalize, rule_question
from .agents.safety import (
    SAFETY_TIMEOUT_SECONDS,
    SafetyFinding,
    llm_safety,
    s1_question_limit,
    s2_proposal_needs_answer,
    safety_prompt,
)
from .agents.strategies import instruction_for
from .agents.validation import (
    DEFAULT_PROPOSE_THRESHOLD,
    VALIDATION_TIMEOUT_SECONDS,
    Finding,
    llm_validate,
    v7_proposal,
    validate_question,
    validation_prompt,
)
from .contracts import (
    CONTRACT_VERSION,
    AgentDecision,
    Answer,
    AskedQuestion,
    Event,
    Gap,
    Hypothesis,
    Inference,
    Option,
    Presentation,
    Proposal,
    SelectOptionEvent,
    SessionState,
    Settings,
    ShareState,
    TurnRequest,
    TurnResponse,
)
from .llm import LlmProvider
from .vocabulary import VocabularyIndex

#: Tekst van de vraag die volgt als er niets meer te vragen valt.
ASK_STOP_TEXT = "Wil je stoppen?"
SHARE_ASK_TEXT = "Wil je dit sturen?"

#: Hoe lang één beurt mag duren (s). Moet ruim onder `AGENT_TIMEOUT_MS` van de backend (30 s) blijven.
DEFAULT_TURN_BUDGET_SECONDS = 25.0
#: Minder tijd over dan dit: geen modelaanroep meer, de regels nemen het over.
MIN_LLM_SECONDS = 1.0


class ProtocolError(ValueError):
    """De gebeurtenis past niet bij de toestand (bv. een antwoord zonder lopend gesprek)."""


class _Turn:
    """Verzamelt wat één beurt oplevert: inferences en agentbeslissingen."""

    def __init__(
        self,
        clock: Callable[[], float],
        llm: LlmProvider | None,
        settings: Settings,
        names: list[str],
        propose_threshold: float = DEFAULT_PROPOSE_THRESHOLD,
        llm_validation: bool = False,
        llm_safety: bool = False,
        turn_budget: float = DEFAULT_TURN_BUDGET_SECONDS,
    ) -> None:
        self.clock = clock
        #: Uiterlijk dan moet de beurt klaar zijn; daarna geen modelaanroepen meer (`budget`).
        self.deadline = clock() + turn_budget
        self.llm_validation = llm_validation
        self.llm_safety = llm_safety
        self.llm = llm
        self.settings = settings
        self.propose_threshold = propose_threshold
        #: Het laatste geslaagde resultaat van de Intent Agent in deze beurt (met een taalmodel).
        self.intent: IntentResult | None = None
        #: Namen van contacten: alleen om te controleren dat ze nooit in een vraag staan (V2).
        self.names = names
        self.inferences: list[Inference] = []
        self.decisions: list[AgentDecision] = []
        self.gaps: list[Gap] = []

    def record(self, result: AgentResult[Any]) -> None:
        self.decisions.append(result.to_decision())

    def budget(self, timeout: float) -> float | None:
        """Hoe lang een modelaanroep mag duren: de time-out van de agent, maar nooit langer dan wat er
        van de beurt over is. `None` als er geen model is of minder dan `MIN_LLM_SECONDS` over: dan
        nemen de regels het over, zodat de dienst altijd binnen de time-out van de backend antwoordt."""
        if self.llm is None:
            return None
        remaining = self.deadline - self.clock()
        return min(timeout, remaining) if remaining >= MIN_LLM_SECONDS else None


def new_state(request: TurnRequest) -> SessionState:
    return SessionState(
        session_id=request.session_id,
        phase="clarify",
        turn=request.turn,
        # De ingestelde vorm; "AI kiest" begint in Binary (§14).
        interaction_mode="multi" if request.settings.interaction_mode == "multi" else "binary",
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
    propose_threshold: float = DEFAULT_PROPOSE_THRESHOLD,
    llm_validation: bool = False,
    llm_safety: bool = False,
    turn_budget: float = DEFAULT_TURN_BUDGET_SECONDS,
) -> TurnResponse:
    """Verwerkt één beurt. Zonder `llm` draaien alle agents op hun regels; `llm_validation` en
    `llm_safety` zetten de LLM-delen van de Validation en Safety Agent aan (`AGENT_LLM_VALIDATION`,
    `AGENT_LLM_SAFETY`)."""
    vocabulary = VocabularyIndex(request.vocabulary)
    turn = _Turn(
        clock,
        llm,
        request.settings,
        [c.name for c in request.contacts],
        propose_threshold,
        llm_validation,
        llm_safety,
        turn_budget,
    )
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
        tiles = last.kind == "question" and last.mode == "multi"
        if event.type == "select_option" or event.type == "none_of_these":
            if not tiles:
                raise ProtocolError(
                    f"Gebeurtenis {event.type} past alleen bij een multi-icon vraag."
                )
            presentation = _answer_multi(state, event, vocabulary, turn)
        else:
            if tiles:
                raise ProtocolError("Een multi-icon vraag vraagt een keuze of 'Geen van deze'.")
            yes = event.type == "answer_yes"
            if last.kind == "ask_stop":
                presentation = _stop(state) if yes else _restart(state, vocabulary, turn)
            elif state.phase == "confirm_message":
                presentation = _confirm(state, yes, vocabulary, turn, bool(request.contacts))
            elif state.phase == "share_ask":
                presentation = _answer_share_ask(state, yes)
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
        gaps=turn.gaps,
    )


# --- clarify ----------------------------------------------------------------------------------------


def _update_hypotheses(
    state: SessionState, vocabulary: VocabularyIndex, turn: _Turn
) -> AgentResult[IntentResult]:
    """De Intent Agent werkt de hypotheses bij; ze staan in de state en gaan als inference mee."""
    attempt: LlmAttempt[IntentResult] | None = None
    timeout = turn.budget(INTENT_TIMEOUT_SECONDS)
    if turn.llm is not None and timeout is not None:
        provider, prompt = turn.llm, intent_prompt()
        attempt = LlmAttempt(
            run=lambda: llm_intent(
                provider,
                prompt,
                state,
                vocabulary,
                timeout,
                tiles=turn.settings.options_per_screen if state.interaction_mode == "multi" else 1,
            ),
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
    turn.intent = intent if result.status == "success" and turn.llm is not None else None
    hypotheses = intent.hypotheses
    state.intent_hypotheses = hypotheses
    state.current_intent = hypotheses[0] if hypotheses else None
    state.assumptions = intent.assumptions
    state.uncertainties = intent.uncertainties
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
                "uncertainties": intent.uncertainties,
                "needs_clarification": intent.needs_clarification,
            },
            confidence=hypotheses[0].confidence if hypotheses else None,
        )
    )
    return result


def _next_targets(state: SessionState, limit: int) -> list[Hypothesis]:
    """De eerste hypotheses waarover nog niets gevraagd of gekozen is (en die niet zijn afgewezen)."""
    done = {q.concept for q in state.questions_asked if q.concept}
    done |= {c for a in state.answers if a.answer in ("yes", "selected") for c in a.concepts}
    done |= set(state.rejected_concepts)
    return [h for h in state.intent_hypotheses if h.concept not in done][:limit]


def _next_target(state: SessionState) -> Hypothesis | None:
    """De eerste hypothese waarover nog geen vraag gesteld is (en die niet is afgewezen)."""
    targets = _next_targets(state, 1)
    return targets[0] if targets else None


def _confirmed(state: SessionState) -> Hypothesis | None:
    """De beste hypothese waarop de gebruiker al JA zei (en die niet later is afgewezen)."""
    yes = {c for a in state.answers if a.answer in ("yes", "selected") for c in a.concepts}
    rejected = set(state.rejected_concepts)
    return next(
        (h for h in state.intent_hypotheses if h.concept in yes and h.concept not in rejected),
        None,
    )


#: S1: zonder JA alleen een voorstel als de bovenste hypothese minstens zo zeker is (N6.16).
S1_MIN_CONFIDENCE = 0.5


def _likely(state: SessionState) -> Hypothesis | None:
    """De bovenste hypothese, maar alleen als die geen gok is."""
    top = state.current_intent
    return top if top is not None and top.confidence >= S1_MIN_CONFIDENCE else None


def _ask_next(
    state: SessionState, vocabulary: VocabularyIndex, turn: _Turn, *, refresh: bool = True
) -> Presentation:
    """Volgende vraag in `clarify`, over de eerste hypothese die nog niet gevraagd is.

    Is er niets meer te vragen: heeft de gebruiker al ergens JA op gezegd, dan dat voorstellen; anders
    "Wil je stoppen?".
    """
    state.phase = "clarify"
    if refresh:
        _update_hypotheses(state, vocabulary, turn)
    limit = s1_question_limit(state, turn.settings)
    if limit is not None:
        # S1: genoeg gevraagd. Voorleggen wat de gebruiker bevestigde, of de bovenste hypothese als die
        # zeker genoeg is — nooit een gok (N6.16). Anders, en na NEE daarop, "Wil je stoppen?".
        _safety(turn, limit)
        best = _confirmed(state) or _likely(state)
        return _propose(state, best, vocabulary, turn) if best else _ask_stop()
    ready = _ready_proposal(state, turn)
    if ready is not None:
        hypothesis, message = ready
        return _propose(
            state, hypothesis, vocabulary, turn, message=message, confidence=hypothesis.confidence
        )
    if state.interaction_mode == "multi":
        return _ask_multi(state, vocabulary, turn)
    target = _next_target(state)
    if target is None:
        confirmed = _confirmed(state)
        return _propose(state, confirmed, vocabulary, turn) if confirmed else _ask_stop()
    option = _pictogram(target.concept, target.label, vocabulary, turn)
    if option is None:
        # Zonder pictogram geen binary vraag (I4): dan liever "Wil je stoppen?" dan een leeg scherm.
        return _ask_stop()
    question = _validated_question(state, target, option, vocabulary, turn)
    if question is None:
        return _ask_stop()
    state.questions_asked.append(
        AskedQuestion(turn=state.turn, concept=question.concept, text=question.text)
    )
    return Presentation(kind="question", mode="binary", text=question.text, options=[option])


#: Hoe vaak de Question Agent een vraag mag maken voordat de terugval volgt (§4.2, stap 6).
MAX_QUESTION_ATTEMPTS = 2


def _validated_question(
    state: SessionState,
    target: Hypothesis,
    option: Option,
    vocabulary: VocabularyIndex,
    turn: _Turn,
) -> Question | None:
    """De Question Agent maakt de vraag; de Validation Agent keurt hem (V1 t/m V6).

    Afgekeurd → de Question Agent nog eens, met de reden erbij; na `MAX_QUESTION_ATTEMPTS` ongeldige
    vragen de regelgebaseerde vraag. Elke keuring komt als `validation-agent` in de beslissingen.
    """
    rejected_because: list[str] = []
    for _ in range(MAX_QUESTION_ATTEMPTS if turn.llm is not None else 1):
        result = _question_agent(state, target, vocabulary, turn, rejected_because)
        question = result.value
        if question is None:
            return None
        findings = _validate(state, question, option, vocabulary, turn)
        if not findings or result.status != "success":
            # Geldig, of al de regelgebaseerde vraag (beter wordt het niet).
            return question
        rejected_because = [f.reason for f in findings]
    ruled = run_agent(
        "question-agent",
        rules=lambda: rule_question(target),
        rules_reason=f"na {MAX_QUESTION_ATTEMPTS} afgekeurde vragen: {'; '.join(rejected_because)}",
        clock=turn.clock,
    )
    fallback = AgentResult(
        agent=ruled.agent,
        status="fallback",
        value=ruled.value,
        meta=ruled.meta,
        validation="invalid",
        reason=ruled.reason,
    )
    turn.record(fallback)
    return fallback.value


def _question_agent(
    state: SessionState,
    target: Hypothesis,
    vocabulary: VocabularyIndex,
    turn: _Turn,
    rejected_because: list[str],
) -> AgentResult[Question]:
    attempt: LlmAttempt[Question] | None = None
    timeout = turn.budget(QUESTION_TIMEOUT_SECONDS)
    if turn.llm is not None and timeout is not None:
        provider, prompt = turn.llm, question_prompt()
        attempt = LlmAttempt(
            run=lambda: llm_question(
                provider,
                prompt,
                target,
                state,
                vocabulary,
                strategy=instruction_for(turn.settings.question_strategy),
                rejected_because=rejected_because or None,
                timeout=timeout,
            ),
            model=provider.model,
            prompt_version=prompt.id,
        )
    result = run_agent(
        "question-agent",
        rules=lambda: rule_question(target),
        llm=attempt,
        rules_reason="één concept per vraag",
        clock=turn.clock,
    )
    turn.record(result)
    return result


def _validate(
    state: SessionState,
    question: Question,
    option: Option,
    vocabulary: VocabularyIndex,
    turn: _Turn,
) -> list[Finding]:
    """Keurt een binary vraag met het pictogram erbij."""
    presentation = Presentation(
        kind="question", mode="binary", text=question.text, options=[option]
    )
    return _validate_presentation(state, presentation, question.concept, vocabulary, turn)


def _validate_presentation(
    state: SessionState,
    presentation: Presentation,
    concept: str | None,
    vocabulary: VocabularyIndex,
    turn: _Turn,
) -> list[Finding]:
    """Keurt de vraag met de pictogrammen erbij; `clarify` (V5) is hier geen afkeuring."""
    question = Question(concept=concept or "", text=presentation.text)
    label = ", ".join(o.label for o in presentation.options)
    findings = [
        f
        for f in validate_question(
            concept=concept,
            text=presentation.text,
            presentation=presentation,
            gaps=turn.gaps,
            state=state,
            settings=turn.settings,
            vocabulary=vocabulary,
            names=turn.names,
        )
        if f.action == "reject"
    ]
    llm = turn.llm
    timeout = turn.budget(max(VALIDATION_TIMEOUT_SECONDS, SAFETY_TIMEOUT_SECONDS))
    if findings or llm is None or timeout is None or not (turn.llm_validation or turn.llm_safety):
        _record_validation(turn, findings, None)
        return findings

    # De LLM-delen van Validation (§9) en Safety (§10), alleen als de regels niets vonden. Ze draaien
    # tegelijk, zodat de wachttijd per beurt de langste van de twee is en niet de som (§10).
    def validation() -> AgentResult[list[Finding]]:
        prompt = validation_prompt()
        return run_agent(
            "validation-agent",
            rules=lambda: list[Finding](),
            llm=LlmAttempt(
                run=lambda: llm_validate(
                    llm,
                    prompt,
                    text=question.text,
                    concept=concept,
                    label=label,
                    state=state,
                    timeout=timeout,
                ),
                model=llm.model,
                prompt_version=prompt.id,
            ),
            rules_reason="alleen regels",
            clock=turn.clock,
        )

    def safety() -> AgentResult[list[SafetyFinding]]:
        prompt = safety_prompt()
        return run_agent(
            "safety-agent",
            rules=lambda: list[SafetyFinding](),
            llm=LlmAttempt(
                run=lambda: llm_safety(
                    llm,
                    prompt,
                    text=question.text,
                    concept=concept,
                    label=label,
                    state=state,
                    timeout=timeout,
                ),
                model=llm.model,
                prompt_version=prompt.id,
            ),
            rules_reason="alleen regels",
            clock=turn.clock,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        validating = pool.submit(validation) if turn.llm_validation else None
        guarding = pool.submit(safety) if turn.llm_safety else None
        validated = validating.result() if validating else None
        guarded = guarding.result() if guarding else None

    if validated is not None:
        findings = validated.value or []
        _record_validation(turn, findings, validated)
    else:
        _record_validation(turn, [], None)
    if guarded is not None:
        unsafe = guarded.value or []
        reason = "; ".join(f"{f.rule}: {f.reason}" for f in unsafe) or None
        if guarded.status != "success":
            reason = "; ".join(r for r in (reason, guarded.reason) if r)
        turn.record(
            dataclasses.replace(guarded, validation="invalid" if unsafe else "valid", reason=reason)
        )
        findings = [*findings, *(Finding("LLM", f.reason) for f in unsafe)]
    return findings


def _record_validation(
    turn: _Turn, findings: list[Finding], llm_result: AgentResult[list[Finding]] | None
) -> None:
    """Eén `validation-agent`-beslissing per keuring: valid of invalid, met de regels die faalden."""
    reason = "; ".join(f"{f.rule}: {f.reason}" for f in findings) or None
    if llm_result is not None and llm_result.status != "success":
        reason = "; ".join(r for r in (reason, llm_result.reason) if r)
    turn.record(
        AgentResult(
            agent="validation-agent",
            status=llm_result.status if llm_result else "success",
            value=findings,
            meta=llm_result.meta
            if llm_result
            else AgentMeta(model=None, prompt_version=RULES_VERSION, latency_ms=0),
            validation="invalid" if findings else "valid",
            reason=reason,
        )
    )


def _pictogram(concept: str, label: str, vocabulary: VocabularyIndex, turn: _Turn) -> Option | None:
    """De Icon Agent (§8): exact uit de Vocabulary, anders het dichtstbijzijnde pictogram (met het
    model) of "geen afbeelding" — bij een benadering altijd met een gap (§17, I5)."""
    exact = exact_match(concept, label, vocabulary)
    if exact is not None:
        result: AgentResult[IconMatch] = run_agent(
            "icon-agent",
            rules=lambda: exact,
            rules_reason=f"exact ({exact.matched_on})",
            clock=turn.clock,
        )
    else:
        attempt: LlmAttempt[IconMatch] | None = None
        timeout = turn.budget(ICON_TIMEOUT_SECONDS)
        if turn.llm is not None and timeout is not None:
            provider, prompt = turn.llm, icon_prompt()
            attempt = LlmAttempt(
                run=lambda: closest_match(provider, prompt, concept, label, vocabulary, timeout),
                model=provider.model,
                prompt_version=prompt.id,
            )
        result = run_agent(
            "icon-agent",
            rules=lambda: no_image(concept, label, vocabulary),
            llm=attempt,
            rules_reason="geen afbeelding",
            confidence=lambda match: match.confidence,
            clock=turn.clock,
        )
    turn.record(result)
    match = result.value
    if match is None:
        return None
    gap = match.gap()
    if gap is not None:
        turn.gaps.append(gap)
    return match.option()


def _asked(state: SessionState) -> Hypothesis:
    """Het concept van de vraag die open staat, met het woord dat erbij getoond werd."""
    last = state.last_presentation
    question = state.questions_asked[-1] if state.questions_asked else None
    if question is None or question.concept is None or last is None or not last.options:
        raise ProtocolError("Er staat geen vraag over een concept open.")
    known = next((h for h in state.intent_hypotheses if h.concept == question.concept), None)
    return Hypothesis(
        concept=question.concept,
        label=last.options[0].label,
        confidence=known.confidence if known else 0.5,
    )


def _answer_question(
    state: SessionState, yes: bool, vocabulary: VocabularyIndex, turn: _Turn
) -> Presentation:
    asked = _asked(state)
    state.answers.append(
        Answer(
            turn=state.turn,
            answer="yes" if yes else "no",
            concepts=[asked.concept],
            option_ref=_first_option_ref(state),
        )
    )
    if not yes:
        state.rejected_concepts.append(asked.concept)
        return _ask_next(state, vocabulary, turn)
    if turn.llm is None:
        # De regels kunnen niet verfijnen: een JA is meteen het voorstel.
        return _propose(state, asked, vocabulary, turn)
    # Met een taalmodel weegt de Intent Agent het JA mee (§36): is er nog iets open, dan volgt een
    # vraag die het preciezer maakt; anders het voorstel.
    result = _update_hypotheses(state, vocabulary, turn)
    if result.status != "success" or result.value is None:
        return _propose(state, asked, vocabulary, turn)
    # Voorstellen als de Intent Agent zeker genoeg is (`_ready_proposal`), anders verder vragen; is er
    # niets meer te vragen, dan wat de gebruiker bevestigde.
    return _ask_next(state, vocabulary, turn, refresh=False)


def _ready_proposal(state: SessionState, turn: _Turn) -> tuple[Hypothesis, str] | None:
    """Is de Intent Agent zeker genoeg voor "Bedoel je …?" (§6, §31)?

    Ja als de bovenste hypothese een confidence ≥ de voorsteldrempel heeft, de gebruiker minstens één
    keer antwoordde en de zin door V7 komt. De zin is die van de Intent Agent, of anders het woord.
    """
    intent = turn.intent
    top = state.current_intent
    if intent is None or top is None:
        return None
    for message in (intent.message, f"{capitalize(top.label)}."):
        if (
            message
            and v7_proposal(message, top.confidence, state, turn.propose_threshold, turn.names)
            is None
        ):
            return top, message.strip()
    return None


def _first_option_ref(state: SessionState) -> str | None:
    last = state.last_presentation
    return last.options[0].ref if last and last.options else None


# --- confirm_message --------------------------------------------------------------------------------


def _propose(
    state: SessionState,
    intent: Hypothesis,
    vocabulary: VocabularyIndex,
    turn: _Turn,
    *,
    message: str | None = None,
    confidence: float = 0.9,
) -> Presentation:
    """JA op een concept → "Bedoel je: {Label}?" (§31). De zin is nog een inference."""
    no_answer = s2_proposal_needs_answer(state)
    if no_answer is not None:
        # S2: de AI neemt het gesprek niet over.
        _safety(turn, no_answer)
        return _ask_stop()
    message = message or capitalize(intent.label)
    state.phase = "confirm_message"
    state.proposal = Proposal(message=message, concepts=[intent.concept], confidence=confidence)
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
            confidence=confidence,
        )
    )
    option = _proposal_pictogram(state, intent, vocabulary, turn)
    return Presentation(
        kind="confirm_message",
        mode="binary",
        text=proposal_text(message),
        options=[option],
        message=message,
    )


def _confirm(
    state: SessionState,
    yes: bool,
    vocabulary: VocabularyIndex,
    turn: _Turn,
    has_contacts: bool = False,
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
        state.communication_intent = proposal
        state.proposal = None
        if has_contacts:
            # Met minstens één bevestigd contact: "Wil je dit sturen?" (§31). Zonder: klaar.
            state.phase = "share_ask"
            return Presentation(
                kind="share_ask",
                mode="binary",
                text=SHARE_ASK_TEXT,
                options=[],
                message=proposal.message,
            )
        return _done(state)
    # NEE op het voorstel: die hypothese telt als afgewezen, terug naar clarify.
    state.rejected_concepts.extend(c for c in proposal.concepts if c not in state.rejected_concepts)
    state.proposal = None
    limit = s1_question_limit(state, turn.settings)
    if limit is not None:
        # S1: na het maximum en een NEE op het voorstel niet verder vragen.
        _safety(turn, limit)
        return _ask_stop()
    return _ask_next(state, vocabulary, turn)


def _done(state: SessionState) -> Presentation:
    """Klaar: de bevestigde boodschap groot in beeld (§48)."""
    intent = state.communication_intent
    if intent is None:
        raise ProtocolError("Klaar zonder bevestigde boodschap.")
    state.phase = "done"
    return Presentation(
        kind="done", mode="binary", text=intent.message, options=[], message=intent.message
    )


# --- delen (§31) ------------------------------------------------------------------------------------


def _answer_share_ask(state: SessionState, yes: bool) -> Presentation:
    """Antwoord op "Wil je dit sturen?". NEE → klaar, er wordt niets verstuurd. JA → de contactvraag
    (N11.2); tot die er is ook klaar, zonder te versturen."""
    state.answers.append(
        Answer(turn=state.turn, answer="yes" if yes else "no", concepts=[], option_ref=None)
    )
    return _done(state)


def proposal_text(message: str) -> str:
    """ "Bedoel je: {boodschap}?" — een punt of uitroepteken aan het eind valt weg. Precies zoals de
    backend het controleert (I2)."""
    return f"Bedoel je: {re.sub(r'[.!?]+$', '', message.strip())}?"


def _safety(turn: _Turn, finding: SafetyFinding) -> None:
    """Legt vast dat een veiligheidsregel ingreep."""
    turn.record(
        AgentResult(
            agent="safety-agent",
            status="success",
            value=finding,
            meta=AgentMeta(model=None, prompt_version=RULES_VERSION, latency_ms=0),
            validation="valid",
            reason=f"{finding.rule}: {finding.reason}",
        )
    )


def _proposal_pictogram(
    state: SessionState, intent: Hypothesis, vocabulary: VocabularyIndex, turn: _Turn
) -> Option:
    """Het pictogram bij "Bedoel je …?": hetzelfde als bij de vraag over dit concept, zodat de
    gebruiker het herkent; een benadering houdt zijn gap (I5)."""
    last = state.last_presentation
    shown = next((o for o in (last.options if last else []) if o.concept == intent.concept), None)
    if shown is None:
        # Niet eerder getoond: de Icon Agent kiest (exact, dichtstbij of "geen afbeelding", met gap).
        picked = _pictogram(intent.concept, intent.label, vocabulary, turn)
        return picked or no_image(intent.concept, intent.label, vocabulary).option()
    option = shown.model_copy(update={"position": 0})
    if option.representation == "stand_in" and option.vocabulary_item_id and option.concept:
        entry = vocabulary.get(option.vocabulary_item_id)
        turn.gaps.append(
            Gap(
                type="vocabulary_gap",
                concept=option.concept,
                label=option.label,
                context=entry.contexts[0] if entry and entry.contexts else None,
                best_available_item_id=option.vocabulary_item_id,
                confidence=0.0,
            )
        )
    return option


# --- stoppen ----------------------------------------------------------------------------------------


def _ask_stop() -> Presentation:
    return Presentation(kind="ask_stop", mode="binary", text=ASK_STOP_TEXT, options=[])


def _stop(state: SessionState) -> Presentation:
    state.phase = "stopped"
    return Presentation(kind="stopped", mode="binary", text="Gestopt.", options=[])


def _restart(state: SessionState, vocabulary: VocabularyIndex, turn: _Turn) -> Presentation:
    """NEE op "Wil je stoppen?": opnieuw beginnen bij de startconcepten."""
    state.rejected_concepts = []
    # Opnieuw beginnen: ook de gestelde vragen tellen niet meer mee (de provenance bewaart ze).
    state.questions_asked = []
    return _ask_next(state, vocabulary, turn)


# --- multi-icon (§13) -------------------------------------------------------------------------------


def _ask_multi(state: SessionState, vocabulary: VocabularyIndex, turn: _Turn) -> Presentation:
    """Een onderwerpvraag met 2 tot `options_per_screen` verschillende tegels.

    Te weinig om uit te kiezen: voorstellen wat de gebruiker koos, anders "Wil je stoppen?".
    """
    targets = _next_targets(state, turn.settings.options_per_screen)
    options: list[Option] = []
    shown: set[tuple[str | None, str]] = set()
    chosen: list[Hypothesis] = []
    for target in targets:
        option = _pictogram(target.concept, target.label, vocabulary, turn)
        key = (option.vocabulary_item_id, option.label.lower()) if option else None
        if option is None or key is None or key in shown:
            continue
        shown.add(key)
        chosen.append(target)
        options.append(option.model_copy(update={"position": len(options)}))
    if len(options) < 2:
        confirmed = _confirmed(state)
        return _propose(state, confirmed, vocabulary, turn) if confirmed else _ask_stop()
    text = _validated_multi_question(state, chosen, options, vocabulary, turn)
    state.questions_asked.append(AskedQuestion(turn=state.turn, concept=None, text=text))
    return Presentation(kind="question", mode="multi", text=text, options=options)


def _validated_multi_question(
    state: SessionState,
    targets: list[Hypothesis],
    options: list[Option],
    vocabulary: VocabularyIndex,
    turn: _Turn,
) -> str:
    """De vraag boven de tegels, gekeurd zoals een binary vraag (V1 t/m V6); anders de terugval."""
    rejected_because: list[str] = []
    for _ in range(MAX_QUESTION_ATTEMPTS if turn.llm is not None else 1):
        attempt: LlmAttempt[str] | None = None
        timeout = turn.budget(QUESTION_TIMEOUT_SECONDS)
        if turn.llm is not None and timeout is not None:
            prompt = multi_question_prompt()
            attempt = LlmAttempt(
                run=partial(
                    llm_multi_question,
                    turn.llm,
                    prompt,
                    targets,
                    state,
                    vocabulary,
                    strategy=instruction_for(turn.settings.question_strategy),
                    rejected_because=list(rejected_because) or None,
                    timeout=timeout,
                ),
                model=turn.llm.model,
                prompt_version=prompt.id,
            )
        result = run_agent(
            "question-agent",
            rules=lambda: RULES_MULTI_TEXT,
            llm=attempt,
            rules_reason="onderwerpvraag",
            clock=turn.clock,
        )
        turn.record(result)
        text = result.value or RULES_MULTI_TEXT
        presentation = Presentation(kind="question", mode="multi", text=text, options=options)
        findings = _validate_presentation(state, presentation, None, vocabulary, turn)
        if not findings or result.status != "success":
            return text
        rejected_because = [f.reason for f in findings]
    turn.record(
        AgentResult(
            agent="question-agent",
            status="fallback",
            value=RULES_MULTI_TEXT,
            meta=AgentMeta(model=None, prompt_version=RULES_VERSION, latency_ms=0),
            validation="invalid",
            reason=f"na {MAX_QUESTION_ATTEMPTS} afgekeurde vragen: {'; '.join(rejected_because)}",
        )
    )
    return RULES_MULTI_TEXT


def _answer_multi(
    state: SessionState, event: Event, vocabulary: VocabularyIndex, turn: _Turn
) -> Presentation:
    """Een tegel gekozen (telt als JA op dat concept) of "Geen van deze" (alle getoonde afgewezen)."""
    last = state.last_presentation
    assert last is not None
    if isinstance(event, SelectOptionEvent):
        chosen = next((o for o in last.options if o.ref == event.option_ref), None)
        if chosen is None or chosen.concept is None:
            raise ProtocolError("Die keuze stond niet op het scherm.")
        state.answers.append(
            Answer(
                turn=state.turn, answer="selected", concepts=[chosen.concept], option_ref=chosen.ref
            )
        )
        known = next((h for h in state.intent_hypotheses if h.concept == chosen.concept), None)
        picked = Hypothesis(
            concept=chosen.concept,
            label=chosen.label,
            confidence=known.confidence if known else 0.5,
        )
        if turn.llm is None:
            # De regels kunnen niet verfijnen: een keuze is meteen het voorstel.
            return _propose(state, picked, vocabulary, turn)
        result = _update_hypotheses(state, vocabulary, turn)
        if result.status != "success":
            return _propose(state, picked, vocabulary, turn)
        return _ask_next(state, vocabulary, turn, refresh=False)

    shown = [o.concept for o in last.options if o.concept]
    state.answers.append(Answer(turn=state.turn, answer="none_of_these", concepts=shown))
    state.rejected_concepts.extend(c for c in shown if c not in state.rejected_concepts)
    return _ask_next(state, vocabulary, turn)
