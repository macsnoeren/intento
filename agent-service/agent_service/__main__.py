"""Entrypoint van de agentdienst: ``python -m agent_service`` (of ``python run.py``)."""

from __future__ import annotations

import logging
import sys
from functools import partial

from .config import ConfigError, ServiceConfig
from .llm import LlmProvider, OllamaProvider
from .orchestrator import step
from .server import AgentServer


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("agent_service")

    try:
        config = ServiceConfig.from_env()
    except ConfigError as exc:
        log.error("Configuratiefout: %s", exc)
        return 1

    provider: LlmProvider | None = None
    if config.ollama is not None:
        provider = OllamaProvider(
            config.ollama.url, config.ollama.model, api_key=config.ollama.api_key
        )
        log.info("Taalmodel: %s via %s", config.ollama.model, config.ollama.url)
    else:
        log.info("Geen taalmodel (OLLAMA_URL leeg): alle agents draaien op hun regels.")

    server = AgentServer(
        config,
        handle_turn=partial(
            step,
            llm=provider,
            propose_threshold=config.propose_threshold,
            llm_validation=config.llm_validation,
            llm_safety=config.llm_safety,
        ),
    )
    log.info("Agentdienst luistert op http://%s:%d", config.host, config.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Signaal ontvangen; agentdienst stopt netjes…")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
