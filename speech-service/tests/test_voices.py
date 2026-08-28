"""Stem-id's: vorm, sprekernummer en de grens tegen path traversal (T18.1)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from speech_service.voices import VoiceError, available_voices, model_path, parse_voice


class ParseVoiceTest(unittest.TestCase):
    def test_enkelvoudige_stem(self) -> None:
        voice = parse_voice("nl_NL-pim-medium")
        self.assertEqual(voice.model, "nl_NL-pim-medium")
        self.assertIsNone(voice.speaker_id)

    def test_stem_met_spreker(self) -> None:
        voice = parse_voice("nl_NL-mls-medium#5")
        self.assertEqual(voice.model, "nl_NL-mls-medium")
        self.assertEqual(voice.speaker_id, 5)

    def test_ongeldige_id_wordt_geweigerd(self) -> None:
        # Het id wordt een bestandsnaam; alles wat op een pad lijkt moet hier stranden.
        for voice_id in (
            "../../etc/passwd",
            "nl_NL-pim-medium/../../geheim",
            "nl_NL-pim-medium#abc",
            "NL_nl-pim-medium",
            "pim",
            "",
            "nl_NL-pim-supreme",
        ):
            with self.subTest(voice_id=voice_id), self.assertRaises(VoiceError):
                parse_voice(voice_id)


class ModelPathTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.voices_dir = Path(self._dir.name)
        self.addCleanup(self._dir.cleanup)

    def test_meldt_ontbrekend_model(self) -> None:
        with self.assertRaisesRegex(VoiceError, "staat niet in"):
            model_path(self.voices_dir, parse_voice("nl_NL-pim-medium"))

    def test_wijst_naar_het_bestand(self) -> None:
        (self.voices_dir / "nl_NL-pim-medium.onnx").write_bytes(b"nep")
        path = model_path(self.voices_dir, parse_voice("nl_NL-pim-medium"))
        self.assertEqual(path.name, "nl_NL-pim-medium.onnx")

    def test_available_voices_somt_de_map_op(self) -> None:
        (self.voices_dir / "nl_NL-pim-medium.onnx").write_bytes(b"nep")
        (self.voices_dir / "nl_BE-nathalie-medium.onnx").write_bytes(b"nep")
        (self.voices_dir / "leesmij.txt").write_text("geen stem")
        self.assertEqual(
            available_voices(self.voices_dir), ["nl_BE-nathalie-medium", "nl_NL-pim-medium"]
        )
        self.assertEqual(available_voices(self.voices_dir / "bestaat-niet"), [])


if __name__ == "__main__":
    unittest.main()
