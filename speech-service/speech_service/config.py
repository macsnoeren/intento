"""Configuratie van de spraakdienst (T18.1).

Zelfde lijn als de AI-worker: alles uit de omgeving (of een `.env`), luid falen bij ontbrekende of
ongeldige waarden, en geen dependencies voor het inlezen ervan.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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
class ServiceConfig:
    """De gevalideerde runtime-configuratie van de spraakdienst."""

    # Waar de dienst luistert. Standaard alleen op localhost: de backend hoort de enige beller te zijn,
    # en de dienst kent zelf geen gebruikers of rollen.
    host: str
    port: int

    # Map met de Piper-stemmodellen (`<naam>.onnx` + `<naam>.onnx.json`).
    voices_dir: Path

    # Gedeeld geheim dat de backend als `Authorization: Bearer …` meestuurt. Leeg = geen controle;
    # alleen verdedigbaar als de dienst op localhost of een gesloten netwerk staat.
    #
    # Te zetten als `SERVICE_TOKEN` of als `SPEECH_SERVICE_TOKEN` — de naam die de backend voor
    # dezelfde waarde gebruikt. Dat scheelt in een deployment één variabele: backend en dienst lezen
    # dan hetzelfde env-bestand en er is niets om uit de pas te laten lopen. En dat is geen
    # schoonheidsfoutje maar de gevaarlijke kant: staat alleen de backend-naam gevuld, dan zou deze
    # dienst zónder controle draaien terwijl de backend keurig een Bearer meestuurt — precies het
    # soort verschil dat werkt en niets zegt.
    service_token: str

    # Bovengrens op de tekstlengte, gelijk aan die van de backend (SPEECH_MAX_TEXT_LENGTH).
    max_text_length: int

    @staticmethod
    def from_env(
        environ: dict[str, str] | None = None,
        env_file: str | os.PathLike[str] | None = ".env",
    ) -> "ServiceConfig":
        """Bouwt en valideert de configuratie; directe env-vars winnen van `.env`-waarden."""
        merged: dict[str, str] = {}
        if env_file is not None:
            merged.update(load_env_file(env_file))
        merged.update(environ if environ is not None else os.environ)

        def optional(key: str, default: str) -> str:
            value = merged.get(key, "").strip()
            return value if value else default

        def positive_int(key: str, default: int) -> int:
            raw = merged.get(key, "").strip()
            if not raw:
                return default
            try:
                value = int(raw)
            except ValueError as exc:
                raise ConfigError(f"{key} moet een geheel getal zijn (kreeg {raw!r}).") from exc
            if value <= 0:
                raise ConfigError(f"{key} moet groter dan 0 zijn (kreeg {value}).")
            return value

        return ServiceConfig(
            host=optional("HOST", "127.0.0.1"),
            port=positive_int("PORT", 5002),
            voices_dir=Path(optional("VOICES_DIR", "voices")).expanduser(),
            service_token=optional("SERVICE_TOKEN", optional("SPEECH_SERVICE_TOKEN", "")),
            max_text_length=positive_int("MAX_TEXT_LENGTH", 300),
        )
