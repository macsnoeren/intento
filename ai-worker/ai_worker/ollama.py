"""Client naar een Ollama-endpoint (T5.6).

Roept ``POST {OLLAMA_URL}/api/generate`` aan met een systeem- en gebruikersprompt en een **JSON-schema**
als ``format``, zodat Ollama gestructureerde uitvoer afdwingt (Ollama structured outputs). De ruwe
JSON-tekst uit het ``response``-veld wordt geparsed en teruggegeven; de vorm wordt daarna in `prompts.py`
gecontroleerd en op de backend-grens (T5.5) nogmaals gevalideerd — een worker wordt nooit vertrouwd.

Bewust op `urllib` uit de stdlib gebouwd (geen third-party-dependencies).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class OllamaError(RuntimeError):
    """Ollama gaf een fout, was onbereikbaar, of leverde onleesbare/niet-JSON-uitvoer."""


class OllamaClient:
    """Dunne client rond ``/api/generate`` met afgedwongen JSON-structuur."""

    def __init__(self, base_url: str, model: str, *, opener: Any | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._opener = opener or urllib.request.build_opener()

    def generate_structured(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        timeout: float,
    ) -> dict[str, Any]:
        """Vraagt Ollama om gestructureerde JSON-uitvoer die aan `schema` voldoet en parset het resultaat.

        Gooit `OllamaError` bij een netwerk-/HTTP-fout, een time-out of onleesbare (niet-JSON) uitvoer.
        """
        body = {
            "model": self._model,
            "system": system,
            "prompt": prompt,
            # Ollama structured outputs: het JSON-schema dwingt de vorm van het antwoord af.
            "format": schema,
            "stream": False,
            # Lage temperatuur: we willen een stabiele, letterlijke keuze binnen de aangeboden concepten,
            # geen creatieve variatie (DESIGN §7.8).
            "options": {"temperature": 0.2},
        }
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{self._base_url}/api/generate", data=data, method="POST"
        )
        request.add_header("Content-Type", "application/json")
        try:
            with self._opener.open(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise OllamaError(f"Ollama gaf {exc.code}: {detail[:200]}") from exc
        except urllib.error.URLError as exc:
            raise OllamaError(f"Ollama onbereikbaar: {exc.reason}") from exc
        except TimeoutError as exc:  # urllib vertaalt socket-timeouts naar TimeoutError
            raise OllamaError("Ollama-aanroep verliep (time-out).") from exc

        try:
            envelope = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise OllamaError("Ollama-respons was geen geldige JSON.") from exc

        content = envelope.get("response")
        if not isinstance(content, str) or not content.strip():
            raise OllamaError("Ollama-respons bevatte geen 'response'-veld.")

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise OllamaError("Ollama leverde geen geldige JSON binnen het opgevraagde schema.") from exc

        if not isinstance(parsed, dict):
            raise OllamaError("Ollama leverde JSON die geen object is.")
        return parsed
