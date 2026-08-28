"""Nepsynthesizer: onthoudt wat hem gevraagd is en geeft herkenbare WAV-bytes terug."""

from __future__ import annotations

from speech_service.synthesizer import SynthesisError
from speech_service.voices import Voice


class FakeSynthesizer:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple[str, Voice]] = []
        self.fail = fail

    def synthesize(self, text: str, voice: Voice) -> bytes:
        self.calls.append((text, voice))
        if self.fail:
            raise SynthesisError("model deed het niet")
        return b"RIFF" + text.encode("utf-8")
