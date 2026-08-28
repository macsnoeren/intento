"""Configuratie: standaardwaarden, `.env`-inlezen en luid falen bij onzin (T18.1)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from speech_service.config import ConfigError, ServiceConfig, load_env_file


class ServiceConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._dir.name)
        self.addCleanup(self._dir.cleanup)

    def test_standaardwaarden(self) -> None:
        config = ServiceConfig.from_env({}, env_file=None)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 5002)
        self.assertEqual(config.service_token, "")
        self.assertEqual(config.max_text_length, 300)

    def test_env_var_wint_van_env_bestand(self) -> None:
        env = self.tmp / ".env"
        env.write_text('PORT=6000\nSERVICE_TOKEN="uit-bestand"\n# commentaar\n')
        config = ServiceConfig.from_env({"SERVICE_TOKEN": "uit-omgeving"}, env_file=env)
        self.assertEqual(config.port, 6000)
        self.assertEqual(config.service_token, "uit-omgeving")

    def test_ongeldige_poort_faalt_luid(self) -> None:
        for waarde in ("geen-getal", "0", "-1"):
            with self.subTest(waarde=waarde), self.assertRaises(ConfigError):
                ServiceConfig.from_env({"PORT": waarde}, env_file=None)

    def test_load_env_file_zonder_bestand(self) -> None:
        self.assertEqual(load_env_file(self.tmp / "nergens.env"), {})


if __name__ == "__main__":
    unittest.main()
