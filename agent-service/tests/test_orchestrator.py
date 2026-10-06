"""Orchestrator-skelet met regelgebaseerde agents: elke overgang apart (N1.5, §4.1)."""

from __future__ import annotations

import unittest

from agent_service.contracts import TurnResponse
from agent_service.orchestrator import ProtocolError, step
from tests.builders import NO, START, YES, answer, request


class OrchestratorTest(unittest.TestCase):
    def start(self) -> TurnResponse:
        return step(request(START))

    def test_start_vraagt_naar_het_eerste_startconcept(self) -> None:
        response = self.start()
        self.assertEqual(response.state.phase, "clarify")
        self.assertEqual(response.turn, 0)
        self.assertEqual(response.presentation.kind, "question")
        self.assertEqual(response.presentation.mode, "binary")
        self.assertEqual(response.presentation.text, "Pijn?")
        [option] = response.presentation.options
        self.assertEqual((option.vocabulary_item_id, option.representation), ("v-pain", "exact"))
        # Startconcepten in vaste volgorde als hypotheses; gewone woorden horen er niet bij.
        self.assertEqual(
            [h.concept for h in response.state.intent_hypotheses], ["pain", "eat", "drink"]
        )
        self.assertEqual(response.state.last_presentation, response.presentation)
        self.assertEqual(
            [d.agent for d in response.decisions],
            ["intent-agent", "icon-agent", "question-agent", "validation-agent"],
        )
        self.assertEqual(response.inferences[0].kind, "intent_hypotheses")

    def test_nee_gaat_naar_het_volgende_startconcept(self) -> None:
        response = step(answer(self.start(), NO))
        self.assertEqual(response.turn, 1)
        self.assertEqual(response.state.phase, "clarify")
        self.assertEqual(response.presentation.text, "Eten?")
        self.assertEqual(response.state.rejected_concepts, ["pain"])
        self.assertEqual(response.state.answers[-1].answer, "no")
        self.assertEqual(response.state.answers[-1].concepts, ["pain"])

    def test_ja_leidt_tot_het_voorstel(self) -> None:
        response = step(answer(self.start(), YES))
        self.assertEqual(response.state.phase, "confirm_message")
        self.assertEqual(response.presentation.kind, "confirm_message")
        self.assertEqual(response.presentation.text, "Bedoel je: Pijn?")
        self.assertEqual(response.presentation.message, "Pijn")
        self.assertIsNotNone(response.state.proposal)
        # Een voorstel is nog geen boodschap van de gebruiker (§31).
        self.assertIsNone(response.state.communication_intent)

    def test_ja_op_het_voorstel_is_klaar(self) -> None:
        proposal = step(answer(self.start(), YES))
        response = step(answer(proposal, YES))
        self.assertEqual(response.state.phase, "done")
        self.assertEqual(response.presentation.kind, "done")
        self.assertEqual(response.presentation.message, "Pijn")
        assert response.state.communication_intent is not None
        self.assertEqual(response.state.communication_intent.concepts, ["pain"])
        self.assertIsNone(response.state.proposal)

    def test_nee_op_het_voorstel_gaat_terug_naar_clarify(self) -> None:
        proposal = step(answer(self.start(), YES))
        response = step(answer(proposal, NO))
        self.assertEqual(response.state.phase, "clarify")
        self.assertEqual(response.presentation.kind, "question")
        self.assertEqual(response.presentation.text, "Eten?")
        self.assertIn("pain", response.state.rejected_concepts)
        self.assertIsNone(response.state.proposal)

    def test_zijn_alle_startconcepten_afgewezen_dan_wil_je_stoppen(self) -> None:
        response = self.start()
        for _ in range(3):
            response = step(answer(response, NO))
        self.assertEqual(response.presentation.kind, "ask_stop")
        self.assertEqual(response.presentation.text, "Wil je stoppen?")
        # JA → gestopt; NEE → opnieuw bij het eerste startconcept.
        self.assertEqual(step(answer(response, YES)).state.phase, "stopped")
        again = step(answer(response, NO))
        self.assertEqual(again.presentation.text, "Pijn?")
        self.assertEqual(again.state.rejected_concepts, [])

    def test_is_deterministisch(self) -> None:
        # Alleen de gemeten duur hangt van de klok af; met een vaste klok is de uitvoer gelijk.
        fixed = request(START)
        self.assertEqual(step(fixed, clock=lambda: 0.0), step(fixed, clock=lambda: 0.0))

    def test_protocolfouten(self) -> None:
        with self.assertRaises(ProtocolError):
            step(request(YES))  # antwoord zonder gesprek
        done = step(answer(step(answer(self.start(), YES)), YES))
        with self.assertRaises(ProtocolError):
            step(answer(done, YES))  # gesprek is al klaar
        with self.assertRaises(ProtocolError):
            step(answer(self.start(), {"type": "select_option", "option_ref": "v-pain"}))


if __name__ == "__main__":
    unittest.main()
