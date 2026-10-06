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


class OllamaConfigTest(unittest.TestCase):
    def config(self, **env: str) -> ServiceConfig:
        return ServiceConfig.from_env({"SERVICE_TOKEN": TOKEN, **env}, env_file=None)

    def test_zonder_ollama_url_geen_llm(self) -> None:
        self.assertIsNone(self.config().ollama)

    def test_lokaal(self) -> None:
        ollama = self.config(OLLAMA_URL="http://127.0.0.1:11434/", OLLAMA_MODEL="gemma3:4b").ollama
        assert ollama is not None
        self.assertEqual(
            (ollama.url, ollama.model, ollama.api_key),
            ("http://127.0.0.1:11434", "gemma3:4b", None),
        )

    def test_cloud_met_sleutel_over_https(self) -> None:
        ollama = self.config(
            OLLAMA_URL="https://ollama.com",
            OLLAMA_MODEL="gpt-oss:120b",
            OLLAMA_API_KEY="geheim-123",
        ).ollama
        assert ollama is not None
        self.assertEqual(ollama.api_key, "geheim-123")
        self.assertNotIn("geheim-123", repr(ollama))
        self.assertNotIn(TOKEN, repr(self.config()))

    def test_sleutel_niet_over_http(self) -> None:
        with self.assertRaises(ConfigError) as ctx:
            self.config(OLLAMA_URL="http://ollama.example", OLLAMA_MODEL="m", OLLAMA_API_KEY="k")
        self.assertIn("https", str(ctx.exception))

    def test_model_verplicht_en_url_geldig(self) -> None:
        with self.assertRaises(ConfigError):
            self.config(OLLAMA_URL="http://127.0.0.1:11434")
        with self.assertRaises(ConfigError):
            self.config(OLLAMA_URL="ftp://x", OLLAMA_MODEL="m")


class ThresholdConfigTest(unittest.TestCase):
    def test_standaard_en_eigen_drempel(self) -> None:
        base = {"SERVICE_TOKEN": TOKEN}
        self.assertEqual(ServiceConfig.from_env(base, env_file=None).propose_threshold, 0.85)
        own = ServiceConfig.from_env({**base, "AGENT_PROPOSE_THRESHOLD": "0.9"}, env_file=None)
        self.assertEqual(own.propose_threshold, 0.9)
        for bad in ("hoog", "0.2", "1.5"):
            with self.subTest(bad=bad), self.assertRaises(ConfigError):
                ServiceConfig.from_env({**base, "AGENT_PROPOSE_THRESHOLD": bad}, env_file=None)


if __name__ == "__main__":
    unittest.main()
