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

from dataclasses import dataclass
from typing import Literal

from ..contracts import Event, Presentation, SessionState, Settings

SafetyRule = Literal["S1", "S2", "S3"]


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
