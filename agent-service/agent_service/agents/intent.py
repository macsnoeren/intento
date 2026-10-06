"""Intent Agent v1 (INTENTO-NEW-DESIGN §6).

LLM-agent: krijgt de antwoorden (concept, woord, JA/NEE), wat er getoond werd, de huidige hypotheses,
de afgewezen concepten en een **compacte** Vocabulary, en geeft hypotheses (concept, woord, zekerheid),
aannames, `needs_clarification` en — als hij zeker is — de zin. Terugval: de startconcepten in volgorde
(`rules.rule_hypotheses`).

Wat het model teruggeeft wordt gevalideerd (pydantic) en nagekeken: afgewezen en dubbele concepten
vallen eruit. Een concept uit de Vocabulary krijgt het woord van dat item (I1); een concept dat er
niet in staat (bv. "dizziness"/"duizelig") mag, en krijgt bij de vraag het dichtstbijzijnde pictogram
met een gap (Icon Agent, §8). Blijft er niets over, dan nemen de regels het over.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from ..contracts import Hypothesis, SessionState
from ..llm import LlmProvider
from ..prompts import Prompt, load_prompt
from ..vocabulary import VocabularyIndex, normalize
from .rules import rule_hypotheses

#: Hoe lang de Intent Agent op het model wacht (seconden).
INTENT_TIMEOUT_SECONDS = 10.0
#: Hoeveel woorden hooguit in de prompt gaan: de hele startset (±3.400) past niet.
MAX_PROMPT_WORDS = 150
MAX_HYPOTHESES = 5
#: Een eigen concept: kleine letters, cijfers en underscores.
_CONCEPT_CHARS = re.compile(r"[^a-z0-9]+")


class IntentHypothesis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept: Annotated[str, Field(min_length=1, max_length=100)]
    label: Annotated[str, Field(min_length=1, max_length=60)]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


class IntentOutput(BaseModel):
    """Wat het model moet teruggeven (ook het JSON-schema voor Ollama)."""

    model_config = ConfigDict(extra="forbid")

    hypotheses: Annotated[list[IntentHypothesis], Field(min_length=1, max_length=MAX_HYPOTHESES)]
    assumptions: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=200)]], Field(max_length=5)
    ] = []
    uncertainties: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=200)]], Field(max_length=5)
    ] = []
    needs_clarification: bool
    message: Annotated[str, Field(min_length=3, max_length=120)] | None = None


@dataclass(frozen=True)
class IntentResult:
    hypotheses: list[Hypothesis]
    assumptions: list[str] = field(default_factory=list)
    uncertainties: list[str] = field(default_factory=list)
    needs_clarification: bool = True
    message: str | None = None


def rules_intent(state: SessionState, vocabulary: VocabularyIndex) -> IntentResult:
    """De terugval: startconcepten in vaste volgorde."""
    return IntentResult(hypotheses=rule_hypotheses(state, vocabulary))


def _label(vocabulary: VocabularyIndex, concept: str) -> str:
    entry = vocabulary.for_concept(concept)
    return vocabulary.label(entry) if entry else concept.replace("_", " ")


def prompt_words(state: SessionState, vocabulary: VocabularyIndex) -> list[dict[str, Any]]:
    """De compacte Vocabulary voor de prompt: de startwoorden, en woorden uit dezelfde contexten als
    waar de gebruiker JA op zei of die in de hypotheses staan. Hooguit `MAX_PROMPT_WORDS`."""
    focus: set[str] = {h.concept for h in state.intent_hypotheses}
    for answer in state.answers:
        if answer.answer in ("yes", "selected"):
            focus.update(answer.concepts)
    contexts = {
        context
        for concept in focus
        if (entry := vocabulary.for_concept(concept)) is not None
        for context in entry.contexts
    }
    chosen = [entry for entry in vocabulary.entries if entry.is_start]
    seen = {entry.id for entry in chosen}
    chosen += [
        entry
        for entry in vocabulary.entries
        if entry.id not in seen and contexts.intersection(entry.contexts)
    ]
    return [
        {
            "concept": vocabulary.concept(entry),
            "woord": vocabulary.label(entry),
            "start": entry.is_start,
        }
        for entry in chosen[:MAX_PROMPT_WORDS]
    ]


def no_streak(state: SessionState) -> int:
    """Hoeveel keer de gebruiker sinds zijn laatste JA (of sinds het begin) NEE zei."""
    streak = 0
    for answer in reversed(state.answers):
        if answer.answer in ("yes", "selected"):
            break
        streak += 1
    return streak


def prompt_input(state: SessionState, vocabulary: VocabularyIndex) -> str:
    """De gebruikersprompt: alleen concepten en woorden, nooit namen of contactgegevens (V6).

    De sleutels heten hetzelfde als in het antwoordschema (`concept`, `label`, `confidence`): een model
    neemt anders de sleutels van de invoer over en het antwoord valt door de validatie.
    """
    shown = state.last_presentation
    payload = {
        "antwoorden": [
            {
                "concept": concept,
                "label": _label(vocabulary, concept),
                "antwoord": "ja" if answer.answer in ("yes", "selected") else "nee",
            }
            for answer in state.answers
            for concept in answer.concepts
        ],
        "getoond": {
            "vraag": shown.text,
            "opties": [o.concept for o in shown.options if o.kind == "symbol" and o.concept],
        }
        if shown
        else None,
        "hypotheses": [
            {"concept": h.concept, "label": h.label, "confidence": h.confidence}
            for h in state.intent_hypotheses
        ],
        "afgewezen": state.rejected_concepts,
        "nee_op_rij": no_streak(state),
        "vocabulary": prompt_words(state, vocabulary),
    }
    return json.dumps(payload, ensure_ascii=False)


def llm_intent(
    provider: LlmProvider,
    prompt: Prompt,
    state: SessionState,
    vocabulary: VocabularyIndex,
    timeout: float = INTENT_TIMEOUT_SECONDS,
) -> IntentResult:
    """Vraagt het model om hypotheses en kijkt ze na. Gooit bij elk probleem (de terugval volgt)."""
    raw = provider.complete_json(
        prompt.text, prompt_input(state, vocabulary), IntentOutput.model_json_schema(), timeout
    )
    output = IntentOutput.model_validate(raw)
    rejected = {normalize(concept) for concept in state.rejected_concepts}
    hypotheses: list[Hypothesis] = []
    seen: set[str] = set()
    for item in sorted(output.hypotheses, key=lambda h: h.confidence, reverse=True):
        entry = vocabulary.for_concept(item.concept)
        if entry is None:
            # Geen item met dit concept: een eigen concept met het woord van het model.
            concept = _CONCEPT_CHARS.sub("_", item.concept.lower()).strip("_")[:100]
            label = " ".join(item.label.split())
            if not concept or not label:
                continue
        else:
            # Concept en woord zoals in de Vocabulary: het pictogram toont dat item, en een ander
            # woord bij dat pictogram zou de betekenis stilzwijgend veranderen (I1). Een synoniem mag.
            concept = vocabulary.concept(entry)
            labels = {normalize(label): label for label in entry.labels}
            label = labels.get(normalize(item.label), vocabulary.label(entry))
        key = normalize(concept)
        if key in rejected or key in seen:
            continue
        seen.add(key)
        hypotheses.append(Hypothesis(concept=concept, label=label, confidence=item.confidence))
    if not hypotheses:
        raise ValueError("geen bruikbare hypothese")
    return IntentResult(
        hypotheses=hypotheses,
        assumptions=[a.strip() for a in output.assumptions if a.strip()],
        uncertainties=[u.strip() for u in output.uncertainties if u.strip()],
        needs_clarification=output.needs_clarification,
        message=output.message,
    )


def intent_prompt() -> Prompt:
    return load_prompt("intent")
