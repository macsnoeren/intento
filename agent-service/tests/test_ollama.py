"""OllamaProvider tegen een nep-HTTP-server (N5.2, INTENTO-NEW-DESIGN §35)."""

from __future__ import annotations

import json
import threading
import time
import unittest
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar

from agent_service.llm import JsonObject, LlmError, OllamaProvider, extract_json_object

SCHEMA: JsonObject = {"type": "object", "properties": {"question": {"type": "string"}}}

#: Wat de nep-Ollama per aanroep doet: (status, inhoud van message.content, vertraging in s).
Reply = tuple[int, str, float]


class FakeOllama(BaseHTTPRequestHandler):
    replies: ClassVar[list[Reply]] = []
    seen: ClassVar[list[tuple[str, dict[str, str], Any]]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length))
        FakeOllama.seen.append((self.path, dict(self.headers.items()), body))
        status, content, delay = FakeOllama.replies.pop(0) if FakeOllama.replies else (500, "", 0)
        if delay:
            time.sleep(delay)
        payload = json.dumps(
            {"model": body.get("model"), "message": {"role": "assistant", "content": content}}
            if status == 200
            else {"error": "nee"}
        ).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, format: str, *args: Any) -> None:
        pass


class OllamaProviderTest(unittest.TestCase):
    server: ThreadingHTTPServer
    url: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        cls.server.daemon_threads = True
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        FakeOllama.replies = []
        FakeOllama.seen = []

    def provider(self, api_key: str | None = None) -> OllamaProvider:
        return OllamaProvider(self.url, "gemma3:4b", api_key=api_key)

    def complete(self, provider: OllamaProvider, timeout: float = 5.0) -> JsonObject:
        return provider.complete_json("systeem", "gebruiker", SCHEMA, timeout)

    def test_kaal_json(self) -> None:
        FakeOllama.replies = [(200, '{"question": "Pijn?"}', 0)]
        self.assertEqual(self.complete(self.provider()), {"question": "Pijn?"})
        path, headers, body = FakeOllama.seen[0]
        self.assertEqual(path, "/api/chat")
        self.assertEqual(body["model"], "gemma3:4b")
        self.assertEqual(body["format"], SCHEMA)
        self.assertIs(body["stream"], False)
        self.assertEqual(
            body["messages"],
            [
                {"role": "system", "content": "systeem"},
                {"role": "user", "content": "gebruiker"},
            ],
        )
        self.assertNotIn("Authorization", headers)

    def test_gefencet(self) -> None:
        FakeOllama.replies = [(200, '```json\n{"question": "Hoofd?"}\n```', 0)]
        self.assertEqual(self.complete(self.provider()), {"question": "Hoofd?"})

    def test_met_inleiding(self) -> None:
        FakeOllama.replies = [(200, 'Hier is het antwoord: {"question": "Buik?"} Succes!', 0)]
        self.assertEqual(self.complete(self.provider()), {"question": "Buik?"})

    def test_cloud_stuurt_de_sleutel_als_bearer(self) -> None:
        FakeOllama.replies = [(200, "{}", 0)]
        self.complete(self.provider(api_key="sleutel-123"))
        self.assertEqual(FakeOllama.seen[0][1].get("Authorization"), "Bearer sleutel-123")

    def test_een_nieuwe_poging_bij_ongeldige_json(self) -> None:
        FakeOllama.replies = [(200, "dit is geen json", 0), (200, '{"question": "Pijn?"}', 0)]
        self.assertEqual(self.complete(self.provider()), {"question": "Pijn?"})
        self.assertEqual(len(FakeOllama.seen), 2)

    def test_hooguit_een_nieuwe_poging(self) -> None:
        FakeOllama.replies = [(200, "nee", 0), (200, "[1, 2]", 0), (200, "{}", 0)]
        with self.assertRaises(LlmError) as raised:
            self.complete(self.provider())
        self.assertEqual(raised.exception.reason, "invalid_json")
        self.assertEqual(len(FakeOllama.seen), 2)

    def test_time_out(self) -> None:
        FakeOllama.replies = [(200, "{}", 1.5)]
        started = time.monotonic()
        with self.assertRaises(LlmError) as raised:
            self.complete(self.provider(), timeout=0.3)
        self.assertEqual(raised.exception.reason, "timeout")
        self.assertLess(time.monotonic() - started, 1.2)

    def test_401_is_unauthorized_zonder_nieuwe_poging(self) -> None:
        FakeOllama.replies = [(401, "", 0), (200, "{}", 0)]
        with self.assertRaises(LlmError) as raised:
            self.complete(self.provider(api_key="fout"))
        self.assertEqual(raised.exception.reason, "unauthorized")
        self.assertEqual(len(FakeOllama.seen), 1)

    def test_500_is_http_error(self) -> None:
        FakeOllama.replies = [(500, "", 0)]
        with self.assertRaises(LlmError) as raised:
            self.complete(self.provider())
        self.assertEqual(raised.exception.reason, "http_error")

    def test_onbereikbaar(self) -> None:
        provider = OllamaProvider("http://127.0.0.1:1", "m")
        with self.assertRaises(LlmError) as raised:
            self.complete(provider)
        self.assertEqual(raised.exception.reason, "unavailable")

    def test_foutmelding_bevat_geen_inhoud(self) -> None:
        FakeOllama.replies = [(200, "geheime zin zonder json", 0), (200, "nog steeds niet", 0)]
        with self.assertRaises(LlmError) as raised:
            self.complete(self.provider())
        self.assertNotIn("geheime", str(raised.exception))


class ExtractJsonTest(unittest.TestCase):
    def test_varianten(self) -> None:
        cases: list[tuple[str, JsonObject]] = [
            ('{"a": 1}', {"a": 1}),
            ('```\n{"a": 1}\n```', {"a": 1}),
            ('```JSON {"a": {"b": 2}} ```', {"a": {"b": 2}}),
            ('Zeker! {"a": [1, 2]}\nKlaar.', {"a": [1, 2]}),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(extract_json_object(text), expected)

    def test_geen_object(self) -> None:
        bad: list[str] = ["", "geen json", "[1, 2]", '"tekst"', "{kapot"]
        check: Callable[[str], JsonObject] = extract_json_object
        for text in bad:
            with self.subTest(text=text), self.assertRaises(LlmError):
                check(text)


if __name__ == "__main__":
    unittest.main()
