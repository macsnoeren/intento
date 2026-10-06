"""Opnieuw proberen bij een ongeldige vraag (N6.8, INTENTO-NEW-DESIGN §4.2 stap 6)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.contracts import ContactEntry, TurnResponse
from agent_service.llm import FakeProvider
from agent_service.orchestrator import step
from tests.builders import START, request


def question(text: str, concept: str = "pain") -> dict[str, Any]:
    return {"concept": concept, "text": text, "required_symbols": [concept], "confidence": 0.8}


MAMA = ContactEntry(id="c-1", name="Mama Jansen", vocabulary_item_id=None, sort_order=0)


def decisions(response: TurnResponse, agent: str) -> list[Any]:
    return [d for d in response.decisions if d.agent == agent]


class QuestionRetryTest(unittest.TestCase):
    def test_tweede_poging_met_de_reden_erbij(self) -> None:
        llm = FakeProvider(
            routes={"Question Agent": [question("Heb je pijn, Jansen?"), question("Heb je pijn?")]}
        )
        response = step(request(START, contacts=[MAMA]), llm=llm)
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        calls = [c for c in llm.calls if "Question Agent" in c.system]
        self.assertEqual(len(calls), 2)
        self.assertNotIn("afgekeurd", json.loads(calls[0].user))
        self.assertEqual(json.loads(calls[1].user)["afgekeurd"], ["de vraag bevat een naam"])
        self.assertEqual(
            [d.validation for d in decisions(response, "validation-agent")], ["invalid", "valid"]
        )

    def test_na_twee_ongeldige_vragen_de_terugval(self) -> None:
        llm = FakeProvider(
            routes={
                "Question Agent": [
                    question("Heb je pijn, Jansen?"),
                    question("Mama Jansen, pijn?"),
                    question("Heb je pijn?"),  # een derde poging komt er niet
                ]
            }
        )
        response = step(request(START, contacts=[MAMA]), llm=llm)
        self.assertEqual(response.presentation.text, "Pijn?")
        self.assertEqual(len([c for c in llm.calls if "Question Agent" in c.system]), 2)
        last = decisions(response, "question-agent")[-1]
        self.assertEqual((last.status, last.validation), ("fallback", "invalid"))
        self.assertIn("na 2 afgekeurde vragen", last.reason or "")
        # De namen zelf komen niet in de beslissing.
        self.assertNotIn("Jansen", json.dumps([d.model_dump() for d in response.decisions]))

    def test_zonder_taalmodel_een_keuring_en_geen_nieuwe_poging(self) -> None:
        response = step(request(START))
        self.assertEqual(response.presentation.text, "Pijn?")
        self.assertEqual(len(decisions(response, "question-agent")), 1)
        self.assertEqual([d.validation for d in decisions(response, "validation-agent")], ["valid"])


if __name__ == "__main__":
    unittest.main()
