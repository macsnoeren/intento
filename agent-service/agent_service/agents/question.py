"""Question Agent v1 (INTENTO-NEW-DESIGN §7, §34).

LLM-agent voor Binary Mode: de orchestrator kiest het concept (de eerste nog niet gevraagde
hypothese), de Question Agent formuleert de vraag erover. Uitvoer volgens §34: concept, tekst,
`required_symbols` en confidence. Terugval: "{Label}?" (`rules.rule_question`).

Het antwoord wordt gevalideerd en nagekeken: het concept moet precies het gevraagde zijn, de tekst een
vraag van 3 tot 80 tekens zonder URL, en niet eerder gesteld. Anders telt de poging als mislukt.
"""

from __future__ import annotations

import json
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from ..contracts import Hypothesis, SessionState
from ..llm import LlmProvider
from ..prompts import Prompt, load_prompt
from ..vocabulary import VocabularyIndex, normalize
from .rules import Question

QUESTION_TIMEOUT_SECONDS = 10.0
_URL = re.compile(r"https?://|www\.", re.IGNORECASE)


class QuestionOutput(BaseModel):
    """Wat het model moet teruggeven (ook het JSON-schema voor Ollama)."""

    model_config = ConfigDict(extra="forbid")

    concept: Annotated[str, Field(min_length=1, max_length=100)]
    text: Annotated[str, Field(min_length=3, max_length=80)]
    required_symbols: Annotated[list[str], Field(min_length=1, max_length=8)]
    confidence: Annotated[float, Field(ge=0.0, le=1.0)]


def _label(vocabulary: VocabularyIndex, concept: str) -> str:
    entry = vocabulary.for_concept(concept)
    return vocabulary.label(entry) if entry else concept.replace("_", " ")


def prompt_input(
    target: Hypothesis, state: SessionState, vocabulary: VocabularyIndex, strategy: str
) -> str:
    """De gebruikersprompt: concepten, woorden en eerdere vragen; nooit namen (V6)."""
    payload = {
        "vraag_over": {"concept": target.concept, "label": target.label},
        "antwoorden": [
            {
                "concept": concept,
                "label": _label(vocabulary, concept),
                "antwoord": "ja" if answer.answer in ("yes", "selected") else "nee",
            }
            for answer in state.answers
            for concept in answer.concepts
        ],
        "gesteld": [question.text for question in state.questions_asked],
        "strategie": strategy,
    }
    return json.dumps(payload, ensure_ascii=False)


def llm_question(
    provider: LlmProvider,
    prompt: Prompt,
    target: Hypothesis,
    state: SessionState,
    vocabulary: VocabularyIndex,
    strategy: str = "",
    timeout: float = QUESTION_TIMEOUT_SECONDS,
) -> Question:
    """Vraagt het model om de vraag en kijkt hem na. Gooit bij elk probleem (de terugval volgt)."""
    raw = provider.complete_json(
        prompt.text,
        prompt_input(target, state, vocabulary, strategy),
        QuestionOutput.model_json_schema(),
        timeout,
    )
    output = QuestionOutput.model_validate(raw)
    if normalize(output.concept) != normalize(target.concept):
        raise ValueError("vraag over een ander concept")
    text = " ".join(output.text.split())
    if not text.endswith("?") or _URL.search(text):
        raise ValueError("geen geldige vraag")
    if normalize(text) in {normalize(q.text) for q in state.questions_asked}:
        raise ValueError("vraag al gesteld")
    return Question(concept=target.concept, text=text)


def question_prompt() -> Prompt:
    return load_prompt("question")
