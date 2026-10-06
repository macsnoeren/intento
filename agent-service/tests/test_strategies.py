"""Vraagstrategieën (N6.4, INTENTO-NEW-DESIGN §7.1)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from agent_service.agents.strategies import STRATEGIES, STRATEGY_KEYS
from agent_service.llm import FakeProvider
from agent_service.orchestrator import step
from tests.builders import START, request

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "question_strategies.json"


class StrategyTest(unittest.TestCase):
    def test_sleutels_gelijk_aan_het_contract(self) -> None:
        expected = json.loads(CONTRACT.read_text("utf-8"))
        self.assertEqual(list(STRATEGY_KEYS), expected)
        self.assertEqual(list(STRATEGIES), expected)

    def test_elke_strategie_is_compleet(self) -> None:
        for key, strategy in STRATEGIES.items():
            with self.subTest(key=key):
                self.assertEqual(strategy.key, key)
                self.assertTrue(strategy.label and strategy.explanation and strategy.instruction)

    def test_de_instructie_staat_in_de_prompt_van_de_question_agent(self) -> None:
        for key, strategy in STRATEGIES.items():
            with self.subTest(key=key):
                llm = FakeProvider()
                step(request(START, question_strategy=key), llm=llm)
                call = next(c for c in llm.calls if "Question Agent" in c.system)
                self.assertEqual(json.loads(call.user)["strategie"], strategy.instruction)
                # Alleen bij de Question Agent: de Intent Agent krijgt geen strategie.
                intent = next(c for c in llm.calls if "Intent Agent" in c.system)
                self.assertNotIn(strategy.instruction, intent.user)


if __name__ == "__main__":
    unittest.main()
