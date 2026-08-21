"""HTTP-client naar het worker-protocol van de Intento-backend (T5.5, ADR-0010).

De worker **opent** altijd de verbinding (worker-initiated, robuust achter NAT). Alle aanroepen dragen het
worker-token als `Authorization: Bearer …`-header. Bewust op `urllib` uit de stdlib gebouwd, zodat de
worker geen third-party-dependencies nodig heeft.

Endpoints (relatief aan `BACKEND_URL`):

- ``POST /ai/worker/claim`` — long-poll: 200 met een job, of 204 (niets claimbaar).
- ``POST /ai/worker/jobs/{id}/heartbeat`` — lease verlengen tijdens lange inferentie.
- ``POST /ai/worker/jobs/{id}/result`` — gestructureerd resultaat inleveren (server-side gevalideerd).
- ``POST /ai/worker/jobs/{id}/fail`` — nette teruggave bij een fout.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("ai_worker.backend")


@dataclass(frozen=True)
class Job:
    """Een geclaimde job: het id, de taak en de beperkte prompt-context (payload) van de backend."""

    id: str
    task: str
    payload: Any


class BackendError(RuntimeError):
    """Een onverwachte backend-respons (geen 2xx/verwachte statuscode)."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class BackendClient:
    """Dunne client rond het worker-protocol. Eén instantie is thread-safe: `urllib` deelt geen state."""

    def __init__(self, base_url: str, token: str, *, opener: Any | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        # Een injecteerbare opener maakt de client testbaar zonder echt netwerk.
        self._opener = opener or urllib.request.build_opener()

    def _post(
        self, path: str, body: dict[str, Any] | None, *, timeout: float
    ) -> tuple[int, dict[str, Any] | None]:
        """Voert een POST uit en geeft (status, json-body-of-None). Gooit BackendError bij een HTTP-fout."""
        url = f"{self._base_url}{path}"
        data = json.dumps(body if body is not None else {}).encode("utf-8")
        request = urllib.request.Request(url, data=data, method="POST")
        request.add_header("Authorization", f"Bearer {self._token}")
        request.add_header("Content-Type", "application/json")
        request.add_header("Accept", "application/json")
        try:
            with self._opener.open(request, timeout=timeout) as response:
                status = int(response.status)
                raw = response.read()
                if not raw:
                    return status, None
                return status, json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise BackendError(
                f"Backend gaf {exc.code} op {path}: {detail[:200]}", status=exc.code
            ) from exc
        except urllib.error.URLError as exc:
            raise BackendError(f"Backend onbereikbaar op {path}: {exc.reason}") from exc
        except TimeoutError as exc:  # socket-time-out tijdens de long-poll
            raise BackendError(f"Backend antwoordde niet op tijd op {path}.") from exc
        except OSError as exc:
            # Verbinding halverwege verbroken (backend herstart, proxy die de long-poll dichtgooit):
            # `http.client.RemoteDisconnected` en verwanten komen hier binnen, níet als URLError. Zonder
            # deze vangst viel de hele worker-lus om bij een backend-herstart (T9.17) — waargenomen bij de
            # rooktest: elke herstart van de dev-server maakte de worker stil dood. Als BackendError kan de
            # lus 'm gewoon opvangen en opnieuw proberen.
            raise BackendError(f"Verbinding met de backend verbroken op {path}: {exc}") from exc

    def claim(self, *, timeout: float) -> Job | None:
        """Claimt de oudste wachtende job (long-poll). Geeft None bij 204 (niets claimbaar)."""
        status, body = self._post("/ai/worker/claim", None, timeout=timeout)
        if status == 204 or body is None:
            return None
        job = body.get("job")
        if not isinstance(job, dict) or "id" not in job or "task" not in job:
            raise BackendError(f"Claim-respons mist een geldige job: {body!r}", status=status)
        return Job(id=str(job["id"]), task=str(job["task"]), payload=job.get("payload"))

    def heartbeat(self, job_id: str, *, timeout: float = 10.0) -> bool:
        """Verlengt de lease. Geeft False als de job niet (meer) door deze worker geclaimd is (409)."""
        try:
            self._post(f"/ai/worker/jobs/{job_id}/heartbeat", None, timeout=timeout)
            return True
        except BackendError as exc:
            if exc.status == 409:
                return False
            raise

    def submit_result(self, job_id: str, result: dict[str, Any], *, timeout: float = 15.0) -> bool:
        """Levert het gestructureerde resultaat in. Geeft False als de lease intussen verloren is (409)."""
        try:
            self._post(f"/ai/worker/jobs/{job_id}/result", result, timeout=timeout)
            return True
        except BackendError as exc:
            if exc.status == 409:
                logger.warning("Resultaat voor job %s geweigerd (lease verloren, 409).", job_id)
                return False
            raise

    def fail(self, job_id: str, message: str, *, timeout: float = 10.0) -> bool:
        """Meldt een mislukte job zodat de backend hem netjes teruglegt of afschrijft."""
        try:
            self._post(f"/ai/worker/jobs/{job_id}/fail", {"message": message[:500]}, timeout=timeout)
            return True
        except BackendError as exc:
            if exc.status == 409:
                return False
            raise
