"""End-to-end HTTP-test: de échte `BackendClient`/`OllamaClient` (urllib) tegen lokale stub-servers.

De overige tests injecteren fakes; deze test verifieert de werkelijke draad: de bearer-header, het
204-geval bij een lege claim, de JSON-bodies en de round-trip claim → Ollama → resultaat. Er is geen
externe backend of Ollama nodig — beide draaien als kleine `http.server` in een thread.
"""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ai_worker.backend import BackendClient, Job
from ai_worker.ollama import OllamaClient
from ai_worker.worker import Worker

from .helpers import make_config

QUESTION_PAYLOAD = {
    "task": "select_next_question",
    "systemRules": [],
    "goal": "",
    "aacRules": [],
    "userContext": [],
    "conversationContext": [],
    "lastChoice": None,
    "availableSymbols": [{"concept": "appel", "label": "appel"}],
}


def _start_server(handler_cls) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    return server, f"http://{host}:{port}"


class BackendStub(BaseHTTPRequestHandler):
    """Emuleert het worker-protocol: één claim levert een job, daarna 204; resultaat wordt bewaard."""

    jobs: list[dict] = []
    state: dict = {}
    expected_token = "raw-token"

    def log_message(self, *_args) -> None:  # stil in de testoutput
        pass

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else {}

    def _send(self, status: int, body: dict | None = None) -> None:
        payload = json.dumps(body).encode("utf-8") if body is not None else b""
        self.send_response(status)
        if payload:
            self.send_header("Content-Type", "application/json")
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802 — vaste naam van BaseHTTPRequestHandler
        # Auth afdwingen zoals de echte backend (workerAuthorize): bearer-token verplicht.
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {self.expected_token}":
            self._send(401, {"error": "unauthenticated"})
            return

        if self.path == "/ai/worker/claim":
            if BackendStub.jobs:
                self._send(200, {"job": BackendStub.jobs.pop(0)})
            else:
                self._send(204)
            return
        if self.path.endswith("/result"):
            BackendStub.state["result"] = self._read_json()
            self._send(200, {"status": "ok"})
            return
        if self.path.endswith("/heartbeat"):
            self._send(200, {"leaseExpiresAt": "2026-07-11T00:00:00.000Z"})
            return
        if self.path.endswith("/fail"):
            BackendStub.state["failed"] = self._read_json()
            self._send(200, {"status": "ok"})
            return
        self._send(404, {"error": "not found"})


class OllamaStub(BaseHTTPRequestHandler):
    """Emuleert Ollama `/api/generate`: geeft een geldig gestructureerd antwoord terug."""

    def log_message(self, *_args) -> None:
        pass

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        structured = json.dumps(
            {
                "question": "Wat wil je eten?",
                "options": [{"symbol": "appel", "confidence": 0.9}],
                "reason": "stub",
            }
        )
        body = json.dumps({"response": structured, "done": True}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


class HttpIntegrationTests(unittest.TestCase):
    def test_real_clients_round_trip_claim_to_result(self) -> None:
        BackendStub.jobs = [{"id": "job-1", "task": "select_next_question", "payload": QUESTION_PAYLOAD}]
        BackendStub.state = {}
        backend_server, backend_url = _start_server(BackendStub)
        ollama_server, ollama_url = _start_server(OllamaStub)
        try:
            backend = BackendClient(backend_url, "raw-token")
            ollama = OllamaClient(ollama_url, "test-model")
            worker = Worker(make_config(max_threads=1), backend, ollama)

            # Claim één job via de echte urllib-client en verwerk hem end-to-end.
            job = backend.claim(timeout=2.0)
            self.assertIsInstance(job, Job)
            assert job is not None
            self.assertEqual(job.id, "job-1")
            worker.process_job(job)

            self.assertIn("result", BackendStub.state)
            self.assertEqual(BackendStub.state["result"]["question"], "Wat wil je eten?")
            self.assertEqual(BackendStub.state["result"]["options"][0]["symbol"], "appel")

            # De tweede claim is leeg (204) → None, zonder fout.
            self.assertIsNone(backend.claim(timeout=2.0))
        finally:
            backend_server.shutdown()
            backend_server.server_close()
            ollama_server.shutdown()
            ollama_server.server_close()

    def test_wrong_token_is_rejected(self) -> None:
        BackendStub.jobs = []
        backend_server, backend_url = _start_server(BackendStub)
        try:
            backend = BackendClient(backend_url, "wrong-token")
            from ai_worker.backend import BackendError

            with self.assertRaises(BackendError) as ctx:
                backend.claim(timeout=2.0)
            self.assertEqual(ctx.exception.status, 401)
        finally:
            backend_server.shutdown()
            backend_server.server_close()


if __name__ == "__main__":
    unittest.main()
