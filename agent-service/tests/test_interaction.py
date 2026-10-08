"""Interaction Strategy bij "AI kiest": startvorm en wisselregels (N13.1, INTENTO-NEW-DESIGN §14, I7)."""

from __future__ import annotations

import unittest
from typing import Any

from agent_service.agents.interaction import next_mode, start_mode
from agent_service.contracts import (
    ExperienceSummary,
    RecentEvent,
    SessionState,
    TurnResponse,
)
from agent_service.orchestrator import step
from tests.builders import NO, START, answer, request, settings


def recent(*events: tuple[int, str, str, str]) -> list[RecentEvent]:
    return [
        RecentEvent.model_validate({"turn": t, "screen": screen, "mode": mode, "event": event})
        for t, screen, mode, event in events
    ]


def modes(binary: int, multi: int) -> ExperienceSummary:
    def count(ref: str, n: int) -> dict[str, Any]:
        return {"ref": ref, "presented": n, "chosen": n, "chosen_at_first_position": 0}

    return ExperienceSummary.model_validate(
        {"symbols": [], "contacts": [], "modes": [count("binary", binary), count("multi", multi)]}
    )


def state(mode: str, since: int = 0) -> SessionState:
    response = step(request(START, interaction_mode=mode))
    return response.state.model_copy(update={"interaction_mode": mode, "mode_since_turn": since})


def mode_changes(response: TurnResponse) -> list[dict[str, Any]]:
    return [dict(i.payload) for i in response.inferences if i.kind == "mode_change"]


class StartModeTest(unittest.TestCase):
    def test_zonder_ervaring_binary(self) -> None:
        self.assertEqual(start_mode(settings(interaction_mode="ai"), None).mode, "binary")

    def test_de_vorm_die_het_vaakst_tot_een_bericht_leidde(self) -> None:
        choice = start_mode(settings(interaction_mode="ai"), modes(binary=1, multi=3))
        self.assertEqual(choice.mode, "multi")
        self.assertIn("3 tegen 1", choice.reason)
        self.assertEqual(start_mode(settings(interaction_mode="ai"), modes(2, 2)).mode, "binary")

    def test_experience_uit_telt_niet(self) -> None:
        choice = start_mode(
            settings(interaction_mode="ai", experience_enabled=False), modes(binary=0, multi=5)
        )
        self.assertEqual(choice.mode, "binary")

    def test_een_ingestelde_vorm_blijft(self) -> None:
        self.assertEqual(
            start_mode(settings(interaction_mode="binary"), modes(0, 9)).mode, "binary"
        )
        self.assertEqual(start_mode(settings(interaction_mode="multi"), modes(9, 0)).mode, "multi")


class NextModeTest(unittest.TestCase):
    AI = settings(interaction_mode="ai")

    def test_binary_naar_multi_na_vier_keer_nee(self) -> None:
        events = recent(*[(t, "question", "binary", "answer_no") for t in range(4)])
        choice = next_mode(self.AI, state("binary"), events, tiles_available=3)
        self.assertIsNotNone(choice)
        assert choice is not None
        self.assertEqual((choice.mode, choice.reason), ("multi", "4 keer achter elkaar nee"))

    def test_drie_keer_nee_of_een_ja_ertussen_is_geen_wissel(self) -> None:
        three = recent(*[(t, "question", "binary", "answer_no") for t in range(3)])
        self.assertIsNone(next_mode(self.AI, state("binary"), three, tiles_available=3))
        mixed = recent(
            (0, "question", "binary", "answer_no"),
            (1, "question", "binary", "answer_yes"),
            (2, "question", "binary", "answer_no"),
            (3, "question", "binary", "answer_no"),
        )
        self.assertIsNone(next_mode(self.AI, state("binary"), mixed, tiles_available=3))

    def test_geen_tegels_om_te_tonen_dan_geen_wissel(self) -> None:
        events = recent(*[(t, "question", "binary", "answer_no") for t in range(4)])
        self.assertIsNone(next_mode(self.AI, state("binary"), events, tiles_available=1))

    def test_multi_naar_binary_na_twee_keer_terug_of_geen_van_deze(self) -> None:
        events = recent(
            (0, "question", "multi", "select_option"),
            (1, "question", "multi", "none_of_these"),
            (2, "confirm_message", "binary", "back"),
        )
        choice = next_mode(self.AI, state("multi"), events, tiles_available=4)
        assert choice is not None
        self.assertEqual(choice.mode, "binary")
        self.assertIn('2 keer terug of "Geen van deze"', choice.reason)

    def test_multi_een_keer_geen_van_deze_blijft_multi(self) -> None:
        events = recent(
            (0, "question", "multi", "none_of_these"),
            (1, "question", "multi", "select_option"),
            (2, "question", "multi", "select_option"),
        )
        self.assertIsNone(next_mode(self.AI, state("multi"), events, tiles_available=4))

    def test_niet_binnen_drie_beurten_na_de_vorige_wissel(self) -> None:
        # Gewisseld op beurt 4: de nee's van daarvoor tellen niet meer.
        events = recent(
            *[(t, "question", "binary", "answer_no") for t in range(4)],
            (4, "question", "multi", "none_of_these"),
            (5, "question", "multi", "none_of_these"),
        )
        self.assertIsNone(next_mode(self.AI, state("multi", since=4), events, tiles_available=4))

    def test_een_ingestelde_vorm_wisselt_nooit(self) -> None:
        nos = recent(*[(t, "question", "binary", "answer_no") for t in range(6)])
        self.assertIsNone(
            next_mode(settings(interaction_mode="binary"), state("binary"), nos, tiles_available=4)
        )
        trouble = recent(*[(t, "question", "multi", "none_of_these") for t in range(4)])
        self.assertIsNone(
            next_mode(
                settings(interaction_mode="multi"), state("multi"), trouble, tiles_available=4
            )
        )


class OrchestratorTest(unittest.TestCase):
    def test_start_bij_ai_kiest_met_reden_in_de_provenance(self) -> None:
        response = step(request(START, interaction_mode="ai"))
        self.assertEqual(response.state.interaction_mode, "binary")
        self.assertEqual(
            mode_changes(response),
            [{"from": None, "to": "binary", "reason": "nog geen ervaring: beginnen met ja/nee"}],
        )

    def test_start_in_multi_uit_de_experience(self) -> None:
        exp = {
            "symbols": [],
            "contacts": [],
            "modes": [{"ref": "multi", "presented": 3, "chosen": 3, "chosen_at_first_position": 0}],
        }
        response = step(request(START, interaction_mode="ai", experience=exp))
        self.assertEqual(response.state.interaction_mode, "multi")
        self.assertEqual(response.presentation.mode, "multi")

    def test_ingestelde_vorm_geen_mode_change(self) -> None:
        self.assertEqual(mode_changes(step(request(START))), [])

    def test_wissel_naar_tegels_zet_mode_since_turn_op_deze_beurt(self) -> None:
        response = step(request(START, interaction_mode="ai"))
        events: list[dict[str, Any]] = []
        for _ in range(4):
            events.append(
                {
                    "turn": response.state.turn,
                    "screen": "question",
                    "mode": "binary",
                    "event": "answer_no",
                }
            )
            response = step(answer(response, NO, interaction_mode="ai", recent=events))
        self.assertEqual(response.state.interaction_mode, "multi")
        self.assertEqual(response.state.mode_since_turn, 4)
        self.assertEqual(response.presentation.mode, "multi")
        self.assertEqual(
            mode_changes(response),
            [{"from": "binary", "to": "multi", "reason": "4 keer achter elkaar nee"}],
        )


if __name__ == "__main__":
    unittest.main()
