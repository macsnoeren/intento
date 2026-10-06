"""Breder zoeken na een reeks NEE (N6.14, INTENTO-NEW-DESIGN §6, §36)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.agents.intent import no_streak
from agent_service.llm import FakeCall, FakeProvider
from agent_service.orchestrator import step
from agent_service.scenarios import EVAL_SCENARIOS, play
from tests.builders import NO, START, YES, answer, request


def intent_by_streak(call: FakeCall) -> dict[str, Any]:
    """Een Intent Agent die doet wat de prompt vraagt: na drie NEE breder, na JA preciezer."""
    data = json.loads(call.user)
    said_yes = [a["concept"] for a in data["antwoorden"] if a["antwoord"] == "ja"]
    if "unwell" in said_yes:
        return {
            "hypotheses": [{"concept": "dizziness", "label": "duizelig", "confidence": 0.9}],
            "needs_clarification": False,
            "message": "Ik ben duizelig.",
        }
    if data["nee_op_rij"] >= 3:
        return {
            "hypotheses": [{"concept": "unwell", "label": "niet lekker", "confidence": 0.5}],
            "needs_clarification": True,
        }
    rest = [w for w in data["vocabulary"] if w["start"] and w["concept"] not in data["afgewezen"]]
    return {
        "hypotheses": [
            {"concept": w["concept"], "label": w["label"], "confidence": 0.2} for w in rest[:3]
        ],
        "needs_clarification": True,
    }


class BroadenTest(unittest.TestCase):
    def test_nee_op_rij(self) -> None:
        state = step(request(START)).state
        self.assertEqual(no_streak(state), 0)
        state = step(answer(step(request(START)), NO)).state
        self.assertEqual(no_streak(state), 1)

    def test_de_prompt_krijgt_het_aantal_nee(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": [intent_by_streak] * 10})
        response = step(request(START), llm=llm)
        for _ in range(3):
            response = step(answer(response, NO), llm=llm)
        last = [c for c in llm.calls if "Intent Agent" in c.system][-1]
        self.assertEqual(json.loads(last.user)["nee_op_rij"], 3)
        self.assertEqual(response.presentation.options[0].label, "niet lekker")
        # Na een JA telt de reeks opnieuw.
        after_yes = step(answer(response, YES), llm=llm)
        self.assertEqual(no_streak(after_yes.state), 0)

    def test_scenario_duizelig_slaagt(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": [intent_by_streak] * 20})
        result = play(EVAL_SCENARIOS[2], lambda r: step(r, llm=llm))
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.message, "Ik ben duizelig.")
        self.assertEqual(result.questions, 4)  # pijn, eten, drinken, niet lekker


if __name__ == "__main__":
    unittest.main()
