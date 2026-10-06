"""Evaluatie: speelt alle scenario's en rapporteert per agent (INTENTO-NEW-DESIGN §54).

    python -m agent_service.eval --provider fake
    python -m agent_service.eval --provider ollama --runs 3 --set meting --vocabulary vocabulary.json

`--provider ollama` gebruikt `OLLAMA_URL`/`OLLAMA_MODEL`/`OLLAMA_API_KEY` uit de omgeving (of `.env`).
Het rapport noemt per scenario of het slaagde, hoeveel vragen en beurten het kostte en hoe lang het
duurde, en per agent hoe vaak hij draaide, met welke status en hoe lang gemiddeld. Er staat geen
gespreksinhoud in, behalve de bevestigde boodschap van de gesimuleerde gebruiker.

De provider gaat via `engine_for` naar de orchestrator. Tot de LLM-agents er zijn (fase N6) draaien
alle agents op hun regels; het rapport laat dat zien in de statussen.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field

from .config import ConfigError, ServiceConfig
from .contracts import TurnRequest, TurnResponse, VocabularyEntry
from .llm import FakeProvider, LlmProvider, OllamaProvider
from .orchestrator import step
from .scenarios import EVAL_SCENARIOS, SCENARIOS, Engine, Scenario, ScenarioResult, play


def engine_for(
    provider: LlmProvider | None, *, llm_validation: bool = False, llm_safety: bool = False
) -> Engine:
    """De orchestrator met deze provider."""

    def engine(request: TurnRequest) -> TurnResponse:
        return step(request, llm=provider, llm_validation=llm_validation, llm_safety=llm_safety)

    return engine


@dataclass
class AgentStats:
    runs: int = 0
    total_ms: int = 0
    max_ms: int = 0
    statuses: dict[str, int] = field(default_factory=lambda: defaultdict(int))


@dataclass
class Report:
    results: list[ScenarioResult]

    @property
    def success_rate(self) -> float:
        return sum(r.success for r in self.results) / len(self.results) if self.results else 0.0

    def agents(self) -> dict[str, AgentStats]:
        stats: dict[str, AgentStats] = defaultdict(AgentStats)
        for result in self.results:
            for decision in result.decisions:
                entry = stats[decision.agent]
                entry.runs += 1
                entry.total_ms += decision.latency_ms
                entry.max_ms = max(entry.max_ms, decision.latency_ms)
                entry.statuses[decision.status] += 1
        return dict(sorted(stats.items()))

    def render(self) -> str:
        lines = ["Scenario's:"]
        for r in self.results:
            outcome = "geslaagd" if r.success else f"MISLUKT ({r.failure})"
            lines.append(
                f"  {r.scenario:<20} {outcome:<12} vragen {r.questions:>2}  beurten {r.turns:>2}  "
                f"{r.duration_ms:>6} ms  boodschap: {r.message or '-'}"
            )
        questions = [r.questions for r in self.results]
        lines.append(
            f"Geslaagd: {self.success_rate:.0%} van {len(self.results)}; "
            f"gemiddeld {sum(questions) / max(len(questions), 1):.1f} vragen"
        )
        turns = sorted(ms for r in self.results for ms in r.turn_ms)
        if turns:
            lines.append(
                f"Beurten: {len(turns)}; mediaan {turns[len(turns) // 2]} ms, "
                f"p90 {turns[min(len(turns) - 1, int(len(turns) * 0.9))]} ms, max {turns[-1]} ms"
            )
        lines.append("Agents:")
        for agent, s in self.agents().items():
            statuses = ", ".join(f"{k} {v}" for k, v in sorted(s.statuses.items()))
            lines.append(
                f"  {agent:<16} {s.runs:>3}x  gem. {s.total_ms / max(s.runs, 1):>7.0f} ms  "
                f"max {s.max_ms:>6} ms  ({statuses})"
            )
        return "\n".join(lines)


def run(
    provider: LlmProvider | None,
    scenarios: Sequence[Scenario] = SCENARIOS,
    runs: int = 1,
    *,
    llm_validation: bool = False,
    llm_safety: bool = False,
) -> Report:
    engine = engine_for(provider, llm_validation=llm_validation, llm_safety=llm_safety)
    return Report([play(s, engine) for _ in range(runs) for s in scenarios])


def load_vocabulary(path: str) -> list[VocabularyEntry]:
    """Een Vocabulary als JSON-lijst van `VocabularyEntry` (bv. geëxporteerd uit de backend)."""
    with open(path, encoding="utf-8") as file:
        raw = json.load(file)
    return [VocabularyEntry.model_validate(entry) for entry in raw]


def build_provider(name: str) -> LlmProvider:
    if name == "fake":
        return FakeProvider()
    ollama = ServiceConfig.from_env(
        {"SERVICE_TOKEN": "eval-only-token-0000", **_env()}, env_file=".env"
    ).ollama
    if ollama is None:
        raise ConfigError("Zet OLLAMA_URL en OLLAMA_MODEL voor --provider ollama.")
    return OllamaProvider(ollama.url, ollama.model, api_key=ollama.api_key)


def _env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.startswith("OLLAMA_")}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m agent_service.eval")
    parser.add_argument("--provider", choices=["fake", "ollama"], default="fake")
    parser.add_argument("--runs", type=int, default=1, help="hoe vaak elk scenario gespeeld wordt")
    parser.add_argument(
        "--set",
        choices=["basis", "meting"],
        default="basis",
        help="basis = pijn en dorst; meting = hoofdpijn, dorst en duizelig (N6.13)",
    )
    parser.add_argument(
        "--vocabulary", help="JSON-bestand met de Vocabulary (standaard een kleine set)"
    )
    parser.add_argument("--llm-validation", action="store_true")
    parser.add_argument("--llm-safety", action="store_true")
    args = parser.parse_args(argv)
    try:
        provider = build_provider(args.provider)
    except ConfigError as error:
        print(f"Configuratiefout: {error}", file=sys.stderr)
        return 2
    scenarios = EVAL_SCENARIOS if args.set == "meting" else SCENARIOS
    if args.vocabulary:
        vocabulary = load_vocabulary(args.vocabulary)
        scenarios = [dataclasses.replace(s, vocabulary=vocabulary) for s in scenarios]
    report = run(
        provider,
        scenarios,
        runs=max(1, args.runs),
        llm_validation=args.llm_validation,
        llm_safety=args.llm_safety,
    )
    print(f"Provider: {args.provider} ({provider.model})")
    print(report.render())
    return 0 if report.success_rate == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
