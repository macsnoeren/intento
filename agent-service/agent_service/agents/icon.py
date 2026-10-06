"""Icon Agent (INTENTO-NEW-DESIGN §8).

Stap 1, **exact** (regels, geen LLM): het concept, een label of een synoniem van een item komt overeen
→ `semantic_match: strong`, `representation: exact`. Hoofdletters, extra spaties en `_` maken niet uit.
Het woord bij het pictogram is altijd een woord van dat item (I1): het gevonden synoniem, of het
gevraagde woord als het item dat kent, anders het eerste label.

Stap 2, **dichtstbij** (LLM): het model noemt verwante woorden; een tekstzoekopdracht op die woorden
geeft hooguit tien kandidaten; het model kiest er één met een schema dat **alleen die ids** toelaat (of
`none`). Dat wordt een `stand_in` met het woord van de gebruiker eronder, plus een gap (§17).

Stap 3, **niets in de buurt**: het neutrale pictogram "geen afbeelding" (`no_image`) met het woord
eronder, en ook dan een gap. Dit is ook de terugval zonder (of bij uitval van) het model.

Er wordt nooit een pictogram verzonnen: wat niet in de meegestuurde Vocabulary staat, bestaat niet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..contracts import Gap, Option, VocabularyEntry
from ..llm import LlmProvider
from ..prompts import Prompt, load_prompt
from ..vocabulary import VocabularyIndex, normalize

SemanticMatch = Literal["strong", "weak", "none"]

#: Het concept van het neutrale pictogram "geen afbeelding" (seed in de backend).
NO_IMAGE_CONCEPT = "no_image"
#: Hoe lang elke stap van de Icon Agent op het model wacht (seconden).
ICON_TIMEOUT_SECONDS = 8.0
MAX_CANDIDATES = 10


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

    def gap(self) -> Gap | None:
        """Bij een stand-in: het gat in de Vocabulary (§17), zonder gebruiker of gesprek."""
        if self.representation != "stand_in":
            return None
        return Gap(
            type="vocabulary_gap",
            concept=self.concept,
            label=self.label,
            context=self.entry.contexts[0] if self.entry.contexts else None,
            best_available_item_id=self.entry.id,
            confidence=self.confidence,
        )

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


# --- Stap 2 en 3 -----------------------------------------------------------------------------------


class RelatedWords(BaseModel):
    model_config = ConfigDict(extra="forbid")

    words: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=40)]], Field(min_length=1, max_length=8)
    ]


class Choice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: Annotated[str, Field(min_length=1, max_length=200)]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


def choice_schema(candidate_ids: list[str]) -> dict[str, Any]:
    """Het antwoordschema voor het kiezen: alleen de ids van de kandidaten, of `none`."""
    return {
        "type": "object",
        "properties": {
            "item_id": {"type": "string", "enum": [*candidate_ids, "none"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["item_id", "confidence"],
        "additionalProperties": False,
    }


def search(
    words: list[str], vocabulary: VocabularyIndex, limit: int = MAX_CANDIDATES
) -> list[VocabularyEntry]:
    """Tekstzoekopdracht op labels, synoniemen en concepten: gelijk > begin > deel van het woord."""
    wanted = [w for w in (normalize(word) for word in words) if len(w) >= 3]
    scored: list[tuple[int, VocabularyEntry]] = []
    for entry in vocabulary.entries:
        if NO_IMAGE_CONCEPT in entry.concepts:
            continue
        names = [normalize(n) for n in [*entry.labels, *entry.concepts]]
        score = 0
        for w in wanted:
            for name in names:
                if name == w:
                    score = max(score, 3)
                elif name.startswith(w) or (w.startswith(name) and len(name) >= 3):
                    score = max(score, 2)
                elif len(w) >= 4 and (w in name or name in w):
                    score = max(score, 1)
        if score:
            scored.append((score, entry))
    scored.sort(key=lambda pair: (-pair[0], pair[1].sort_order, pair[1].id))
    return [entry for _, entry in scored[:limit]]


def stand_in(entry: VocabularyEntry, concept: str, label: str, confidence: float) -> IconMatch:
    """Een benadering: het pictogram van `entry` met het woord van de gebruiker eronder."""
    return IconMatch(
        entry=entry,
        label=label,
        concept=concept,
        semantic_match="weak" if NO_IMAGE_CONCEPT not in entry.concepts else "none",
        representation="stand_in",
        confidence=confidence,
        matched_on="dichtstbij" if NO_IMAGE_CONCEPT not in entry.concepts else "geen afbeelding",
    )


def no_image(concept: str, label: str, vocabulary: VocabularyIndex) -> IconMatch:
    """Stap 3: het neutrale pictogram met het woord eronder. Gooit `LookupError` als het ontbreekt."""
    entry = vocabulary.for_concept(NO_IMAGE_CONCEPT)
    if entry is None:
        raise LookupError("geen pictogram 'geen afbeelding' in de Vocabulary")
    return stand_in(entry, concept, label, 0.0)


def closest_match(
    provider: LlmProvider,
    prompt: Prompt,
    concept: str,
    label: str,
    vocabulary: VocabularyIndex,
    timeout: float = ICON_TIMEOUT_SECONDS,
) -> IconMatch:
    """Stap 2 met het model, en stap 3 als het model niets in de buurt vindt.

    Gooit bij een fout van het model of een verzonnen id (de terugval is dan stap 3).
    """
    related = RelatedWords.model_validate(
        provider.complete_json(
            prompt.text,
            json.dumps({"taak": "verwant", "woord": label, "concept": concept}, ensure_ascii=False),
            RelatedWords.model_json_schema(),
            timeout,
        )
    )
    candidates = search([label, concept, *related.words], vocabulary)
    if not candidates:
        return no_image(concept, label, vocabulary)
    by_id = {entry.id: entry for entry in candidates}
    raw = provider.complete_json(
        prompt.text,
        json.dumps(
            {
                "taak": "kiezen",
                "woord": label,
                "kandidaten": [
                    {"id": e.id, "label": e.labels[0], "concept": e.concepts[0]} for e in candidates
                ],
            },
            ensure_ascii=False,
        ),
        choice_schema(list(by_id)),
        timeout,
    )
    choice = Choice.model_validate(raw)
    if choice.item_id == "none":
        return no_image(concept, label, vocabulary)
    entry = by_id.get(choice.item_id)
    if entry is None:
        # Het schema laat alleen bestaande ids toe; een model dat toch iets verzint, wordt geweigerd.
        raise ValueError("verzonnen pictogram")
    return stand_in(entry, concept, label, choice.confidence)


def icon_prompt() -> Prompt:
    return load_prompt("icon")
