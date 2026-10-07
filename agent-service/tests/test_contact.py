"""Contact Agent: volgorde en vaste zinnen (N11.2, INTENTO-NEW-DESIGN §28, §29)."""

from __future__ import annotations

import unittest

from agent_service.agents.contact import (
    contact_option,
    contact_order,
    contact_question,
    next_contact,
)
from agent_service.contracts import ContactEntry
from agent_service.orchestrator import new_state
from tests.builders import START, request


def contact(cid: str, order: int) -> ContactEntry:
    return ContactEntry(id=cid, name=cid.title(), vocabulary_item_id=None, sort_order=order)


class ContactAgentTest(unittest.TestCase):
    def test_volgorde_op_sort_order_en_stabiel_bij_gelijk(self) -> None:
        contacts = [contact("b", 1), contact("a", 0), contact("c", 1)]
        self.assertEqual([c.id for c in contact_order(contacts)], ["a", "b", "c"])

    def test_volgende_slaat_gevraagde_over(self) -> None:
        state = new_state(request(START))
        contacts = [contact("a", 0), contact("b", 1)]
        state.share.contacts_asked = ["a"]
        nxt = next_contact(state, contacts)
        self.assertEqual(nxt.id if nxt else None, "b")
        state.share.contacts_asked.append("b")
        self.assertIsNone(next_contact(state, contacts))

    def test_vaste_zin_en_optie(self) -> None:
        self.assertEqual(contact_question("Mama"), "Wil je dit naar Mama sturen?")
        option = contact_option(contact("mama", 0))
        self.assertEqual(
            (option.kind, option.contact_id, option.label), ("contact", "mama", "Mama")
        )
        self.assertIsNone(option.concept)


if __name__ == "__main__":
    unittest.main()
