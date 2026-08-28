# Intento-spraakdienst

Losstaande dienst die **tekst omzet in spraak** voor Intento (T18.1). De tablet laat uitspreken wat er
op zijn scherm staat; die aanvraag loopt via de backend, en de backend praat met deze dienst.

Waarom een aparte dienst en geen bibliotheek in de backend:

- **Privacy.** De synthese draait lokaal, op je eigen CPU. De zin van de gebruiker ("ik heb pijn in
  mijn buik") gaat nooit naar een cloudleverancier (DESIGN §9.4).
- **Licentie.** Piper staat onder GPL-3.0 (het bevat espeak-ng). Als los proces achter een
  HTTP-grens raakt die licentie de rest van Intento niet; zie [ADR-0015](../docs/adr/0015-speech-synthesis-piper.md).
- **Deploy.** Net als `ai-worker/` kun je hem op een andere machine zetten zonder de backend te raken.

## Vereisten

- **Python ≥ 3.10**
- **piper-tts** — de enige runtime-dependency. De HTTP-laag draait op de standaardbibliotheek.

## Installeren

```bash
cd speech-service
python -m venv .venv && . .venv/bin/activate
pip install piper-tts
cp .env.example .env          # vul SERVICE_TOKEN in
```

Daarna minstens één stem downloaden. De stemmen die Intento aanbiedt:

```bash
python -m piper.download_voices --data-dir voices \
  nl_NL-pim-medium nl_NL-alex-medium nl_NL-ronnie-medium nl_BE-nathalie-medium
```

Elke stem is ± 63 MB. `nl_NL-pim-medium` is de standaardstem; zonder die stem kan een gebruiker met
de standaardinstellingen niets laten uitspreken.

> **Welke stemmen ontbreken en waarom.** Piper heeft tien Nederlandse/Vlaamse stemmen, maar
> `nl_NL-mls-medium` (52 sprekers, waaronder álle Nederlandse vrouwenstemmen) en de twee losse
> `mls_*-low`-modellen komen uit ruwe luisterboekdata. Bij het beluisteren op 2026-08-28 sprak geen
> van die stemmen een zin verstaanbaar uit; ze staan daarom niet in de catalogus. Wie een Nederlandse
> **vrouwenstem** wil, kiest voorlopig "Stem van het apparaat" — dan spreekt de tablet zelf, met de
> stem van Android of iPadOS (zie T18.5 in `TASKS.md`).

## Draaien

```bash
python -m speech_service     # of: python run.py
```

De dienst logt bij het opstarten welke stemmen hij gevonden heeft. Snel controleren:

```bash
curl http://127.0.0.1:5002/health
# {"status": "ok", "voices": ["nl_BE-nathalie-medium", "nl_NL-pim-medium", ...]}

curl -X POST http://127.0.0.1:5002/synthesize \
  -H "Authorization: Bearer $SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Ik wil graag water drinken.","voice":"nl_NL-pim-medium"}' --output zin.wav
```

Koppel hem daarna aan de backend met `SPEECH_PROVIDER=http`, `SPEECH_SERVICE_URL` en
`SPEECH_SERVICE_TOKEN` in `server/.env` (zie de hoofd-`.env.example`).

## API

| Endpoint | Auth | Antwoord |
|---|---|---|
| `GET /health` | geen | `{"status":"ok","voices":[…]}` — voor een gezondheidscheck |
| `POST /synthesize` | `Bearer SERVICE_TOKEN` | `audio/wav` |

`POST /synthesize` verwacht `{"text": "...", "voice": "nl_NL-pim-medium"}`. Een stem-id mag een
sprekernummer dragen (`nl_NL-mls-medium#5`) voor een meersprekermodel. Fouten hebben dezelfde vorm als
in de backend: `{"error": {"code": "...", "message": "..."}}`.

De dienst kent geen gebruikers, sessies of database: hij krijgt tekst en geeft geluid. **Wie** wat mag
laten uitspreken bepaalt de backend. Van de tekst zelf wordt niets gelogd — alleen lengte, stem en duur.

## Testen

Volledig offline en zonder Piper (de synthese wordt nagebootst), met de stdlib-testrunner:

```bash
python -m unittest discover -t . -s . -p "test_*.py"
```

De tests dekken de stem-id's (inclusief de grens tegen path traversal), de configuratie, en een echte
HTTP-round-trip tegen een server op een vrije poort: token, invoervalidatie, WAV-antwoord en foutvorm.

## Als het niet werkt

**"Beluisteren lukte niet" in de beheeromgeving, of de tablet blijft op de apparaatstem.**
Loop deze drie langs — in deze volgorde:

1. **Staat de koppeling in `server/.env`?** Zonder `SPEECH_PROVIDER=http` draait de backend op `none`
   en antwoordt hij met `503 SPEECH_UNAVAILABLE` — de tablet valt dan terug op de stem van het
   apparaat, wat eruitziet alsof de stemkeuze niets doet. Nodig zijn `SPEECH_PROVIDER`,
   `SPEECH_SERVICE_URL` en `SPEECH_SERVICE_TOKEN` (dezelfde waarde als `SERVICE_TOKEN` hier).
2. **Leeft de dienst?** `curl http://127.0.0.1:5002/health` moet de stemmen opsommen.
3. **Zijn de stemmodellen compleet?** Een afgebroken download laat een half `.onnx`-bestand achter.
   Een `medium`-stem hoort ± 63 MB te zijn; is hij kleiner, dan meldt de dienst bij het spreken
   "Stemmodel … kon niet geladen worden". Controleer ze in één keer:

   ```bash
   python - <<'PY'
   from pathlib import Path
   from piper import PiperVoice
   for f in sorted(Path("voices").glob("*.onnx")):
       try:
           PiperVoice.load(str(f), config_path=str(f) + ".json")
           print(f"{f.name}: OK ({f.stat().st_size} bytes)")
       except Exception as exc:
           print(f"{f.name}: STUK ({f.stat().st_size} bytes) — {type(exc).__name__}")
   PY
   ```

   Haal een kapot model opnieuw op met `python -m piper.download_voices --data-dir voices <naam>`
   (verwijder het halve bestand eerst; de downloader slaat een bestaand bestand over).

## Prestaties

Gemeten op een Intel i7-6700 (8 threads, **geen GPU**), `piper-tts` 1.7.0:

| | |
|---|---|
| Model laden (eenmalig, per stem) | ± 1 s |
| Een korte zin synthetiseren | 64–153 ms |
| Real-time factor | 0,05 (twintig keer sneller dan realtime) |
| Volledige HTTP-ronde, model warm | ± 120 ms |

De backend cachet bovendien op `hash(tekst + stem)`, dus herhaalde zinnen — de vaste schermteksten en
de AAC-labels — kosten na de eerste keer niets meer.
