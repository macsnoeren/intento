"""Interaction Strategy bij "AI kiest": met welke vorm beginnen en wanneer wisselen (INTENTO-NEW-DESIGN
§11, §14, I7).

Regels, geen LLM. Een expliciet ingestelde vorm (`binary` of `multi`) wisselt **nooit**; alleen bij de
instelling `ai` kiest Intento zelf:

| Van → naar | Wanneer |
|---|---|
| Start | De vorm die het vaakst tot een bevestigde boodschap leidde (Experience); anders Binary. |
| Multi-icon → Binary | In de laatste 3 beurten minstens 2 keer ↩ Terug of "Geen van deze". |
| Binary → Multi-icon | 4 keer achter elkaar NEE. |

Nooit binnen 3 beurten in de huidige vorm: de gebruiker krijgt tijd om te wennen. Een "beurt" is hier een
handeling die de backend vastlegde (`TurnRequest.recent`): een antwoord op een vraag, of ↩ Terug — dat
ziet de agentdienst zelf nooit. De backend bewaakt dezelfde grens opnieuw (I7). Elke keuze en elke wissel
krijgt een reden, die als inference `mode_change` in de provenance komt.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from ..contracts import ExperienceSummary, InteractionMode, RecentEvent, SessionState, Settings

#: Zoveel beurten in de huidige vorm voordat er gewisseld mag worden (§14, I7).
MIN_TURNS_IN_MODE = 3
#: Multi-icon → Binary: zoveel keer Terug of "Geen van deze" in de laatste 3 beurten.
MULTI_TROUBLE = 2
#: Binary → Multi-icon: zoveel keer NEE achter elkaar.
BINARY_NO_RUN = 4


@dataclass(frozen=True)
class ModeChoice:
    mode: InteractionMode
    reason: str


def start_mode(settings: Settings, experience: ExperienceSummary | None) -> ModeChoice:
    """De vorm waarmee een gesprek begint."""
    if settings.interaction_mode != "ai":
        return ModeChoice(settings.interaction_mode, "ingesteld door de beheerder")
    chosen = (
        {count.ref: count.chosen for count in experience.modes}
        if experience is not None and settings.experience_enabled
        else {}
    )
    multi, binary = chosen.get("multi", 0), chosen.get("binary", 0)
    if multi > binary:
        return ModeChoice(
            "multi",
            f"meerdere pictogrammen leidde vaker tot een bericht ({multi} tegen {binary} keer)",
        )
    if binary > 0:
        return ModeChoice(
            "binary", f"ja/nee leidde het vaakst tot een bericht ({binary} tegen {multi} keer)"
        )
    return ModeChoice("binary", "nog geen ervaring: beginnen met ja/nee")


def _in_mode(state: SessionState, recent: Sequence[RecentEvent]) -> list[RecentEvent]:
    """De beurten sinds de laatste wissel: antwoorden op een vraag, en ↩ Terug op elk scherm."""
    return [
        event
        for event in recent
        if event.turn >= state.mode_since_turn
        and (event.screen == "question" or event.event == "back")
    ]


def next_mode(
    settings: Settings,
    state: SessionState,
    recent: Sequence[RecentEvent],
    *,
    tiles_available: int,
) -> ModeChoice | None:
    """Een wissel, of `None` als de vorm blijft. `tiles_available`: hoeveel verschillende opties er nu
    als tegels getoond kunnen worden — met minder dan 2 heeft multi-icon geen zin."""
    if settings.interaction_mode != "ai":
        return None
    events = _in_mode(state, recent)
    if len(events) < MIN_TURNS_IN_MODE:
        return None
    if state.interaction_mode == "multi":
        last = events[-MIN_TURNS_IN_MODE:]
        trouble = sum(1 for e in last if e.event in ("back", "none_of_these"))
        if trouble >= MULTI_TROUBLE:
            return ModeChoice(
                "binary",
                f'in de laatste {len(last)} beurten {trouble} keer terug of "Geen van deze"',
            )
        return None
    last = events[-BINARY_NO_RUN:]
    if (
        len(last) == BINARY_NO_RUN
        and all(e.event == "answer_no" for e in last)
        and tiles_available >= 2
    ):
        return ModeChoice("multi", f"{BINARY_NO_RUN} keer achter elkaar nee")
    return None
