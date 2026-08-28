"""Stem-id's: valideren en vertalen naar een modelbestand (T18.1).

Een stem-id is de naam van een Piper-stemmodel, eventueel met `#<spreker>` erachter voor een
meersprekermodel — bijvoorbeeld `nl_NL-pim-medium` of `nl_NL-mls-medium#5`.

Het id komt van de backend, die het al tegen de gedeelde catalogus valideert. Toch controleert deze
dienst het opnieuw: hij draait als eigen proces en moet ook veilig zijn als er ooit iets anders tegen
praat. De vorm is streng afgedwongen, want dit id wordt een **bestandspad** — zonder die controle zou
een id als `../../etc/passwd` de dienst een willekeurig bestand laten openen (path traversal).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

#: Vorm van een stem-id: taalcode, naam, kwaliteitsniveau en optioneel een sprekernummer.
VOICE_ID_PATTERN = re.compile(r"^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(x_low|low|medium|high)(#\d{1,3})?$")


class VoiceError(ValueError):
    """Het stem-id deugt niet of het model staat er niet."""


@dataclass(frozen=True)
class Voice:
    """Een opgelost stem-id: welk model, en welke spreker daarbinnen."""

    model: str
    speaker_id: int | None

    @property
    def key(self) -> str:
        """De sleutel waaronder een geladen model in het geheugen blijft (per model, niet per spreker)."""
        return self.model


def parse_voice(voice_id: str) -> Voice:
    """Splitst een stem-id in model + spreker en weigert alles wat niet aan de vorm voldoet."""
    if not VOICE_ID_PATTERN.match(voice_id):
        raise VoiceError(f"Ongeldig stem-id: {voice_id!r}")
    model, _, speaker = voice_id.partition("#")
    return Voice(model=model, speaker_id=int(speaker) if speaker else None)


def model_path(voices_dir: Path, voice: Voice) -> Path:
    """Het pad naar het `.onnx`-bestand van deze stem; bestaat het niet, dan een duidelijke fout."""
    path = voices_dir / f"{voice.model}.onnx"
    # Dubbele bodem naast het patroon hierboven: het opgeloste pad moet ín de stemmenmap liggen.
    if not path.resolve().is_relative_to(voices_dir.resolve()):
        raise VoiceError(f"Stem valt buiten de stemmenmap: {voice.model!r}")
    if not path.is_file():
        raise VoiceError(
            f"Stemmodel {voice.model!r} staat niet in {voices_dir}. "
            f"Downloaden met: python -m piper.download_voices --data-dir {voices_dir} {voice.model}"
        )
    return path


def available_voices(voices_dir: Path) -> list[str]:
    """De stemmodellen die in de map staan (voor `GET /health` en het opstartlogboek)."""
    if not voices_dir.is_dir():
        return []
    return sorted(path.stem for path in voices_dir.glob("*.onnx"))
