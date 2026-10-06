"""Hypotheses in de Session State (N6.2, INTENTO-NEW-DESIGN §36, §37)."""

from __future__ import annotations

import unittest
from typing import Any

from agent_service.llm import FakeProvider
from agent_service.orchestrator import step
from agent_service.scenarios import Scenario, play
from tests.builders import NO, START, YES, answer, request


def intent(*concepts: tuple[str, str, float], open_: list[str] | None = None) -> dict[str, Any]:
    return {
        "hypotheses": [{"concept": c, "label": label, "confidence": p} for c, label, p in concepts],
        "uncertainties": open_ or [],
        "needs_clarification": bool(open_),
    }


class HypothesesTest(unittest.TestCase):
    def test_ja_pijn_nee_hoofd_nee_buik(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("pain", "pijn", 0.4), ("eat", "eten", 0.3), open_=["wat"]),
                    intent(
                        ("pain", "pijn", 0.8),
                        ("head", "hoofd", 0.4),
                        ("belly", "buik", 0.3),
                        open_=["waar de pijn zit"],
                    ),
                    intent(
                        ("pain", "pijn", 0.8), ("belly", "buik", 0.4), open_=["waar de pijn zit"]
                    ),
                    intent(("pain", "pijn", 0.8), open_=["waar de pijn zit"]),
                ]
            }
        )
        first = step(request(START), llm=llm)
        self.assertEqual(first.presentation.text, "Pijn?")
        head = step(answer(first, YES), llm=llm)
        # Een JA met een taalmodel is nog geen voorstel: er is iets open, dus een preciezere vraag.
        self.assertEqual(head.presentation.text, "Hoofd?")
        belly = step(answer(head, NO), llm=llm)
        self.assertEqual(belly.presentation.text, "Buik?")
        after = step(answer(belly, NO), llm=llm)

        state = after.state
        # Pijn blijft; de plek is nog open.
        self.assertEqual([h.concept for h in state.intent_hypotheses], ["pain"])
        self.assertEqual(state.rejected_concepts, ["head", "belly"])
        self.assertEqual(state.uncertainties, ["waar de pijn zit"])
        # Niets meer te vragen, maar wel een JA: dan het voorstel (niet "Wil je stoppen?").
        self.assertEqual(after.presentation.kind, "confirm_message")
        self.assertEqual(after.presentation.text, "Bedoel je: Pijn?")
        # De hypotheses van elke beurt gaan als inference mee.
        for response in (first, head, belly, after):
            kinds = [i.kind for i in response.inferences]
            self.assertIn("intent_hypotheses", kinds)
        payload = after.inferences[0].payload
        self.assertEqual(payload["uncertainties"], ["waar de pijn zit"])

    def test_ja_zonder_twijfel_is_meteen_het_voorstel(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("drink", "drinken", 0.5), open_=["wat"]),
                    intent(("drink", "drinken", 0.9)),
                ]
            }
        )
        first = step(request(START), llm=llm)
        proposal = step(answer(first, YES), llm=llm)
        self.assertEqual(proposal.presentation.text, "Bedoel je: Drinken?")

    def test_valt_het_model_uit_na_een_ja_dan_het_voorstel(self) -> None:
        llm = FakeProvider(
            routes={"Intent Agent": [intent(("pain", "pijn", 0.5), open_=["wat"])]}
        )  # daarna geen antwoord
        first = step(request(START), llm=llm)
        proposal = step(answer(first, YES), llm=llm)
        self.assertEqual(proposal.presentation.text, "Bedoel je: Pijn?")
        statuses = [d.status for d in proposal.decisions if d.agent == "intent-agent"]
        self.assertEqual(statuses[:1], ["fallback"])

    def test_opnieuw_beginnen_vraagt_weer_vanaf_het_begin(self) -> None:
        # Regels: alles NEE → "Wil je stoppen?" → NEE → opnieuw "Pijn?".
        response = step(request(START))
        while response.presentation.kind == "question":
            response = step(answer(response, NO))
        self.assertEqual(response.presentation.kind, "ask_stop")
        again = step(answer(response, NO))
        self.assertEqual(again.presentation.text, "Pijn?")
        self.assertEqual(len(again.state.questions_asked), 1)

    def test_scenario_pijn_met_verfijning(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("pain", "pijn", 0.4), open_=["wat"]),
                    intent(("pain", "pijn", 0.8), ("head", "hoofd", 0.4), open_=["waar"]),
                    intent(("pain", "pijn", 0.8), open_=["waar"]),
                ]
            }
        )
        result = play(
            Scenario(name="pijn, niet aan het hoofd", goal=frozenset({"pain"})),
            lambda r: step(r, llm=llm),
        )
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.questions, 2)


if __name__ == "__main__":
    unittest.main()
