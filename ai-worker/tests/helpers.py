"""Gedeelde test-helpers."""

from __future__ import annotations

from ai_worker.config import WorkerConfig


def make_config(*, max_threads: int = 2, **overrides: object) -> WorkerConfig:
    """Bouwt een `WorkerConfig` met snelle, testvriendelijke defaults; velden overschrijfbaar."""
    defaults = dict(
        backend_url="http://backend.test",
        worker_token="test-token",
        ollama_url="http://ollama.test",
        ollama_model="test-model",
        max_threads=max_threads,
        ollama_timeout_s=5.0,
        claim_timeout_s=1.0,
        heartbeat_interval_s=60.0,  # hoog: heartbeats vuren niet mee in korte tests
        idle_sleep_s=0.01,
    )
    defaults.update(overrides)
    return WorkerConfig(**defaults)  # type: ignore[arg-type]
