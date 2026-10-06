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
| POST | `/v1/turn` | ja | Eén beurt: `TurnRequest` → `TurnResponse` ([contracten](../contracts/README.md)). |

Fouten hebben dezelfde vorm als in de backend: `{ "error": { "code": "…", "message": "…" } }`.

| Status | Code | Wanneer |
|---|---|---|
| 401 | `UNAUTHORIZED` | Geen of een verkeerde API-key. |
| 400 | `INVALID_BODY` | Geen JSON, of groter dan 8 MB. |
| 400 | `INVALID_REQUEST` | Geen geldig `TurnRequest`; de melding noemt alleen de velden, nooit de waarden. |
| 409 | `PROTOCOL_ERROR` | De gebeurtenis past niet bij de toestand (bv. een antwoord op een afgelopen gesprek). |
| 500 | `INTERNAL_ERROR` | Onverwachte fout; de details staan alleen in het log van de dienst. |

`POST /v1/experience` volgt in N12.4. Het log bevat per beurt alleen de gebeurtenis, de fase, de soort
presentatie en de duur.

## LLM-laag

Agents praten nooit rechtstreeks met een model maar met een **`LlmProvider`** (`agent_service/llm/`,
INTENTO-NEW-DESIGN §35): één methode `complete_json(system, user, schema, timeout) -> dict`. Wat eruit
komt is een JSON-object, of een `LlmError` met een reden (`timeout`, `unavailable`, `unauthorized`,
`http_error`, `invalid_json`, `no_response`); de agent valideert het zelf en valt bij elke fout terug
op zijn regels. De foutmelding bevat nooit de prompt of het antwoord.

`OllamaProvider` praat met `POST {OLLAMA_URL}/api/chat` (`format` = het JSON-schema, `stream: false`),
lokaal zonder sleutel of in de cloud met `OLLAMA_API_KEY` als Bearer (alleen over https). Hij haalt
code-fences en tekst rond de JSON weg en doet bij ongeldige JSON hooguit één nieuwe poging, binnen
dezelfde time-out; een time-out of 401 wordt niet herhaald. Zonder `OLLAMA_URL` is er geen LLM en
draaien alle agents op hun regels.

`FakeProvider` geeft vaste antwoorden in volgorde (een object, een `LlmError` om te gooien, of een
functie van de aanroep) en **bewaart elke prompt**, zodat tests ook kunnen controleren wat er níet naar
een model gaat (namen en e-mailadressen van contacten, V6).

## Agents: envelop en prompts

Elke agent draait via **`run_agent`** (`agent_service/agents/envelope.py`, §34) en levert een
`AgentResult`: waarde, status (`success`; `fallback` als de regels het overnamen na een mislukte
LLM-poging; `failed` als ook de regels niets opleverden), zekerheid, aannames en meta (model,
promptversie, duur). De orchestrator zet elk resultaat om in een `AgentDecision`. Een fout in het
LLM-deel — time-out, ongeldige JSON, een antwoord dat niet door pydantic komt, een bug — leidt altijd
tot de terugval; er gaat nooit een exceptie naar buiten. Zonder taalmodel zíjn de regels de agent
(`success`, promptversie `rules-v1`). De reden noemt alleen de soort fout of de veldnamen, nooit inhoud.

**Intent Agent v1** (`agents/intent.py`, §6): krijgt de antwoorden, wat er getoond werd, de huidige
hypotheses, de afgewezen concepten en een compacte Vocabulary (de startwoorden plus woorden uit
dezelfde contexten, hooguit 150) en geeft hypotheses, aannames, `needs_clarification` en eventueel de
zin. Het antwoord wordt gevalideerd en nagekeken: afgewezen, dubbele en onbekende concepten vallen eruit,
en het woord bij een symbool blijft een woord van dat item (I1). Terugval: de startconcepten in
volgorde. De sleutels in de invoer heten bewust hetzelfde als in het antwoordschema: anders neemt een
model de invoersleutels over. Contactnamen gaan nooit mee.

**Hypotheses door het gesprek heen** (§36, §37): de hypotheses, aannames en onzekerheden staan in de
Session State en gaan elke beurt als inference `intent_hypotheses` mee. De vraag gaat steeds over de
eerste hypothese die nog niet gevraagd is. Met een taalmodel is een JA nog geen voorstel: de Intent
Agent weegt het mee, en zolang hij iets open ziet (`needs_clarification`) volgt een preciezere vraag.
Is er niets meer te vragen maar wel een JA, dan volgt het voorstel; zonder JA "Wil je stoppen?". Zonder
taalmodel (of als het faalt) is een JA meteen het voorstel.

**Question Agent v1** (`agents/question.py`, §7, §34): de orchestrator kiest het concept, de agent
formuleert de binary vraag erover (`concept`, `text`, `required_symbols`, `confidence`). Het concept
moet precies het gevraagde zijn, de tekst een vraag van 3 tot 80 tekens zonder URL die nog niet
gesteld is; anders de terugval "{Label}?". Het pictogram en het woord eronder blijven die van het item.

**Vraagstrategieën** (`agents/strategies.py`, §7.1): de drie strategieën met sleutel, label, uitleg en
instructie. De instructie van de strategie uit de instellingen gaat als `strategie` mee naar de Question
Agent (niet naar andere agents). De sleutels zijn getest tegen `contracts/question_strategies.json`.

**Icon Agent, stap 1** (`agents/icon.py`, §8): exact op concept, label of synoniem van een item
(hoofdletters, spaties en `_` maken niet uit) → `strong`/`exact`, zonder LLM. Het woord onder het
pictogram is altijd een woord van dat item (I1). Er wordt nooit een pictogram verzonnen.

**Icon Agent, stap 2 en 3** (§8, §17): zonder exacte treffer noemt het model verwante woorden, een
tekstzoekopdracht maakt daar hooguit tien kandidaten van, en het model kiest er één met een schema dat
alleen die ids (of `none`) toelaat — een verzonnen id wordt geweigerd. Dat wordt een `stand_in` met het
woord van de gebruiker eronder, en een `Gap` in hetzelfde antwoord (I5). Niets in de buurt, geen
taalmodel of uitval: het pictogram "geen afbeelding" (`no_image`), ook met een gap. "Bedoel je …?"
toont hetzelfde pictogram als de vraag over dat concept. De Intent Agent (prompt `intent-v3`) mag een
eigen concept noemen als niets in de Vocabulary past (bv. `dizziness`/"duizelig").

**Validation Agent, regels** (`agents/validation.py`, §9): V1 (symbool in de Vocabulary), V2
(vraagtekst: 3 tot 80 tekens, vraagteken, geen URL, geen namen), V3 (pictogram past bij het concept, of
stand-in met gap), V4 (niet eerder gesteld), V5 (tegenstrijdige antwoorden → `clarify`), V6 (aantal
symbolen per vorm) en V7 (voorstel: lengte, drempel, minstens één antwoord) als losse, benoemde
functies die een `Finding` met regel, reden en actie geven. De reden bevat geen gespreksinhoud.
Elke vraag gaat met het pictogram erbij door V1 t/m V6 (`validation-agent` in de beslissingen).
Afgekeurd → de Question Agent nog eens, met de reden in `afgekeurd` (prompt `question-v2`); na twee
ongeldige vragen volgt de regelgebaseerde vraag. Contactnamen gaan alleen mee om te controleren dat ze
nooit in een vraag staan (V2); ze komen nooit in een prompt.

**Safety Agent, regels** (`agents/safety.py`, §10): S1 maximum aantal vragen (instelling
`max_questions`) — bereikt: de beste hypothese voorleggen (waar de gebruiker JA op zei, anders de
bovenste), en bij NEE daarop "Wil je stoppen?"; S2 geen voorstel zonder antwoord; S3 versturen alleen
na een JA op dát contact (voor de deelfase). Grijpt een regel in, dan staat dat als `safety-agent` met
de regel in de beslissingen.

`FakeProvider(routes={"Intent Agent": [...], "Question Agent": [...]})` geeft elke agent een eigen rij
antwoorden (de sleutel is een stukje van zijn systeemprompt).

Prompts staan als **versiebestanden** in `agent_service/prompts/` (`<naam>-v<n>.md`); `load_prompt`
pakt de hoogste versie, en die versie komt mee in de `AgentDecision`. Een prompt wijzigen is een nieuw
bestand met een hoger nummer.

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

### Scenario's en evaluatie

`agent_service/scenarios/` laat een **gesimuleerde gebruiker** een heel gesprek spelen via `step()`
(§54): hij heeft een doel (een set concepten), zegt JA als het getoonde concept daarbij hoort en stopt
als hem dat gevraagd wordt. Een scenario slaagt als het gesprek eindigt met een bevestigde boodschap
waarvan alle concepten bij het doel horen. De scenario's draaien in de gewone testsuite.

```bash
.venv/bin/python -m agent_service.eval --provider fake
OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=gpt-oss:120b-cloud \
  .venv/bin/python -m agent_service.eval --provider ollama --runs 3
```

Het rapport geeft per scenario slagen/mislukken, aantal vragen, beurten en duur, en per agent hoe vaak
hij draaide, met welke status en hoe lang gemiddeld. Exitcode 0 alleen als alles slaagde. Tot de
LLM-agents er zijn (fase N6) draaien alle agents op hun regels, ook met `--provider ollama`.
