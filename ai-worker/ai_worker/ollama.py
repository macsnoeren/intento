"""Client naar een Ollama-endpoint (T5.6).

Roept ``POST {OLLAMA_URL}/api/generate`` aan met een systeem- en gebruikersprompt en een **JSON-schema**
als ``format``, zodat Ollama gestructureerde uitvoer afdwingt (Ollama structured outputs). De ruwe
JSON-tekst uit het ``response``-veld wordt geparsed en teruggegeven; de vorm wordt daarna in `prompts.py`
gecontroleerd en op de backend-grens (T5.5) nogmaals gevalideerd — een worker wordt nooit vertrouwd.

Is `OLLAMA_TOKEN` gezet, dan gaat elke aanroep met een ``Authorization: Bearer``-header de deur uit
(T9.9): een gehost of afgeschermd Ollama-endpoint eist dat. Zonder token gaat er geen header mee, zoals
bij een lokale Ollama.

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

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        token: str = "",
        opener: Any | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        # Bearer-token voor een afgeschermd/gehost Ollama-endpoint (T9.9). Leeg = geen header, zodat een
        # lokale Ollama zonder authenticatie precies werkt zoals voorheen.
        self._token = token.strip()
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
            # Ollama structured outputs: het JSON-schema stuurt de vorm van het antwoord. Let op: bij
            # *cloud*- en reasoning-modellen dwingt Ollama dit schema niet hard af (de constrained decoding
            # zit in de lokale sampler). Daarom beschrijft de prompt de exacte JSON-velden óók expliciet
            # (zie prompts.py) — dat maakt de worker robuust over lokale én cloud-modellen.
            "format": schema,
            "stream": False,
            # Reasoning-modellen (qwen3, gpt-oss, …) stoppen hun uitvoer anders in een apart `thinking`-veld
            # en laten `response` leeg. We hebben alleen de gestructureerde JSON nodig, dus zetten we het
            # "denken" uit zodat de JSON gegarandeerd in `response` staat.
            "think": False,
            # Lage temperatuur: we willen een stabiele, letterlijke keuze binnen de aangeboden concepten,
            # geen creatieve variatie (DESIGN §7.8).
            "options": {"temperature": 0.2},
        }
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{self._base_url}/api/generate", data=data, method="POST"
        )
        request.add_header("Content-Type", "application/json")
        if self._token:
            request.add_header("Authorization", f"Bearer {self._token}")
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
