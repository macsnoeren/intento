"""De HTTP-grens van de agentdienst, met een échte server op een vrije poort (N1.1)."""

from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request
from typing import Any

from agent_service.auth import is_authorized
from agent_service.config import ServiceConfig
from agent_service.server import AgentServer

TOKEN = "agt_" + "y" * 32


class AuthTest(unittest.TestCase):
    def test_juiste_bearer(self) -> None:
        self.assertTrue(is_authorized(f"Bearer {TOKEN}", TOKEN))

    def test_fout_of_ontbrekend(self) -> None:
        self.assertFalse(is_authorized(None, TOKEN))
        self.assertFalse(is_authorized("", TOKEN))
        self.assertFalse(is_authorized(TOKEN, TOKEN))  # zonder "Bearer "
        self.assertFalse(is_authorized(f"Bearer {TOKEN}x", TOKEN))
        self.assertFalse(is_authorized("Bearer ", TOKEN))

    def test_leeg_verwacht_token_accepteert_nooit(self) -> None:
        self.assertFalse(is_authorized("Bearer ", ""))
        self.assertFalse(is_authorized("Bearer iets", ""))


class ServerTestCase(unittest.TestCase):
    """Basis: start een AgentServer op poort 0 en ruimt hem na de test op."""

    def make_server(self) -> AgentServer:
        return AgentServer(ServiceConfig(host="127.0.0.1", port=0, service_token=TOKEN))

    def setUp(self) -> None:
        self.server = self.make_server()
        host, port = self.server.server_address[0], self.server.server_address[1]
        self.base = f"http://{host!s}:{port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        token: str | None = TOKEN,
    ) -> tuple[int, Any]:
        req = urllib.request.Request(f"{self.base}{path}", data=body, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if token is not None:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"null")


class HealthTest(ServerTestCase):
    def test_health_zonder_token(self) -> None:
        status, body = self.request("GET", "/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok", "service": "intento-agent-service"})

    def test_onbekend_pad_is_404_in_de_foutvorm(self) -> None:
        status, body = self.request("GET", "/bestaat-niet")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
