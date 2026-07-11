"""Entrypoint van de Ollama-worker: ``python -m ai_worker`` (of ``python run.py``).

Laadt en valideert de configuratie, bouwt de clients, en draait de worker-lus tot Ctrl-C. Bij een
configuratiefout stopt het proces luid met een duidelijke melding (exit 1).
"""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType

from .backend import BackendClient
from .config import ConfigError, WorkerConfig
from .ollama import OllamaClient
from .worker import Worker


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("ai_worker")

    try:
        config = WorkerConfig.from_env()
    except ConfigError as exc:
        log.error("Configuratiefout: %s", exc)
        return 1

    backend = BackendClient(config.backend_url, config.worker_token)
    ollama = OllamaClient(config.ollama_url, config.ollama_model)
    worker = Worker(config, backend, ollama)

    def handle_signal(_signum: int, _frame: FrameType | None) -> None:
        log.info("Signaal ontvangen; worker stopt netjes…")
        worker.stop()

    signal.signal(signal.SIGINT, handle_signal)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_signal)

    worker.run()
    log.info("Worker gestopt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
