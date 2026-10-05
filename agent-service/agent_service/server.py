"""De HTTP-grens van de agentdienst (INTENTO-NEW-DESIGN §51).

- ``GET /health`` — leeft de dienst? Zonder token, zodat een gezondheidscheck geen geheim nodig heeft.
- ``POST /v1/turn`` — één beurt: `TurnRequest` → `TurnResponse`. Achter de API-key.

De agentdienst is **stateless** tussen beurten en wordt alleen door de backend aangeroepen. Er wordt
nooit gespreksinhoud gelogd: alleen pad, fase, status en duur.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from pydantic import ValidationError

from .auth import is_authorized
from .config import ServiceConfig
from .contracts import TurnRequest, TurnResponse
from .orchestrator import ProtocolError, step

#: Grootste request-body die we lezen. De compacte Vocabulary van de startset is enkele honderden kB.
MAX_BODY_BYTES = 8 * 1024 * 1024

TurnHandler = Callable[[TurnRequest], TurnResponse]

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
        if self.path.split("?", 1)[0] != "/v1/turn":
            self.send_error_json(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Onbekend pad.")
            return
        if not self.authorized():
            self.send_error_json(
                HTTPStatus.UNAUTHORIZED, "UNAUTHORIZED", "Ongeldige of ontbrekende API-key."
            )
            return
        payload = self.read_json()
        if payload is None:
            return
        try:
            request = TurnRequest.model_validate(payload)
        except ValidationError as exc:
            # Alleen de plek en de soort fout, nooit de waarde: die kan gespreksinhoud zijn.
            fields = ", ".join(
                ".".join(str(part) for part in error["loc"]) or "(body)"
                for error in exc.errors()[:5]
            )
            self.send_error_json(
                HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", f"Ongeldig TurnRequest: {fields}."
            )
            return

        started = time.perf_counter()
        try:
            response = self.server.handle_turn(request)
        except ProtocolError as exc:
            self.send_error_json(HTTPStatus.CONFLICT, "PROTOCOL_ERROR", str(exc))
            return
        except Exception:
            log.exception("Beurt mislukt (event=%s)", request.event.type)
            self.send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "De beurt kon niet worden verwerkt.",
            )
            return
        log.info(
            "Beurt: event=%s fase=%s presentatie=%s in %.0f ms",
            request.event.type,
            response.state.phase,
            response.presentation.kind,
            (time.perf_counter() - started) * 1000,
        )
        self.send_json(HTTPStatus.OK, response.model_dump(mode="json"))

    def read_json(self) -> Any:
        """Leest de body als JSON; stuurt zelf een 400 en geeft `None` terug als dat niet lukt."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_error_json(
                HTTPStatus.BAD_REQUEST, "INVALID_BODY", "Body ontbreekt of is te groot."
            )
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error_json(
                HTTPStatus.BAD_REQUEST, "INVALID_BODY", "Body is geen geldige JSON."
            )
            return None


class AgentServer(ThreadingHTTPServer):
    """HTTP-server die zijn configuratie aan de handlers doorgeeft."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: ServiceConfig, handle_turn: TurnHandler = step) -> None:
        super().__init__((config.host, config.port), AgentRequestHandler)
        self.config = config
        # Injecteerbaar, zodat tests een beurt kunnen laten mislukken zonder de orchestrator te raken.
        self.handle_turn = handle_turn
