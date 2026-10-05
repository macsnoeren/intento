"""Bouwstenen voor tests: een kleine Vocabulary, instellingen en verzoeken."""

from __future__ import annotations

from typing import Any

from agent_service.contracts import (
    CONTRACT_VERSION,
    ContactEntry,
    SessionState,
    Settings,
    TurnRequest,
    TurnResponse,
    VocabularyEntry,
)


def item(
    item_id: str,
    label: str,
    concept: str,
    *,
    start: bool = False,
    order: int = 0,
    contexts: list[str] | None = None,
    labels: list[str] | None = None,
) -> VocabularyEntry:
    return VocabularyEntry(
        id=item_id,
        labels=labels or [label],
        concepts=[concept],
        contexts=contexts or [],
        part_of_speech=None,
        is_start=start,
        sort_order=order,
    )


def vocabulary() -> list[VocabularyEntry]:
    """Startconcepten pijn, eten, drinken (in die volgorde) plus een paar gewone woorden."""
    return [
        item("v-pain", "pijn", "pain", start=True, order=1, contexts=["health"]),
        item("v-eat", "eten", "eat", start=True, order=2, contexts=["food_drink"]),
        item("v-drink", "drinken", "drink", start=True, order=3, contexts=["food_drink"]),
        item("v-head", "hoofd", "head", order=10, contexts=["body"]),
        item("v-belly", "buik", "belly", order=11, contexts=["body"]),
        item("v-sick", "ziek", "sick", order=12, contexts=["health"], labels=["ziek", "misselijk"]),
        item("v-water", "water", "water", order=13, contexts=["food_drink"]),
        item("v-noimage", "geen afbeelding", "no_image", order=99),
    ]


def settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "interaction_mode": "binary",
        "options_per_screen": 4,
        "question_strategy": "general_to_specific",
        "max_questions": 15,
        "experience_enabled": True,
    }
    base.update(overrides)
    return Settings.model_validate(base)


def request(
    event: dict[str, Any],
    state: SessionState | None = None,
    *,
    turn: int | None = None,
    vocab: list[VocabularyEntry] | None = None,
    contacts: list[ContactEntry] | None = None,
    **setting_overrides: Any,
) -> TurnRequest:
    return TurnRequest.model_validate(
        {
            "contract_version": CONTRACT_VERSION,
            "session_id": "s-1",
            "turn": turn if turn is not None else (0 if state is None else state.turn + 1),
            "event": event,
            "state": state,
            "settings": settings(**setting_overrides),
            "vocabulary": vocab or vocabulary(),
            "contacts": contacts or [],
            "experience": None,
        }
    )


START: dict[str, Any] = {"type": "start"}
YES: dict[str, Any] = {"type": "answer_yes"}
NO: dict[str, Any] = {"type": "answer_no"}


def answer(response: TurnResponse, event: dict[str, Any], **kwargs: Any) -> TurnRequest:
    """Het volgende verzoek na `response`, met `event` als antwoord."""
    return request(event, response.state, **kwargs)
