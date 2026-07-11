"""Tests voor de env-gedreven configuratie (T5.6)."""

from __future__ import annotations

import unittest

from ai_worker.config import ConfigError, WorkerConfig, load_env_file

VALID_ENV = {
    "BACKEND_URL": "https://intento.example/",
    "WORKER_TOKEN": "raw-token",
    "OLLAMA_URL": "http://gpu-node:11434",
    "OLLAMA_MODEL": "llama3.1",
    "MAX_THREADS": "3",
}


class ConfigTests(unittest.TestCase):
    def test_valid_env_parses_and_strips_trailing_slash(self) -> None:
        config = WorkerConfig.from_env(dict(VALID_ENV), env_file=None)
        self.assertEqual(config.backend_url, "https://intento.example")
        self.assertEqual(config.worker_token, "raw-token")
        self.assertEqual(config.ollama_model, "llama3.1")
        self.assertEqual(config.max_threads, 3)

    def test_missing_required_field_raises(self) -> None:
        env = dict(VALID_ENV)
        del env["WORKER_TOKEN"]
        with self.assertRaises(ConfigError):
            WorkerConfig.from_env(env, env_file=None)

    def test_non_http_backend_url_raises(self) -> None:
        env = dict(VALID_ENV, BACKEND_URL="ftp://nope")
        with self.assertRaises(ConfigError):
            WorkerConfig.from_env(env, env_file=None)

    def test_non_positive_max_threads_raises(self) -> None:
        env = dict(VALID_ENV, MAX_THREADS="0")
        with self.assertRaises(ConfigError):
            WorkerConfig.from_env(env, env_file=None)

    def test_defaults_apply(self) -> None:
        env = {k: v for k, v in VALID_ENV.items() if k != "MAX_THREADS"}
        config = WorkerConfig.from_env(env, env_file=None)
        self.assertEqual(config.max_threads, 2)
        self.assertEqual(config.ollama_url, "http://gpu-node:11434")


class LoadEnvFileTests(unittest.TestCase):
    def test_parses_comments_quotes_and_export(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text(
                "\n".join(
                    [
                        "# commentaar",
                        "BACKEND_URL=https://a.example",
                        'WORKER_TOKEN="quoted-token"',
                        "export OLLAMA_MODEL=llama3.1",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            values = load_env_file(path)
            self.assertEqual(values["BACKEND_URL"], "https://a.example")
            self.assertEqual(values["WORKER_TOKEN"], "quoted-token")
            self.assertEqual(values["OLLAMA_MODEL"], "llama3.1")

    def test_missing_file_returns_empty(self) -> None:
        self.assertEqual(load_env_file("does-not-exist.env"), {})


if __name__ == "__main__":
    unittest.main()
