"""Entrypoint van de spraakdienst: ``python -m speech_service`` (of ``python run.py``)."""

from __future__ import annotations

import logging
import sys

from .config import ConfigError, ServiceConfig
from .server import SpeechServer
from .synthesizer import PiperSynthesizer
from .voices import available_voices


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("speech_service")

    try:
        config = ServiceConfig.from_env()
    except ConfigError as exc:
        log.error("Configuratiefout: %s", exc)
        return 1

    voices = available_voices(config.voices_dir)
    if not voices:
        # Geen harde fout: de dienst mag draaien terwijl de stemmen nog gedownload worden. Wel luid,
        # want zonder model kan hij niets uitspreken.
        log.warning(
            "Geen stemmodellen gevonden in %s. Downloaden met: "
            "python -m piper.download_voices --data-dir %s nl_NL-pim-medium",
            config.voices_dir,
            config.voices_dir,
        )
    else:
        log.info("Stemmen beschikbaar: %s", ", ".join(voices))

    server = SpeechServer(config, PiperSynthesizer(config.voices_dir))
    log.info("Spraakdienst luistert op http://%s:%d", config.host, config.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Signaal ontvangen; spraakdienst stopt netjes…")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
