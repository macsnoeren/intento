"""Icon Agent, stap 1: exact (N6.5, INTENTO-NEW-DESIGN §8)."""

from __future__ import annotations

import unittest

from agent_service.agents.icon import exact_match, exact_option
from agent_service.vocabulary import VocabularyIndex
from tests.builders import item, vocabulary


def index() -> VocabularyIndex:
    return VocabularyIndex(
        [
            *vocabulary(),
            item("v-headache", "hoofdpijn", "headache", order=20, labels=["hoofdpijn", "koppijn"]),
        ]
    )


class ExactMatchTest(unittest.TestCase):
    def test_op_concept(self) -> None:
        match = exact_match("headache", "hoofdpijn", index())
        assert match is not None
        self.assertEqual(
            (match.entry.id, match.semantic_match, match.representation, match.matched_on),
            ("v-headache", "strong", "exact", "concept"),
        )
        self.assertEqual(match.label, "hoofdpijn")

    def test_op_label(self) -> None:
        match = exact_match("head_ache_onbekend", "hoofdpijn", index())
        assert match is not None
        self.assertEqual(
            (match.entry.id, match.matched_on, match.concept), ("v-headache", "label", "headache")
        )

    def test_op_synoniem(self) -> None:
        match = exact_match("onbekend", "koppijn", index())
        assert match is not None
        self.assertEqual(
            (match.entry.id, match.matched_on, match.label), ("v-headache", "synoniem", "koppijn")
        )

    def test_hoofdletters_spaties_en_underscores(self) -> None:
        for concept, label in [
            ("HEADACHE", "x"),
            ("  headache ", "x"),
            ("onbekend", "  Hoofd   Pijn "),
        ]:
            with self.subTest(concept=concept, label=label):
                match = exact_match(concept, label, index())
                if label.strip() == "Hoofd   Pijn":
                    # "hoofd pijn" (twee woorden) is niet "hoofdpijn": geen treffer.
                    self.assertIsNone(match)
                else:
                    assert match is not None
                    self.assertEqual(match.entry.id, "v-headache")
        # Een concept met underscore vindt het item met spaties in het label.
        spaced = VocabularyIndex([item("v-x", "chest pain", "chestpain", labels=["chest pain"])])
        found = exact_match("chest_pain", "x", spaced)
        assert found is not None
        self.assertEqual(found.entry.id, "v-x")

    def test_het_woord_is_altijd_van_het_item(self) -> None:
        # Gevonden op concept, maar het gevraagde woord kent het item niet: dan het eigen label (I1).
        match = exact_match("pain", "hoofdpijn", index())
        assert match is not None
        self.assertEqual((match.entry.id, match.label), ("v-pain", "pijn"))

    def test_geen_treffer(self) -> None:
        self.assertIsNone(exact_match("dizzy", "duizelig", index()))
        with self.assertRaises(LookupError):
            exact_option("dizzy", "duizelig", index())

    def test_als_optie(self) -> None:
        option = exact_option("headache", "hoofdpijn", index(), position=2)
        self.assertEqual(
            (
                option.ref,
                option.vocabulary_item_id,
                option.label,
                option.concept,
                option.representation,
                option.position,
            ),
            ("v-headache", "v-headache", "hoofdpijn", "headache", "exact", 2),
        )


if __name__ == "__main__":
    unittest.main()
