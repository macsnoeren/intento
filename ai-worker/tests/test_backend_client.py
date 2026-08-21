"""Tests voor de robuustheid van de backend-client (T9.17).

Een AI-worker draait dag en nacht naast een backend die af en toe herstart. Een verbinding die
halverwege wegvalt (`http.client.RemoteDisconnected` en verwanten) mag de worker-lus daarom niet
omvergooien: hij hoort als `BackendError` naar boven te komen, zodat de lus 'm opvangt en het opnieuw
probeert. Bij de rooktest van fase 9 stierf de worker stil bij elke herstart van de dev-server.
"""

from __future__ import annotations

import http.client
import socket
import unittest
from typing import Any

from ai_worker.backend import BackendClient, BackendError


class _FailingOpener:
    """Nep-opener die bij elke aanroep een netwerkfout gooit."""

    def __init__(self, error: BaseException) -> None:
        self._error = error

    def open(self, _request: Any, timeout: float) -> Any:  # noqa: ARG002
        raise self._error


class BackendClientErrorTests(unittest.TestCase):
    def _claim_with(self, error: BaseException) -> BackendError:
        client = BackendClient("http://backend.test", "token", opener=_FailingOpener(error))
        with self.assertRaises(BackendError) as caught:
            client.claim(timeout=1.0)
        return caught.exception

    def test_remote_disconnect_becomes_backend_error(self) -> None:
        # Precies wat een backend-herstart tijdens de long-poll oplevert.
        exc = self._claim_with(http.client.RemoteDisconnected("closed"))
        self.assertIn("verbroken", str(exc))

    def test_connection_reset_becomes_backend_error(self) -> None:
        self.assertIsInstance(self._claim_with(ConnectionResetError("reset")), BackendError)

    def test_socket_timeout_becomes_backend_error(self) -> None:
        # `socket.timeout` is sinds Python 3.10 een alias van TimeoutError.
        self.assertIsInstance(self._claim_with(socket.timeout("te traag")), BackendError)


if __name__ == "__main__":
    unittest.main()
