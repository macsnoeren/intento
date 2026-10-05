"""Configuratie van de agentdienst: verplicht token, poort, `.env` (N1.1)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_service.config import ConfigError, ServiceConfig

TOKEN = "agt_" + "x" * 32


class ConfigTest(unittest.TestCase):
    def test_defaults_met_token(self) -> None:
        config = ServiceConfig.from_env({"SERVICE_TOKEN": TOKEN}, env_file=None)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 5003)
        self.assertEqual(config.service_token, TOKEN)

    def test_ontbrekend_token_geeft_duidelijke_fout(self) -> None:
        with self.assertRaises(ConfigError) as ctx:
            ServiceConfig.from_env({}, env_file=None)
        self.assertIn("SERVICE_TOKEN ontbreekt", str(ctx.exception))
        self.assertIn("AGENT_SERVICE_TOKEN", str(ctx.exception))

    def test_te_kort_token_wordt_geweigerd(self) -> None:
        with self.assertRaises(ConfigError):
            ServiceConfig.from_env({"SERVICE_TOKEN": "kort"}, env_file=None)

    def test_backendnaam_van_het_token_werkt_ook(self) -> None:
        config = ServiceConfig.from_env({"AGENT_SERVICE_TOKEN": TOKEN}, env_file=None)
        self.assertEqual(config.service_token, TOKEN)

    def test_ongeldige_poort(self) -> None:
        for port in ("abc", "0", "70000"):
            with self.subTest(port=port), self.assertRaises(ConfigError):
                ServiceConfig.from_env({"SERVICE_TOKEN": TOKEN, "PORT": port}, env_file=None)

    def test_env_bestand_en_directe_env_wint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env"
            env_file.write_text(f'# commentaar\nexport SERVICE_TOKEN="{TOKEN}"\nPORT=6001\n')
            config = ServiceConfig.from_env({"PORT": "6002"}, env_file=env_file)
        self.assertEqual(config.service_token, TOKEN)
        self.assertEqual(config.port, 6002)


if __name__ == "__main__":
    unittest.main()
