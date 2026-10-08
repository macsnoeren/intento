"""Experience Agent: observaties over een afgerond gesprek (INTENTO-NEW-DESIGN §21 laag 2, N12.4).

De backend roept hem na afloop aan (`POST /v1/experience`); de gebruiker wacht er nooit op. Hij krijgt
de schermen van het gesprek (Presented) met wat de gebruiker deed (Observed) — zonder contacten: schermen
met namen stuurt de backend niet mee, en het contract kent er geen veld voor (V6).

Wat hij noteert, is een **observatie, geen waarheid** (§21, §36): de backend bewaart het als inference
en toont het de beheerder zo. In de MVP stuurt het niets bij.

Met een taalmodel kijkt het model terug; zonder (of als dat mislukt) noteren de regels een paar feiten
over het verloop. Nooit een exceptie naar buiten: hooguit een lege lijst.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..contracts import (
    CONTRACT_VERSION,
    MAX_EXPERIENCE_NOTES,
    ExperienceNote,
    ExperienceRequest,
    ExperienceResponse,
    ExperienceScreen,
)
from ..llm import LlmProvider
from ..prompts import Prompt, load_prompt
from .envelope import LlmAttempt, run_agent

AGENT = "experience-agent"
#: Ruim, want niemand wacht hierop, maar binnen de time-out van de backend (`AGENT_TIMEOUT_MS`, 30 s):
#: ook als het model niet antwoordt, komen de regels nog op tijd terug.
EXPERIENCE_TIMEOUT_SECONDS = 20.0
#: Het model noteert er hooguit zoveel (de prompt vraagt er hooguit 3; het contract staat 5 toe).
MAX_LLM_NOTES = 3

_URL = re.compile(r"https?://|www\.", re.IGNORECASE)

_ANSWER_WORDS = {
    "yes": "ja",
    "no": "nee",
    "selected": "gekozen",
    "none_of_these": "geen van deze",
    "back": "terug",
    "stop": "stoppen",
}


class _NoteOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    about: Literal["mode", "question", "symbol", "flow"]
    text: Annotated[str, Field(min_length=10, max_length=160)]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class ExperienceOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: Annotated[list[_NoteOutput], Field(max_length=MAX_LLM_NOTES)]


def experience_prompt() -> Prompt:
    return load_prompt("experience")


def prompt_input(request: ExperienceRequest) -> str:
    """De schermen compact en in gewone woorden. Alleen wat in het verzoek staat: geen contacten."""

    def screen(s: ExperienceScreen) -> dict[str, object]:
        return {
            "soort": s.kind,
            "vraag": s.text,
            "pictogrammen": [
                {
                    "label": o.label,
                    "plek": o.position,
                    "dekking": "exact" if o.representation == "exact" else "vervanger",
                }
                for o in s.options
            ],
            "gedaan": _ANSWER_WORDS.get(s.answer, None) if s.answer else None,
            "gekozen_plek": s.chosen_position,
            "seconden": round(s.response_time_ms / 1000, 1) if s.response_time_ms else None,
        }

    payload = {
        "vorm": request.settings.interaction_mode,
        "uitkomst": "bevestigd" if request.outcome == "confirmed" else "gestopt",
        "verstuurd": request.sent,
        "schermen": [screen(s) for s in request.screens],
    }
    return json.dumps(payload, ensure_ascii=False)


def llm_notes(
    provider: LlmProvider,
    prompt: Prompt,
    request: ExperienceRequest,
    timeout: float = EXPERIENCE_TIMEOUT_SECONDS,
) -> list[ExperienceNote]:
    """Vraagt het model om observaties en kijkt ze na. Gooit bij elk probleem (de regels volgen)."""
    raw = provider.complete_json(
        prompt.text, prompt_input(request), ExperienceOutput.model_json_schema(), timeout
    )
    output = ExperienceOutput.model_validate(raw)
    notes: list[ExperienceNote] = []
    for note in output.notes:
        text = " ".join(note.text.split())
        if _URL.search(text):
            raise ValueError("observatie met een URL")
        notes.append(ExperienceNote(about=note.about, text=text, confidence=note.confidence))
    return notes


def _longest_no_run(screens: list[ExperienceScreen]) -> int:
    longest = current = 0
    for s in screens:
        if s.kind == "question" and s.answer in ("no", "none_of_these"):
            current += 1
            longest = max(longest, current)
        elif s.kind == "question" and s.answer is not None:
            current = 0
    return longest


def rules_notes(request: ExperienceRequest) -> list[ExperienceNote]:
    """De terugval: een paar feiten over het verloop, zonder te raden waarom."""
    screens = request.screens
    questions = [s for s in screens if s.kind == "question"]
    asked = len(questions)
    notes: list[ExperienceNote] = []
    if request.outcome == "confirmed":
        sent = " en verstuurd" if request.sent else ""
        notes.append(
            ExperienceNote(
                about="flow",
                text=f"Na {asked} {'vraag' if asked == 1 else 'vragen'} een bevestigd bericht{sent}.",
                confidence=0.9,
            )
        )
    else:
        notes.append(
            ExperienceNote(
                about="flow",
                text=f"Gestopt zonder bericht na {asked} {'vraag' if asked == 1 else 'vragen'}.",
                confidence=0.9,
            )
        )
    run = _longest_no_run(screens)
    if run >= 3:
        notes.append(
            ExperienceNote(
                about="question",
                text=f"{run} keer achter elkaar nee: misschien sloten de vragen niet aan.",
                confidence=0.4,
            )
        )
    backs = sum(1 for s in screens if s.answer == "back")
    if backs >= 2:
        notes.append(
            ExperienceNote(
                about="flow",
                text=f"{backs} keer terug: misschien ging het te snel of was een keuze onduidelijk.",
                confidence=0.4,
            )
        )
    stand_ins = sum(
        1
        for s in questions
        if s.answer in ("yes", "selected")
        and any(
            o.representation == "stand_in"
            and (s.chosen_position is None or o.position == s.chosen_position)
            for o in s.options
        )
    )
    if stand_ins:
        notes.append(
            ExperienceNote(
                about="symbol",
                text="Er werd een vervangend pictogram gekozen: een eigen pictogram kan helpen.",
                confidence=0.5,
            )
        )
    return notes[:MAX_EXPERIENCE_NOTES]


def observe(
    request: ExperienceRequest,
    llm: LlmProvider | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> ExperienceResponse:
    """Eén keer terugkijken op een afgerond gesprek."""
    attempt: LlmAttempt[list[ExperienceNote]] | None = None
    if llm is not None:
        provider, prompt = llm, experience_prompt()
        attempt = LlmAttempt(
            run=lambda: llm_notes(provider, prompt, request),
            model=provider.model,
            prompt_version=prompt.id,
        )
    result = run_agent(
        AGENT,
        rules=lambda: rules_notes(request),
        llm=attempt,
        rules_reason="feiten over het verloop",
        confidence=lambda notes: max((n.confidence for n in notes), default=None),
        clock=clock,
    )
    return ExperienceResponse(
        contract_version=CONTRACT_VERSION,
        session_id=request.session_id,
        notes=result.value or [],
        decision=result.to_decision(),
    )
