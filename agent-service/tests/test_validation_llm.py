"""Validation Agent: het LLM-deel, aan en uit (N6.11, INTENTO-NEW-DESIGN §9)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.config import ConfigError, ServiceConfig
from agent_service.contracts import ContactEntry, TurnResponse
from agent_service.llm import FakeProvider, FakeResponse, LlmError
from agent_service.orchestrator import step
from tests.builders import START, request

TOKEN = "agt_" + "x" * 32


def question(text: str) -> dict[str, Any]:
    return {"concept": "pain", "text": text, "required_symbols": ["pain"], "confidence": 0.8}


def fake(questions: list[FakeResponse], verdicts: list[FakeResponse]) -> FakeProvider:
    return FakeProvider(routes={"Question Agent": questions, "Validation Agent": verdicts})


def validations(response: TurnResponse) -> list[Any]:
    return [d for d in response.decisions if d.agent == "validation-agent"]


def judge_calls(llm: FakeProvider) -> int:
    return sum("Validation Agent" in c.system for c in llm.calls)


class LlmValidationTest(unittest.TestCase):
    def test_standaard_uit(self) -> None:
        llm = fake([question("Heb je pijn?")], [{"valid": False, "reason": "nee"}])
        response = step(request(START), llm=llm)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        self.assertEqual(judge_calls(llm), 0)

    def test_aan_en_goedgekeurd(self) -> None:
        llm = fake([question("Heb je pijn?")], [{"valid": True, "reason": None}])
        response = step(request(START), llm=llm, llm_validation=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        [decision] = validations(response)
        self.assertEqual(
            (decision.status, decision.validation, decision.model, decision.prompt_version),
            ("success", "valid", "fake-model", "validation-v1"),
        )
        data = json.loads(next(c for c in llm.calls if "Validation Agent" in c.system).user)
        self.assertEqual(
            (data["vraag"], data["concept"], data["label"]), ("Heb je pijn?", "pain", "pijn")
        )

    def test_aan_en_afgekeurd_dan_een_nieuwe_vraag_met_de_reden(self) -> None:
        llm = fake(
            [question("Ervaar je momenteel lichamelijk ongemak?"), question("Heb je pijn?")],
            [{"valid": False, "reason": "te moeilijk woordgebruik"}, {"valid": True}],
        )
        response = step(request(START), llm=llm, llm_validation=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        second = [c for c in llm.calls if "Question Agent" in c.system][1]
        self.assertEqual(json.loads(second.user)["afgekeurd"], ["te moeilijk woordgebruik"])
        self.assertEqual([d.validation for d in validations(response)], ["invalid", "valid"])

    def test_uitval_van_het_model_dan_alleen_de_regels(self) -> None:
        llm = fake([question("Heb je pijn?")], [LlmError("timeout")])
        response = step(request(START), llm=llm, llm_validation=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        [decision] = validations(response)
        self.assertEqual((decision.status, decision.validation), ("fallback", "valid"))
        self.assertIn("llm: timeout", decision.reason or "")

    def test_regels_eerst_dan_geen_modelaanroep(self) -> None:
        mama = ContactEntry(id="c-1", name="Mama Jansen", vocabulary_item_id=None, sort_order=0)
        llm = fake([question("Heb je pijn, Jansen?"), question("Heb je pijn?")], [{"valid": True}])
        response = step(request(START, contacts=[mama]), llm=llm, llm_validation=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        # Eerste vraag: regels keuren af, het model wordt niet gevraagd; tweede: wel.
        self.assertEqual(judge_calls(llm), 1)

    def test_config(self) -> None:
        base = {"SERVICE_TOKEN": TOKEN}
        self.assertFalse(ServiceConfig.from_env(base, env_file=None).llm_validation)
        on = ServiceConfig.from_env({**base, "AGENT_LLM_VALIDATION": "true"}, env_file=None)
        self.assertTrue(on.llm_validation)
        with self.assertRaises(ConfigError):
            ServiceConfig.from_env({**base, "AGENT_LLM_VALIDATION": "misschien"}, env_file=None)


if __name__ == "__main__":
    unittest.main()
