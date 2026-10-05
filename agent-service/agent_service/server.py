"""De HTTP-grens van de agentdienst (INTENTO-NEW-DESIGN §51).

- ``GET /health`` — leeft de dienst? Zonder token, zodat een gezondheidscheck geen geheim nodig heeft.

De agentdienst is **stateless** tussen beurten en wordt alleen door de backend aangeroepen. Er wordt
nooit gespreksinhoud gelogd: alleen pad, status en duur.
"""

from __future__ import annotations

import json
import logging
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .auth import is_authorized
from .config import ServiceConfig

log = logging.getLogger("agent_service")


class AgentRequestHandler(BaseHTTPRequestHandler):
    """Verwerkt één verzoek. De configuratie komt van de server-instantie."""

    server_version = "IntentoAgents/1.0"
    protocol_version = "HTTP/1.1"
    server: AgentServer

    @property
    def config(self) -> ServiceConfig:
        return self.server.config

    # --- helpers ---------------------------------------------------------------------------

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: HTTPStatus, code: str, message: str) -> None:
        # Dezelfde foutvorm als de backend: `{ "error": { "code", "message" } }`.
        self.send_json(status, {"error": {"code": code, "message": message}})

    def authorized(self) -> bool:
        return is_authorized(self.headers.get("Authorization"), self.config.service_token)

    def log_message(self, format: str, *args: Any) -> None:
        log.info("%s - %s", self.address_string(), format % args)

    # --- routes ----------------------------------------------------------------------------

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] != "/health":
            self.send_error_json(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Onbekend pad.")
            return
        self.send_json(HTTPStatus.OK, {"status": "ok", "service": "intento-agent-service"})

    def do_POST(self) -> None:
        self.send_error_json(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Onbekend pad.")


class AgentServer(ThreadingHTTPServer):
    """HTTP-server die zijn configuratie aan de handlers doorgeeft."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: ServiceConfig) -> None:
        super().__init__((config.host, config.port), AgentRequestHandler)
        self.config = config
