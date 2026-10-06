"""Agent-envelop en promptbestanden (N5.3, INTENTO-NEW-DESIGN §34)."""

from __future__ import annotations

import itertools
import unittest
from collections.abc import Callable

from pydantic import BaseModel, ValidationError

from agent_service.agents.envelope import RULES_VERSION, LlmAttempt, run_agent
from agent_service.llm import LlmError
from agent_service.prompts import load_prompt


class Question(BaseModel):
    text: str


def ticking(step: float = 0.25) -> Callable[[], float]:
    """Een klok die bij elke aflezing `step` seconden verder staat."""
    counter = itertools.count()
    return lambda: next(counter) * step


def failing_llm(error: Exception) -> LlmAttempt[Question]:
    def run() -> Question:
        raise error

    return LlmAttempt(run=run, model="gpt-oss:120b-cloud", prompt_version="question-v1")


def rules() -> Question:
    return Question(text="Pijn?")


class RunAgentTest(unittest.TestCase):
    def test_llm_gelukt_is_success(self) -> None:
        attempt = LlmAttempt(
            run=lambda: Question(text="Heb je pijn?"), model="m", prompt_version="question-v1"
        )
        result = run_agent("question-agent", rules=rules, llm=attempt, clock=ticking())
        self.assertEqual(result.status, "success")
        self.assertEqual(result.value, Question(text="Heb je pijn?"))
        decision = result.to_decision()
        self.assertEqual(
            (decision.model, decision.prompt_version, decision.validation, decision.latency_ms),
            ("m", "question-v1", "valid", 250),
        )

    def test_zonder_llm_zijn_de_regels_de_agent(self) -> None:
        result = run_agent("question-agent", rules=rules, rules_reason="één concept per vraag")
        self.assertEqual(result.status, "success")
        decision = result.to_decision()
        self.assertEqual((decision.model, decision.prompt_version), (None, RULES_VERSION))
        self.assertEqual(decision.reason, "één concept per vraag")

    def test_llm_fout_levert_fallback(self) -> None:
        for error, reason in [
            (LlmError("timeout", "na 5 s"), "llm: timeout"),
            (LlmError("invalid_json"), "llm: invalid_json"),
            (RuntimeError("bug"), "fout: RuntimeError"),
        ]:
            with self.subTest(error=error):
                result = run_agent("question-agent", rules=rules, llm=failing_llm(error))
                self.assertEqual(result.status, "fallback")
                self.assertEqual(result.value, Question(text="Pijn?"))
                self.assertEqual(result.reason, reason)
                self.assertEqual(result.to_decision().model, "gpt-oss:120b-cloud")

    def test_ongeldig_antwoord_is_fallback_met_validatie_invalid(self) -> None:
        def run() -> Question:
            return Question.model_validate({"tekst": "geheime inhoud"})

        attempt = LlmAttempt(run=run, model="m", prompt_version="question-v1")
        result = run_agent("question-agent", rules=rules, llm=attempt)
        self.assertEqual((result.status, result.validation), ("fallback", "invalid"))
        assert result.reason is not None
        self.assertIn("text", result.reason)
        self.assertNotIn("geheime", result.reason)

    def test_ook_de_regels_falen_dan_failed_en_geen_exceptie(self) -> None:
        def broken() -> Question:
            raise LookupError("geen item")

        result = run_agent("icon-agent", rules=broken, llm=failing_llm(LlmError("unavailable")))
        self.assertEqual(result.status, "failed")
        self.assertIsNone(result.value)
        self.assertEqual(result.reason, "llm: unavailable; regels: LookupError")
        self.assertEqual(result.to_decision().status, "failed")

    def test_confidence_komt_uit_het_resultaat(self) -> None:
        result = run_agent("intent-agent", rules=lambda: 0.7, confidence=lambda value: value)
        self.assertEqual(result.confidence, 0.7)

    def test_validatiefout_type(self) -> None:
        with self.assertRaises(ValidationError):
            Question.model_validate({})


class PromptTest(unittest.TestCase):
    def test_laadt_de_hoogste_versie(self) -> None:
        prompt = load_prompt("question")
        self.assertEqual(prompt.id, "question-v1")
        self.assertIn("JA of\nNEE", prompt.text)

    def test_vaste_versie_en_onbekend(self) -> None:
        self.assertEqual(load_prompt("question", 1).version, 1)
        for name, version in [("question", 99), ("bestaat_niet", None), ("../config", None)]:
            with self.subTest(name=name), self.assertRaises(LookupError):
                load_prompt(name, version)


if __name__ == "__main__":
    unittest.main()
