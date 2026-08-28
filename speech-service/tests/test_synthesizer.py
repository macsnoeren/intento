"""De Piper-synthesizer: wat er gebeurt als een stemmodel niet deugt (T18.1).

Aanleiding: een afgebroken download liet een half `.onnx`-bestand achter. Het laden daarvan gooide een
`onnxruntime`-fout die ongefilterd uit de handler kwam, waarna de verbinding wegviel — de backend zag
een time-out en de begeleider las "draait de spraakdienst?", terwijl die gewoon draaide. Sindsdien is
een onlaadbaar model een gewone `SynthesisError` mét een aanwijzing wat te doen.

De test draait alleen als Piper geïnstalleerd is; zonder Piper valt hij op een andere (ook correcte)
`SynthesisError` en zou hij dus niets bewijzen.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from speech_service.synthesizer import PiperSynthesizer, SynthesisError
from speech_service.voices import VoiceError, parse_voice

try:  # pragma: no cover - hangt van de installatie af
    import piper  # noqa: F401

    PIPER_AANWEZIG = True
except ImportError:  # pragma: no cover
    PIPER_AANWEZIG = False


class PiperSynthesizerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.voices_dir = Path(self._dir.name)
        self.addCleanup(self._dir.cleanup)

    def test_ontbrekend_model_meldt_waar_het_hoort_te_staan(self) -> None:
        synth = PiperSynthesizer(self.voices_dir)
        with self.assertRaises(VoiceError) as ctx:
            synth.synthesize("Hallo", parse_voice("nl_NL-pim-medium"))
        self.assertIn("download_voices", str(ctx.exception))

    @unittest.skipUnless(PIPER_AANWEZIG, "piper-tts niet geïnstalleerd")
    def test_half_gedownload_model_geeft_een_nette_fout(self) -> None:
        # Een afgebroken download: geldig begin, maar niet af.
        (self.voices_dir / "nl_NL-pim-medium.onnx").write_bytes(b"\x08\x08\x12\x07pytorch" + b"\x00" * 512)
        (self.voices_dir / "nl_NL-pim-medium.onnx.json").write_text("{}")

        synth = PiperSynthesizer(self.voices_dir)
        with self.assertRaises(SynthesisError) as ctx:
            synth.synthesize("Hallo", parse_voice("nl_NL-pim-medium"))

        melding = str(ctx.exception)
        self.assertIn("nl_NL-pim-medium.onnx", melding)
        # De melding moet zeggen wat de beheerder moet dóén, niet alleen dát het misging.
        self.assertIn("download_voices", melding)


if __name__ == "__main__":
    unittest.main()
