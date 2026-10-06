"""Configuratie van de agentdienst (INTENTO-NEW-DESIGN §3.1, §51).

Zelfde lijn als de spraakdienst: alles uit de omgeving (of een `.env`), luid falen bij ontbrekende of
ongeldige waarden. Eén verschil: `SERVICE_TOKEN` is hier **verplicht**. De agentdienst wordt alleen
door de backend aangeroepen, en zonder gedeeld geheim zou iedereen op het netwerk de LLM kunnen
aansturen.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

#: Minimale lengte van het gedeelde geheim; korter is te raden.
MIN_TOKEN_LENGTH = 16


def load_env_file(path: str | os.PathLike[str]) -> dict[str, str]:
    """Leest een eenvoudig `.env`-bestand (KEY=VALUE per regel) in een dict.

    Ondersteunt commentaar (`#`), lege regels, een optioneel `export`-voorvoegsel en aanhalingstekens
    rond de waarde. Bestaat het bestand niet, dan een lege dict — `.env` is optioneel.
    """
    result: dict[str, str] = {}
    file = Path(path)
    if not file.is_file():
        return result
    for raw in file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            result[key] = value
    return result


class ConfigError(ValueError):
    """Configuratie ontbreekt of is ongeldig — de dienst mag niet opstarten."""


@dataclass(frozen=True)
class OllamaSettings:
    """Waar het taalmodel draait (§35). Lokaal zonder sleutel, in de cloud met `api_key`."""

    url: str
    model: str
    api_key: str | None = None

    def __repr__(self) -> str:
        # De sleutel nooit in een log of traceback.
        key = "***" if self.api_key else None
        return f"OllamaSettings(url={self.url!r}, model={self.model!r}, api_key={key!r})"


@dataclass(frozen=True)
class ServiceConfig:
    """De gevalideerde runtime-configuratie van de agentdienst."""

    # Waar de dienst luistert. Standaard alleen op localhost: de backend is de enige beller.
    host: str
    port: int

    # Gedeeld geheim dat de backend als `Authorization: Bearer …` meestuurt (AGENT_SERVICE_TOKEN in de
    # backend). Verplicht.
    service_token: str

    # Het taalmodel. `None` = geen LLM geconfigureerd: alle agents draaien op hun regels.
    ollama: OllamaSettings | None = None

    # Vanaf welke zekerheid de Intent Agent "Bedoel je …?" mag voorstellen (§6, V7).
    propose_threshold: float = 0.85

    def __repr__(self) -> str:
        return (
            f"ServiceConfig(host={self.host!r}, port={self.port}, service_token='***', "
            f"ollama={self.ollama!r}, propose_threshold={self.propose_threshold})"
        )

    @staticmethod
    def from_env(
        environ: dict[str, str] | None = None,
        env_file: str | os.PathLike[str] | None = ".env",
    ) -> ServiceConfig:
        """Bouwt en valideert de configuratie; directe env-vars winnen van `.env`-waarden."""
        merged: dict[str, str] = {}
        if env_file is not None:
            merged.update(load_env_file(env_file))
        merged.update(environ if environ is not None else os.environ)

        def optional(key: str, default: str) -> str:
            value = merged.get(key, "").strip()
            return value if value else default

        port_raw = optional("PORT", "5003")
        try:
            port = int(port_raw)
        except ValueError as exc:
            raise ConfigError(f"PORT moet een geheel getal zijn (kreeg {port_raw!r}).") from exc
        if not 0 < port < 65536:
            raise ConfigError(f"PORT moet tussen 1 en 65535 liggen (kreeg {port}).")

        # Dezelfde waarde mag ook onder de backend-naam staan, zodat backend en dienst één env-bestand
        # kunnen delen zonder dat er iets uit de pas loopt.
        token = optional("SERVICE_TOKEN", optional("AGENT_SERVICE_TOKEN", ""))
        if not token:
            raise ConfigError(
                "SERVICE_TOKEN ontbreekt. Verzin een gedeeld geheim, bv. met "
                "`python -c \"import secrets; print('agt_' + secrets.token_hex(24))\"`, en zet "
                "dezelfde waarde in de backend als AGENT_SERVICE_TOKEN."
            )
        if len(token) < MIN_TOKEN_LENGTH:
            raise ConfigError(
                f"SERVICE_TOKEN is te kort (minstens {MIN_TOKEN_LENGTH} tekens, kreeg {len(token)})."
            )

        threshold_raw = optional("AGENT_PROPOSE_THRESHOLD", "0.85")
        try:
            threshold = float(threshold_raw)
        except ValueError as exc:
            raise ConfigError(
                f"AGENT_PROPOSE_THRESHOLD moet een getal zijn (kreeg {threshold_raw!r})."
            ) from exc
        if not 0.5 <= threshold <= 1.0:
            raise ConfigError(
                f"AGENT_PROPOSE_THRESHOLD moet tussen 0,5 en 1 liggen (kreeg {threshold})."
            )

        return ServiceConfig(
            host=optional("HOST", "127.0.0.1"),
            port=port,
            service_token=token,
            ollama=_ollama_settings(optional),
            propose_threshold=threshold,
        )


def _ollama_settings(optional: Callable[[str, str], str]) -> OllamaSettings | None:
    """`OLLAMA_URL` leeg = geen LLM. Anders: http(s), een model, en een API-key alleen over https."""
    url = optional("OLLAMA_URL", "")
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ConfigError(f"OLLAMA_URL moet een http(s)-URL zijn (kreeg {url!r}).")
    model = optional("OLLAMA_MODEL", "")
    if not model:
        raise ConfigError("OLLAMA_MODEL ontbreekt: welk model moet de agentdienst gebruiken?")
    api_key = optional("OLLAMA_API_KEY", "") or None
    if api_key and parsed.scheme != "https":
        raise ConfigError(
            "OLLAMA_API_KEY gaat alleen over https: zet OLLAMA_URL op een https-adres "
            "(bv. https://ollama.com) of laat de sleutel weg voor een lokale Ollama."
        )
    return OllamaSettings(url=url.rstrip("/"), model=model, api_key=api_key)
