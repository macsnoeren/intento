"""Delen: "Wil je dit sturen?" (N11.1, INTENTO-NEW-DESIGN §4.1, §31)."""

from __future__ import annotations

import unittest
from functools import partial

from agent_service.contracts import ContactEntry, TurnResponse
from agent_service.llm import FakeProvider, LlmProvider
from agent_service.orchestrator import SHARE_ASK_TEXT, ProtocolError, step
from tests.builders import NO, START, YES, answer, request

MAMA = ContactEntry(id="c-mama", name="Ankie Jansen", vocabulary_item_id=None, sort_order=0)


def confirmed(
    contacts: list[ContactEntry] | None = None,
    llm: LlmProvider | None = None,
    *,
    llm_checks: bool = False,
) -> TurnResponse:
    """Start → JA op "Pijn?" → JA op "Bedoel je: Pijn?"."""
    run = partial(step, llm=llm, llm_validation=llm_checks, llm_safety=llm_checks)
    first = run(request(START, contacts=contacts))
    proposal = run(answer(first, YES, contacts=contacts))
    return run(answer(proposal, YES, contacts=contacts))


class ShareAskTest(unittest.TestCase):
    def test_met_een_contact_volgt_wil_je_dit_sturen(self) -> None:
        response = confirmed([MAMA])
        self.assertEqual(response.state.phase, "share_ask")
        self.assertEqual(response.presentation.kind, "share_ask")
        self.assertEqual(response.presentation.mode, "binary")
        self.assertEqual(response.presentation.text, SHARE_ASK_TEXT)
        self.assertEqual(response.presentation.message, "Pijn")
        self.assertEqual(response.presentation.options, [])
        assert response.state.communication_intent is not None
        self.assertEqual(response.state.communication_intent.message, "Pijn")

    def test_zonder_contacten_meteen_klaar(self) -> None:
        response = confirmed([])
        self.assertEqual(response.state.phase, "done")
        self.assertEqual(response.presentation.kind, "done")

    def test_nee_op_sturen_is_klaar_zonder_iets_te_versturen(self) -> None:
        ask = confirmed([MAMA])
        response = step(answer(ask, NO, contacts=[MAMA]))
        self.assertEqual(response.state.phase, "done")
        self.assertEqual(response.presentation.kind, "done")
        self.assertEqual(response.presentation.message, "Pijn")
        self.assertEqual(response.state.share.sent_to, [])
        self.assertEqual(response.state.answers[-1].answer, "no")

    def test_ja_op_sturen_is_voorlopig_ook_klaar_zonder_te_versturen(self) -> None:
        # De contactvraag komt in N11.2; tot dan wordt er niets verstuurd.
        ask = confirmed([MAMA])
        response = step(answer(ask, YES, contacts=[MAMA]))
        self.assertEqual(response.presentation.kind, "done")
        self.assertEqual(response.state.share.sent_to, [])

    def test_na_klaar_geen_antwoord_meer(self) -> None:
        done = step(answer(confirmed([MAMA]), NO, contacts=[MAMA]))
        with self.assertRaises(ProtocolError):
            step(answer(done, YES, contacts=[MAMA]))

    def test_contactnamen_staan_in_geen_enkele_prompt(self) -> None:
        # Alle LLM-agents aan; de FakeProvider onthoudt elke prompt (en faalt, zodat de regels
        # het overnemen). Een naam van een contact mag nergens in staan (V6).
        llm = FakeProvider()
        ask = confirmed([MAMA], llm, llm_checks=True)
        step(answer(ask, NO, contacts=[MAMA]), llm=llm, llm_validation=True, llm_safety=True)
        self.assertGreater(len(llm.calls), 0)
        for text in llm.prompts:
            self.assertNotIn("Ankie", text)
            self.assertNotIn("Jansen", text)
            self.assertNotIn("c-mama", text)


if __name__ == "__main__":
    unittest.main()
