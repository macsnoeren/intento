"""Icon Agent (INTENTO-NEW-DESIGN §8).

Stap 1, **exact** (regels, geen LLM): het concept, een label of een synoniem van een item komt overeen
→ `semantic_match: strong`, `representation: exact`. Hoofdletters, extra spaties en `_` maken niet uit.
Het woord bij het pictogram is altijd een woord van dat item (I1): het gevonden synoniem, of het
gevraagde woord als het item dat kent, anders het eerste label.

Er wordt nooit een pictogram verzonnen: wat niet in de meegestuurde Vocabulary staat, bestaat niet.
Geen treffer → `None`; stap 2 (het dichtstbijzijnde pictogram met een gap) volgt in N6.6.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..contracts import Option, VocabularyEntry
from ..vocabulary import VocabularyIndex, normalize

SemanticMatch = Literal["strong", "weak", "none"]


@dataclass(frozen=True)
class IconMatch:
    entry: VocabularyEntry
    #: Het woord onder het pictogram.
    label: str
    #: Het concept zoals het item het draagt.
    concept: str
    semantic_match: SemanticMatch
    representation: Literal["exact", "stand_in"]
    confidence: float
    #: Waarop het item gevonden werd: `concept`, `label` of `synoniem`.
    matched_on: str

    def option(self, position: int = 0) -> Option:
        return Option(
            ref=self.entry.id,
            kind="symbol",
            vocabulary_item_id=self.entry.id,
            label=self.label,
            concept=self.concept,
            representation=self.representation,
            position=position,
        )


def _own_label(entry: VocabularyEntry, wanted: str) -> str:
    """Het gevraagde woord als het item het kent (label of synoniem), anders het eerste label."""
    return next(
        (label for label in entry.labels if normalize(label) == normalize(wanted)), entry.labels[0]
    )


def exact_match(concept: str, label: str, vocabulary: VocabularyIndex) -> IconMatch | None:
    """Stap 1: een item met precies dit concept, of met dit woord als label of synoniem."""
    entry = vocabulary.for_concept(concept)
    matched_on = "concept"
    if entry is None:
        for word in (label, concept):
            entry = vocabulary.for_label(word)
            if entry is not None:
                matched_on = (
                    "label" if normalize(entry.labels[0]) == normalize(word) else "synoniem"
                )
                label = word
                break
    if entry is None:
        return None
    return IconMatch(
        entry=entry,
        label=_own_label(entry, label),
        concept=VocabularyIndex.concept(entry),
        semantic_match="strong",
        representation="exact",
        confidence=1.0,
        matched_on=matched_on,
    )


def exact_option(
    concept: str, label: str, vocabulary: VocabularyIndex, position: int = 0
) -> Option:
    """De regels van de Icon Agent als optie; gooit `LookupError` zonder treffer."""
    match = exact_match(concept, label, vocabulary)
    if match is None:
        raise LookupError("geen exact pictogram")
    return match.option(position)
