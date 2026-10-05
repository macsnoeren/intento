# Agentdienst

De agentdienst bevat de **orchestrator** en de **agents** van Intento (INTENTO-NEW-DESIGN §3.1, §4;
[ADR-0017](../docs/adr/0017-agentic-architectuur.md)). Hij vervangt de oude `ai-worker`.

- **Alleen de backend roept hem aan**, met een gedeeld geheim (`Authorization: Bearer …`). De tablet en
  de beheeromgeving praten nooit rechtstreeks met de AI.
- **Stateless tussen beurten.** De backend stuurt per beurt alles mee wat nodig is en bewaart zelf alle
  data; de agentdienst wijzigt nooit de Vocabulary of andere data.
- **Geen inhoud in de logs.** Alleen pad, status en duur.

## Endpoints

| Methode | Pad | Token | Doel |
|---|---|---|---|
| GET | `/health` | nee | Leeft de dienst? |

`POST /v1/turn` (één beurt) en `POST /v1/experience` volgen in latere taken. Fouten hebben dezelfde vorm
als in de backend: `{ "error": { "code": "…", "message": "…" } }`.

## Opzet en draaien

Python ≥ 3.11. De HTTP-laag draait op de standaardbibliotheek.

```bash
cd agent-service
python3 -m venv .venv            # ontbreekt ensurepip: python3 -m venv --without-pip .venv + get-pip.py
.venv/bin/pip install -e ".[dev]"
cp .env.example .env             # vul SERVICE_TOKEN in
.venv/bin/python -m agent_service
curl http://127.0.0.1:5003/health
```

`SERVICE_TOKEN` is verplicht: zonder start de dienst niet en noemt hij precies wat er ontbreekt.

## Testen

Vanuit de repo-root (maakt de venv zo nodig aan, met ruff, mypy en pip-audit):

```bash
npm run check:python   # ruff + mypy --strict + unittest (ook voor de spraakdienst)
npm run audit:python   # pip-audit
```

Of los: `.venv/bin/python -m unittest discover -s tests -t .` en `.venv/bin/mypy`.

De tests starten een echte server op een vrije poort; er is geen netwerk of LLM nodig.
