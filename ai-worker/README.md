# Intento — Ollama AI-worker (T5.6)

Een aparte, deploybare applicatie die AI-jobs van de Intento-backend verwerkt tegen een **Ollama**-model.
De worker is **backend-infrastructuur**: hij haalt jobs op van de wachtrij (T5.5) en levert gestructureerde
uitvoer terug. De tablet-client praat nooit rechtstreeks met de AI — de flow blijft
`tablet → backend → wachtrij → worker → Ollama → backend → tablet`.

Zie ook de backend-context in [`../DESIGN.md`](../DESIGN.md) (§7.2, §7.7, §9.2, §9.3) en
[`../docs/adr/0010-distributed-ai-worker-queue.md`](../docs/adr/0010-distributed-ai-worker-queue.md).

## Hoe het werkt

1. **Worker-initiated verbinding.** De worker opent altijd zelf de verbinding (robuust achter NAT). Hij
   long-pollt `POST /ai/worker/claim` met zijn worker-token in de `Authorization: Bearer …`-header.
2. **Verwerken tegen Ollama.** Uit de beperkte job-context (systeemregels, doel, AAC-regels, gekozen
   concepten, toegestane opties) bouwt de worker een systeem- en gebruikersprompt plus een **JSON-schema**,
   en dwingt zo gestructureerde uitvoer af via Ollama's `format`-parameter (`/api/generate`).
3. **Heartbeats.** Tijdens de (mogelijk lange) inferentie verlengt een achtergrond-thread periodiek de
   lease (`…/jobs/:id/heartbeat`), zodat de backend de job niet als "gecrasht" teruglegt.
4. **Resultaat terugleveren.** De uitvoer wordt opgeschoond (onbekende concepten weggelaten, confidence
   geklemd) en ingeleverd via `…/jobs/:id/result`. De **backend valideert de vorm opnieuw** met zod en
   tegen de AAC-bibliotheek (T5.1/T5.2) — een worker wordt nooit vertrouwd.
5. **Nette foutafhandeling.** Een Ollama-fout/time-out of onbruikbaar antwoord leidt tot
   `…/jobs/:id/fail`; de backend legt de job terug in de wachtrij of schrijft hem af. De worker crasht niet.

### Concurrency-limiet

Een semaphore van `MAX_THREADS` gates zowel het **claimen** als het **verwerken** (een `ThreadPoolExecutor`
van dezelfde grootte). Er draaien dus nooit meer dan `MAX_THREADS` Ollama-aanroepen tegelijk — de worker
(en daarmee de site) overvraagt Ollama niet. Kies `MAX_THREADS` op de capaciteit van de Ollama-machine.

## Vereisten

- **Python ≥ 3.11** (getest op 3.14). Geen third-party-dependencies — alleen de standaardbibliotheek.
- Een draaiende **Intento-backend** met `AI_PROVIDER=queue` en een geldig **worker-token**.
- Een bereikbare **Ollama** met het gewenste model (`ollama pull <model>`).

## Opzet

```bash
cd ai-worker
cp .env.example .env          # en vul in (zie hieronder)
```

Munt een worker-token op de backend (het rauwe token wordt één keer getoond):

```bash
# in de repo-root
npm run worker-token:create --workspace=server -- --name gpu-node-1
```

Zet dat token als `WORKER_TOKEN` in `.env`. De belangrijkste variabelen (alle gedocumenteerd in
[`.env.example`](.env.example)):

| Variabele             | Betekenis                                                        | Standaard                 |
| --------------------- | ---------------------------------------------------------------- | ------------------------- |
| `BACKEND_URL`         | Basis-URL van de backend (zonder pad)                            | — (verplicht)             |
| `WORKER_TOKEN`        | Rauw worker-token (infrastructuur-credential)                    | — (verplicht)             |
| `OLLAMA_URL`          | Ollama-endpoint (mag een andere machine zijn)                    | `http://localhost:11434`  |
| `OLLAMA_MODEL`        | Ollama-modelnaam                                                 | — (verplicht)             |
| `MAX_THREADS`         | Max. gelijktijdige Ollama-aanroepen                              | `2`                       |
| `OLLAMA_TIMEOUT_S`    | Time-out per Ollama-aanroep                                      | `120`                     |
| `CLAIM_TIMEOUT_S`     | Client-time-out voor de long-poll-claim (> server-long-poll)     | `30`                      |
| `HEARTBEAT_INTERVAL_S`| Heartbeat-interval (< server-lease)                              | `10`                      |
| `IDLE_SLEEP_S`        | Pauze na een lege claim                                          | `1`                       |

Ontbrekende of ongeldige configuratie laat de worker **luid** stoppen (exit 1) met een duidelijke melding.

## Draaien

```bash
python -m ai_worker          # of: python run.py
```

Stoppen met Ctrl-C (SIGINT/SIGTERM) — de worker maakt lopende jobs af en sluit netjes af.

## Testen

Volledig offline (backend en Ollama worden gemockt/gestubd), met de stdlib-testrunner:

```bash
python -m unittest discover -t . -s . -p "test_*.py"
```

De tests dekken onder meer:

- **Job-lus** (`tests/test_worker.py`): claim → Ollama → resultaat/fout; onbekend concept gefilterd;
  onbekende taak en Ollama-fout leiden tot `fail` zonder crash.
- **Concurrency-limiet** (`tests/test_concurrency.py`): meer jobs dan `MAX_THREADS` overschrijden de limiet
  nooit.
- **Echte HTTP-round-trip** (`tests/test_integration_http.py`): de werkelijke `urllib`-clients tegen lokale
  stub-servers, inclusief bearer-auth (fout token → 401) en het 204-geval bij een lege claim.
- **Configuratie** (`tests/test_config.py`) en **prompt-/schemabouw** (`tests/test_prompts.py`).

## Live rooktest (handmatig, tegen een echte Ollama)

De geautomatiseerde tests mocken Ollama. Voor een echte end-to-end-controle op een tweede machine:

1. Start Ollama en haal het model op: `ollama pull llama3.1`.
2. Start de backend met `AI_PROVIDER=queue` en munt een worker-token.
3. Vul `.env` (incl. `OLLAMA_URL` van de GPU-machine) en start de worker: `python -m ai_worker`.
4. Doorloop een gesprek in de tablet-UI; de worker logt claim → resultaat en de vraag/het voorstel
   verschijnt in de app.

> Status in deze omgeving: de live rooktest tegen een echte Ollama is **niet** uitgevoerd (geen
> Ollama/GPU-machine beschikbaar in de ontwikkelomgeving). De volledige flow is wel geverifieerd tegen een
> gestubde Ollama én een gestubde backend over echt HTTP (`tests/test_integration_http.py`).
