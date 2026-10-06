"""De LLM-laag van de agentdienst (INTENTO-NEW-DESIGN §35).

Agents praten nooit rechtstreeks met een model, maar met een `LlmProvider`: één methode die een
systeem- en gebruikersbericht plus een JSON-schema krijgt en een JSON-object teruggeeft. Welk model
erachter zit (Ollama lokaal of in de cloud, of een `FakeProvider` in de tests) is een detail.

Wat de provider teruggeeft is **nog niet gevalideerd** tegen het schema van de agent: de agent valideert
zelf (pydantic) en valt bij elke fout terug op zijn regels. De provider garandeert alleen "een
JSON-object, of een `LlmError`".
"""

from __future__ import annotations

from .fake import FakeCall, FakeProvider
from .provider import JsonObject, LlmError, LlmErrorReason, LlmProvider

__all__ = [
    "FakeCall",
    "FakeProvider",
    "JsonObject",
    "LlmError",
    "LlmErrorReason",
    "LlmProvider",
]
