# Architectuur

> Beschrijft **wat** het systeem is en **waarom** het zo gebouwd is. Details die
> veranderen (exacte types, endpoints) horen in de code/schema's. Volledige
> ontwerpbron: [../INTENTO-NEW-DESIGN.md](../INTENTO-NEW-DESIGN.md).
>
> **Herbouw:** de gespreks- en AI-laag wordt herbouwd als agentdienst met eigen orchestrator
> ([ADR-0017](adr/0017-agentic-architectuur.md)). Secties over de oude AI-Orchestrator, de
> wachtrij en de AI-worker beschrijven de situatie vóór de herbouw en verdwijnen per taak.

## Overzicht

Intento is een monorepo met drie workspaces plus losse Python-diensten. De web-app (tablet en
beheer) praat uitsluitend met de backend-API. De client praat **nooit** rechtstreeks met de AI: de
backend roept de agentdienst aan (in herbouw, [adr/0017](adr/0017-agentic-architectuur.md)), en die
praat met Ollama.

```
web (React/Vite)  ──HTTP──▶  server (Fastify 5)  ──▶  agentdienst (Python, in herbouw)  ──▶  Ollama
        │                         │       └──────────▶  spraakdienst (Python, Piper)
        └──── shared (zod) ───────┘
```

`shared/` bevat de zod-schema's die de vorm van API-payloads vastleggen; zowel server
(validatie + response-typing) als web (fetch-typing) importeren eruit, zodat client en
server niet uit elkaar lopen.

## Stack en keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Taal/runtime | TypeScript (strict) / Node ≥ 22 | Sjabloonstandaard; strict vangt fouten vroeg. |
| HTTP-server | Fastify 5 | `buildApp()`-factory, testbaar via `inject()` zonder poort. |
| Validatie | zod | Runtime-validatie + type-inferentie, gedeeld client/server. |
| Repostructuur | npm workspaces (`shared`/`server`/`web`) | Zie [adr/0002](adr/0002-monorepo-workspaces.md). |
| Frontend | React 19 + Vite | Eén codebase voor de drie interfaces; tablet-first. |
| Database | Prisma (SQLite dev → PostgreSQL prod) | Driver adapters; zie [adr/0003](adr/0003-persistence-prisma-sqlite-postgres.md). |
| Auth | argon2id + gehashte sessietokens | Vanaf T1.1. |
| AI | Python-agentdienst met eigen orchestrator, Ollama als LLM | Stateless, backend is data-eigenaar. Zie [adr/0017](adr/0017-agentic-architectuur.md). |

## Mappenstructuur

- `shared/src/` — zod-schema's en afgeleide types (`ApiError`, `HealthResponse`, …).
- `server/src/` — `env.ts` (gevalideerde config), `app.ts` (`buildApp()`-factory),
  `server.ts` (entrypoint dat luistert), `errors.ts` (centrale foutafhandeling),
  `routes/` (één bestand per domein), `db/` (Prisma-client-singleton).
- `server/prisma/` — `schema.prisma` (datamodel), `migrations/`, `seed.ts`. De
  CLI-config staat in `server/prisma.config.ts`.
- `server/src/speech/` — de **spraaklaag** (T18.1): een provider-agnostische `SpeechSynthesizer` met een
  HTTP-client naar de losstaande spraakdienst en een "niet geconfigureerd"-variant die netjes 503 geeft,
  plus een **geheugencache** op `hash(tekst + stem)`. De routes staan in `routes/speech.ts`. Server-intern:
  de tablet praat nooit rechtstreeks met de spraakdienst, net zomin als met de AI.
- `agent-service/` — de **agentdienst** (Python, ADR-0017): `config.py` (gevalideerde env, verplicht
  `SERVICE_TOKEN`), `auth.py` (API-key, constante-tijdvergelijking), `server.py` (stdlib-HTTP-server).
  `contracts.py` bevat de contracten v1 (pydantic); ze worden samen met de zod-kant getest tegen
  `contracts/fixtures/`. `orchestrator.py` is een **zuivere functie** `step(TurnRequest) -> TurnResponse`
  (geen I/O, geen klok): de fasen `clarify` → `confirm_message` → `done`/`stopped`, met de
  regelgebaseerde agents uit `agents/rules.py` (Intent = startconcepten in volgorde, Question =
  "{Label}?", Icon = het item van dat concept) als terugval. `vocabulary.py` is een alleen-lezen index
  op de meegestuurde Vocabulary.
- `shared/src/agent-contract.ts` — dezelfde contracten in zod, voor de backend. De vitest-test leest
  `contracts/fixtures/` en `contracts/fields.json` en eist hetzelfde oordeel als pydantic.
- `server/src/vocabulary/` — de Vocabulary (INTENTO-NEW-DESIGN §15). Nu alleen de OpenSymbols-client
  (`opensymbols.ts`), die bij het importeren uit een externe bron wordt hergebruikt. Zie
  [adr/0015](adr/0015-speech-synthesis-piper.md).
- `web/src/` — `main.tsx` (mount + interfacekeuze op de URL: `/tablet` → gebruikersapp,
  anders beheeromgeving), `App.tsx` (beheer: sessie-toestand + weergavekeuze),
  `TabletApp.tsx` (gebruikersapp op de tablet: koppelscherm; de gespreksflow is in herbouw), `api.ts`
  (injecteerbare, zod-validerende clients naar de backend: de beheer-`Api` en de losgekoppelde
  `DeviceApi` voor de tablet), beheercomponenten (`LoginForm`, `AdminUsersPage`, `SettingsForm`),
  `styles.css`.
- **Schil en huisstijl (T17.1)** — drie componenten die elke ingelogde pagina dezelfde vorm geven:
  `AppShell.tsx` (zijbalk met menu + kopbalk met paginatitel en account), `AdminNav.tsx` (het menu
  zelf: gegroepeerd en gefilterd op rol, met `NavIcon.tsx` voor de lijnicoontjes) en `AuthLayout.tsx`
  (de voordeurschermen: inloggen, aanmelden, bevestigen, tablet koppelen). `Brand.tsx` houdt naam,
  payoff en logopaden op één plek; de logobestanden zelf staan in `web/public/brand/` en worden uit
  het bronlogo gegenereerd (`web/brand/README.md`). Een pagina bepaalt daardoor alleen nog zijn titel
  en inhoud — niet zijn kop, menu of uitlogknop. Schermen met veel inhoud volgen sinds T17.2/T17.3
  hetzelfde **overzicht → detail**-patroon: de pagina houdt de selectie in state (`selectedId`) en
  rendert óf de lijst óf het detail, elk met een eigen `AppShell`-titel. Handelingen die je vanaf een
  overzicht begint lopen via `Modal.tsx` (focus erin, Tab rondlopend, Escape sluit, focus terug naar
  de opener). Een detailscherm met veel inhoud verdeelt die over onderdelen met
  `SegmentedTabs.tsx` (echte `tablist`/`tab`/`tabpanel`-semantiek; `tabPanelProps()` koppelt paneel
  en tab aan elkaar).

## Interfaces in de web-app

De web-app bundelt drie interfaces, gescheiden op de URL en op
authenticatiepijler:

- **Gebruikersapp (tablet)** — `/tablet`, `TabletApp.tsx`, op **device-auth** (aparte cookie).
  Kent via de `DeviceApi` alléén eigen-gebruiker-endpoints (`/device/me`, `/devices/link`,
  `/device/speech`) — nooit beheer- of accountroutes. De gespreksflow wordt herbouwd (ADR-0017); tot
  dan toont een gekoppelde tablet "Nog niet beschikbaar". De spraaklaag (`speech.ts`) blijft: hij
  haalt audio bij de backend op en valt terug op `speechSynthesis` van het apparaat.
- **Beheeromgeving** — overige paden, `App.tsx`, op **account-auth** (`/auth/*`, ADMIN/CAREGIVER).
  Menu voor de beheerder: Dashboard, Gebruikers (met per gebruiker instellingen, begeleiders, tablet en
  profiel), Audit-log en Mijn account. De oude AI-schermen (vraagmodus, gesprekken, AI-activiteit,
  conceptvoorstellen, voorkeuren, persoonlijke context, worker-tokens, AAC-bibliotheek, berichtenlijst)
  zijn weg (N0.3); de nieuwe beheerschermen uit INTENTO-NEW-DESIGN §49 komen per taak terug.
- **Begeleiderinterface** — dezelfde route-tak als de beheeromgeving, maar met een **kort menu**:
  voorlopig alleen Mijn account. Een begeleider ziet geen ingangen naar beheer dat de server hem toch
  weigert; dat menu is geen beveiliging, de autorisatie zit in de backend (ADR-0005).
- **Platform-operatorconsole** — `/operator`, `OperatorConsole.tsx`. Draait in dezelfde schil, maar
  bewust **zonder menu**: cross-tenant beheer hoort geen knop naast "Gebruikers" te zijn (T8.3).

Deze scheiding is bewust ook in de client zichtbaar: een tablet-token werkt niet op accountroutes
en omgekeerd, dus de tablet-UI hoeft geen beheer-`Api` te kennen (en andersom).

## Belangrijke patronen

- **`buildApp()`-factory** — bouwt een geconfigureerde, niet-luisterende Fastify-app;
  herbruikbaar in tests via `app.inject()`. `server.ts` roept `listen()` apart aan.
- **`env.ts`** — zod-gevalideerde env met prod-guards (weigert dev-default-secrets en
  onveilige cookie-instellingen in productie). De rest van de app raakt `process.env`
  niet meer aan.
- **Centrale foutafhandeling** — `ZodError → 400`, `HttpError → eigen status`,
  onbekende fouten → 500 zonder interne details te lekken. Alle fouten in de
  consistente structuur `{ error: { code, message } }`.
- **Autorisatie + tenant-isolatie** — beschermde routes hangen het
  `authorize(prisma, { roles })`-preHandler ervoor (401 zonder sessie, 403 bij verkeerde
  rol) en zetten `request.account`. Tenant-gebonden queries filteren op `organizationId`
  via `tenantScope(account)` / `assertSameTenant(...)` (`auth/tenant.ts`). Zie
  [adr/0005](adr/0005-authorization-tenant-isolation.md).
- **Prisma-client-singleton** (`db/prisma.ts`) — verbindt via een driver adapter
  (SQLite in dev/test) op basis van `DATABASE_URL`; wordt op `globalThis` bewaard zodat
  `tsx watch` niet telkens een nieuwe verbinding opent. Zie [data-model.md](data-model.md).
- **Platform-operatorconsole** (`auth/operator.ts`, `auth/organization-status.ts`,
  `routes/operator.ts`, `web/src/OperatorConsole.tsx`, T8.3) — de enige laag die bewust **over de
  tenant-grens heen** kijkt: organisaties beheren (aanmaken, (de)activeren) en accounts/gebruikers
  inzien over alle omgevingen. Staat naast de gewone autorisatielaag, niet erin: een eigen guard
  (`operatorAuthorize`) op een eigen routetak (`/operator/*`), die `request.operator` zet en
  `request.account` **leeg laat**, zodat `requireAccount`/`tenantScope`/`assertSameTenant` daar hard
  falen in plaats van stilletjes op de organisatie van de operator te filteren — een vergissing wordt
  een crash, geen datalek. Toegang vereist `Account.isOperator` **én** `Organization.isPlatform`, en de
  vlag is alleen via de bootstrap-seed te zetten. `organization-status.ts` dwingt daarnaast
  `Organization.active` af op alle drie de auth-paden (login, accountsessie, device), zodat een
  gedeactiveerde omgeving onmiddellijk stopt. In de web-bundel is het een aparte route-tak
  (`routes.tsx` → `/operator`). Zie [adr/0011](adr/0011-platform-operator-console.md).

## Draaien in containers (fase 19)

Vier images, één `compose.yaml` in de repo-root:

| Dienst | Image | Bijzonderheid |
|---|---|---|
| `server` | `server/Dockerfile`, Debian + Node 24 | migreert in het entrypoint (`prisma migrate deploy`), draait als niet-root, SQLite op een named volume |
| `web` | `web/Dockerfile`, nginx-alpine | statische build; `VITE_API_URL` wordt **bij de build** ingebakken |
| `speech` | `speech-service/Dockerfile`, Python + Piper | alleen op het interne netwerk; stemmen uit een volume dat een eenmalige init-dienst vult |
| `agents` | `agent-service/Dockerfile`, Python + pydantic | geen `ports:`, `SERVICE_TOKEN` verplicht, healthcheck op `/health`; de backend bereikt hem op `http://agents:5003` |

Build-context van `server` en `web` is de **repo-root** (npm-workspaces, `shared/`). De database is
bewust SQLite; het PostgreSQL-pad staat als losse stap op de "na de MVP"-lijst. Afwegingen:
[adr/0016](adr/0016-containers-en-compose.md); bediening: README, sectie "Draaien in Docker".

## Gerelateerde documentatie

- Belangrijke keuzes met onderbouwing: [adr/](adr/)
- Datamodel: [data-model.md](data-model.md)
- Beveiliging: [security.md](security.md)
