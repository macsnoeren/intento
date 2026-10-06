# syntax=docker/dockerfile:1
#
# Agentdienst-image (N1.7). Build-context is `agent-service/`:
#
#   docker build -t intento-agents agent-service/
#
# Geen poort naar buiten: alleen de backend hoort de dienst te bereiken (compose zet geen `ports:`).

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Eerst alleen de projectbeschrijving, zodat de dependency-laag in de cache blijft zolang die niet wijzigt.
COPY pyproject.toml ./
RUN pip install --no-cache-dir "pydantic>=2.13.5"

COPY agent_service/ ./agent_service/
COPY run.py ./run.py

RUN useradd --create-home --shell /usr/sbin/nologin intento \
    && chown -R intento:intento /app

USER intento
ENV HOST=0.0.0.0 \
    PORT=5003
EXPOSE 5003

# `/health` heeft bewust geen token nodig, zodat een gezondheidscheck geen geheim hoeft te kennen.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','5003')+'/health', timeout=4).status==200 else 1)"

CMD ["python", "-m", "agent_service"]
