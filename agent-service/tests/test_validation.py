"""Validation Agent: de regels V1 t/m V7, elk geldig en ongeldig (N6.7, INTENTO-NEW-DESIGN §9)."""

from __future__ import annotations

import unittest

from agent_service.agents.validation import (
    v1_symbols_exist,
    v2_question_text,
    v3_concept_matches,
    v4_not_repeated,
    v5_conflicting_answers,
    v6_option_count,
    v7_proposal,
    validate_question,
)
from agent_service.contracts import Answer, AskedQuestion, Gap, Option, Presentation, SessionState
from agent_service.orchestrator import step
from agent_service.vocabulary import VocabularyIndex
from tests.builders import START, request, settings, vocabulary

INDEX = VocabularyIndex(vocabulary())


def option(
    item_id: str, label: str, concept: str, *, stand_in: bool = False, position: int = 0
) -> Option:
    return Option(
        ref=item_id,
        kind="symbol",
        vocabulary_item_id=item_id,
        label=label,
        concept=concept,
        representation="stand_in" if stand_in else "exact",
        position=position,
    )


def question(*options: Option, mode: str = "binary") -> Presentation:
    return Presentation.model_validate(
        {"kind": "question", "mode": mode, "text": "Pijn?", "options": list(options)}
    )


def state() -> SessionState:
    return step(request(START)).state


class ValidationRulesTest(unittest.TestCase):
    def test_v1_symbool_bestaat(self) -> None:
        self.assertIsNone(v1_symbols_exist(question(option("v-pain", "pijn", "pain")), INDEX))
        finding = v1_symbols_exist(question(option("v-verzonnen", "pijn", "pain")), INDEX)
        self.assertEqual(finding and finding.rule, "V1")

    def test_v2_vraagtekst(self) -> None:
        self.assertIsNone(v2_question_text("Heb je pijn?", ["Mama Jansen"]))
        for text in [
            "Pi",
            "Heb je pijn",
            "Kijk op www.voorbeeld.nl?",
            "Zie https://x.nl?",
            "x" * 80 + "?",
        ]:
            with self.subTest(text=text):
                self.assertEqual(getattr(v2_question_text(text), "rule", None), "V2")
        named = v2_question_text("Wil je naar Jansen?", ["Mama Jansen"])
        self.assertEqual(named and named.reason, "de vraag bevat een naam")

    def test_v3_concept_past_bij_het_symbool(self) -> None:
        self.assertIsNone(
            v3_concept_matches("pain", question(option("v-pain", "pijn", "pain")), [], INDEX)
        )
        wrong = v3_concept_matches("eat", question(option("v-pain", "pijn", "eat")), [], INDEX)
        self.assertEqual(wrong and wrong.rule, "V3")
        gap = Gap(
            type="vocabulary_gap",
            concept="dizziness",
            label="duizelig",
            best_available_item_id="v-sick",
            confidence=0.4,
        )
        stand_in = question(option("v-sick", "duizelig", "dizziness", stand_in=True))
        self.assertIsNone(v3_concept_matches("dizziness", stand_in, [gap], INDEX))
        self.assertEqual(
            getattr(v3_concept_matches("dizziness", stand_in, [], INDEX), "rule", None), "V3"
        )

    def test_v4_niet_herhaald(self) -> None:
        s = state()
        self.assertIsNone(v4_not_repeated("Heb je honger?", s))
        s.questions_asked.append(AskedQuestion(turn=0, concept="eat", text="Heb je honger?"))
        self.assertEqual(getattr(v4_not_repeated("heb je  HONGER?", s), "rule", None), "V4")

    def test_v5_tegenstrijdige_antwoorden(self) -> None:
        s = state()
        s.answers = [
            Answer(turn=0, answer="yes", concepts=["pain"]),
            Answer(turn=1, answer="no", concepts=["head"]),
        ]
        self.assertIsNone(v5_conflicting_answers(s))
        s.answers.append(Answer(turn=2, answer="no", concepts=["pain"]))
        finding = v5_conflicting_answers(s)
        assert finding is not None
        self.assertEqual(
            (finding.rule, finding.reason, finding.action), ("V5", "conflicting_answers", "clarify")
        )

    def test_v6_aantal_symbolen(self) -> None:
        cfg = settings(options_per_screen=3)
        self.assertIsNone(
            v6_option_count(question(option("v-pain", "pijn", "pain")), "binary", cfg)
        )
        two = question(
            option("v-pain", "pijn", "pain"),
            option("v-eat", "eten", "eat", position=1),
            mode="multi",
        )
        self.assertEqual(getattr(v6_option_count(two, "binary", cfg), "rule", None), "V6")
        self.assertIsNone(v6_option_count(two, "multi", cfg))
        same = question(
            option("v-pain", "pijn", "pain"),
            option("v-pain", "pijn", "pain", position=1),
            mode="multi",
        )
        self.assertEqual(getattr(v6_option_count(same, "multi", cfg), "rule", None), "V6")
        four = question(
            *[
                option(i, w, c, position=n)
                for n, (i, w, c) in enumerate(
                    [
                        ("v-pain", "pijn", "pain"),
                        ("v-eat", "eten", "eat"),
                        ("v-drink", "drinken", "drink"),
                        ("v-head", "hoofd", "head"),
                    ]
                )
            ],
            mode="multi",
        )
        self.assertEqual(getattr(v6_option_count(four, "multi", cfg), "rule", None), "V6")

    def test_v7_voorstel(self) -> None:
        s = state()
        s.answers = [Answer(turn=0, answer="yes", concepts=["pain"])]
        self.assertIsNone(v7_proposal("Ik heb pijn.", 0.9, s))
        self.assertEqual(getattr(v7_proposal("Ik", 0.9, s), "rule", None), "V7")
        self.assertEqual(getattr(v7_proposal("Ik heb pijn.", 0.6, s), "rule", None), "V7")
        self.assertIsNone(v7_proposal("Ik heb pijn.", 0.6, s, threshold=0.5))
        s.answers = []
        self.assertEqual(
            getattr(v7_proposal("Ik heb pijn.", 0.9, s), "reason", None),
            "een voorstel vraagt minstens één antwoord",
        )

    def test_alles_samen(self) -> None:
        s = state()
        ok = validate_question(
            concept="pain",
            text="Heb je pijn?",
            presentation=question(option("v-pain", "pijn", "pain")),
            gaps=[],
            state=s,
            settings=settings(),
            vocabulary=INDEX,
        )
        self.assertEqual(ok, [])
        bad = validate_question(
            concept="eat",
            text="Kijk op www.x.nl",
            presentation=question(option("v-verzonnen", "x", "x")),
            gaps=[],
            state=s,
            settings=settings(),
            vocabulary=INDEX,
        )
        self.assertEqual([f.rule for f in bad], ["V1", "V2", "V3"])


if __name__ == "__main__":
    unittest.main()
