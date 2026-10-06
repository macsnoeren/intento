"""Scenario's: een gesimuleerde gebruiker speelt een heel gesprek (INTENTO-NEW-DESIGN §54).

De gesimuleerde gebruiker heeft een **doel**: een set concepten ("bedoelt dorst" = `{"drink"}`). Hij
zegt JA als het getoonde concept bij zijn doel hoort en NEE als dat niet zo is, en hij stopt als hem
gevraagd wordt of hij wil stoppen. Een scenario slaagt als het gesprek eindigt met een bevestigde
boodschap waarvan alle concepten bij het doel horen.

Het gesprek loopt via dezelfde `step()` als in de dienst; met de `FakeProvider` draaien de scenario's
in de gewone testsuite, met Ollama in `python -m agent_service.eval`.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..contracts import (
    CONTRACT_VERSION,
    AgentDecision,
    Presentation,
    SessionState,
    Settings,
    TurnRequest,
    TurnResponse,
    VocabularyEntry,
)

#: Eén beurt van de agentdienst: verzoek erin, antwoord eruit (in de dienst: `step`).
Engine = Callable[[TurnRequest], TurnResponse]


def _entry(
    item_id: str, label: str, concept: str, order: int, *, start: bool = False, contexts: list[str]
) -> VocabularyEntry:
    return VocabularyEntry(
        id=item_id,
        labels=[label],
        concepts=[concept],
        contexts=contexts,
        part_of_speech=None,
        is_start=start,
        sort_order=order,
    )


def scenario_vocabulary() -> list[VocabularyEntry]:
    """Een kleine Vocabulary als uit de startset: vijf startconcepten, een paar gewone woorden en
    "geen afbeelding"."""
    return [
        _entry("v-pain", "pijn", "pain", 1, start=True, contexts=["health"]),
        _entry("v-eat", "eten", "eat", 2, start=True, contexts=["food_drink"]),
        _entry("v-drink", "drinken", "drink", 3, start=True, contexts=["food_drink"]),
        _entry("v-toilet", "toilet", "toilet", 4, start=True, contexts=["care"]),
        _entry("v-tired", "moe", "tired", 5, start=True, contexts=["feeling"]),
        _entry("v-head", "hoofd", "head", 10, contexts=["body"]),
        _entry("v-belly", "buik", "belly", 11, contexts=["body"]),
        _entry("v-water", "water", "water", 12, contexts=["food_drink"]),
        _entry("v-sick", "ziek", "sick", 13, contexts=["health"]),
        # Zoals in de echte startset: het neutrale pictogram voor een woord zonder pictogram (§8).
        _entry("v-noimage", "geen afbeelding", "no_image", 9999, contexts=["other"]),
    ]


@dataclass(frozen=True)
class Scenario:
    name: str
    #: Wat de gebruiker bedoelt.
    goal: frozenset[str]
    vocabulary: list[VocabularyEntry] = field(default_factory=scenario_vocabulary)
    settings: dict[str, Any] = field(default_factory=dict)


#: De scenario's die met de regelgebaseerde agents al moeten slagen.
SCENARIOS: list[Scenario] = [
    Scenario(name="bedoelt pijn", goal=frozenset({"pain"})),
    Scenario(name="bedoelt dorst", goal=frozenset({"drink"})),
]


class SimulatedUser:
    """Antwoordt naar zijn doel: JA als het getoonde concept erbij hoort."""

    def __init__(self, goal: frozenset[str]) -> None:
        self.goal = goal

    def respond(self, presentation: Presentation, state: SessionState) -> dict[str, Any] | None:
        """De gebeurtenis bij dit scherm, of `None` als het gesprek voorbij is."""
        if presentation.kind in ("done", "stopped"):
            return None
        if presentation.kind == "ask_stop":
            return {"type": "answer_yes"}
        if presentation.kind == "confirm_message":
            concepts = set(state.proposal.concepts) if state.proposal else self._shown(presentation)
            yes = bool(concepts) and concepts <= self.goal
        else:
            yes = bool(self._shown(presentation) & self.goal)
        return {"type": "answer_yes" if yes else "answer_no"}

    @staticmethod
    def _shown(presentation: Presentation) -> set[str]:
        return {option.concept for option in presentation.options if option.concept}


@dataclass
class ScenarioResult:
    scenario: str
    success: bool
    #: Hoeveel vragen de gebruiker kreeg (zonder "Bedoel je …?").
    questions: int
    turns: int
    message: str | None
    duration_ms: int
    decisions: list[AgentDecision]
    #: Waarom een scenario niet slaagde (of `None`).
    failure: str | None = None


def _settings(overrides: dict[str, Any]) -> Settings:
    base: dict[str, Any] = {
        "interaction_mode": "binary",
        "options_per_screen": 4,
        "question_strategy": "general_to_specific",
        "max_questions": 15,
        "experience_enabled": True,
    }
    base.update(overrides)
    return Settings.model_validate(base)


def play(
    scenario: Scenario,
    engine: Engine,
    *,
    max_turns: int = 40,
    clock: Callable[[], float] = time.monotonic,
) -> ScenarioResult:
    """Speelt één scenario van start tot het einde (of tot `max_turns`)."""
    user = SimulatedUser(scenario.goal)
    settings = _settings(scenario.settings)
    started = clock()
    decisions: list[AgentDecision] = []
    state: SessionState | None = None
    event: dict[str, Any] | None = {"type": "start"}
    questions = 0
    turn = 0
    response: TurnResponse | None = None

    def result(success: bool, failure: str | None) -> ScenarioResult:
        message = (
            state.communication_intent.message if state and state.communication_intent else None
        )
        return ScenarioResult(
            scenario=scenario.name,
            success=success,
            questions=questions,
            turns=turn,
            message=message,
            duration_ms=round((clock() - started) * 1000),
            decisions=decisions,
            failure=failure,
        )

    while event is not None:
        if turn >= max_turns:
            return result(False, f"geen einde na {max_turns} beurten")
        request = TurnRequest.model_validate(
            {
                "contract_version": CONTRACT_VERSION,
                "session_id": f"scenario-{scenario.name}",
                "turn": turn,
                "event": event,
                "state": state,
                "settings": settings,
                "vocabulary": scenario.vocabulary,
                "contacts": [],
                "experience": None,
            }
        )
        response = engine(request)
        decisions.extend(response.decisions)
        state = response.state
        if response.presentation.kind == "question":
            questions += 1
        event = user.respond(response.presentation, state)
        turn += 1

    assert response is not None
    if response.presentation.kind != "done" or state is None or not state.communication_intent:
        return result(False, f"geëindigd met {response.presentation.kind}")
    confirmed = set(state.communication_intent.concepts)
    if not confirmed <= scenario.goal:
        return result(False, f"bevestigd: {sorted(confirmed)}, bedoeld: {sorted(scenario.goal)}")
    return result(True, None)
