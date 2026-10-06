"""Safety Agent: de regels S1 t/m S3 (N6.9, INTENTO-NEW-DESIGN §10)."""

from __future__ import annotations

import itertools
import unittest
from typing import Any

from agent_service.agents.safety import (
    s1_question_limit,
    s2_proposal_needs_answer,
    s3_send_requires_yes,
)
from agent_service.contracts import Answer, AskedQuestion, Option, Presentation
from agent_service.llm import FakeCall, FakeProvider
from agent_service.orchestrator import step
from agent_service.scenarios import Scenario, play
from tests.builders import NO, START, YES, answer, request, settings

YES_EVENT = request(YES, turn=1).event
NO_EVENT = request(NO, turn=1).event


def contact_screen(contact_id: str) -> Presentation:
    return Presentation(
        kind="confirm_send",
        mode="binary",
        text="Wil je dit naar Mama sturen?",
        options=[
            Option(
                ref=contact_id,
                kind="contact",
                contact_id=contact_id,
                label="Mama",
                representation="exact",
                position=0,
            )
        ],
    )


def refining_intent() -> Any:
    """Een Intent Agent die na JA op pijn eindeloos blijft verfijnen."""
    extra = itertools.count()

    def respond(call: FakeCall) -> dict[str, Any]:
        n = next(extra)
        return {
            "hypotheses": [
                {"concept": "pain", "label": "pijn", "confidence": 0.8},
                {"concept": f"body_part_{n}", "label": f"plek {n}", "confidence": 0.3},
            ],
            "needs_clarification": True,
        }

    return respond


class SafetyRulesTest(unittest.TestCase):
    def test_s1_maximum_aantal_vragen(self) -> None:
        state = step(request(START)).state
        cfg = settings(max_questions=5)
        self.assertIsNone(s1_question_limit(state, cfg))
        state.questions_asked = [
            AskedQuestion(turn=i, concept=f"c{i}", text=f"V{i}?") for i in range(5)
        ]
        finding = s1_question_limit(state, cfg)
        self.assertEqual(finding and finding.rule, "S1")

    def test_s2_geen_voorstel_zonder_antwoord(self) -> None:
        state = step(request(START)).state
        self.assertEqual(getattr(s2_proposal_needs_answer(state), "rule", None), "S2")
        state.answers = [Answer(turn=0, answer="no", concepts=["pain"])]
        self.assertIsNone(s2_proposal_needs_answer(state))

    def test_s3_versturen_vraagt_een_ja_op_dat_contact(self) -> None:
        shown = contact_screen("c-1")
        self.assertIsNone(s3_send_requires_yes("c-1", shown, YES_EVENT))
        self.assertEqual(getattr(s3_send_requires_yes("c-1", shown, NO_EVENT), "rule", None), "S3")
        self.assertEqual(getattr(s3_send_requires_yes("c-2", shown, YES_EVENT), "rule", None), "S3")
        self.assertEqual(getattr(s3_send_requires_yes("c-1", None, YES_EVENT), "rule", None), "S3")


class SafetyFlowTest(unittest.TestCase):
    def test_maximum_bereikt_dan_het_voorstel(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": [refining_intent()] * 50})
        result = play(
            Scenario(
                name="pijn, plek onbekend", goal=frozenset({"pain"}), settings={"max_questions": 5}
            ),
            lambda r: step(r, llm=llm),
        )
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.questions, 5)
        self.assertIn(
            "S1: maximum van 5 vragen bereikt",
            [d.reason for d in result.decisions if d.agent == "safety-agent"],
        )

    def test_nee_op_dat_voorstel_dan_wil_je_stoppen(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": [refining_intent()] * 50})
        response = step(request(START, max_questions=5), llm=llm)
        response = step(answer(response, YES, max_questions=5), llm=llm)  # JA pijn
        while response.presentation.kind == "question":
            response = step(answer(response, NO, max_questions=5), llm=llm)
        self.assertEqual(response.presentation.text, "Bedoel je: Pijn?")
        stop = step(answer(response, NO, max_questions=5), llm=llm)
        self.assertEqual(stop.presentation.kind, "ask_stop")


if __name__ == "__main__":
    unittest.main()
