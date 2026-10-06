"""`FakeProvider`: vaste antwoorden, alle prompts bewaard (INTENTO-NEW-DESIGN §35, §54).

Maakt de tests deterministisch en offline. Omdat hij elke prompt bewaart, kunnen tests ook controleren
wat er **niet** naar een model gaat — bijvoorbeeld dat namen en e-mailadressen van contacten nooit in
een prompt staan (V6).
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from .provider import JsonObject, LlmError


@dataclass(frozen=True)
class FakeCall:
    """Eén aanroep zoals de FakeProvider hem zag."""

    system: str
    user: str
    schema: JsonObject
    timeout: float


#: Een vast antwoord: een JSON-object, een fout om te gooien, of een functie van de aanroep.
FakeResponse = JsonObject | LlmError | Callable[[FakeCall], JsonObject]


class FakeProvider:
    """Geeft de opgegeven antwoorden in volgorde terug en onthoudt elke aanroep."""

    def __init__(self, responses: Iterable[FakeResponse] = (), model: str = "fake-model") -> None:
        self._responses: list[FakeResponse] = list(responses)
        self._model = model
        self.calls: list[FakeCall] = []

    @property
    def model(self) -> str:
        return self._model

    def add(self, *responses: FakeResponse) -> None:
        """Voegt antwoorden toe achteraan de rij."""
        self._responses.extend(responses)

    @property
    def prompts(self) -> list[str]:
        """Alle teksten die naar het "model" gingen (systeem en gebruiker), in volgorde."""
        return [text for call in self.calls for text in (call.system, call.user)]

    def complete_json(
        self, system: str, user: str, schema: JsonObject, timeout: float
    ) -> JsonObject:
        call = FakeCall(system=system, user=user, schema=copy.deepcopy(schema), timeout=timeout)
        self.calls.append(call)
        if not self._responses:
            raise LlmError("no_response", "de FakeProvider heeft geen antwoord meer")
        response = self._responses.pop(0)
        if isinstance(response, LlmError):
            raise response
        if callable(response):
            return copy.deepcopy(response(call))
        # Een kopie: een agent die het antwoord aanpast, mag de testdata niet veranderen.
        return copy.deepcopy(response)
