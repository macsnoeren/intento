"""Experience Agent: observaties over een afgerond gesprek (N12.4, INTENTO-NEW-DESIGN §21 laag 2)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from agent_service.agents.observer import observe, prompt_input, rules_notes
from agent_service.contracts import ExperienceRequest, ExperienceResponse
from agent_service.llm import FakeProvider, LlmError
from agent_service.server import AgentServer
from tests.test_server import TOKEN, ServerTestCase

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "fixtures"
    / "valid"
    / "experience_request.confirmed.json"
)


def base() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text("utf-8"))
    return data


def make(**overrides: Any) -> ExperienceRequest:
    data = base()
    data.update(overrides)
    return ExperienceRequest.model_validate(data)


def question(turn: int, answer: str | None, representation: str = "exact") -> dict[str, Any]:
    return {
        "turn": turn,
        "kind": "question",
        "mode": "binary",
        "text": "Heb je pijn?",
        "options": [
            {"label": "pijn", "concept": "pain", "representation": representation, "position": 0}
        ],
        "answer": answer,
        "chosen_position": None,
        "response_time_ms": 3000,
    }


def llm(*responses: Any) -> FakeProvider:
    return FakeProvider(routes={"Experience Agent": list(responses)})


class RulesTest(unittest.TestCase):
    def test_bevestigd_en_verstuurd(self) -> None:
        notes = rules_notes(make())
        self.assertEqual(notes[0].about, "flow")
        self.assertEqual(notes[0].text, "Na 2 vragen een bevestigd bericht en verstuurd.")

    def test_gestopt_na_drie_keer_nee_en_twee_keer_terug(self) -> None:
        screens = [question(0, "no"), question(1, "no"), question(2, "no"), question(3, "back")]
        screens.append({**question(4, "back"), "turn": 4})
        notes = rules_notes(make(outcome="stopped", sent=False, screens=screens))
        texts = [n.text for n in notes]
        self.assertEqual(texts[0], "Gestopt zonder bericht na 5 vragen.")
        self.assertIn("3 keer achter elkaar nee: misschien sloten de vragen niet aan.", texts)
        self.assertTrue(any(t.startswith("2 keer terug") for t in texts))

    def test_vervangend_pictogram_gekozen(self) -> None:
        notes = rules_notes(make(screens=[question(0, "yes", representation="stand_in")]))
        self.assertIn("symbol", [n.about for n in notes])


class ObserveTest(unittest.TestCase):
    def test_zonder_taalmodel_de_regels(self) -> None:
        response = observe(make())
        self.assertEqual(response.decision.status, "success")
        self.assertEqual(response.decision.prompt_version, "rules-v1")
        self.assertGreaterEqual(len(response.notes), 1)

    def test_met_taalmodel_de_observaties_van_het_model(self) -> None:
        note = {
            "about": "question",
            "text": "Nee op pijn duurde lang;  ja op drinken ging snel.",
            "confidence": 0.6,
        }
        provider = llm({"notes": [note]})
        response = observe(make(), llm=provider)
        self.assertEqual(response.decision.status, "success")
        self.assertEqual(response.decision.prompt_version, "experience-v1")
        self.assertEqual(response.decision.validation, "valid")
        self.assertEqual(
            [n.text for n in response.notes], ["Nee op pijn duurde lang; ja op drinken ging snel."]
        )
        # Wat het model zag: de schermen, in gewone woorden.
        sent = json.loads(provider.calls[0].user)
        self.assertEqual(sent["uitkomst"], "bevestigd")
        self.assertEqual(sent["schermen"][0]["gedaan"], "nee")
        self.assertEqual(sent["schermen"][0]["seconden"], 4.2)

    def test_geen_observatie_mag(self) -> None:
        response = observe(make(), llm=llm({"notes": []}))
        self.assertEqual((response.decision.status, response.notes), ("success", []))

    def test_ongeldig_antwoord_valt_terug_op_de_regels(self) -> None:
        bad_answers: list[Any] = [
            {
                "notes": [
                    {"about": "question", "text": "Zie https://x.nl voor meer.", "confidence": 1}
                ]
            },
            {
                "notes": [
                    {"about": "user", "text": "De gebruiker wil altijd drinken.", "confidence": 1}
                ]
            },
            {"notes": [{"about": "flow", "text": "x" * 161, "confidence": 0.5}]},
            {
                "notes": [
                    {
                        "about": "flow",
                        "text": "Een observatie van genoeg tekens.",
                        "confidence": 0.5,
                    }
                ]
                * 4
            },
            {"notes": "geen lijst"},
        ]
        for bad in bad_answers:
            with self.subTest(bad=str(bad)[:40]):
                response = observe(make(), llm=llm(bad))
                self.assertEqual(response.decision.status, "fallback")
                self.assertEqual(response.decision.validation, "invalid")
                self.assertEqual(response.notes, rules_notes(make()))

    def test_taalmodel_onbereikbaar_valt_terug(self) -> None:
        response = observe(make(), llm=llm(LlmError("timeout", "te traag")))
        self.assertEqual(response.decision.status, "fallback")
        self.assertEqual(response.decision.reason, "llm: timeout")
        self.assertEqual(response.notes, rules_notes(make()))

    def test_de_invoer_kent_geen_contacten(self) -> None:
        # Het contract heeft geen plek voor contactschermen of -namen; de invoer bevat alleen schermen.
        payload = json.loads(prompt_input(make()))
        self.assertEqual(set(payload), {"vorm", "uitkomst", "verstuurd", "schermen"})
        self.assertNotIn("contact", json.dumps(payload))


class ExperienceServerTest(ServerTestCase):
    def test_terugkijken_over_http(self) -> None:
        status, body = self.request("POST", "/v1/experience", json.dumps(base()).encode())
        self.assertEqual(status, 200)
        response = ExperienceResponse.model_validate(body)
        self.assertEqual(response.session_id, "s-1")
        self.assertEqual(response.decision.agent, "experience-agent")

    def test_zonder_token_401(self) -> None:
        status, body = self.request("POST", "/v1/experience", json.dumps(base()).encode(), None)
        self.assertEqual((status, body["error"]["code"]), (401, "UNAUTHORIZED"))

    def test_contactscherm_wordt_geweigerd(self) -> None:
        data = base()
        data["screens"][3]["kind"] = "share_contact"
        status, body = self.request("POST", "/v1/experience", json.dumps(data).encode())
        self.assertEqual((status, body["error"]["code"]), (400, "INVALID_REQUEST"))
        self.assertNotIn("Wil je dit sturen", body["error"]["message"])


class ExperienceServerFailureTest(ServerTestCase):
    def make_server(self) -> AgentServer:
        from agent_service.config import ServiceConfig

        def broken(_: ExperienceRequest) -> ExperienceResponse:
            raise RuntimeError("stuk")

        return AgentServer(
            ServiceConfig(host="127.0.0.1", port=0, service_token=TOKEN),
            handle_experience=broken,
        )

    def test_een_fout_is_500_zonder_inhoud(self) -> None:
        status, body = self.request("POST", "/v1/experience", json.dumps(base()).encode())
        self.assertEqual((status, body["error"]["code"]), (500, "INTERNAL_ERROR"))


if __name__ == "__main__":
    unittest.main()
