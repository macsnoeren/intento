"""Tests voor de Ollama-client, met nadruk op het optionele bearer-token (T9.9).

Een gehost of afgeschermd Ollama-endpoint eist `Authorization: Bearer …`; een lokale Ollama juist niet.
De client stuurt de header daarom alléén mee als `OLLAMA_TOKEN` gevuld is. Geen echt netwerk: we vangen
de uitgaande `urllib.request.Request` op met een nep-opener.
"""

from __future__ import annotations

import json
import unittest
from typing import Any

from ai_worker.ollama import OllamaClient

SCHEMA: dict[str, Any] = {"type": "object"}


class _Response:
    """Minimale respons-double die als contextmanager werkt, net als `urlopen`."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class _CapturingOpener:
    """Nep-opener die de uitgaande request bewaart en een geldig Ollama-antwoord teruggeeft."""

    def __init__(self) -> None:
        self.request: Any = None

    def open(self, request: Any, timeout: float) -> _Response:  # noqa: ARG002
        self.request = request
        return _Response({"response": json.dumps({"message": "ok"}), "done": True})


class OllamaTokenTests(unittest.TestCase):
    def _call(self, token: str) -> _CapturingOpener:
        opener = _CapturingOpener()
        client = OllamaClient("http://ollama.test", "test-model", token=token, opener=opener)
        parsed = client.generate_structured(
            system="s", prompt="p", schema=SCHEMA, timeout=5.0
        )
        self.assertEqual(parsed, {"message": "ok"})
        return opener

    def test_sends_bearer_header_when_token_is_set(self) -> None:
        opener = self._call("geheim-token")
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer geheim-token")

    def test_sends_no_authorization_header_without_token(self) -> None:
        opener = self._call("")
        self.assertIsNone(opener.request.get_header("Authorization"))

    def test_whitespace_only_token_counts_as_no_token(self) -> None:
        opener = self._call("   ")
        self.assertIsNone(opener.request.get_header("Authorization"))


if __name__ == "__main__":
    unittest.main()
