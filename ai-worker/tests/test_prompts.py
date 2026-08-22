"""Tests voor de prompt-/schemabouw en het opschonen van Ollama-uitvoer (T5.6)."""

from __future__ import annotations

import unittest

from ai_worker.prompts import (
    PromptError,
    build_generate_message,
    build_select_next_question,
    shape_message_result,
    shape_question_result,
)

# Een representatieve select_next_question-payload zoals de backend (`buildAiPrompt`) hem samenstelt.
QUESTION_PAYLOAD = {
    "task": "select_next_question",
    "systemRules": ["Je bent geen chatbot.", "Je verzint geen concepten."],
    "goal": "Bepaal de beste volgende vraag.",
    "aacRules": ["Blijf binnen de aangeboden opties."],
    "userContext": [{"kind": "person", "value": "mama"}],
    "conversationContext": [{"concept": "eten", "label": "eten"}],
    "lastChoice": {"concept": "eten", "label": "eten"},
    "availableSymbols": [
        {"concept": "appel", "label": "appel"},
        {"concept": "brood", "label": "brood"},
    ],
    "askedQuestions": ["Wat wil je duidelijk maken?"],
    "rejectedConcepts": [
        {"concept": "drink", "label": "drinken", "kind": "no_fitting_option"},
    ],
}

MESSAGE_PAYLOAD = {
    "task": "generate_message",
    "systemRules": ["Je spreekt nooit namens de gebruiker."],
    "goal": "Vorm één natuurlijke zin.",
    "aacRules": ["Voeg niets toe."],
    "userContext": [],
    "chosenConcepts": [
        {"concept": "ik_wil", "label": "ik wil"},
        {"concept": "appel", "label": "appel"},
    ],
}


class BuildSelectNextQuestionTests(unittest.TestCase):
    def test_lists_available_concepts_without_hard_enum(self) -> None:
        _system, prompt, schema, allowed = build_select_next_question(QUESTION_PAYLOAD)
        self.assertEqual(allowed, ["appel", "brood"])
        symbol_schema = schema["properties"]["options"]["items"]["properties"]["symbol"]
        # Sinds DESIGN §7.6 trap 3 mag het model een nieuw begrip aandragen: een `enum` zou dat hard
        # onmogelijk maken. De backend valideert de sleutel alsnog tegen de bibliotheek.
        self.assertNotIn("enum", symbol_schema)
        # De prompt somt de toegestane opties op en bevat de gesprekscontext.
        self.assertIn("appel", prompt)
        self.assertIn("TOEGESTANE OPTIES", prompt)

    def test_prompt_carries_negative_context(self) -> None:
        """T10.4: de eerder gestelde vragen en de afgewezen concepten staan in de prompt."""
        _system, prompt, _schema, _allowed = build_select_next_question(QUESTION_PAYLOAD)
        self.assertIn("AL GESTELDE VRAGEN", prompt)
        self.assertIn("Wat wil je duidelijk maken?", prompt)
        self.assertIn("AFGEWEZEN DOOR DE GEBRUIKER", prompt)
        self.assertIn("drink (drinken) — no_fitting_option", prompt)

    def test_prompt_without_negative_context_says_none(self) -> None:
        payload = {key: value for key, value in QUESTION_PAYLOAD.items()}
        payload.pop("askedQuestions")
        payload.pop("rejectedConcepts")
        _system, prompt, _schema, _allowed = build_select_next_question(payload)
        self.assertIn("AL GESTELDE VRAGEN (niet herhalen):\n- (geen)", prompt)
        self.assertIn("AFGEWEZEN DOOR DE GEBRUIKER (niet opnieuw aanbieden):\n- (geen)", prompt)

    def test_system_prompt_carries_rules_and_goal(self) -> None:
        system, _prompt, _schema, _allowed = build_select_next_question(QUESTION_PAYLOAD)
        self.assertIn("Je bent geen chatbot.", system)
        self.assertIn("Bepaal de beste volgende vraag.", system)


class ShapeQuestionResultTests(unittest.TestCase):
    def test_keeps_new_concepts_but_puts_known_ones_first(self) -> None:
        """T10.6: een onbekend begrip wordt niet meer weggegooid — de backend beslist erover.

        Wel krijgen bekende (beheerde) concepten voorrang in de volgorde, zodat de bibliotheek vóór een
        verzonnen begrip gaat (DESIGN §7.6: trap 1/2 vóór trap 3).
        """
        raw = {
            "question": "Wat wil je eten?",
            "options": [
                {"symbol": "nagelknipper", "confidence": 0.8},  # nog niet in de bibliotheek
                {"symbol": "appel", "confidence": 0.9},
            ],
            "reason": "omdat",
            "confidence": 0.7,
        }
        result = shape_question_result(raw, ["appel", "brood"])
        symbols = [opt["symbol"] for opt in result["options"]]
        self.assertEqual(symbols, ["appel", "nagelknipper"])
        self.assertEqual(result["confidence"], 0.7)

    def test_skips_empty_symbols(self) -> None:
        raw = {
            "question": "Wat wil je eten?",
            "options": [{"symbol": "  ", "confidence": 0.9}, {"symbol": "appel", "confidence": 0.5}],
            "reason": "",
        }
        result = shape_question_result(raw, ["appel"])
        self.assertEqual([opt["symbol"] for opt in result["options"]], ["appel"])

    def test_clamps_out_of_range_confidence(self) -> None:
        raw = {
            "question": "Wat wil je eten?",
            "options": [{"symbol": "appel", "confidence": 1.8}],
            "reason": "",
        }
        result = shape_question_result(raw, ["appel"])
        self.assertEqual(result["options"][0]["confidence"], 1.0)

    def test_missing_question_raises(self) -> None:
        with self.assertRaises(PromptError):
            shape_question_result({"options": [], "reason": ""}, ["appel"])


class MessageTests(unittest.TestCase):
    def test_build_and_shape_message(self) -> None:
        system, prompt, schema = build_generate_message(MESSAGE_PAYLOAD)
        self.assertIn("Je spreekt nooit namens de gebruiker.", system)
        self.assertIn("appel", prompt)
        self.assertEqual(schema["required"], ["message"])

        result = shape_message_result({"message": "  Ik wil een appel.  ", "confidence": 0.9})
        self.assertEqual(result["message"], "Ik wil een appel.")
        self.assertEqual(result["confidence"], 0.9)

    def test_empty_message_raises(self) -> None:
        with self.assertRaises(PromptError):
            shape_message_result({"message": "   "})


if __name__ == "__main__":
    unittest.main()
