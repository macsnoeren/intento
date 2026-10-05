"""Regelgebaseerde agents: de terugval van elke LLM-agent (INTENTO-NEW-DESIGN §4.2 "Terugval").

- **Intent**: de startconcepten in vaste volgorde, zonder wat al is afgewezen (§6).
- **Question**: "{Label}?" over het eerste concept uit de hypotheses (§7).
- **Icon**: het item met dat concept, exact (§8, stap 1).

Ze zijn deterministisch en hebben geen netwerk nodig, zodat de gebruiker nooit een leeg scherm krijgt.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts import Hypothesis, Option, SessionState
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


def rule_icon(concept: str, label: str, vocabulary: VocabularyIndex, position: int = 0) -> Option:
    """Icon-terugval: het item dat dit concept draagt, als exacte representatie (§8, stap 1).

    De regels vragen alleen naar concepten uit de Vocabulary, dus er is altijd een item. Het zoeken naar
    het dichtstbijzijnde pictogram (met een gap) komt in N6.6.
    """
    entry = vocabulary.for_concept(concept)
    if entry is None:
        raise LookupError(f"Geen Vocabulary-item voor concept {concept!r}.")
    return Option(
        ref=entry.id,
        kind="symbol",
        vocabulary_item_id=entry.id,
        label=label,
        concept=concept,
        representation="exact",
        position=position,
    )
