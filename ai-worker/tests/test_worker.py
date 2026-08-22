"""Tests voor de job-lus: claimen → Ollama → resultaat/fout terugleveren (T5.6)."""

from __future__ import annotations

import threading
import time
import unittest

from ai_worker.backend import Job
from ai_worker.ollama import OllamaError
from ai_worker.worker import Worker

from .fakes import FakeBackend, FakeOllama, sleeping_responder
from .helpers import make_config

QUESTION_PAYLOAD = {
    "task": "select_next_question",
    "systemRules": [],
    "goal": "",
    "aacRules": [],
    "userContext": [],
    "conversationContext": [],
    "lastChoice": None,
    "availableSymbols": [{"concept": "appel", "label": "appel"}],
}

QUESTION_RESULT = {
    "question": "Wat wil je eten?",
    "options": [{"symbol": "appel", "confidence": 0.9}],
    "reason": "mock",
}


def wait_until(predicate, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class ProcessJobTests(unittest.TestCase):
    def test_select_next_question_submits_shaped_result(self) -> None:
        backend = FakeBackend()
        ollama = FakeOllama(lambda *_: dict(QUESTION_RESULT))
        worker = Worker(make_config(), backend, ollama)  # type: ignore[arg-type]

        worker.process_job(Job(id="j1", task="select_next_question", payload=QUESTION_PAYLOAD))

        self.assertIn("j1", backend.results)
        self.assertEqual(backend.results["j1"]["question"], "Wat wil je eten?")
        self.assertEqual(backend.results["j1"]["options"][0]["symbol"], "appel")
        self.assertNotIn("j1", backend.failures)

    def test_generate_message_submits_shaped_result(self) -> None:
        backend = FakeBackend()
        ollama = FakeOllama(lambda *_: {"message": "Ik wil een appel."})
        worker = Worker(make_config(), backend, ollama)  # type: ignore[arg-type]

        payload = {
            "task": "generate_message",
            "systemRules": [],
            "goal": "",
            "aacRules": [],
            "userContext": [],
            "chosenConcepts": [{"concept": "appel", "label": "appel"}],
        }
        worker.process_job(Job(id="m1", task="generate_message", payload=payload))

        self.assertEqual(backend.results["m1"]["message"], "Ik wil een appel.")

    def test_new_concept_reaches_the_backend_behind_the_known_ones(self) -> None:
        # Sinds DESIGN §7.6 trap 3 mag Ollama een begrip aandragen dat nog niet in de bibliotheek staat;
        # de worker geeft het door en de **backend** beslist (eerst deduplicatie, dan eventueel een nieuw
        # symbool + voorstel voor de beheerder). Bekende concepten gaan wel vóór in de volgorde.
        backend = FakeBackend()
        raw = {
            "question": "Wat wil je?",
            "options": [
                {"symbol": "ruimteschip", "confidence": 0.8},
                {"symbol": "appel", "confidence": 0.9},
            ],
            "reason": "",
        }
        ollama = FakeOllama(lambda *_: dict(raw))
        worker = Worker(make_config(), backend, ollama)  # type: ignore[arg-type]

        worker.process_job(Job(id="j1", task="select_next_question", payload=QUESTION_PAYLOAD))
        symbols = [opt["symbol"] for opt in backend.results["j1"]["options"]]
        self.assertEqual(symbols, ["appel", "ruimteschip"])

    def test_ollama_error_fails_job_without_crashing(self) -> None:
        backend = FakeBackend()

        def boom(*_args, **_kwargs):
            raise OllamaError("Ollama plat")

        ollama = FakeOllama(boom)
        worker = Worker(make_config(), backend, ollama)  # type: ignore[arg-type]

        worker.process_job(Job(id="j1", task="select_next_question", payload=QUESTION_PAYLOAD))

        self.assertIn("j1", backend.failures)
        self.assertNotIn("j1", backend.results)

    def test_unknown_task_is_failed(self) -> None:
        backend = FakeBackend()
        ollama = FakeOllama(lambda *_: {})
        worker = Worker(make_config(), backend, ollama)  # type: ignore[arg-type]

        worker.process_job(Job(id="x1", task="does_not_exist", payload={}))
        self.assertIn("x1", backend.failures)
        self.assertEqual(ollama.calls, 0)  # Ollama nooit aangeroepen voor een onbekende taak


class HeartbeatTests(unittest.TestCase):
    def test_heartbeat_fires_during_slow_inference(self) -> None:
        # Een korte heartbeat-interval + trage inferentie ⇒ minstens één heartbeat naar de backend.
        backend = FakeBackend()
        ollama = FakeOllama(sleeping_responder(0.12, QUESTION_RESULT))
        config = make_config(heartbeat_interval_s=0.02)
        worker = Worker(config, backend, ollama)  # type: ignore[arg-type]

        worker.process_job(Job(id="hb1", task="select_next_question", payload=QUESTION_PAYLOAD))

        self.assertIn("hb1", backend.results)
        self.assertGreaterEqual(backend.heartbeats.get("hb1", 0), 1)


class RunLoopTests(unittest.TestCase):
    def test_loop_claims_and_processes_all_jobs(self) -> None:
        jobs = [Job(id=f"j{i}", task="select_next_question", payload=QUESTION_PAYLOAD) for i in range(3)]
        backend = FakeBackend(jobs)
        ollama = FakeOllama(sleeping_responder(0.0, QUESTION_RESULT))
        worker = Worker(make_config(max_threads=2), backend, ollama)  # type: ignore[arg-type]

        thread = threading.Thread(target=worker.run, daemon=True)
        thread.start()
        try:
            self.assertTrue(wait_until(lambda: len(backend.results) == 3))
        finally:
            worker.stop()
            thread.join(timeout=5.0)

        self.assertEqual(set(backend.results), {"j0", "j1", "j2"})


if __name__ == "__main__":
    unittest.main()
