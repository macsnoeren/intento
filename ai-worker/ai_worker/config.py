"""Configuratie van de Ollama-worker (T5.6).

Alle instellingen komen uit de omgeving (env), zodat de worker op een losse machine gedeployd kan worden
zonder codewijziging. Ontbrekende of ongeldige waarden falen **luid** bij het opstarten (net als de
zod-gevalideerde `env.ts` van de backend) in plaats van stilletjes verkeerd te draaien.

Bewust dependency-vrij: een minimale `.env`-lezer (`load_env_file`) vervangt `python-dotenv`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: str | os.PathLike[str]) -> dict[str, str]:
    """Leest een eenvoudig `.env`-bestand (KEY=VALUE per regel) in een dict.

    Ondersteunt commentaarregels (`#`), lege regels, een optioneel `export`-voorvoegsel en enkele/dubbele
    aanhalingstekens rond de waarde. Bewust minimalistisch — geen variabele-interpolatie. Bestaat het
    bestand niet, dan geeft de functie een lege dict (het `.env`-bestand is optioneel; env-vars mogen ook
    direct in de omgeving staan).
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
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            result[key] = value
    return result


class ConfigError(ValueError):
    """Configuratie ontbreekt of is ongeldig — de worker mag niet opstarten."""


@dataclass(frozen=True)
class WorkerConfig:
    """De gevalideerde runtime-configuratie van de worker."""

    # Verbinding met de Intento-backend (T5.5). `backend_url` is de basis; de worker-paden
    # (`/ai/worker/...`) worden eraan geplakt. `worker_token` is het rauwe infrastructuur-token.
    backend_url: str
    worker_token: str

    # Ollama-endpoint op (mogelijk) een andere machine, plus het te gebruiken model.
    ollama_url: str
    ollama_model: str

    # Maximum aantal gelijktijdige Ollama-aanroepen. Begrenst zowel de threadpool als het claimen, zodat
    # de worker (en daarmee de site) Ollama nooit overvraagt (DESIGN §9.4).
    max_threads: int

    # Time-out (s) voor één Ollama-aanroep — een hangende inferentie mag de worker niet blokkeren.
    ollama_timeout_s: float

    # Client-time-out (s) voor de long-poll-claim. Moet ruim boven de server-long-poll
    # (`AI_WORKER_CLAIM_LONGPOLL_MS`, standaard 20 s) liggen, anders breekt de claim voortijdig af.
    claim_timeout_s: float

    # Interval (s) tussen heartbeats tijdens lange inferentie. Moet ruim onder de server-lease
    # (`AI_WORKER_LEASE_MS`, standaard 30 s) liggen, anders verloopt de lease en wordt de job teruggelegd.
    heartbeat_interval_s: float

    # Pauze (s) na een lege claim (204) voordat opnieuw wordt geprobeerd. De server long-pollt al, dus
    # klein houden; bestaat vooral om een strakke lus te vermijden als de server niet long-pollt.
    idle_sleep_s: float

    @staticmethod
    def from_env(
        environ: dict[str, str] | None = None,
        env_file: str | os.PathLike[str] | None = ".env",
    ) -> "WorkerConfig":
        """Bouwt en valideert de configuratie uit de omgeving (en optioneel een `.env`-bestand).

        Directe env-vars winnen van `.env`-waarden, zodat een deploy-omgeving het bestand kan overschrijven.
        """
        merged: dict[str, str] = {}
        if env_file is not None:
            merged.update(load_env_file(env_file))
        merged.update(environ if environ is not None else os.environ)

        def required(key: str) -> str:
            value = merged.get(key, "").strip()
            if not value:
                raise ConfigError(f"{key} is verplicht.")
            return value

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

        def positive_float(key: str, default: float) -> float:
            raw = merged.get(key, "").strip()
            if not raw:
                return default
            try:
                value = float(raw)
            except ValueError as exc:
                raise ConfigError(f"{key} moet een getal zijn (kreeg {raw!r}).") from exc
            if value <= 0:
                raise ConfigError(f"{key} moet groter dan 0 zijn (kreeg {value}).")
            return value

        backend_url = required("BACKEND_URL").rstrip("/")
        ollama_url = optional("OLLAMA_URL", "http://localhost:11434").rstrip("/")

        # In productie hoort verkeer over TLS te lopen (DESIGN §9.4). Lokale hosts blijven toegestaan voor
        # dev en voor een Ollama op dezelfde machine.
        for label, url in (("BACKEND_URL", backend_url), ("OLLAMA_URL", ollama_url)):
            if not (url.startswith("http://") or url.startswith("https://")):
                raise ConfigError(f"{label} moet met http:// of https:// beginnen (kreeg {url!r}).")

        config = WorkerConfig(
            backend_url=backend_url,
            worker_token=required("WORKER_TOKEN"),
            ollama_url=ollama_url,
            ollama_model=required("OLLAMA_MODEL"),
            max_threads=positive_int("MAX_THREADS", 2),
            ollama_timeout_s=positive_float("OLLAMA_TIMEOUT_S", 120.0),
            claim_timeout_s=positive_float("CLAIM_TIMEOUT_S", 30.0),
            heartbeat_interval_s=positive_float("HEARTBEAT_INTERVAL_S", 10.0),
            idle_sleep_s=positive_float("IDLE_SLEEP_S", 1.0),
        )
        return config
