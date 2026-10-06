"""Regelgebaseerde agents: de terugval van elke LLM-agent (INTENTO-NEW-DESIGN §4.2 "Terugval").

- **Intent**: de startconcepten in vaste volgorde, zonder wat al is afgewezen (§6).
- **Question**: "{Label}?" over het eerste concept uit de hypotheses (§7).
- **Icon**: exact op concept, label of synoniem — zie `icon.py` (§8, stap 1).

Ze zijn deterministisch en hebben geen netwerk nodig, zodat de gebruiker nooit een leeg scherm krijgt.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts import Hypothesis, SessionState
from ..vocabulary import VocabularyIndex


def capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


def rule_hypotheses(state: SessionState, vocabulary: VocabularyIndex) -> list[Hypothesis]:
    """Intent-terugval: de nog niet afgewezen startconcepten, in vaste volgorde.

    De confidence is bewust laag en gelijk verdeeld: zonder antwoord weet de regel niets.
    """
    rejected = set(state.rejected_concepts)
    # Heeft de beheerder (nog) geen startconcepten gemarkeerd, dan de hele Vocabulary in vaste volgorde.
    pool = vocabulary.start_items() or vocabulary.entries
    candidates = [entry for entry in pool if vocabulary.concept(entry) not in rejected]
    if not candidates:
        return []
    share = round(1 / len(candidates), 4)
    return [
        Hypothesis(
            concept=vocabulary.concept(entry), label=vocabulary.label(entry), confidence=share
        )
        for entry in candidates
    ]


@dataclass(frozen=True)
class Question:
    concept: str
    text: str


def rule_question(hypothesis: Hypothesis) -> Question:
    """Question-terugval: "{Label}?" over één concept (Binary Mode, §7)."""
    return Question(concept=hypothesis.concept, text=f"{capitalize(hypothesis.label)}?")
