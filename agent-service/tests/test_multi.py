"""Multi-icon in de agentdienst (N7.1, INTENTO-NEW-DESIGN §7, §13)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.contracts import TurnResponse
from agent_service.llm import FakeProvider
from agent_service.orchestrator import ProtocolError, step
from agent_service.scenarios import Scenario, play, scenario_vocabulary
from tests.builders import NO, START, YES, answer, request

MULTI: dict[str, Any] = {"interaction_mode": "multi", "options_per_screen": 4}


def select(response: TurnResponse, index: int) -> dict[str, Any]:
    return {"type": "select_option", "option_ref": response.presentation.options[index].ref}


NONE: dict[str, Any] = {"type": "none_of_these"}


def intent(*hyps: tuple[str, str, float], message: str | None = None) -> dict[str, Any]:
    return {
        "hypotheses": [{"concept": c, "label": label, "confidence": p} for c, label, p in hyps],
        "needs_clarification": message is None,
        "message": message,
    }


class MultiRulesTest(unittest.TestCase):
    def test_start_in_multi_met_verschillende_tegels(self) -> None:
        response = step(request(START, vocab=scenario_vocabulary(), **MULTI))
        presentation = response.presentation
        self.assertEqual(
            (presentation.kind, presentation.mode, presentation.text),
            ("question", "multi", "Wat bedoel je?"),
        )
        self.assertEqual(
            [o.label for o in presentation.options], ["pijn", "eten", "drinken", "toilet"]
        )
        self.assertEqual([o.position for o in presentation.options], [0, 1, 2, 3])
        self.assertEqual(response.state.interaction_mode, "multi")
        self.assertEqual(len(response.state.questions_asked), 1)

    def test_aantal_tegels_volgt_de_instelling(self) -> None:
        for n in (2, 3):
            with self.subTest(n=n):
                response = step(
                    request(
                        START,
                        vocab=scenario_vocabulary(),
                        interaction_mode="multi",
                        options_per_screen=n,
                    )
                )
                self.assertEqual(len(response.presentation.options), n)

    def test_geen_van_deze_wijst_alle_getoonde_af(self) -> None:
        first = step(request(START, vocab=scenario_vocabulary(), **MULTI))
        second = step(answer(first, NONE, vocab=scenario_vocabulary(), **MULTI))
        self.assertEqual(second.state.rejected_concepts, ["pain", "eat", "drink", "toilet"])
        self.assertEqual(second.state.answers[-1].answer, "none_of_these")
        # De volgende tegels: wat er nog over is (moe, hoofd, buik, water).
        self.assertNotIn("drinken", [o.label for o in second.presentation.options])

    def test_een_keuze_zonder_model_is_meteen_het_voorstel_en_dat_blijft_binary(self) -> None:
        first = step(request(START, vocab=scenario_vocabulary(), **MULTI))
        proposal = step(answer(first, select(first, 2), vocab=scenario_vocabulary(), **MULTI))
        self.assertEqual(proposal.presentation.kind, "confirm_message")
        self.assertEqual(proposal.presentation.mode, "binary")
        self.assertEqual(proposal.presentation.text, "Bedoel je: Drinken?")
        self.assertEqual(proposal.state.answers[-1].answer, "selected")
        done = step(answer(proposal, YES, vocab=scenario_vocabulary(), **MULTI))
        self.assertEqual(done.presentation.kind, "done")

    def test_protocolfouten(self) -> None:
        first = step(request(START, vocab=scenario_vocabulary(), **MULTI))
        with self.assertRaises(ProtocolError):
            step(answer(first, YES, vocab=scenario_vocabulary(), **MULTI))
        with self.assertRaises(ProtocolError):
            step(
                answer(
                    first,
                    {"type": "select_option", "option_ref": "verzonnen"},
                    vocab=scenario_vocabulary(),
                    **MULTI,
                )
            )
        binary = step(request(START))
        with self.assertRaises(ProtocolError):
            step(answer(binary, NONE))
        with self.assertRaises(ProtocolError):
            step(
                answer(binary, NO, turn=1).model_copy(update={"event": request(NONE, turn=1).event})
            )

    def test_te_weinig_over_dan_wil_je_stoppen(self) -> None:
        response = step(request(START, vocab=scenario_vocabulary(), **MULTI))
        while response.presentation.kind == "question":
            response = step(answer(response, NONE, vocab=scenario_vocabulary(), **MULTI))
        self.assertEqual(response.presentation.kind, "ask_stop")


class MultiLlmTest(unittest.TestCase):
    def test_de_intent_agent_weet_hoeveel_tegels(self) -> None:
        llm = FakeProvider()
        step(
            request(
                START, vocab=scenario_vocabulary(), interaction_mode="multi", options_per_screen=8
            ),
            llm=llm,
        )
        step(request(START, vocab=scenario_vocabulary()), llm=llm)
        tiles = [json.loads(c.user)["tegels"] for c in llm.calls if "Intent Agent" in c.system]
        self.assertEqual(tiles, [8, 1])

    def test_scenario_dorst_naar_water(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(
                        ("pain", "pijn", 0.3),
                        ("eat", "eten", 0.3),
                        ("drink", "drinken", 0.3),
                        ("toilet", "toilet", 0.2),
                    ),
                    intent(
                        ("drink", "drinken", 0.7), ("water", "water", 0.5), ("eat", "eten", 0.2)
                    ),
                    intent(("water", "water", 0.92), message="Ik wil water."),
                ],
                "Question Agent": [
                    {"text": "Wat heb je nodig?", "confidence": 0.8},
                    {"text": "Wat wil je drinken?", "confidence": 0.8},
                ],
            }
        )
        result = play(
            Scenario(name="dorst → water", goal=frozenset({"drink", "water"}), settings=MULTI),
            lambda r: step(r, llm=llm),
        )
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.message, "Ik wil water.")
        self.assertEqual(result.questions, 2)  # Wat heb je nodig? Wat wil je drinken?


if __name__ == "__main__":
    unittest.main()
