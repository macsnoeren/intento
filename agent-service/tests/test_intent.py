"""Intent Agent v1 met de FakeProvider (N6.1, INTENTO-NEW-DESIGN §6)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.agents.intent import MAX_PROMPT_WORDS, prompt_words
from agent_service.contracts import ContactEntry, TurnResponse
from agent_service.llm import FakeProvider, LlmError
from agent_service.orchestrator import step
from agent_service.vocabulary import VocabularyIndex
from tests.builders import NO, START, answer, item, request, vocabulary


def hypotheses(*items: tuple[str, str, float], **extra: Any) -> dict[str, Any]:
    return {
        "hypotheses": [{"concept": c, "label": label, "confidence": p} for c, label, p in items],
        "needs_clarification": True,
        **extra,
    }


def intent_decision(response: TurnResponse) -> Any:
    return next(d for d in response.decisions if d.agent == "intent-agent")


class IntentAgentTest(unittest.TestCase):
    def test_geldig_antwoord_bepaalt_de_hypotheses(self) -> None:
        llm = FakeProvider(
            [hypotheses(("drink", "drinken", 0.6), ("eat", "eten", 0.3), assumptions=["dorst"])]
        )
        response = step(request(START), llm=llm)
        self.assertEqual(
            [(h.concept, h.confidence) for h in response.state.intent_hypotheses],
            [("drink", 0.6), ("eat", 0.3)],
        )
        self.assertEqual(response.presentation.text, "Drinken?")
        self.assertEqual(response.state.assumptions, ["dorst"])
        decision = intent_decision(response)
        self.assertEqual(
            (decision.status, decision.model, decision.prompt_version, decision.validation),
            ("success", "fake-model", "intent-v3", "valid"),
        )
        payload = response.inferences[0].payload
        self.assertIs(payload["needs_clarification"], True)

    def test_ongeldige_json_valt_terug_op_de_regels(self) -> None:
        llm = FakeProvider([{"hypotheses": "kapot"}])
        response = step(request(START), llm=llm)
        decision = intent_decision(response)
        self.assertEqual((decision.status, decision.validation), ("fallback", "invalid"))
        self.assertIn("hypotheses", decision.reason or "")
        # De regels: startconcepten in vaste volgorde.
        self.assertEqual(response.presentation.text, "Pijn?")

    def test_time_out_valt_terug_op_de_regels(self) -> None:
        llm = FakeProvider([LlmError("timeout", "na 10 s")])
        response = step(request(START), llm=llm)
        decision = intent_decision(response)
        self.assertEqual((decision.status, decision.reason), ("fallback", "llm: timeout"))
        self.assertEqual(
            [h.concept for h in response.state.intent_hypotheses], ["pain", "eat", "drink"]
        )

    def test_afgewezen_en_dubbel_vallen_eruit_een_eigen_concept_mag(self) -> None:
        first = step(request(START))  # regels: "Pijn?"
        llm = FakeProvider(
            [
                hypotheses(
                    ("pain", "pijn", 0.9),  # net afgewezen
                    ("Dizziness!", "duizelig", 0.8),  # geen item: een eigen concept
                    ("eat", "eten", 0.5),
                    ("EAT", "eten", 0.4),  # dubbel
                )
            ]
        )
        response = step(answer(first, NO), llm=llm)
        self.assertEqual(
            [(h.concept, h.label) for h in response.state.intent_hypotheses],
            [("dizziness", "duizelig"), ("eat", "eten")],
        )

    def test_niets_bruikbaars_is_een_terugval(self) -> None:
        # Alleen een onbruikbaar concept (na opschonen leeg): niets over, dus de regels.
        llm = FakeProvider([hypotheses(("!!!", "iets", 0.9))])
        response = step(request(START), llm=llm)
        self.assertEqual(intent_decision(response).status, "fallback")
        self.assertEqual(intent_decision(response).reason, "fout: ValueError")

    def test_het_woord_bij_het_pictogram_blijft_dat_van_het_item(self) -> None:
        llm = FakeProvider([hypotheses(("sick", "misselijk", 0.7), ("pain", "hoofdpijn", 0.6))])
        response = step(request(START), llm=llm)
        labels = [(h.concept, h.label) for h in response.state.intent_hypotheses]
        # "misselijk" is een synoniem van het item; "hoofdpijn" is geen woord van het item "pijn".
        self.assertEqual(labels, [("sick", "misselijk"), ("pain", "pijn")])

    def test_de_prompt_bevat_antwoorden_maar_nooit_contactnamen(self) -> None:
        mama = ContactEntry(id="c-1", name="Mama Jansen", vocabulary_item_id=None, sort_order=0)
        first = step(request(START, contacts=[mama]))
        llm = FakeProvider([hypotheses(("eat", "eten", 0.5))])
        step(answer(first, NO, contacts=[mama]), llm=llm)
        system, user = llm.calls[0].system, llm.calls[0].user
        self.assertIn("Intent Agent", system)
        data = json.loads(user)
        self.assertEqual(
            data["antwoorden"], [{"concept": "pain", "label": "pijn", "antwoord": "nee"}]
        )
        self.assertEqual(data["getoond"]["opties"], ["pain"])
        for prompt in llm.prompts:
            self.assertNotIn("Mama", prompt)
            self.assertNotIn("Jansen", prompt)

    def test_compacte_vocabulary(self) -> None:
        many = [
            item(f"v-{i}", f"woord{i}", f"concept_{i}", order=100 + i, contexts=["x"])
            for i in range(400)
        ]
        index = VocabularyIndex(vocabulary() + many)
        state = step(request(START)).state
        words = prompt_words(state, index)
        # Startwoorden altijd; woorden uit niet-relevante contexten niet.
        self.assertEqual([w["concept"] for w in words if w["start"]], ["pain", "eat", "drink"])
        self.assertNotIn("concept_1", {w["concept"] for w in words})
        state.intent_hypotheses[0].concept = "concept_1"
        self.assertLessEqual(len(prompt_words(state, index)), MAX_PROMPT_WORDS)


if __name__ == "__main__":
    unittest.main()
