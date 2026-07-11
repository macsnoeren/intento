# 0010. Gedistribueerde AI-workers: wachtrij en worker-initiated protocol

- **Status:** geaccepteerd
- **Datum:** 2026-07-11

## Context

T5.1–T5.4 zetten de AI achter een provider-agnostische `AiProvider`-interface met een orchestrator en
validatielaag (ADR-0008, ADR-0009). De providers tot nu toe draaien **in-process** en **synchroon**: de
backend roept `selectNextQuestion`/`generateMessage` aan en wacht op het antwoord. Dat volstaat voor de
deterministische mock, maar niet voor een echte LLM:

1. **Zware, trage inferentie op andere hardware.** Een lokaal LLM (bv. Ollama) draait op een GPU-machine,
   niet op de webserver. De inferentie mag de request-thread van de website niet blokkeren.
2. **Schaal en robuustheid (DESIGN §9.5).** Meerdere workers moeten parallel jobs kunnen verwerken; een
   worker mag crashen zonder dat een aanvraag verloren gaat.
3. **NAT/firewall.** Workers staan vaak achter NAT (thuis, een aparte GPU-node). De backend kan ze niet
   proactief bereiken — de **worker** moet de verbinding openen.
4. **Backpressure (DESIGN §9.4, "veiligheid boven snelheid").** Bij een piek mag de site niet omvallen of
   oneindig blokkeren; de aanvrager hoort netjes te horen "even wachten".
5. **Nul vertrouwen in de worker (DESIGN §7.6, §8.1).** Een externe worker is infrastructuur, geen
   vertrouwde component: al zijn uitvoer moet opnieuw door de zod-schema's én de validatielaag (T5.2).
6. **De client praat nooit met de AI (DESIGN §8.1).** Ook met externe workers blijft de flow
   tablet → backend → (wachtrij) → worker → backend → tablet.

## Beslissing

**We introduceren een database-gebackte AI-jobwachtrij met een worker-initiated (long-poll) protocol, een
apart worker-token als infrastructuur-credential, en een `QueueAiProvider` die de bestaande
`AiProvider`-interface implementeert.** Concreet (`server/src/ai/`):

- **`AiJob` (wachtrij, DB).** Elke AI-aanvraag wordt een rij: `task`, `payloadJson` (de door
  `buildAiPrompt`/`buildMessagePrompt` samengestelde, beperkte context), `status`, `resultJson`,
  `attempts`, lease-velden en TTL. De DB is de bron van waarheid — een herstart verliest geen jobs.
- **`WorkerToken` (credential).** Een apart, **gehasht** (SHA-256) token met scope (`ai:process`),
  intrekbaar (`revokedAt`) en optioneel verlopend. Losstaand van gebruiker-/device-/sessietokens: een
  worker is infrastructuur, geen gebruiker. Rate limiting op de worker-endpoints.
- **Worker-initiated protocol** (`routes/ai-worker.ts`, alle onder `workerAuthorize`):
  `POST /ai/worker/claim` (long-poll: claim de oudste wachtende job, of 204), `…/jobs/:id/heartbeat`
  (lease verlengen tijdens lange inferentie), `…/jobs/:id/result` (gestructureerd resultaat inleveren) en
  `…/jobs/:id/fail` (nette teruggave bij een fout). De worker opent altijd de verbinding — robuust achter
  NAT.
- **Backpressure via een configureerbaar maximum** (`AI_WORKER_MAX_CONCURRENT_JOBS`). Bij het inschakelen
  telt de service de actieve jobs (`QUEUED` + `CLAIMED`). Onder het maximum → `QUEUED` (direct claimbaar);
  op het maximum → `WAITING_FOR_WORKER` met een **positie**, en de aanvrager krijgt meteen een
  wacht-signaal i.p.v. te blokkeren. Zodra een slot vrijkomt promoveert de service de oudste wachtende job.
- **Crash-herstel zonder achtergrond-timer.** Een geclaimde job heeft een `leaseExpiresAt`; de worker
  verlengt die met heartbeats. Een **opportunistische sweep** (bij elke enqueue/claim/poll) legt een
  verlopen lease terug in de wachtrij (`attempts++`, na `AI_WORKER_MAX_ATTEMPTS` → `FAILED`) en laat oude,
  nooit-opgepakte jobs verlopen (`EXPIRED`). Geen `setInterval` — deterministisch testbaar.
- **`QueueAiProvider`** (`queue-provider.ts`) implementeert `AiProvider`: enqueue → poll de DB tot het
  resultaat er is (binnen `AI_REQUEST_TIMEOUT_MS`). Bij backpressure gooit hij `AiWorkerBusyError`
  (→ 503 `AI_WORKER_BUSY` + `Retry-After` + `waiting`/`position`); bij time-out/mislukking
  `AiWorkerUnavailableError` (→ 503 `AI_WORKER_UNAVAILABLE`). De orchestrator en validatielaag blijven
  ongewijzigd: **de uitvoer van een worker doorloopt exact dezelfde zod-parse en AAC-validatie** als die
  van elke andere provider — een onbekend concept van een worker bereikt de gebruiker nooit.

## Alternatieven

- **Directe, synchrone HTTP-provider naar één Ollama.** Simpel, maar blokkeert de request, schaalt niet
  naar meerdere workers, en werkt niet als de worker achter NAT staat. Afgewezen; de mock blijft de
  in-process route voor dev/test.
- **Externe message broker (Redis/RabbitMQ/BullMQ).** Krachtig, maar voegt een nieuwe infrastructuurlaag
  en dependency toe voor een MVP met bescheiden volume. De DB die we al hebben is voor deze schaal genoeg
  en houdt de jobs transactioneel bij de rest van de data. Een broker blijft een latere optie (DESIGN
  §9.5) achter dezelfde `AiProvider`-interface.
- **Backend pusht naar workers (WebSocket vanaf de backend / webhook).** Vereist bereikbare workers; sneuvelt
  op NAT. Worker-initiated long-poll is robuuster en simpeler.

## Gevolgen

- Een echte, self-hosted LLM kan nu als **losstaande worker** (T5.6, Python + Ollama) meedraaien zonder de
  backend te wijzigen: hij haalt een worker-token op, claimt jobs en levert gestructureerde output.
- De backend blokkeert nooit op trage inferentie en degradeert netjes onder druk (`WAITING`/503 met
  `Retry-After`) i.p.v. om te vallen.
- De volledige tablet-UX voor `WAITING` (spinner + polling) is bewust **niet** in deze taak gebouwd — de
  backend levert het signaal (503 + `Retry-After` + `position`); de gebruikersapp-afhandeling is als
  vervolgtaak genoteerd (TASKS.md). Tot die tijd is de mock de standaardprovider en verandert de
  bestaande flow niet.
- Worker-tokens worden buiten de app-UI aangemaakt via een CLI-script (`scripts/create-worker-token.ts`);
  een beheer-UI ervoor is een latere taak.
