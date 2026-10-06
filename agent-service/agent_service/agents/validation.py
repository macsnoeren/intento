"""Validation Agent: de vaste regels V1 t/m V7 (INTENTO-NEW-DESIGN §9).

Harde controles hangen niet van een model af: elke regel is een losse, benoemde functie die een
`Finding` geeft als hij geschonden wordt, of `None`. De meeste leiden tot `reject` (de Question Agent
probeert het nog eens of de terugval volgt, N6.8); tegenstrijdige antwoorden (V5) tot `clarify`: dan is
een gerichte verduidelijkingsvraag nodig.

De backend controleert daarnaast zijn eigen invarianten (§52); deze regels maken dat een slecht
antwoord al in de agentdienst wordt opgevangen, met een reden die de Question Agent kan gebruiken.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from ..contracts import Gap, Presentation, SessionState, Settings
from ..vocabulary import VocabularyIndex, normalize

#: Standaarddrempel voor een voorstel (§6, `AGENT_PROPOSE_THRESHOLD`).
DEFAULT_PROPOSE_THRESHOLD = 0.85

Rule = Literal["V1", "V2", "V3", "V4", "V5", "V6", "V7"]

_URL = re.compile(r"https?://|www\.|\b[\w-]+\.(?:nl|com|org|net|be|eu)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Finding:
    rule: Rule
    #: Kort en zonder gespreksinhoud: gaat in de `AgentDecision` en terug naar de Question Agent.
    reason: str
    action: Literal["reject", "clarify"] = "reject"


def v1_symbols_exist(presentation: Presentation, vocabulary: VocabularyIndex) -> Finding | None:
    """V1: elk symbool bestaat in de meegegeven Vocabulary."""
    for option in presentation.options:
        if option.kind == "symbol" and (
            option.vocabulary_item_id is None or vocabulary.get(option.vocabulary_item_id) is None
        ):
            return Finding("V1", "een symbool staat niet in de Vocabulary")
    return None


def v2_question_text(text: str, names: Sequence[str] = ()) -> Finding | None:
    """V2: 3 tot 80 tekens, eindigt op "?", geen URL, geen namen van de gebruiker of contacten."""
    stripped = text.strip()
    if not 3 <= len(stripped) <= 80:
        return Finding("V2", "de vraag moet 3 tot 80 tekens zijn")
    if not stripped.endswith("?"):
        return Finding("V2", "de vraag moet eindigen op een vraagteken")
    if _URL.search(stripped):
        return Finding("V2", "de vraag bevat een internetadres")
    words = set(re.findall(r"\w+", normalize(stripped)))
    for name in names:
        parts = [p for p in re.findall(r"\w+", normalize(name)) if len(p) >= 2]
        if parts and any(part in words for part in parts):
            return Finding("V2", "de vraag bevat een naam")
    return None


def v3_concept_matches(
    concept: str | None,
    presentation: Presentation,
    gaps: Sequence[Gap],
    vocabulary: VocabularyIndex,
) -> Finding | None:
    """V3: het concept van de vraag zit in de concepten van het symbool — of het is een stand-in met
    een bijbehorende gap."""
    if concept is None:
        return None
    for option in presentation.options:
        if option.kind != "symbol" or option.vocabulary_item_id is None:
            continue
        entry = vocabulary.get(option.vocabulary_item_id)
        if entry is None:
            continue
        if normalize(concept) in {normalize(c) for c in entry.concepts}:
            return None
        if option.representation == "stand_in" and any(
            gap.best_available_item_id == option.vocabulary_item_id
            and normalize(gap.concept) == normalize(concept)
            for gap in gaps
        ):
            return None
    return Finding("V3", "het pictogram past niet bij het concept van de vraag")


def v4_not_repeated(text: str, state: SessionState) -> Finding | None:
    """V4: dezelfde vraag is in dit gesprek nog niet gesteld."""
    if normalize(text) in {normalize(q.text) for q in state.questions_asked}:
        return Finding("V4", "deze vraag is al gesteld")
    return None


def v5_conflicting_answers(state: SessionState) -> Finding | None:
    """V5: JA én NEE op hetzelfde concept → `conflicting_answers`, actie `clarify`."""
    yes: set[str] = set()
    no: set[str] = set()
    for answer in state.answers:
        target = yes if answer.answer in ("yes", "selected") else no
        if answer.answer in ("yes", "selected", "no"):
            target.update(normalize(c) for c in answer.concepts)
    if yes & no:
        return Finding("V5", "conflicting_answers", action="clarify")
    return None


def v6_option_count(
    presentation: Presentation, mode: Literal["binary", "multi"], settings: Settings
) -> Finding | None:
    """V6: binary precies één symbool; multi-icon 2 tot het ingestelde aantal, allemaal verschillend."""
    symbols = [o for o in presentation.options if o.kind == "symbol"]
    if mode == "binary":
        return None if len(symbols) == 1 else Finding("V6", "binary vraagt precies één symbool")
    if not 2 <= len(symbols) <= settings.options_per_screen:
        return Finding("V6", f"multi-icon vraagt 2 tot {settings.options_per_screen} symbolen")
    shown = {(o.vocabulary_item_id, normalize(o.label)) for o in symbols}
    if len(shown) != len(symbols):
        return Finding("V6", "twee symbolen zijn gelijk")
    return None


def v7_proposal(
    message: str,
    confidence: float,
    state: SessionState,
    threshold: float = DEFAULT_PROPOSE_THRESHOLD,
) -> Finding | None:
    """V7: een voorstel is een zin van 3 tot 120 tekens, met confidence ≥ drempel, na minstens één antwoord."""
    if not 3 <= len(message.strip()) <= 120:
        return Finding("V7", "het voorstel moet 3 tot 120 tekens zijn")
    if confidence < threshold:
        return Finding("V7", f"te onzeker voor een voorstel ({confidence:.2f} < {threshold:.2f})")
    if not state.answers:
        return Finding("V7", "een voorstel vraagt minstens één antwoord")
    return None


def validate_question(
    *,
    concept: str | None,
    text: str,
    presentation: Presentation,
    gaps: Sequence[Gap],
    state: SessionState,
    settings: Settings,
    vocabulary: VocabularyIndex,
    names: Sequence[str] = (),
) -> list[Finding]:
    """Alle regels voor een vraag (V1 t/m V6), in volgorde."""
    checks = [
        v1_symbols_exist(presentation, vocabulary),
        v2_question_text(text, names),
        v3_concept_matches(concept, presentation, gaps, vocabulary),
        v4_not_repeated(text, state),
        v5_conflicting_answers(state),
        v6_option_count(presentation, presentation.mode, settings),
    ]
    return [finding for finding in checks if finding is not None]
