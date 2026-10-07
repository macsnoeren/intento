"""Machinevertaling van een symboolset naar het Nederlands (INTENTO-NEW-DESIGN §15.1, stap 3).

    python -m agent_service.translate mulberry [--batch 20] [--limit 100] [--vocabulary-dir ../vocabulary]

Leest `sources/<slug>.manifest.json` (Engels, Duits, Frans en woordsoort per symbool) en vult
`translations/<slug>.nl.json` aan voor elk symbool **zonder** Nederlandse vertaling: het taalmodel geeft
het woord, synoniemen en een context uit de vaste lijst; het concept wordt uit het Engelse label
afgeleid (zelfde regel als de backend, getest tegen `contracts/concept_from_english.json`). Nieuwe regels
krijgen `status: machine`; een bestaande regel — `reviewed` of `machine` — wordt nooit overschreven.

Na elke batch wordt het bestand weggeschreven (atomair), zodat een onderbroken run hervat waar hij was.
Daarna zet de import van de backend (N2.7) de nieuwe symbolen in de Vocabulary, als machinevertaling
die de beheerder nog kan nakijken (N8.8).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .config import ConfigError, ServiceConfig
from .llm import LlmError, LlmProvider, OllamaProvider
from .prompts import Prompt, load_prompt

#: De vaste contexten van de Vocabulary (zelfde lijst als `VOCABULARY_CONTEXTS` in shared, getest tegen
#: `contracts/vocabulary_contexts.json`).
Context = Literal[
    "health",
    "food_drink",
    "feelings",
    "body",
    "people",
    "places",
    "activities",
    "things",
    "time",
    "other",
]
TRANSLATE_TIMEOUT_SECONDS = 60.0
DEFAULT_BATCH = 20

Label = Annotated[str, Field(min_length=1, max_length=60)]


class TranslatedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    label: Label
    synonyms: Annotated[list[Label], Field(max_length=5)] = []
    context: Context


class TranslationBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[TranslatedItem]


def concept_from_english(label: str) -> str:
    """Het concept bij een Engels label; dezelfde regel als `conceptFromEnglish` in de backend."""
    value = label.lower()
    value = re.sub(r"\s*,\s*to\s*$", "", value)
    value = re.sub("['\u2019]", "", value)
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def _clean_label(label: str) -> str:
    return " ".join(label.split())


def translate_batch(
    provider: LlmProvider,
    prompt: Prompt,
    symbols: Sequence[dict[str, Any]],
    timeout: float = TRANSLATE_TIMEOUT_SECONDS,
) -> list[dict[str, Any]]:
    """Vertaalt één batch; geeft regels voor het vertaalbestand terug (alleen gevraagde ids)."""
    payload = {
        "symbolen": [
            {
                "id": s["id"],
                "en": s["labels"].get("eng"),
                "de": s["labels"].get("deu"),
                "fr": s["labels"].get("fra"),
                "woordsoort": s.get("part_of_speech"),
            }
            for s in symbols
        ]
    }
    raw = provider.complete_json(
        prompt.text,
        json.dumps(payload, ensure_ascii=False),
        TranslationBatch.model_json_schema(),
        timeout,
    )
    batch = TranslationBatch.model_validate(raw)
    wanted = {s["id"]: s for s in symbols}
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in batch.items:
        source = wanted.get(item.id)
        if source is None or item.id in seen:
            continue  # een id dat niet gevraagd is, of dubbel: overslaan
        concept = concept_from_english(source["labels"].get("eng") or "")
        label = _clean_label(item.label)
        if not concept or not label:
            continue
        seen.add(item.id)
        synonyms = [
            s
            for s in dict.fromkeys(_clean_label(x) for x in item.synonyms)
            if s and s.lower() != label.lower()
        ]
        rows.append(
            {
                "id": item.id,
                "label": label,
                "synonyms": synonyms,
                "concept": concept,
                "context": item.context,
                "is_start": False,
                "status": "machine",
            }
        )
    return rows


def unique_concepts(items: list[dict[str, Any]], taken: set[str]) -> int:
    """Maakt de concepten van machineregels uniek met `_2`, `_3`, … (zelfde afspraak als de kernset).

    Mulberry heeft meerdere pictos met hetzelfde Engelse label (bv. vier keer "drink"). Het concept is
    de sleutel waarop de iconagent exact zoekt, dus het moet uniek zijn over alle vertaalbestanden heen.
    Nagekeken regels en concepten in `taken` (andere bestanden) blijven staan; een machineregel die een
    bezet concept heeft, krijgt een achtervoegsel. Idempotent. Geeft het aantal gewijzigde regels terug.
    """
    used = set(taken)
    used.update(item["concept"] for item in items if item["status"] == "reviewed")
    changed = 0
    for item in items:
        if item["status"] == "reviewed":
            continue
        concept, n = item["concept"], 2
        while concept in used:
            concept, n = f"{item['concept']}_{n}", n + 1
        if concept != item["concept"]:
            item["concept"] = concept
            changed += 1
        used.add(concept)
    return changed


def _write_atomic(path: Path, data: dict[str, Any]) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")
    os.replace(tmp, path)


def translate_set(
    slug: str,
    vocabulary_dir: Path,
    provider: LlmProvider,
    *,
    batch_size: int = DEFAULT_BATCH,
    limit: int | None = None,
    log: Callable[[str], None] = print,
) -> dict[str, int]:
    """Vult het vertaalbestand aan. Geeft telling terug: gevraagd, vertaald, mislukt."""
    manifest = json.loads((vocabulary_dir / "sources" / f"{slug}.manifest.json").read_text("utf-8"))
    path = vocabulary_dir / "translations" / f"{slug}.nl.json"
    translation: dict[str, Any] = (
        json.loads(path.read_text("utf-8"))
        if path.exists()
        else {"slug": slug, "language": "nl", "items": []}
    )
    items: list[dict[str, Any]] = translation["items"]
    taken = {
        item["concept"]
        for other in (vocabulary_dir / "translations").glob("*.nl.json")
        if other.name != path.name
        for item in json.loads(other.read_text("utf-8"))["items"]
    }
    if fixed := unique_concepts(items, taken):
        _write_atomic(path, translation)
        log(f"{fixed} dubbele concepten uniek gemaakt")
    done = {item["id"] for item in items}
    todo = [s for s in manifest["items"] if s["id"] not in done and s["labels"].get("eng")]
    if limit is not None:
        todo = todo[:limit]
    prompt = load_prompt("translate")
    counts = {"gevraagd": len(todo), "vertaald": 0, "mislukt": 0}
    for start in range(0, len(todo), batch_size):
        batch = todo[start : start + batch_size]
        try:
            rows = translate_batch(provider, prompt, batch)
        except (LlmError, ValueError) as error:
            # Deze batch overslaan; een volgende run probeert hem opnieuw.
            counts["mislukt"] += len(batch)
            log(f"batch {start // batch_size + 1}: mislukt ({type(error).__name__})")
            continue
        items.extend(rows)
        unique_concepts(items, taken)
        counts["vertaald"] += len(rows)
        counts["mislukt"] += len(batch) - len(rows)
        _write_atomic(path, translation)
        log(f"batch {start // batch_size + 1}: {len(rows)}/{len(batch)} vertaald")
    return counts


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m agent_service.translate")
    parser.add_argument("slug", help="de symboolset, bv. mulberry")
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--limit", type=int, default=None, help="hooguit zoveel symbolen")
    parser.add_argument(
        "--vocabulary-dir",
        default=str(Path(__file__).resolve().parents[2] / "vocabulary"),
        help="map met sources/ en translations/",
    )
    args = parser.parse_args(argv)
    try:
        ollama = ServiceConfig.from_env(
            {
                "SERVICE_TOKEN": "translate-only-0000",
                **{k: v for k, v in os.environ.items() if k.startswith("OLLAMA_")},
            },
            env_file=".env",
        ).ollama
    except ConfigError as error:
        print(f"Configuratiefout: {error}", file=sys.stderr)
        return 2
    if ollama is None:
        print("Zet OLLAMA_URL en OLLAMA_MODEL.", file=sys.stderr)
        return 2
    provider = OllamaProvider(ollama.url, ollama.model, api_key=ollama.api_key)
    counts = translate_set(
        args.slug,
        Path(args.vocabulary_dir),
        provider,
        batch_size=max(1, args.batch),
        limit=args.limit,
    )
    print(f"Klaar: {counts}")
    return 0 if counts["mislukt"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
