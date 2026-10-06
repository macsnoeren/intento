"""Het voorstel "Bedoel je …?" (N6.10, INTENTO-NEW-DESIGN §6, §31)."""

from __future__ import annotations

import unittest
from typing import Any

from agent_service.contracts import ContactEntry
from agent_service.llm import FakeProvider
from agent_service.orchestrator import proposal_text, step
from agent_service.scenarios import Scenario, play
from tests.builders import NO, START, YES, answer, request


def intent(
    *hyps: tuple[str, str, float], message: str | None = None, open_: bool = True
) -> dict[str, Any]:
    return {
        "hypotheses": [{"concept": c, "label": label, "confidence": p} for c, label, p in hyps],
        "needs_clarification": open_,
        "message": message,
    }


def headache_intents() -> list[Any]:
    return [
        intent(("pain", "pijn", 0.4), ("eat", "eten", 0.3)),
        intent(("pain", "pijn", 0.7), ("head", "hoofd", 0.5)),
        intent(("headache", "hoofdpijn", 0.92), message="Ik heb hoofdpijn.", open_=False),
    ]


class ProposalTest(unittest.TestCase):
    def test_scenario_hoofdpijn_van_start_tot_done(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": headache_intents()})
        result = play(
            Scenario(name="hoofdpijn", goal=frozenset({"pain", "head", "headache"})),
            lambda r: step(r, llm=llm),
        )
        self.assertTrue(result.success, result.failure)
        self.assertEqual(result.message, "Ik heb hoofdpijn.")
        self.assertEqual(result.questions, 2)  # Pijn? Hoofd?

    def test_voorstel_met_de_zin_van_de_intent_agent(self) -> None:
        llm = FakeProvider(routes={"Intent Agent": headache_intents()})
        first = step(request(START), llm=llm)
        head = step(answer(first, YES), llm=llm)
        self.assertEqual(head.presentation.text, "Hoofd?")
        proposal = step(answer(head, YES), llm=llm)
        self.assertEqual(proposal.presentation.kind, "confirm_message")
        self.assertEqual(proposal.presentation.text, "Bedoel je: Ik heb hoofdpijn?")
        self.assertEqual(proposal.presentation.message, "Ik heb hoofdpijn.")
        assert proposal.state.proposal is not None
        self.assertEqual(
            (proposal.state.proposal.concepts, proposal.state.proposal.confidence),
            (["headache"], 0.92),
        )
        # Geen item "hoofdpijn": het pictogram komt van de Icon Agent ("geen afbeelding" zonder model-antwoord).
        [option] = proposal.presentation.options
        self.assertEqual((option.label, option.representation), ("hoofdpijn", "stand_in"))
        self.assertTrue(proposal.gaps)

    def test_onder_de_drempel_verder_vragen(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("pain", "pijn", 0.4)),
                    intent(("pain", "pijn", 0.8), ("head", "hoofd", 0.5), message="Ik heb pijn."),
                ]
            }
        )
        first = step(request(START), llm=llm)
        after = step(answer(first, YES), llm=llm)
        self.assertEqual(after.presentation.text, "Hoofd?")  # 0,8 < 0,85
        # Met een lagere drempel wel het voorstel.
        llm2 = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("pain", "pijn", 0.4)),
                    intent(("pain", "pijn", 0.8), ("head", "hoofd", 0.5), message="Ik heb pijn."),
                ]
            }
        )
        first2 = step(request(START), llm=llm2, propose_threshold=0.75)
        proposal = step(answer(first2, YES), llm=llm2, propose_threshold=0.75)
        self.assertEqual(proposal.presentation.text, "Bedoel je: Ik heb pijn?")

    def test_zin_met_een_naam_wordt_het_woord(self) -> None:
        mama = ContactEntry(id="c-1", name="Mama Jansen", vocabulary_item_id=None, sort_order=0)
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    intent(("drink", "drinken", 0.4)),
                    intent(
                        ("drink", "drinken", 0.95),
                        message="Ik wil drinken met Jansen.",
                        open_=False,
                    ),
                ]
            }
        )
        first = step(request(START, contacts=[mama]), llm=llm)
        proposal = step(answer(first, YES, contacts=[mama]), llm=llm)
        self.assertEqual(proposal.presentation.text, "Bedoel je: Drinken?")

    def test_nee_op_het_voorstel_terug_naar_clarify(self) -> None:
        llm = FakeProvider(
            routes={
                "Intent Agent": [
                    *headache_intents(),
                    intent(("pain", "pijn", 0.6), ("belly", "buik", 0.5)),
                ]
            }
        )
        first = step(request(START), llm=llm)
        head = step(answer(first, YES), llm=llm)
        proposal = step(answer(head, YES), llm=llm)
        after = step(answer(proposal, NO), llm=llm)
        self.assertEqual(after.state.phase, "clarify")
        self.assertIn("headache", after.state.rejected_concepts)
        self.assertIsNone(after.state.proposal)
        self.assertEqual(after.presentation.text, "Buik?")

    def test_voorsteltekst(self) -> None:
        self.assertEqual(proposal_text("Ik heb pijn."), "Bedoel je: Ik heb pijn?")
        self.assertEqual(proposal_text(" Drinken "), "Bedoel je: Drinken?")


if __name__ == "__main__":
    unittest.main()
