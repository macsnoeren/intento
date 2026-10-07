"""Machinevertaling van een symboolset (N8.7, INTENTO-NEW-DESIGN §15.1 stap 3)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, get_args

from agent_service.llm import FakeCall, FakeProvider, LlmError
from agent_service.translate import Context, concept_from_english, translate_set, unique_concepts

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"


def manifest_item(item_id: int, en: str, pos: str) -> dict[str, Any]:
    return {
        "id": item_id,
        "part_of_speech": pos,
        "image_url": f"https://example.org/{item_id}.svg",
        "format": "svg",
        "labels": {"eng": en, "deu": f"{en}-de", "fra": f"{en}-fr"},
    }


def answer_for(call: FakeCall) -> dict[str, Any]:
    """Een vertaler die werkwoorden als heel werkwoord en zelfstandige naamwoorden kaal teruggeeft."""
    words = {
        "Eat , To": "eten",
        "Apple": "appel",
        "Go Out , To": "naar buiten gaan",
        "Chair": "stoel",
    }
    symbols = json.loads(call.user)["symbolen"]
    return {
        "items": [
            {
                "id": s["id"],
                "label": words.get(s["en"], s["en"].lower()),
                "synonyms": ["opeten", "eten"] if s["en"] == "Eat , To" else [],
                "context": "food_drink" if s["en"] in ("Eat , To", "Apple") else "things",
            }
            for s in symbols
        ]
    }


class TranslateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "sources").mkdir()
        (self.dir / "translations").mkdir()
        manifest = {
            "slug": "set",
            "items": [
                manifest_item(1, "Eat , To", "verb"),
                manifest_item(2, "Apple", "noun"),
                manifest_item(3, "Go Out , To", "verb"),
                manifest_item(4, "Chair", "noun"),
                manifest_item(5, "Pain", "noun"),
            ],
        }
        (self.dir / "sources" / "set.manifest.json").write_text(json.dumps(manifest), "utf-8")
        reviewed = {
            "slug": "set",
            "language": "nl",
            "items": [
                {
                    "id": 5,
                    "label": "pijn",
                    "synonyms": ["zeer"],
                    "concept": "pain",
                    "context": "health",
                    "is_start": True,
                    "status": "reviewed",
                }
            ],
        }
        self.path = self.dir / "translations" / "set.nl.json"
        self.path.write_text(json.dumps(reviewed), "utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def items(self) -> dict[int, dict[str, Any]]:
        return {i["id"]: i for i in json.loads(self.path.read_text("utf-8"))["items"]}

    def test_vertaalt_wat_ontbreekt_als_machine(self) -> None:
        llm = FakeProvider([answer_for] * 5)
        counts = translate_set("set", self.dir, llm, batch_size=2, log=lambda _: None)
        self.assertEqual(counts, {"gevraagd": 4, "vertaald": 4, "mislukt": 0})
        items = self.items()
        self.assertEqual(
            items[1],
            {
                "id": 1,
                "label": "eten",
                "synonyms": ["opeten"],
                "concept": "eat",
                "context": "food_drink",
                "is_start": False,
                "status": "machine",
            },
        )
        self.assertEqual((items[3]["label"], items[3]["concept"]), ("naar buiten gaan", "go_out"))
        self.assertEqual((items[2]["label"], items[4]["label"]), ("appel", "stoel"))
        # De woordsoort gaat mee naar het model.
        sent = json.loads(llm.calls[0].user)["symbolen"]
        self.assertEqual([(s["id"], s["woordsoort"]) for s in sent], [(1, "verb"), (2, "noun")])

    def test_reviewed_blijft_staan(self) -> None:
        translate_set("set", self.dir, FakeProvider([answer_for] * 5), log=lambda _: None)
        self.assertEqual(self.items()[5]["label"], "pijn")
        self.assertEqual(self.items()[5]["status"], "reviewed")

    def test_hervat_waar_hij_gebleven_was(self) -> None:
        first = FakeProvider([answer_for, LlmError("timeout")])
        counts = translate_set("set", self.dir, first, batch_size=2, log=lambda _: None)
        self.assertEqual(counts, {"gevraagd": 4, "vertaald": 2, "mislukt": 2})
        self.assertEqual(sorted(self.items()), [1, 2, 5])
        second = FakeProvider([answer_for])
        counts = translate_set("set", self.dir, second, batch_size=2, log=lambda _: None)
        self.assertEqual(counts, {"gevraagd": 2, "vertaald": 2, "mislukt": 0})
        self.assertEqual(sorted(self.items()), [1, 2, 3, 4, 5])
        self.assertEqual([s["id"] for s in json.loads(second.calls[0].user)["symbolen"]], [3, 4])

    def test_vreemde_ids_en_ongeldige_context_worden_geweigerd(self) -> None:
        bad = FakeProvider(
            [
                {"items": [{"id": 99, "label": "x", "context": "things"}]},
                {"items": [{"id": 3, "label": "x", "context": "onzin"}]},
            ]
        )
        counts = translate_set("set", self.dir, bad, batch_size=2, limit=4, log=lambda _: None)
        self.assertEqual(counts["vertaald"], 0)
        self.assertEqual(sorted(self.items()), [5])

    def test_limiet(self) -> None:
        counts = translate_set(
            "set", self.dir, FakeProvider([answer_for]), limit=1, log=lambda _: None
        )
        self.assertEqual(counts["gevraagd"], 1)

    def test_dubbele_concepten_krijgen_een_achtervoegsel(self) -> None:
        # Een ander vertaalbestand heeft "chair" al; Mulberry heeft twee keer "Eat , To" en "Pain".
        manifest = json.loads((self.dir / "sources" / "set.manifest.json").read_text("utf-8"))
        manifest["items"] += [
            manifest_item(6, "Eat , To", "verb"),
            manifest_item(7, "Pain", "noun"),
        ]
        (self.dir / "sources" / "set.manifest.json").write_text(json.dumps(manifest), "utf-8")
        other = {
            "slug": "x",
            "language": "nl",
            "items": [{**self.items()[5], "id": 9, "concept": "chair"}],
        }
        (self.dir / "translations" / "x.nl.json").write_text(json.dumps(other), "utf-8")

        translate_set(
            "set", self.dir, FakeProvider([answer_for] * 2), batch_size=3, log=lambda _: None
        )
        concepts = {i: item["concept"] for i, item in self.items().items()}
        self.assertEqual(
            concepts,
            {1: "eat", 2: "apple", 3: "go_out", 4: "chair_2", 5: "pain", 6: "eat_2", 7: "pain_2"},
        )
        # Nog een keer draaien verandert niets.
        items = list(self.items().values())
        self.assertEqual(unique_concepts(items, {"chair"}), 0)


class ContractTest(unittest.TestCase):
    def test_contexten_gelijk_aan_het_contract(self) -> None:
        expected = json.loads((CONTRACTS / "vocabulary_contexts.json").read_text("utf-8"))
        self.assertEqual(list(get_args(Context)), expected)

    def test_concept_uit_het_engels_zoals_de_backend(self) -> None:
        for label, concept in json.loads(
            (CONTRACTS / "concept_from_english.json").read_text("utf-8")
        ):
            with self.subTest(label=label):
                self.assertEqual(concept_from_english(label), concept)


if __name__ == "__main__":
    unittest.main()
