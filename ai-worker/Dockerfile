# syntax=docker/dockerfile:1
#
# AI-worker-image (T19.3). Build-context is `ai-worker/`:
#
#   docker build -t intento-ai-worker ai-worker/
#
# De worker draait op alleen de standaardbibliotheek (zie `pyproject.toml`), dus dit image is niet veel
# meer dan Python plus de code. Hij praat twee kanten op: hij haalt jobs bij de backend en voert ze uit
# tegen een Ollama-endpoint. Beide adressen én een `WORKER_TOKEN` komen uit de omgeving — dat token
# geeft de backend uit, dus de worker kan pas draaien nadat er één gemunt is (zie README).

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY ai_worker/ ./ai_worker/
COPY run.py ./run.py

RUN useradd --create-home --shell /usr/sbin/nologin intento && chown -R intento:intento /app
USER intento

# Geen poort: de worker opent zelf verbindingen (worker-initiated long-poll, ADR-0010) en luistert
# nergens op. Daarom ook geen healthcheck op een poort — of hij leeft, zie je aan `GET /ai/status`
# op de backend en aan zijn logregels.
CMD ["python", "-m", "ai_worker"]
