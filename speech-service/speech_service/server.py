"""De HTTP-grens van de spraakdienst (T18.1).

Twee endpoints, bewust niet meer:

- ``GET /health`` — leeft de dienst, en welke stemmen staan er? Zonder token, zodat een
  gezondheidscheck geen geheim nodig heeft. Geeft nooit iets prijs over wat er uitgesproken is.
- ``POST /synthesize`` — ``{"text": "...", "voice": "nl_NL-pim-medium"}`` → ``audio/wav``.
  Achter het gedeelde geheim, want dit is de enige route die rekentijd kost.

De dienst kent geen gebruikers, geen sessies en geen database: hij krijgt tekst en geeft geluid. Wie
wat mag laten uitspreken, bepaalt de backend — daar zitten de gebruikers, de profielen en de
autorisatie. Zo blijft deze dienst klein genoeg om te vertrouwen.

Er wordt niets gelogd van de tekst zelf (DESIGN §9.4): alleen de lengte, de stem en de duur.
"""

from __future__ import annotations

import json
import logging
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .config import ServiceConfig
from .synthesizer import SynthesisError, Synthesizer
from .voices import VoiceError, available_voices, parse_voice

log = logging.getLogger("speech_service")

#: Grootste request-body die we lezen. Ruim boven een zin, klein genoeg om geheugen te sparen.
MAX_BODY_BYTES = 8 * 1024


class SpeechRequestHandler(BaseHTTPRequestHandler):
    """Verwerkt één verzoek. `config` en `synthesizer` komen van de server-instantie."""

    server_version = "IntentoSpeech/1.0"
    protocol_version = "HTTP/1.1"

    @property
    def config(self) -> ServiceConfig:
        return self.server.config  # type: ignore[attr-defined]

    @property
    def synthesizer(self) -> Synthesizer:
        return self.server.synthesizer  # type: ignore[attr-defined]

    # --- helpers ---------------------------------------------------------------------------

    def _send(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # De audio is de zin van een gebruiker: nergens laten blijven hangen.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _send_error(self, status: HTTPStatus, code: str, message: str) -> None:
        # Zelfde vorm als de backend (DESIGN §8.1), zodat een fout hier net zo leesbaar is.
        self._send_json(status, {"error": {"code": code, "message": message}})

    def _authorized(self) -> bool:
        expected = self.config.service_token
        if not expected:
            return True
        header = self.headers.get("Authorization", "")
        return header.strip() == f"Bearer {expected}"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - signatuur van de stdlib
        log.info("%s - %s", self.address_string(), format % args)

    # --- routes ----------------------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 - signatuur van de stdlib
        if self.path.split("?", 1)[0] != "/health":
            self._send_error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Onbekend pad.")
            return
        self._send_json(
            HTTPStatus.OK,
            {"status": "ok", "voices": available_voices(self.config.voices_dir)},
        )

    def do_POST(self) -> None:  # noqa: N802 - signatuur van de stdlib
        if self.path.split("?", 1)[0] != "/synthesize":
            self._send_error(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Onbekend pad.")
            return
        if not self._authorized():
            self._send_error(HTTPStatus.UNAUTHORIZED, "UNAUTHORIZED", "Ongeldig of ontbrekend token.")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_BODY", "Body ontbreekt of is te groot.")
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_BODY", "Body is geen geldige JSON.")
            return

        if not isinstance(payload, dict):
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_BODY", "Body moet een object zijn.")
            return
        text = payload.get("text")
        voice_id = payload.get("voice")
        if not isinstance(text, str) or not text.strip():
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_TEXT", "`text` is verplicht.")
            return
        if len(text) > self.config.max_text_length:
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "TEXT_TOO_LONG",
                f"`text` mag hoogstens {self.config.max_text_length} tekens zijn.",
            )
            return
        if not isinstance(voice_id, str):
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_VOICE", "`voice` is verplicht.")
            return

        try:
            voice = parse_voice(voice_id)
        except VoiceError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, "INVALID_VOICE", str(exc))
            return

        started = time.perf_counter()
        try:
            audio = self.synthesizer.synthesize(text.strip(), voice)
        except VoiceError as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, "UNKNOWN_VOICE", str(exc))
            return
        except SynthesisError as exc:
            log.error("Synthese mislukte voor stem %s: %s", voice_id, exc)
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "SYNTHESIS_FAILED", str(exc))
            return

        # Nooit de tekst zelf in het log — alleen hoe lang hij was en hoe lang het duurde.
        log.info(
            "Gesynthetiseerd: stem=%s tekens=%d bytes=%d in %.0f ms",
            voice_id,
            len(text),
            len(audio),
            (time.perf_counter() - started) * 1000,
        )
        self._send(HTTPStatus.OK, audio, "audio/wav")


class SpeechServer(ThreadingHTTPServer):
    """HTTP-server die zijn configuratie en synthesizer aan de handlers doorgeeft."""

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: ServiceConfig, synthesizer: Synthesizer) -> None:
        super().__init__((config.host, config.port), SpeechRequestHandler)
        self.config = config
        self.synthesizer = synthesizer
