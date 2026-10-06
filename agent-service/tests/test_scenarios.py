"""Scenario-opstelling en evaluatie-CLI (N5.4, INTENTO-NEW-DESIGN §54)."""

from __future__ import annotations

import contextlib
import io
import unittest

from agent_service.eval import main, run
from agent_service.llm import FakeProvider
from agent_service.orchestrator import step
from agent_service.scenarios import SCENARIOS, Scenario, play


class ScenarioTest(unittest.TestCase):
    def test_bedoelt_pijn(self) -> None:
        result = play(SCENARIOS[0], step)
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.message, "Pijn")
        self.assertEqual(result.questions, 1)

    def test_bedoelt_dorst(self) -> None:
        result = play(SCENARIOS[1], step)
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.message, "Drinken")
        # Pijn? Eten? Drinken? — de regels vragen de startconcepten in volgorde af.
        self.assertEqual(result.questions, 3)
        self.assertIn("question-agent", {d.agent for d in result.decisions})

    def test_een_onbereikbaar_doel_mislukt_netjes(self) -> None:
        # "duizelig" staat niet bij de startconcepten: de regels komen er niet; de gebruiker stopt.
        result = play(Scenario(name="bedoelt duizelig", goal=frozenset({"dizzy"})), step)
        self.assertFalse(result.success)
        self.assertIn("stopped", result.failure or "")

    def test_te_veel_beurten(self) -> None:
        result = play(SCENARIOS[1], step, max_turns=2)
        self.assertFalse(result.success)
        self.assertIn("2 beurten", result.failure or "")


class EvalTest(unittest.TestCase):
    def test_rapport_tegen_de_fake_provider(self) -> None:
        report = run(FakeProvider(), runs=2)
        self.assertEqual(len(report.results), 4)
        self.assertEqual(report.success_rate, 1.0)
        agents = report.agents()
        self.assertEqual(set(agents), {"icon-agent", "intent-agent", "question-agent"})
        self.assertEqual(dict(agents["question-agent"].statuses), {"success": 8})
        text = report.render()
        self.assertIn("Geslaagd: 100% van 4", text)
        self.assertIn("question-agent", text)

    def test_cli_met_fake_provider(self) -> None:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = main(["--provider", "fake"])
        self.assertEqual(code, 0)
        self.assertIn("Provider: fake (fake-model)", out.getvalue())
        self.assertIn("bedoelt dorst", out.getvalue())


if __name__ == "__main__":
    unittest.main()
