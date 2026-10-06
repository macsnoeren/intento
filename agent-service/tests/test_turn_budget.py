"""Tijdsbudget per beurt (N6.13): de dienst antwoordt altijd binnen de time-out van de backend."""

from __future__ import annotations

import unittest
from typing import Any

from agent_service.config import ConfigError, ServiceConfig
from agent_service.llm import FakeCall, FakeProvider
from agent_service.orchestrator import step
from tests.builders import START, request

TOKEN = "agt_" + "x" * 32


class TurnBudgetTest(unittest.TestCase):
    def test_elke_aanroep_krijgt_hooguit_de_resterende_tijd(self) -> None:
        now = [0.0]

        def intent(call: FakeCall) -> dict[str, Any]:
            now[0] += 3.0  # de Intent Agent "duurt" 3 s
            return {
                "hypotheses": [{"concept": "pain", "label": "pijn", "confidence": 0.4}],
                "needs_clarification": True,
            }

        llm = FakeProvider(routes={"Intent Agent": [intent]})
        step(request(START), llm=llm, clock=lambda: now[0], turn_budget=5.0)
        intent_call, question_call = llm.calls
        self.assertEqual(intent_call.timeout, 5.0)  # niet de 10 s van de Intent Agent
        # Na 3 s is er nog 2 s over voor de Question Agent.
        self.assertAlmostEqual(question_call.timeout, 2.0)

    def test_te_weinig_tijd_dan_geen_model(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": [{"hypotheses": "niet gebruikt"}]})
        response = step(request(START), llm=llm, clock=lambda: 0.0, turn_budget=0.5)
        self.assertEqual(llm.calls, [])
        self.assertEqual(response.presentation.text, "Pijn?")

    def test_config(self) -> None:
        base = {"SERVICE_TOKEN": TOKEN}
        self.assertEqual(ServiceConfig.from_env(base, env_file=None).turn_budget, 25.0)
        self.assertEqual(
            ServiceConfig.from_env(
                {**base, "AGENT_TURN_BUDGET_SECONDS": "20"}, env_file=None
            ).turn_budget,
            20.0,
        )
        for bad in ("snel", "1", "500"):
            with self.subTest(bad=bad), self.assertRaises(ConfigError):
                ServiceConfig.from_env({**base, "AGENT_TURN_BUDGET_SECONDS": bad}, env_file=None)


if __name__ == "__main__":
    unittest.main()
