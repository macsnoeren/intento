"""Synthese met Piper (T18.1).

Piper is een neuraal TTS-systeem (VITS in ONNX) dat volledig lokaal draait: op een gewone CPU kost
een korte zin ± 100 ms. Dat is precies wat Intento nodig heeft — geen cloud, dus de zin van de
gebruiker verlaat de eigen omgeving niet (DESIGN §9.4).

De import van `piper` gebeurt **binnen** de functie die hem nodig heeft, zodat de dienst en zijn tests
te draaien zijn zonder dat het model-pakket geïnstalleerd is. Wie geen Piper heeft, krijgt een
begrijpelijke fout in plaats van een ImportError bij het opstarten.

Licentie: Piper staat onder GPL-3.0 (het bevat espeak-ng). Daarom draait het hier als een **losstaand
proces** achter een HTTP-grens en niet als bibliotheek in de backend; zie `docs/adr/0015`.
"""

from __future__ import annotations

import io
import threading
import wave
from pathlib import Path
from typing import Protocol

from .voices import Voice, model_path


class Synthesizer(Protocol):
    """Zet tekst om in WAV-bytes. Een Protocol, zodat de tests een nepversie kunnen meegeven."""

    def synthesize(self, text: str, voice: Voice) -> bytes: ...


class SynthesisError(RuntimeError):
    """De synthese lukte niet (model ontbreekt, Piper niet geïnstalleerd, of het model faalde)."""


class PiperSynthesizer:
    """Synthetiseert met Piper en houdt geladen modellen in het geheugen.

    Een model laden kost ± 1 seconde; dat wil je één keer betalen en niet per zin. De cache is
    per **model**: een meersprekermodel wordt één keer geladen en daarna met verschillende
    `speaker_id`'s aangeroepen.
    """

    def __init__(self, voices_dir: Path) -> None:
        self._voices_dir = voices_dir
        self._models: dict[str, object] = {}
        # De HTTP-server is multithreaded; twee gelijktijdige eerste-aanvragen mogen niet
        # hetzelfde model dubbel laden (geheugen) of half geladen gebruiken.
        self._lock = threading.Lock()

    def _load(self, voice: Voice) -> object:
        with self._lock:
            cached = self._models.get(voice.key)
            if cached is not None:
                return cached
            path = model_path(self._voices_dir, voice)
            try:
                from piper import PiperVoice
            except ImportError as exc:  # pragma: no cover - hangt van de installatie af
                raise SynthesisError(
                    "Piper is niet geïnstalleerd. Installeer het met: pip install piper-tts"
                ) from exc
            model = PiperVoice.load(str(path), config_path=str(path) + ".json")
            self._models[voice.key] = model
            return model

    def synthesize(self, text: str, voice: Voice) -> bytes:
        model = self._load(voice)
        try:
            from piper import SynthesisConfig
        except ImportError as exc:  # pragma: no cover - hangt van de installatie af
            raise SynthesisError(
                "Piper is niet geïnstalleerd. Installeer het met: pip install piper-tts"
            ) from exc

        buffer = io.BytesIO()
        try:
            with wave.open(buffer, "wb") as wav:
                if voice.speaker_id is None:
                    model.synthesize_wav(text, wav)  # type: ignore[attr-defined]
                else:
                    model.synthesize_wav(  # type: ignore[attr-defined]
                        text, wav, syn_config=SynthesisConfig(speaker_id=voice.speaker_id)
                    )
        except Exception as exc:  # noqa: BLE001 - alles wat Piper gooit wordt één nette fout
            raise SynthesisError(f"Synthese mislukte: {exc}") from exc
        return buffer.getvalue()
