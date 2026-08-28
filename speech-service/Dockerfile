# syntax=docker/dockerfile:1
#
# Spraakdienst-image (T19.2). Build-context is `speech-service/` — deze dienst staat los van de
# npm-workspaces en heeft alleen zichzelf en Piper nodig:
#
#   docker build -t intento-speech speech-service/
#
# De **stemmodellen zitten bewust niet in het image**. Ze zijn ± 63 MB per stuk, de keuze welke
# stemmen je aanbiedt is geen build-tijdbeslissing, en bij een afgebroken download wil je een volume
# opnieuw kunnen vullen in plaats van een image opnieuw te bouwen. Compose vult het volume met een
# eenmalige init-dienst; zie `compose.yaml`.
#
# Licentie: Piper staat onder GPL-3.0. Het draait hier als eigen proces in een eigen image, precies
# zoals ADR-0015 beschrijft; lever je dit image uit, dan hoort daar een broncode-aanbod bij.

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Piper is de enige runtime-dependency; de HTTP-laag draait op de standaardbibliotheek.
RUN pip install --no-cache-dir "piper-tts>=1.7"

COPY speech_service/ ./speech_service/
COPY run.py ./run.py

# Stemmen komen uit een volume; de map bestaat alvast zodat een lege start niet struikelt.
RUN useradd --create-home --shell /usr/sbin/nologin intento \
    && mkdir -p /voices \
    && chown -R intento:intento /app /voices

USER intento
ENV HOST=0.0.0.0 \
    PORT=5002 \
    VOICES_DIR=/voices
EXPOSE 5002

# `/health` heeft bewust geen token nodig, juist zodat een gezondheidscheck geen geheim hoeft te kennen.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','5002')+'/health', timeout=4).status==200 else 1)"

CMD ["python", "-m", "speech_service"]
