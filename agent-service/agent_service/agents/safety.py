"""Safety Agent: de vaste regels S1 t/m S3 (INTENTO-NEW-DESIGN §10).

Bewust los van de Validation Agent: die keurt of een vraag goed gemaakt is, de Safety Agent bewaakt
het gesprek zelf — dat het niet onnodig belastend wordt en dat de AI het niet overneemt.

- **S1** maximum aantal vragen per gesprek (instelling, standaard 15). Bereikt: de beste hypothese
  wordt voorgelegd; bij NEE volgt "Wil je stoppen?".
- **S2** geen voorstel zonder minstens één antwoord van de gebruiker.
- **S3** versturen vraagt altijd een JA van de gebruiker op dát contact (gebruikt in de deelfase, N11;
  de backend dwingt hetzelfde af als I3).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..contracts import Event, Presentation, SessionState, Settings
from ..llm import LlmProvider
from ..prompts import Prompt, load_prompt

SafetyRule = Literal["S1", "S2", "S3", "LLM"]
SAFETY_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class SafetyFinding:
    rule: SafetyRule
    reason: str


def s1_question_limit(state: SessionState, settings: Settings) -> SafetyFinding | None:
    """S1: is het maximum aantal vragen bereikt?"""
    if len(state.questions_asked) >= settings.max_questions:
        return SafetyFinding("S1", f"maximum van {settings.max_questions} vragen bereikt")
    return None


def s2_proposal_needs_answer(state: SessionState) -> SafetyFinding | None:
    """S2: een voorstel mag pas na minstens één antwoord van de gebruiker."""
    if not state.answers:
        return SafetyFinding("S2", "geen voorstel zonder antwoord van de gebruiker")
    return None


def s3_send_requires_yes(
    contact_id: str, shown: Presentation | None, event: Event
) -> SafetyFinding | None:
    """S3: versturen naar `contact_id` alleen na een JA op een scherm dat over dát contact ging."""
    about_contact = (
        shown is not None
        and shown.kind in ("share_contact", "confirm_send")
        and any(o.kind == "contact" and o.contact_id == contact_id for o in shown.options)
    )
    if about_contact and event.type in ("answer_yes", "select_option"):
        if event.type == "select_option" and shown is not None:
            chosen = next((o for o in shown.options if o.ref == event.option_ref), None)
            if chosen is None or chosen.contact_id != contact_id:
                return SafetyFinding("S3", "gekozen optie is niet dit contact")
        return None
    return SafetyFinding("S3", "versturen vraagt een JA op dit contact")


# --- Het LLM-deel (optioneel, `AGENT_LLM_SAFETY`) --------------------------------------------------


class SafetyVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    appropriate: bool
    reason: Annotated[str, Field(max_length=200)] | None = None


def llm_safety(
    provider: LlmProvider,
    prompt: Prompt,
    *,
    text: str,
    concept: str | None,
    label: str,
    state: SessionState,
    timeout: float = SAFETY_TIMEOUT_SECONDS,
) -> list[SafetyFinding]:
    """Laat het model beoordelen of de vraag passend en niet belastend is (§10).

    Gooit bij een fout van het model; de aanroeper telt dan alleen de regels.
    """
    payload = {
        "vraag": text,
        "concept": concept,
        "label": label,
        "aantal_vragen": len(state.questions_asked),
    }
    raw = provider.complete_json(
        prompt.text,
        json.dumps(payload, ensure_ascii=False),
        SafetyVerdict.model_json_schema(),
        timeout,
    )
    verdict = SafetyVerdict.model_validate(raw)
    if verdict.appropriate:
        return []
    reason = " ".join((verdict.reason or "de vraag is niet passend").split())[:120]
    return [SafetyFinding("LLM", reason)]


def safety_prompt() -> Prompt:
    return load_prompt("safety")
