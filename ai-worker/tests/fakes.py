"""Deterministische test-doubles voor backend en Ollama (geen echt netwerk).

De worker (T5.6) is bewust opgebouwd rond injecteerbare `BackendClient`/`OllamaClient`, zodat de job-lus en
de concurrency-limiet volledig offline te testen zijn.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from ai_worker.backend import Job


class FakeBackend:
    """Backend-double: serveert een vooraf gevulde rij jobs en registreert result/fail/heartbeat."""

    def __init__(self, jobs: list[Job] | None = None) -> None:
        self._jobs: list[Job] = list(jobs or [])
        self._lock = threading.Lock()
        self.results: dict[str, dict[str, Any]] = {}
        self.failures: dict[str, str] = {}
        self.heartbeats: dict[str, int] = {}
        self.claim_calls = 0

    def add_job(self, job: Job) -> None:
        with self._lock:
            self._jobs.append(job)

    def claim(self, *, timeout: float) -> Job | None:  # noqa: ARG002 — timeout niet nodig in de fake
        with self._lock:
            self.claim_calls += 1
            if self._jobs:
                return self._jobs.pop(0)
            return None

    def heartbeat(self, job_id: str, *, timeout: float = 10.0) -> bool:  # noqa: ARG002
        with self._lock:
            self.heartbeats[job_id] = self.heartbeats.get(job_id, 0) + 1
        return True

    def submit_result(self, job_id: str, result: dict[str, Any], *, timeout: float = 15.0) -> bool:  # noqa: ARG002
        with self._lock:
            self.results[job_id] = result
        return True

    def fail(self, job_id: str, message: str, *, timeout: float = 10.0) -> bool:  # noqa: ARG002
        with self._lock:
            self.failures[job_id] = message
        return True


class FakeOllama:
    """Ollama-double die een injecteerbare responder aanroept en de gelijktijdigheid meet."""

    def __init__(self, responder: Callable[[str, str, dict[str, Any]], dict[str, Any]]) -> None:
        self._responder = responder
        self._lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.calls = 0

    def generate_structured(
        self, *, system: str, prompt: str, schema: dict[str, Any], timeout: float  # noqa: ARG002
    ) -> dict[str, Any]:
        with self._lock:
            self.calls += 1
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            return self._responder(system, prompt, schema)
        finally:
            with self._lock:
                self.active -= 1


def sleeping_responder(delay_s: float, result: dict[str, Any]) -> Callable[..., dict[str, Any]]:
    """Bouwt een responder die even 'rekent' (zodat gelijktijdigheid meetbaar wordt) en `result` teruggeeft."""

    def responder(_system: str, _prompt: str, _schema: dict[str, Any]) -> dict[str, Any]:
        time.sleep(delay_s)
        return dict(result)

    return responder
