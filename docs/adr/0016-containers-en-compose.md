# 0016. Vier images en één compose-stack, voorlopig op SQLite

- **Status:** geaccepteerd
- **Datum:** 2026-08-29

## Context

Intento bestaat uit vier draaiende onderdelen: de backend, de web-app, de spraakdienst en de
AI-worker. Ze hebben elk een eigen runtime (Node 24, nginx, Python + Piper, Python), een eigen
`.env` en een eigen opstartcommando. Wie het geheel wil draaien — of het ergens wil neerzetten voor
een pilot — moet nu vier handleidingen volgen en de juiste versies zelf installeren.

Randvoorwaarden die de vorm bepaalden, gevonden bij het bekijken van de repo:

1. **Native modules.** `argon2` en `better-sqlite3` compileren tegen glibc.
2. **npm-workspaces.** `server` en `web` hangen aan `shared/`; een build-context van alleen `server/`
   bestaat dus niet.
3. **De SPA en de API kunnen geen origin delen.** De web-app heeft een client-side route `/operator`
   en de API een routetak `/operator/*` (`routes/operator.ts`).
4. **De database is nu echt SQLite.** `provider = "sqlite"` in het schema én in `migration_lock.toml`,
   en de runtime hangt aan `PrismaBetterSqlite3`.
5. **Piper is GPL-3.0** (ADR-0015) en de stemmodellen zijn ± 63 MB per stuk.

## Beslissing

**Vier images, één `compose.yaml`, database als SQLite-bestand op een volume.**

- **Eén image per onderdeel**, niet één image met alles erin. Ze schalen en herstarten los van elkaar,
  de spraakdienst blijft daarmee ook als GPL-proces netjes afgezonderd, en een web-app die alleen
  statische bestanden serveert hoort geen Node-runtime te bevatten.
- **Debian (`bookworm-slim`) voor de backend, niet Alpine.** De native modules bouwen tegen glibc; op
  musl kost dat een eigen toolchain en levert het niets op. De web-app draait wél op Alpine-nginx:
  daar wordt niets gecompileerd.
- **Build-context is de repo-root** voor `server` en `web` (workspaces), met een strakke
  `.dockerignore` — anders reist er honderden MB's aan `node_modules`, `dev.db` en stemmodellen mee.
- **Migreren gebeurt in het entrypoint** (`prisma migrate deploy`, daarna de server). Een verse
  database op een leeg volume hoort vanzelf goed te komen, en `deploy` verzint nooit zelf een migratie.
  Daarom staat `prisma` bij de *dependencies*: in een container is de CLI runtime, geen gereedschap.
- **De API krijgt een eigen poort**, en de web-app bakt die URL in bij de build (`VITE_API_URL`).
  Gevolg van punt 3 hierboven; één origin zou de route `/operator` en de API-tak `/operator/*` op
  elkaar laten botsen.
- **Stemmen in een named volume**, gevuld door een eenmalige init-dienst. Niet in het image: dat maakt
  de stemkeuze een build-tijdbeslissing, laat het image met ± 63 MB per stem groeien, en bij een
  afgebroken download (dat gebeurde al eens) wil je een volume opnieuw kunnen vullen in plaats van een
  image opnieuw te bouwen.
- **De AI-worker achter een compose-profiel** (`--profile ai`). Hij heeft een `WORKER_TOKEN` nodig dat
  de backend éérst moet uitgeven en een bereikbare Ollama; die twee horen niet stil te blokkeren wat de
  rest van de stack doet.
- **SQLite op een volume, voorlopig.** DESIGN §9.3 noemt PostgreSQL voor productie en dat blijft staan,
  maar de overstap vraagt een adapter, een provider-wissel en een **eigen migratielijn**. Dat hoort een
  zichtbare taak te zijn ("na de MVP" in `TASKS.md`), niet iets wat ongemerkt in een containertaak
  meelift.

## Gevolgen

- **Makkelijker:** `npm run docker:up` en het staat er, inclusief automatische migratie; een pilot
  opzetten vraagt geen Node/Python/Piper op de doelmachine; de onderdelen zijn los te vervangen.
- **Moeilijker/afweging:** de configuratie staat nu op twee plekken (`.env` voor lokaal ontwikkelen,
  `.env.docker` voor de stack) en die kunnen uit elkaar lopen. Compose leest zijn eigen variabelen
  bovendien alleen uit het bestand dat je met `--env-file` meegeeft, vandaar de `docker:*`-npm-scripts.
  Een nieuwe `VITE_API_URL` vraagt een herbouw van de web-app, geen herstart.
- **Openstaand:** TLS/reverse proxy (nu draait alles op http en `COOKIE_SECURE=false`), en het
  PostgreSQL-pad.

## Alternatieven overwogen

- **Eén image met alles erin (supervisord).** Simpel op te starten, maar het maakt vier processen met
  verschillende levenscycli tot één ondeelbaar geheel, en het trekt de GPL-code van Piper de rest in.
  Afgewezen.
- **De web-app door de backend laten serveren** (statische bestanden uit Fastify). Bespaart een image
  en lost het origin-probleem op, maar zet een SPA-build in de backend-release en dwingt een herstart
  van de API voor elke frontendwijziging. Afgewezen; wel het overwegen waard zodra er een reverse proxy
  met paden voor de API staat.
- **Stemmen in het image bakken.** Voorspelbaarder (één artefact) en zonder init-dienst, maar het
  bevriest de stemkeuze op buildtijd en maakt elk image honderden MB's groter. Afgewezen; blijft de
  betere keuze voor een airgapped installatie.
- **PostgreSQL nu meteen.** Zou dichter bij DESIGN §9.3 liggen, maar de migratielijn is SQLite en een
  half doorgevoerde overstap in een containertaak is precies het soort verborgen werk dat later
  omvalt. Uitgesteld en opgeschreven.
