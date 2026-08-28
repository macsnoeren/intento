"""De HTTP-grens, met een échte server op een vrije poort (T18.1).

Bewust geen nagebootste sockets: juist wat hier misgaat — een ontbrekend token, een te grote body,
een stem die op een pad lijkt — zit in de HTTP-laag zelf.
"""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from speech_service.config import ServiceConfig
from speech_service.server import SpeechServer
from tests.fakes import FakeSynthesizer


class SpeechServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        voices_dir = Path(self._dir.name)
        (voices_dir / "nl_NL-pim-medium.onnx").write_bytes(b"nep")

        config = ServiceConfig(
            host="127.0.0.1",
            port=0,  # 0 = het besturingssysteem kiest een vrije poort
            voices_dir=voices_dir,
            service_token="geheim",
            max_text_length=300,
        )
        self.synthesizer = FakeSynthesizer()
        self.server = SpeechServer(config, self.synthesizer)
        self.base = f"http://{self.server.server_address[0]}:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def post(self, path: str, payload: dict, token: str | None = "geheim") -> tuple[int, bytes, str]:
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        if token is not None:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read(), response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), exc.headers.get("Content-Type", "")

    def test_health_noemt_de_beschikbare_stemmen(self) -> None:
        with urllib.request.urlopen(f"{self.base}/health", timeout=5) as response:
            self.assertEqual(response.status, 200)
            body = json.loads(response.read())
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["voices"], ["nl_NL-pim-medium"])

    def test_synthetiseert_en_geeft_wav_terug(self) -> None:
        status, body, content_type = self.post(
            "/synthesize",
            {"text": "Ik wil graag water drinken.", "voice": "nl_NL-pim-medium"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "audio/wav")
        self.assertTrue(body.startswith(b"RIFF"))
        text, voice = self.synthesizer.calls[0]
        self.assertEqual(text, "Ik wil graag water drinken.")
        self.assertEqual(voice.model, "nl_NL-pim-medium")

    def test_geeft_het_sprekernummer_door(self) -> None:
        status, _, _ = self.post("/synthesize", {"text": "Hallo", "voice": "nl_NL-mls-medium#5"})
        self.assertEqual(status, 200)
        self.assertEqual(self.synthesizer.calls[0][1].speaker_id, 5)

    def test_weigert_zonder_of_met_verkeerd_token(self) -> None:
        for token in (None, "fout"):
            with self.subTest(token=token):
                status, _, _ = self.post(
                    "/synthesize", {"text": "Hallo", "voice": "nl_NL-pim-medium"}, token
                )
                self.assertEqual(status, 401)
        self.assertEqual(self.synthesizer.calls, [])

    def test_weigert_onzinnige_invoer(self) -> None:
        for payload in (
            {"voice": "nl_NL-pim-medium"},
            {"text": "", "voice": "nl_NL-pim-medium"},
            {"text": "   ", "voice": "nl_NL-pim-medium"},
            {"text": "Hallo"},
            {"text": "Hallo", "voice": 42},
            {"text": "a" * 301, "voice": "nl_NL-pim-medium"},
        ):
            with self.subTest(payload=payload):
                status, _, _ = self.post("/synthesize", payload)
                self.assertEqual(status, 400)
        self.assertEqual(self.synthesizer.calls, [])

    def test_weigert_een_stem_die_op_een_pad_lijkt(self) -> None:
        status, body, _ = self.post("/synthesize", {"text": "Hallo", "voice": "../../etc/passwd"})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["error"]["code"], "INVALID_VOICE")
        self.assertEqual(self.synthesizer.calls, [])

    def test_meldt_een_mislukte_synthese_als_500(self) -> None:
        self.synthesizer.fail = True
        status, body, _ = self.post("/synthesize", {"text": "Hallo", "voice": "nl_NL-pim-medium"})
        self.assertEqual(status, 500)
        self.assertEqual(json.loads(body)["error"]["code"], "SYNTHESIS_FAILED")

    def test_onbekend_pad_geeft_404(self) -> None:
        status, _, _ = self.post("/spreek", {"text": "Hallo", "voice": "nl_NL-pim-medium"})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
