"""Contracten v1 tegen de gedeelde voorbeeldbestanden (N1.3, INTENTO-NEW-DESIGN §34).

De zod-kant (`shared/src/agent-contract.test.ts`) leest dezelfde bestanden en moet tot hetzelfde
oordeel komen. Een bestand heet `<model>.<naam>.json`; het voorvoegsel bepaalt tegen welk model het
gaat.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from pydantic import BaseModel, ValidationError

from agent_service.contracts import CONTRACT_VERSION, TurnRequest, TurnResponse, field_paths

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"

MODELS: dict[str, type[BaseModel]] = {
    "turn_request": TurnRequest,
    "turn_response": TurnResponse,
}


def fixtures(kind: str) -> list[Path]:
    files = sorted((FIXTURES / kind).glob("*.json"))
    if not files:
        raise AssertionError(f"Geen voorbeeldbestanden in {FIXTURES / kind}")
    return files


def model_for(path: Path) -> type[BaseModel]:
    prefix = path.name.split(".", 1)[0]
    if prefix not in MODELS:
        raise AssertionError(f"Onbekend model in bestandsnaam: {path.name}")
    return MODELS[prefix]


class ContractFixturesTest(unittest.TestCase):
    def test_elk_geldig_voorbeeld_wordt_geaccepteerd(self) -> None:
        for path in fixtures("valid"):
            with self.subTest(fixture=path.name):
                model_for(path).model_validate(json.loads(path.read_text("utf-8")))

    def test_elk_ongeldig_voorbeeld_wordt_geweigerd(self) -> None:
        for path in fixtures("invalid"):
            with self.subTest(fixture=path.name), self.assertRaises(ValidationError):
                model_for(path).model_validate(json.loads(path.read_text("utf-8")))

    def test_geldige_voorbeelden_overleven_een_rondgang(self) -> None:
        # Wat pydantic uitschrijft, moet hij zelf weer accepteren — en gelijk zijn aan het origineel.
        for path in fixtures("valid"):
            with self.subTest(fixture=path.name):
                data = json.loads(path.read_text("utf-8"))
                model = model_for(path).model_validate(data)
                self.assertEqual(model.model_dump(mode="json"), data)

    def test_velden_gelijk_aan_contracts_fields_json(self) -> None:
        # De zod-kant vergelijkt met hetzelfde bestand; een veld aan maar één kant faalt dus altijd.
        expected = json.loads((FIXTURES.parent / "fields.json").read_text("utf-8"))
        for name, model in MODELS.items():
            with self.subTest(model=name):
                self.assertEqual(field_paths(model.model_json_schema()), expected[name])

    def test_contractversie_is_1(self) -> None:
        self.assertEqual(CONTRACT_VERSION, 1)


if __name__ == "__main__":
    unittest.main()
