"""Test voor de concurrency-limiet: nooit meer gelijktijdige Ollama-aanroepen dan `max_threads` (T5.6)."""

from __future__ import annotations

import threading
import time
import unittest

from ai_worker.backend import Job
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


def wait_until(predicate, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class ConcurrencyLimitTests(unittest.TestCase):
    def test_never_exceeds_max_threads(self) -> None:
        max_threads = 2
        total_jobs = 8
        jobs = [
            Job(id=f"j{i}", task="select_next_question", payload=QUESTION_PAYLOAD)
            for i in range(total_jobs)
        ]
        backend = FakeBackend(jobs)
        # Elke 'inferentie' duurt even, zodat meerdere jobs elkaar overlappen als de limiet niet werkt.
        ollama = FakeOllama(sleeping_responder(0.05, QUESTION_RESULT))
        worker = Worker(make_config(max_threads=max_threads), backend, ollama)  # type: ignore[arg-type]

        thread = threading.Thread(target=worker.run, daemon=True)
        thread.start()
        try:
            self.assertTrue(
                wait_until(lambda: len(backend.results) == total_jobs),
                msg=f"Niet alle jobs verwerkt: {len(backend.results)}/{total_jobs}",
            )
        finally:
            worker.stop()
            thread.join(timeout=5.0)

        self.assertEqual(len(backend.results), total_jobs)
        # De kern van de test: de gelijktijdigheid overschreed de limiet nooit.
        self.assertLessEqual(
            ollama.max_active,
            max_threads,
            msg=f"Gelijktijdigheid {ollama.max_active} overschreed max_threads {max_threads}",
        )
        # En de limiet werd ook echt benut (anders test de assertie hierboven niets).
        self.assertEqual(ollama.max_active, max_threads)


if __name__ == "__main__":
    unittest.main()
