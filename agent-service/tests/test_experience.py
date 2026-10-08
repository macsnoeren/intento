"""Vaakst gekozen eerst (N12.2, INTENTO-NEW-DESIGN §2.4, §29 besluit 7).

Ranking ordent startconcepten, multi-icon-tegels en contacten, maar verbergt nooit een optie; bij een
gelijk aantal keuzes blijft de vaste volgorde. Zonder Experience (uit, of niets meegestuurd) verandert er
niets.
"""

from __future__ import annotations

import unittest
from typing import Any

from agent_service.agents.experience import Ranking
from agent_service.contracts import ContactEntry, ExperienceSummary, TurnResponse
from agent_service.orchestrator import step
from tests.builders import NO, START, YES, answer, experience, request

TIM = ContactEntry(id="c-tim", name="Tim", vocabulary_item_id=None, sort_order=0)
MAMA = ContactEntry(id="c-mama", name="Mama", vocabulary_item_id=None, sort_order=1)
OMA = ContactEntry(id="c-oma", name="Oma", vocabulary_item_id=None, sort_order=2)
CONTACTS = [TIM, MAMA, OMA]


def labels(response: TurnResponse) -> list[str]:
    return [option.label for option in response.presentation.options]


def summary(**kwargs: Any) -> ExperienceSummary:
    return ExperienceSummary.model_validate(experience(**kwargs))


class RankingTest(unittest.TestCase):
    def test_vaakst_gekozen_eerst_gelijk_blijft_de_volgorde(self) -> None:
        ranking = Ranking(summary(symbols={"b": 2, "c": 5}))
        self.assertEqual(ranking.symbols(["a", "b", "c", "d"], lambda x: x), ["c", "b", "a", "d"])

    def test_verbergt_nooit_een_optie(self) -> None:
        ranking = Ranking(summary(symbols={"x": 9, "d": 1}))
        ranked = ranking.symbols(["a", "b", "c", "d"], lambda x: x)
        self.assertCountEqual(ranked, ["a", "b", "c", "d"])

    def test_zonder_experience_de_gegeven_volgorde(self) -> None:
        self.assertEqual(Ranking(None).contacts(["a", "b"], lambda x: x), ["a", "b"])


class StartConceptsTest(unittest.TestCase):
    def test_binary_eerste_vraag_over_het_vaakst_gekozen_startconcept(self) -> None:
        response = step(request(START, experience=experience(symbols={"v-drink": 4, "v-eat": 1})))
        self.assertEqual(labels(response), ["drinken"])
        concepts = [h.concept for h in response.state.intent_hypotheses]
        self.assertEqual(concepts, ["drink", "eat", "pain"])

    def test_zonder_experience_de_vaste_volgorde(self) -> None:
        self.assertEqual(labels(step(request(START))), ["pijn"])

    def test_experience_uit_negeert_een_meegestuurde_samenvatting(self) -> None:
        response = step(
            request(
                START,
                experience=experience(symbols={"v-drink": 4}),
                experience_enabled=False,
            )
        )
        self.assertEqual(labels(response), ["pijn"])

    def test_na_nee_blijven_alle_startconcepten_aan_de_beurt(self) -> None:
        exp = experience(symbols={"v-drink": 4, "v-eat": 1})
        first = step(request(START, experience=exp))
        second = step(answer(first, NO, experience=exp))
        third = step(answer(second, NO, experience=exp))
        self.assertEqual(
            [labels(first), labels(second), labels(third)], [["drinken"], ["eten"], ["pijn"]]
        )

    def test_multi_icon_tegels_vaakst_gekozen_eerst(self) -> None:
        response = step(
            request(
                START,
                experience=experience(symbols={"v-drink": 3, "v-eat": 1}),
                interaction_mode="multi",
            )
        )
        self.assertEqual(labels(response), ["drinken", "eten", "pijn"])
        self.assertEqual([o.position for o in response.presentation.options], [0, 1, 2])


class ContactOrderTest(unittest.TestCase):
    def _share(self, exp: dict[str, Any] | None, **settings: Any) -> TurnResponse:
        """Start → JA → JA (Bedoel je) → JA (Wil je dit sturen?): de eerste contactvraag."""
        kwargs: dict[str, Any] = {"contacts": CONTACTS, "experience": exp, **settings}
        response = step(request(START, **kwargs))
        for _ in range(3):
            tiles = response.presentation.mode == "multi"
            event = (
                {"type": "select_option", "option_ref": response.presentation.options[0].ref}
                if tiles
                else YES
            )
            response = step(answer(response, event, **kwargs))
        return response

    def test_binary_vaakst_gekozen_contact_eerst_daarna_de_rest(self) -> None:
        exp = experience(contacts={"c-oma": 5, "c-mama": 2})
        first = self._share(exp)
        self.assertEqual(first.presentation.text, "Wil je dit naar Oma sturen?")
        second = step(answer(first, NO, contacts=CONTACTS, experience=exp))
        third = step(answer(second, NO, contacts=CONTACTS, experience=exp))
        self.assertEqual(second.presentation.text, "Wil je dit naar Mama sturen?")
        self.assertEqual(third.presentation.text, "Wil je dit naar Tim sturen?")

    def test_multi_icon_contacttegels_vaakst_gekozen_eerst(self) -> None:
        response = self._share(experience(contacts={"c-oma": 5}), interaction_mode="multi")
        self.assertEqual(response.presentation.kind, "share_contact")
        self.assertEqual(labels(response), ["Oma", "Tim", "Mama"])

    def test_zonder_experience_de_vaste_volgorde(self) -> None:
        self.assertEqual(self._share(None).presentation.text, "Wil je dit naar Tim sturen?")


if __name__ == "__main__":
    unittest.main()
