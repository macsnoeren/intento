"""Question Agent v1 met de FakeProvider (N6.3, INTENTO-NEW-DESIGN §7, §34)."""

from __future__ import annotations

import json
import unittest
from typing import Any

from agent_service.contracts import ContactEntry, TurnResponse
from agent_service.llm import FakeProvider, FakeResponse, LlmError
from agent_service.orchestrator import step
from tests.builders import NO, START, answer, request


def question(text: str, concept: str = "pain", **extra: Any) -> dict[str, Any]:
    return {
        "concept": concept,
        "text": text,
        "required_symbols": [concept],
        "confidence": 0.8,
        **extra,
    }


def with_questions(*answers: FakeResponse) -> FakeProvider:
    # Alleen de Question Agent krijgt antwoorden; de Intent Agent valt terug op de startconcepten.
    return FakeProvider(routes={"Question Agent": list(answers)})


def decision(response: TurnResponse) -> Any:
    return next(d for d in response.decisions if d.agent == "question-agent")


class QuestionAgentTest(unittest.TestCase):
    def test_geldige_vraag(self) -> None:
        response = step(request(START), llm=with_questions(question("Heb je pijn?")))
        self.assertEqual(response.presentation.text, "Heb je pijn?")
        self.assertEqual(response.state.questions_asked[-1].text, "Heb je pijn?")
        d = decision(response)
        self.assertEqual(
            (d.status, d.prompt_version, d.validation), ("success", "question-v1", "valid")
        )
        # Het pictogram en het woord eronder blijven die van het item.
        [option] = response.presentation.options
        self.assertEqual((option.vocabulary_item_id, option.label), ("v-pain", "pijn"))

    def test_terugval_bij_een_ongeldige_vraag(self) -> None:
        cases: list[tuple[FakeResponse, str]] = [
            (question("Heb je honger?", concept="eat"), "fout: ValueError"),  # ander concept
            (question("Heb je pijn"), "fout: ValueError"),  # geen vraagteken
            (question("Kijk op https://x.nl?"), "fout: ValueError"),  # URL
            (question("Heb je " + "heel " * 20 + "veel pijn?"), "ongeldig antwoord: text"),
            ({"text": "Pijn?"}, "ongeldig antwoord: concept, confidence, required_symbols"),
            (LlmError("timeout"), "llm: timeout"),
        ]
        for fake, reason in cases:
            with self.subTest(reason=reason):
                response = step(request(START), llm=with_questions(fake))
                self.assertEqual(response.presentation.text, "Pijn?")
                self.assertEqual(
                    (decision(response).status, decision(response).reason), ("fallback", reason)
                )

    def test_een_al_gestelde_vraag_is_een_terugval(self) -> None:
        first = step(request(START), llm=with_questions(question("Heb je pijn?")))
        # Na NEE gaat de vraag over "eten"; het model herhaalt een eerdere vraag over een ander concept.
        again = step(answer(first, NO), llm=with_questions(question("Heb je pijn?", concept="eat")))
        self.assertEqual(again.presentation.text, "Eten?")
        repeat = step(
            answer(first, NO),
            llm=with_questions(question("heb je  PIJN?", concept="eat")),
        )
        self.assertEqual(decision(repeat).status, "fallback")

    def test_de_prompt(self) -> None:
        mama = ContactEntry(id="c-1", name="Mama Jansen", vocabulary_item_id=None, sort_order=0)
        first = step(request(START, contacts=[mama]), llm=with_questions(question("Heb je pijn?")))
        llm = with_questions(question("Wil je eten?", concept="eat"))
        step(answer(first, NO, contacts=[mama]), llm=llm)
        call = next(c for c in llm.calls if "Question Agent" in c.system)
        data = json.loads(call.user)
        self.assertEqual(data["vraag_over"], {"concept": "eat", "label": "eten"})
        self.assertEqual(data["gesteld"], ["Heb je pijn?"])
        self.assertEqual(
            data["antwoorden"], [{"concept": "pain", "label": "pijn", "antwoord": "nee"}]
        )
        self.assertTrue(all("Mama" not in p for p in llm.prompts))


if __name__ == "__main__":
    unittest.main()
