"""Provider-interface en FakeProvider (N5.1, INTENTO-NEW-DESIGN §35)."""

from __future__ import annotations

import unittest

from agent_service.llm import FakeCall, FakeProvider, JsonObject, LlmError, LlmProvider

SCHEMA: JsonObject = {"type": "object", "properties": {"question": {"type": "string"}}}


class FakeProviderTest(unittest.TestCase):
    def test_geeft_de_antwoorden_in_volgorde(self) -> None:
        provider = FakeProvider([{"question": "Pijn?"}, {"question": "Hoofd?"}])
        self.assertEqual(provider.complete_json("sys", "een", SCHEMA, 5.0), {"question": "Pijn?"})
        self.assertEqual(provider.complete_json("sys", "twee", SCHEMA, 5.0), {"question": "Hoofd?"})

    def test_bewaart_elke_aanroep_en_alle_prompts(self) -> None:
        provider = FakeProvider([{}, {}], model="gemma3:4b")
        provider.complete_json("systeem 1", "gebruiker 1", SCHEMA, 2.5)
        provider.complete_json("systeem 2", "gebruiker 2", SCHEMA, 3.0)
        self.assertEqual(provider.model, "gemma3:4b")
        self.assertEqual(
            provider.calls[0],
            FakeCall(system="systeem 1", user="gebruiker 1", schema=SCHEMA, timeout=2.5),
        )
        self.assertEqual(provider.prompts, ["systeem 1", "gebruiker 1", "systeem 2", "gebruiker 2"])

    def test_gooit_een_opgegeven_fout(self) -> None:
        provider = FakeProvider([LlmError("timeout", "na 5 s")])
        with self.assertRaises(LlmError) as raised:
            provider.complete_json("s", "u", SCHEMA, 5.0)
        self.assertEqual(raised.exception.reason, "timeout")
        self.assertEqual(len(provider.calls), 1)

    def test_zonder_antwoorden_een_llm_error(self) -> None:
        with self.assertRaises(LlmError) as raised:
            FakeProvider().complete_json("s", "u", SCHEMA, 5.0)
        self.assertEqual(raised.exception.reason, "no_response")

    def test_een_functie_krijgt_de_aanroep(self) -> None:
        provider = FakeProvider([lambda call: {"echo": call.user}])
        self.assertEqual(provider.complete_json("s", "hallo", SCHEMA, 1.0), {"echo": "hallo"})

    def test_antwoorden_zijn_kopieen(self) -> None:
        answer: JsonObject = {"options": ["a"]}
        provider = FakeProvider([answer, answer])
        first = provider.complete_json("s", "u", SCHEMA, 1.0)
        first["options"].append("b")
        self.assertEqual(provider.complete_json("s", "u", SCHEMA, 1.0), {"options": ["a"]})

    def test_voldoet_aan_het_protocol(self) -> None:
        provider: LlmProvider = FakeProvider([{"ok": True}])
        self.assertEqual(provider.complete_json("s", "u", SCHEMA, 1.0), {"ok": True})

    def test_de_foutmelding_bevat_geen_prompt(self) -> None:
        error = LlmError("invalid_json", "geen object")
        self.assertEqual(str(error), "invalid_json: geen object")


if __name__ == "__main__":
    unittest.main()
