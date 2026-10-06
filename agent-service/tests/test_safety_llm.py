"""Safety Agent: het LLM-deel, en tegelijk met Validation (N6.12, INTENTO-NEW-DESIGN §10)."""

from __future__ import annotations

import json
import time
import unittest
from typing import Any

from agent_service.config import ConfigError, ServiceConfig
from agent_service.contracts import TurnResponse
from agent_service.llm import FakeCall, FakeProvider, FakeResponse, LlmError
from agent_service.orchestrator import step
from tests.builders import START, request

TOKEN = "agt_" + "x" * 32


def question(text: str) -> dict[str, Any]:
    return {"concept": "pain", "text": text, "required_symbols": ["pain"], "confidence": 0.8}


def fake(
    questions: list[FakeResponse],
    safety: list[FakeResponse],
    validation: list[FakeResponse] | None = None,
) -> FakeProvider:
    return FakeProvider(
        routes={
            "Question Agent": questions,
            "Safety Agent": safety,
            "Validation Agent": validation or [],
        }
    )


def safety_decisions(response: TurnResponse) -> list[Any]:
    return [d for d in response.decisions if d.agent == "safety-agent"]


def slow(answer: dict[str, Any], seconds: float) -> Any:
    def respond(call: FakeCall) -> dict[str, Any]:
        time.sleep(seconds)
        return answer

    return respond


class LlmSafetyTest(unittest.TestCase):
    def test_standaard_uit(self) -> None:
        llm = fake([question("Heb je pijn?")], [{"appropriate": False, "reason": "nee"}])
        step(request(START), llm=llm)
        self.assertFalse(any("Safety Agent" in c.system for c in llm.calls))

    def test_passend(self) -> None:
        llm = fake([question("Heb je pijn?")], [{"appropriate": True}])
        response = step(request(START), llm=llm, llm_safety=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        [decision] = safety_decisions(response)
        self.assertEqual(
            (decision.status, decision.validation, decision.prompt_version),
            ("success", "valid", "safety-v1"),
        )
        data = json.loads(next(c for c in llm.calls if "Safety Agent" in c.system).user)
        self.assertEqual((data["vraag"], data["aantal_vragen"]), ("Heb je pijn?", 0))

    def test_niet_passend_dan_een_nieuwe_vraag_met_de_reden(self) -> None:
        llm = fake(
            [question("Doet het heel erg pijn, ben je bang?"), question("Heb je pijn?")],
            [{"appropriate": False, "reason": "te beangstigend"}, {"appropriate": True}],
        )
        response = step(request(START), llm=llm, llm_safety=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        second = [c for c in llm.calls if "Question Agent" in c.system][1]
        self.assertEqual(json.loads(second.user)["afgekeurd"], ["te beangstigend"])
        self.assertEqual([d.validation for d in safety_decisions(response)], ["invalid", "valid"])

    def test_uitval_dan_alleen_de_regels(self) -> None:
        llm = fake([question("Heb je pijn?")], [LlmError("unavailable")])
        response = step(request(START), llm=llm, llm_safety=True)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        [decision] = safety_decisions(response)
        self.assertEqual((decision.status, decision.validation), ("fallback", "valid"))

    def test_validation_en_safety_tegelijk(self) -> None:
        delay = 0.4
        llm = fake(
            [question("Heb je pijn?")],
            [slow({"appropriate": True}, delay)],
            [slow({"valid": True}, delay)],
        )
        started = time.monotonic()
        response = step(request(START), llm=llm, llm_validation=True, llm_safety=True)
        elapsed = time.monotonic() - started
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        # Na elkaar zou het ≥ 0,8 s duren; tegelijk ongeveer de langste van de twee.
        self.assertGreaterEqual(elapsed, delay)
        self.assertLess(elapsed, 2 * delay - 0.1)
        agents = [d.agent for d in response.decisions]
        self.assertIn("validation-agent", agents)
        self.assertIn("safety-agent", agents)

    def test_config(self) -> None:
        base = {"SERVICE_TOKEN": TOKEN}
        self.assertFalse(ServiceConfig.from_env(base, env_file=None).llm_safety)
        self.assertTrue(
            ServiceConfig.from_env({**base, "AGENT_LLM_SAFETY": "1"}, env_file=None).llm_safety
        )
        with self.assertRaises(ConfigError):
            ServiceConfig.from_env({**base, "AGENT_LLM_SAFETY": "soms"}, env_file=None)


if __name__ == "__main__":
    unittest.main()
