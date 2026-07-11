"""De worker-lus: jobs claimen, tegen Ollama verwerken en het resultaat terugleveren (T5.6).

**Concurrency-limiet.** Een `threading.Semaphore` van `max_threads` gates zowel het claimen als het
verwerken: er wordt pas een nieuwe job geclaimd als er een vrij slot is, en de verwerking loopt in een
`ThreadPoolExecutor` van dezelfde grootte. Zo draaien er nooit meer dan `max_threads` Ollama-aanroepen
tegelijk — de worker (en daarmee de site) overvraagt Ollama niet (DESIGN §9.4).

**Heartbeats.** Tijdens de (mogelijk lange) inferentie stuurt een achtergrond-thread periodiek een
heartbeat, zodat de server-lease niet verloopt en de job niet onnodig wordt teruggelegd (T5.5).

**Nette foutafhandeling.** Een Ollama-fout/time-out of een onbruikbaar antwoord leidt tot `fail` op de
backend (de job gaat netjes terug in de wachtrij of wordt afgeschreven) — de worker crasht niet.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .backend import BackendClient, BackendError, Job
from .config import WorkerConfig
from .ollama import OllamaClient, OllamaError
from .prompts import (
    TASK_GENERATE_MESSAGE,
    TASK_SELECT_NEXT_QUESTION,
    PromptError,
    build_generate_message,
    build_select_next_question,
    shape_message_result,
    shape_question_result,
)

logger = logging.getLogger("ai_worker.worker")


class Heartbeat:
    """Stuurt periodiek een heartbeat voor één job tot hij wordt gestopt.

    Stopt zichzelf ook als de backend 409 geeft (lease verloren) — verder heartbeaten heeft dan geen zin.
    """

    def __init__(self, backend: BackendClient, job_id: str, interval_s: float) -> None:
        self._backend = backend
        self._job_id = job_id
        self._interval = interval_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"hb-{job_id}", daemon=True)

    def __enter__(self) -> "Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=self._interval + 1.0)

    def _run(self) -> None:
        # `wait` keert vervroegd terug zodra `_stop` is gezet — geen busy-loop, snelle afsluiting.
        while not self._stop.wait(self._interval):
            try:
                if not self._backend.heartbeat(self._job_id):
                    logger.warning("Heartbeat voor job %s geweigerd (lease verloren); stop.", self._job_id)
                    return
            except BackendError as exc:
                logger.warning("Heartbeat voor job %s faalde: %s", self._job_id, exc)
                return


class Worker:
    """Claimt jobs (worker-initiated long-poll) en verwerkt ze met een begrensde threadpool."""

    def __init__(
        self,
        config: WorkerConfig,
        backend: BackendClient,
        ollama: OllamaClient,
    ) -> None:
        self._config = config
        self._backend = backend
        self._ollama = ollama
        self._stop = threading.Event()
        # Het aantal vrije verwerkings-slots. Gating vóór het claimen voorkomt dat we meer jobs vasthouden
        # dan we tegelijk kunnen verwerken (en dus leases laten verlopen).
        self._slots = threading.Semaphore(config.max_threads)
        self._executor = ThreadPoolExecutor(
            max_workers=config.max_threads, thread_name_prefix="ollama-job"
        )

    def stop(self) -> None:
        """Vraagt de lus netjes te stoppen (na de huidige claim/iteratie)."""
        self._stop.set()

    def run(self) -> None:
        """Draait de claim-verwerk-lus tot `stop()` wordt aangeroepen. Blokkeert de aanroeper."""
        logger.info(
            "Worker gestart: backend=%s ollama=%s model=%s max_threads=%d",
            self._config.backend_url,
            self._config.ollama_url,
            self._config.ollama_model,
            self._config.max_threads,
        )
        try:
            while not self._stop.is_set():
                self._tick()
        finally:
            self._executor.shutdown(wait=True)

    def _tick(self) -> None:
        """Eén iteratie: wacht op een vrij slot, claim een job en dispatch hem (of idle bij niets)."""
        # Wacht (onderbreekbaar) op een vrij verwerkings-slot.
        if not self._slots.acquire(timeout=0.5):
            return
        try:
            job = self._backend.claim(timeout=self._config.claim_timeout_s)
        except BackendError as exc:
            logger.warning("Claim faalde: %s", exc)
            self._slots.release()
            self._stop.wait(self._config.idle_sleep_s)
            return

        if job is None:
            # Niets claimbaar binnen de long-poll: slot vrijgeven en kort wachten.
            self._slots.release()
            self._stop.wait(self._config.idle_sleep_s)
            return

        # Verwerk in de pool; het slot komt vrij zodra de job (met resultaat of fout) klaar is.
        self._executor.submit(self._process_and_release, job)

    def _process_and_release(self, job: Job) -> None:
        try:
            self.process_job(job)
        except Exception:  # noqa: BLE001 — een verwerkings-thread mag nooit stil sterven.
            logger.exception("Onverwachte fout bij het verwerken van job %s.", job.id)
        finally:
            self._slots.release()

    def process_job(self, job: Job) -> None:
        """Verwerkt één job end-to-end: prompt bouwen → Ollama → resultaat vormen → terugleveren.

        Bij een Ollama-/vorm-fout wordt de job via `fail` netjes teruggegeven i.p.v. de worker te laten
        crashen. Publiek zodat de job-verwerking los (zonder de lus) te testen is.
        """
        payload: dict[str, Any] = job.payload if isinstance(job.payload, dict) else {}
        try:
            result = self._infer(job.id, job.task, payload)
        except (OllamaError, PromptError) as exc:
            logger.warning("Job %s (%s) mislukt: %s", job.id, job.task, exc)
            self._safe_fail(job.id, str(exc))
            return

        if not self._backend.submit_result(job.id, result):
            # Lease verloren tussen claim en resultaat (409) — niets meer te doen; de backend legde de job
            # al terug voor een andere worker.
            logger.info("Resultaat voor job %s niet opgeslagen (lease verlopen).", job.id)

    def _infer(self, job_id: str, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Bouwt de prompt, roept Ollama aan (met heartbeats) en vormt het resultaat per taak."""
        if task == TASK_SELECT_NEXT_QUESTION:
            system, prompt, schema, allowed = build_select_next_question(payload)
            raw = self._call_ollama(job_id, system, prompt, schema)
            return shape_question_result(raw, allowed)
        if task == TASK_GENERATE_MESSAGE:
            system, prompt, schema = build_generate_message(payload)
            raw = self._call_ollama(job_id, system, prompt, schema)
            return shape_message_result(raw)
        raise PromptError(f"Onbekende taak: {task!r}")

    def _call_ollama(
        self, job_id: str, system: str, prompt: str, schema: dict[str, Any]
    ) -> dict[str, Any]:
        """Roept Ollama aan terwijl een heartbeat de lease vasthoudt tijdens lange inferentie."""
        with Heartbeat(self._backend, job_id, self._config.heartbeat_interval_s):
            return self._ollama.generate_structured(
                system=system, prompt=prompt, schema=schema, timeout=self._config.ollama_timeout_s
            )

    def _safe_fail(self, job_id: str, message: str) -> None:
        try:
            self._backend.fail(job_id, message)
        except BackendError as exc:
            logger.warning("Kon job %s niet als mislukt melden: %s", job_id, exc)
