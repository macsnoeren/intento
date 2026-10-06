"""Icon Agent, stap 2 en 3: het dichtstbijzijnde pictogram (N6.6, INTENTO-NEW-DESIGN §8, §17)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.agents.icon import closest_match, icon_prompt, no_image, search
from agent_service.llm import FakeProvider, FakeResponse, LlmError
from agent_service.orchestrator import step
from agent_service.vocabulary import VocabularyIndex
from tests.builders import START, YES, answer, request, vocabulary


def icon_fake(*answers: FakeResponse, intent: list[FakeResponse] | None = None) -> FakeProvider:
    return FakeProvider(routes={"Icon Agent": list(answers), "Intent Agent": intent or []})


def dizzy_intent() -> dict[str, Any]:
    return {
        "hypotheses": [{"concept": "dizziness", "label": "duizelig", "confidence": 0.6}],
        "needs_clarification": True,
    }


class ClosestTest(unittest.TestCase):
    def test_duizelig_wordt_ziek_als_stand_in_met_gap(self) -> None:
        llm = icon_fake(
            {"words": ["ziek", "misselijk", "draaierig"]}, {"item_id": "v-sick", "confidence": 0.4}
        )
        match = closest_match(
            llm, icon_prompt(), "dizziness", "duizelig", VocabularyIndex(vocabulary())
        )
        self.assertEqual(
            (match.entry.id, match.representation, match.semantic_match),
            ("v-sick", "stand_in", "weak"),
        )
        # Het woord van de gebruiker onder het pictogram, niet "ziek".
        option = match.option()
        self.assertEqual(
            (option.label, option.concept, option.vocabulary_item_id),
            ("duizelig", "dizziness", "v-sick"),
        )
        gap = match.gap()
        assert gap is not None
        self.assertEqual(
            (gap.concept, gap.label, gap.context, gap.best_available_item_id, gap.confidence),
            ("dizziness", "duizelig", "health", "v-sick", 0.4),
        )
        # Het kiesschema laat alleen de kandidaten toe.
        schema = llm.calls[1].schema
        self.assertEqual(schema["properties"]["item_id"]["enum"], ["v-sick", "none"])
        self.assertEqual(json.loads(llm.calls[1].user)["kandidaten"][0]["id"], "v-sick")

    def test_een_verzonnen_id_wordt_geweigerd(self) -> None:
        llm = icon_fake({"words": ["ziek"]}, {"item_id": "v-verzonnen", "confidence": 0.9})
        with self.assertRaises(ValueError):
            closest_match(
                llm, icon_prompt(), "dizziness", "duizelig", VocabularyIndex(vocabulary())
            )

    def test_niets_in_de_buurt_is_geen_afbeelding(self) -> None:
        index = VocabularyIndex(vocabulary())
        # Geen kandidaten uit de tekstzoekopdracht.
        nothing = closest_match(
            icon_fake({"words": ["ruimteschip"]}), icon_prompt(), "spaceship", "ruimteschip", index
        )
        self.assertEqual(
            (nothing.entry.id, nothing.semantic_match, nothing.label),
            ("v-noimage", "none", "ruimteschip"),
        )
        # Het model kiest "none".
        none = closest_match(
            icon_fake({"words": ["ziek"]}, {"item_id": "none", "confidence": 0.0}),
            icon_prompt(),
            "x",
            "iets",
            index,
        )
        self.assertEqual(none.entry.id, "v-noimage")
        gap = none.gap()
        assert gap is not None
        self.assertEqual(gap.best_available_item_id, "v-noimage")

    def test_geen_afbeelding_zonder_item_is_een_fout(self) -> None:
        without = VocabularyIndex([e for e in vocabulary() if e.id != "v-noimage"])
        with self.assertRaises(LookupError):
            no_image("x", "iets", without)

    def test_tekstzoekopdracht(self) -> None:
        index = VocabularyIndex(vocabulary())
        self.assertEqual([e.id for e in search(["misselijk"], index)], ["v-sick"])
        self.assertEqual([e.id for e in search(["drink"], index)][:1], ["v-drink"])
        self.assertEqual(search(["xy"], index), [])  # te kort
        self.assertNotIn("v-noimage", [e.id for e in search(["afbeelding", "no_image"], index)])


class OrchestratorIconTest(unittest.TestCase):
    def test_vraag_met_stand_in_en_gap_in_hetzelfde_antwoord(self) -> None:
        llm = icon_fake(
            {"words": ["ziek", "misselijk"]},
            {"item_id": "v-sick", "confidence": 0.4},
            intent=[dizzy_intent()],
        )
        response = step(request(START), llm=llm)
        [option] = response.presentation.options
        self.assertEqual(
            (option.vocabulary_item_id, option.label, option.representation),
            ("v-sick", "duizelig", "stand_in"),
        )
        self.assertEqual(
            [(g.concept, g.best_available_item_id) for g in response.gaps],
            [("dizziness", "v-sick")],
        )
        decision = next(d for d in response.decisions if d.agent == "icon-agent")
        self.assertEqual((decision.status, decision.prompt_version), ("success", "icon-v1"))

    def test_uitval_van_het_model_geeft_geen_afbeelding(self) -> None:
        llm = icon_fake(LlmError("timeout"), intent=[dizzy_intent()])
        response = step(request(START), llm=llm)
        [option] = response.presentation.options
        self.assertEqual((option.vocabulary_item_id, option.label), ("v-noimage", "duizelig"))
        self.assertEqual(response.gaps[0].best_available_item_id, "v-noimage")
        decision = next(d for d in response.decisions if d.agent == "icon-agent")
        self.assertEqual((decision.status, decision.reason), ("fallback", "llm: timeout"))

    def test_exact_vraagt_het_model_niet(self) -> None:
        llm = icon_fake()
        response = step(request(START), llm=llm)  # Intent valt terug op de startconcepten: pijn
        self.assertEqual(response.gaps, [])
        self.assertFalse(any("Icon Agent" in c.system for c in llm.calls))

    def test_het_voorstel_houdt_het_pictogram_en_de_gap(self) -> None:
        llm = icon_fake(
            {"words": ["ziek"]},
            {"item_id": "v-sick", "confidence": 0.4},
            intent=[dizzy_intent(), {**dizzy_intent(), "needs_clarification": False}],
        )
        first = step(request(START), llm=llm)
        proposal = step(answer(first, YES), llm=llm)
        self.assertEqual(proposal.presentation.text, "Bedoel je: Duizelig?")
        [option] = proposal.presentation.options
        self.assertEqual(
            (option.vocabulary_item_id, option.label, option.representation),
            ("v-sick", "duizelig", "stand_in"),
        )
        self.assertEqual([g.best_available_item_id for g in proposal.gaps], ["v-sick"])


if __name__ == "__main__":
    unittest.main()
