"""De gemeenschappelijke envelop van elke agent (INTENTO-NEW-DESIGN §34).

Elke agent levert een `AgentResult`: wat hij concludeerde, met welke status (`success`, `fallback` als
de regelgebaseerde terugval het overnam, `failed` als zelfs die niets opleverde), zijn zekerheid, zijn
aannames en meta (model, promptversie, duur). De orchestrator zet elk resultaat om in een
`AgentDecision` voor de provenance.

`run_agent` is de enige plek waar een agent draait. Wat er ook misgaat in het LLM-deel — time-out,
ongeldige JSON, een antwoord dat niet door pydantic komt, een bug — de agent valt terug op zijn regels.
Er gaat **nooit** een exceptie naar buiten: de gebruiker krijgt nooit een leeg scherm (§4).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Generic, Literal, TypeVar

from pydantic import ValidationError

from ..contracts import AgentDecision
from ..llm import LlmError

T = TypeVar("T")

AgentStatus = Literal["success", "fallback", "failed"]
Validation = Literal["valid", "invalid", "skipped"]

#: De promptversie die bij een regelgebaseerd resultaat hoort.
RULES_VERSION = "rules-v1"

#: Redenen zijn kort; ze komen in de provenance en mogen nooit inhoud bevatten.
_MAX_REASON = 300


@dataclass(frozen=True)
class AgentMeta:
    model: str | None
    prompt_version: str | None
    latency_ms: int


@dataclass(frozen=True)
class AgentResult(Generic[T]):
    """Wat één agent opleverde. `value` is `None` alleen bij `failed`."""

    agent: str
    status: AgentStatus
    value: T | None
    meta: AgentMeta
    confidence: float | None = None
    assumptions: list[str] = field(default_factory=list)
    validation: Validation = "skipped"
    reason: str | None = None

    def to_decision(self) -> AgentDecision:
        return AgentDecision(
            agent=self.agent,
            status=self.status,
            model=self.meta.model,
            prompt_version=self.meta.prompt_version,
            latency_ms=self.meta.latency_ms,
            validation=self.validation,
            reason=self.reason[:_MAX_REASON] if self.reason else None,
        )


@dataclass(frozen=True)
class LlmAttempt(Generic[T]):
    """Het LLM-deel van een agent: een functie die het (gevalideerde) resultaat geeft, plus meta."""

    run: Callable[[], T]
    model: str
    prompt_version: str


def _reason(error: Exception) -> str:
    """De reden van een mislukte LLM-poging, zonder inhoud: alleen de soort fout."""
    if isinstance(error, LlmError):
        return f"llm: {error.reason}"
    if isinstance(error, ValidationError):
        fields = sorted({".".join(str(p) for p in e["loc"]) or "(root)" for e in error.errors()})
        return "ongeldig antwoord: " + ", ".join(fields[:5])
    return f"fout: {type(error).__name__}"


def run_agent(
    agent: str,
    *,
    rules: Callable[[], T],
    llm: LlmAttempt[T] | None = None,
    rules_reason: str | None = None,
    confidence: Callable[[T], float | None] = lambda _: None,
    clock: Callable[[], float] = time.monotonic,
) -> AgentResult[T]:
    """Draait één agent: eerst het LLM-deel (als dat er is), anders of bij een fout de regels.

    - LLM gelukt → `success`, validatie `valid`.
    - Geen LLM geconfigureerd → de regels zíjn de agent: `success`, promptversie `rules-v1`.
    - LLM mislukt → de regels nemen het over: `fallback`, validatie `invalid` als het antwoord niet door
      de validatie kwam, met de reden.
    - Ook de regels falen → `failed`, `value` is `None`. De orchestrator beslist wat er dan getoond wordt.
    """
    started = clock()

    def meta(model: str | None, version: str | None) -> AgentMeta:
        return AgentMeta(model, version, max(0, round((clock() - started) * 1000)))

    failure: str | None = None
    validation: Validation = "skipped"
    if llm is not None:
        try:
            value = llm.run()
        except Exception as error:
            failure = _reason(error)
            if isinstance(error, (ValidationError, ValueError)) and not isinstance(error, LlmError):
                validation = "invalid"
        else:
            return AgentResult(
                agent=agent,
                status="success",
                value=value,
                meta=meta(llm.model, llm.prompt_version),
                confidence=confidence(value),
                validation="valid",
            )

    try:
        value = rules()
    except Exception as error:
        reason = "; ".join(r for r in (failure, f"regels: {type(error).__name__}") if r)
        return AgentResult(
            agent=agent,
            status="failed",
            value=None,
            meta=meta(llm.model if llm else None, RULES_VERSION),
            validation=validation,
            reason=reason,
        )
    return AgentResult(
        agent=agent,
        status="fallback" if failure else "success",
        value=value,
        meta=meta(llm.model if llm else None, RULES_VERSION),
        confidence=confidence(value),
        validation=validation,
        reason=failure or rules_reason,
    )
