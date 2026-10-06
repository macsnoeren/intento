"""De provider-interface (INTENTO-NEW-DESIGN §35)."""

from __future__ import annotations

from typing import Any, Literal, Protocol

#: Een JSON-object zoals de provider het teruggeeft (nog niet gevalideerd door de agent).
JsonObject = dict[str, Any]

#: Waarom een aanroep mislukte. De agent hoeft het onderscheid niet te maken (hij valt altijd terug op
#: zijn regels), maar het komt in de `AgentDecision` terecht en helpt bij het meten (N6.13).
LlmErrorReason = Literal[
    "timeout",
    "unavailable",
    "unauthorized",
    "http_error",
    "invalid_json",
    "no_response",
]


class LlmError(Exception):
    """Het model leverde geen bruikbaar JSON-object.

    De melding bevat nooit de prompt of het antwoord van het model: daar kan gespreksinhoud in staan.
    """

    def __init__(self, reason: LlmErrorReason, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason: LlmErrorReason = reason
        self.detail = detail


class LlmProvider(Protocol):
    """Eén taalmodel achter één methode."""

    #: Het model zoals het in een `AgentDecision` komt (bv. `gemma3:4b`).
    @property
    def model(self) -> str: ...

    def complete_json(
        self, system: str, user: str, schema: JsonObject, timeout: float
    ) -> JsonObject:
        """Vraagt het model om een JSON-object volgens `schema`.

        `timeout` in seconden geldt voor de hele aanroep (ook een eventuele nieuwe poging). Gooit
        `LlmError` als er binnen die tijd geen JSON-object komt.
        """
        ...
