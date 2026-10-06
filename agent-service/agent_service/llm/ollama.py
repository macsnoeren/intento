"""`OllamaProvider`: Ollama lokaal of in de cloud (INTENTO-NEW-DESIGN §35, besluit 13).

`POST {url}/api/chat` met `format` = het JSON-schema en `stream: false`. Lokaal zonder sleutel, in de
cloud met `Authorization: Bearer {OLLAMA_API_KEY}`.

Lessen uit de oude worker die hier vastliggen:

- Cloudmodellen verpakken JSON soms in een code-fence of zetten er een zin voor. Die worden weggehaald
  vóór het parsen; de agent valideert daarna altijd zelf opnieuw.
- Elke aanroep heeft een time-out. Bij ongeldige JSON volgt hooguit één nieuwe poging, binnen dezelfde
  time-out.

Niets van de prompt of het antwoord komt in een foutmelding of log: daar kan gespreksinhoud in staan.
"""

from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.request
from typing import Any

from .provider import JsonObject, LlmError

#: Bovengrens voor een antwoord van Ollama; een agentantwoord is een paar kB.
MAX_RESPONSE_BYTES = 2 * 1024 * 1024

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)


def extract_json_object(text: str) -> JsonObject:
    """Haalt één JSON-object uit modeltekst: kaal, in een code-fence, of met tekst eromheen.

    Gooit `LlmError("invalid_json")` als er geen JSON-object in staat.
    """
    candidates: list[str] = [text.strip()]
    fenced = _FENCE.search(text)
    if fenced:
        candidates.append(fenced.group(1).strip())
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            value: Any = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise LlmError("invalid_json", "geen JSON-object in het antwoord")


class OllamaProvider:
    """Praat met Ollama via `/api/chat`."""

    def __init__(
        self,
        url: str,
        model: str,
        api_key: str | None = None,
        max_response_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        self._url = url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._max_response_bytes = max_response_bytes

    @property
    def model(self) -> str:
        return self._model

    def complete_json(
        self, system: str, user: str, schema: JsonObject, timeout: float
    ) -> JsonObject:
        deadline = time.monotonic() + timeout
        last_error: LlmError | None = None
        # Eén nieuwe poging, en alleen bij ongeldige JSON: een time-out of een 401 wordt er niet beter van.
        for _ in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise LlmError("timeout", f"geen antwoord binnen {timeout:g} s")
            content = self._chat(system, user, schema, remaining)
            try:
                return extract_json_object(content)
            except LlmError as error:
                last_error = error
        assert last_error is not None
        raise last_error

    def _chat(self, system: str, user: str, schema: JsonObject, timeout: float) -> str:
        body = json.dumps(
            {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "format": schema,
                "stream": False,
            }
        ).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = urllib.request.Request(
            f"{self._url}/api/chat", data=body, headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read(self._max_response_bytes + 1)
        except urllib.error.HTTPError as error:
            error.close()  # de foutrespons houdt anders de verbinding open
            if error.code in (401, 403):
                raise LlmError("unauthorized", f"status {error.code}") from None
            raise LlmError("http_error", f"status {error.code}") from None
        except TimeoutError:
            raise LlmError("timeout", f"geen antwoord binnen {timeout:.1f} s") from None
        except urllib.error.URLError as error:
            if isinstance(error.reason, (TimeoutError, socket.timeout)):
                raise LlmError("timeout", f"geen antwoord binnen {timeout:.1f} s") from None
            raise LlmError("unavailable", type(error.reason).__name__) from None
        except OSError as error:
            raise LlmError("unavailable", type(error).__name__) from None

        if len(raw) > self._max_response_bytes:
            raise LlmError("http_error", "antwoord te groot")
        try:
            envelope: Any = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise LlmError("invalid_json", "Ollama gaf geen JSON-envelop") from None
        message = envelope.get("message") if isinstance(envelope, dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            raise LlmError("invalid_json", "geen message.content in het antwoord")
        return content
