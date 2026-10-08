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
  op de meegestuurde Vocabulary. `llm/` is de provider-laag (§35): `LlmProvider.complete_json(system,
  user, schema, timeout)` met `FakeProvider` (vaste antwoorden, bewaart alle prompts) voor de tests.
  Elke agent draait via `agents/envelope.py` (`run_agent` → `AgentResult` → `AgentDecision`): eerst
  het LLM-deel, bij elke fout de regels, nooit een exceptie naar buiten. Prompts staan als
  versiebestanden in `prompts/`.
- `server/src/agents/client.ts` — de **client naar de agentdienst** (N4.3): `POST /v1/turn` met de
  API-key als Bearer, een harde time-out (`AGENT_TIMEOUT_MS`), een groottegrens op het antwoord en
  zod-validatie tegen het contract (plus: zelfde gesprek en beurt). Elke fout wordt één
  `AgentUnavailableError` (503 `AGENT_UNAVAILABLE`) met een interne `reason` voor log en
  `AgentDecision`. `FakeAgentClient` is de nep-agentdienst voor backendtests.
- `server/src/agents/invariants.ts` — de **harde invarianten** (§52, N4.4): een zuivere functie
  `checkTurnResponse(request, response)` voor I1, I4, I5, I6 en I7. Ze kijkt alleen naar wat de backend
  zelf verstuurde (Vocabulary, contacten, instellingen, vorige toestand) en naar het antwoord; wat de
  agent in zijn eigen state zet, telt niet als bewijs. Een schending noemt ids en aantallen, nooit
  woorden van het scherm.
- `server/src/communication/` — gesprekken (`sessions.ts`: versleutelde momentopname per beurt),
  provenance (`provenance.ts`: Presented, Observed, Inferred en agentbeslissingen in eigen tabellen)
  en `conversation.ts`: één beurt van begin tot eind (Observed vastleggen → `TurnRequest` bouwen →
  agentdienst → invarianten → opslaan, inclusief de ontbrekende woorden per organisatie → presentatie
  voor de tablet met ondertekende afbeeldings-URL's).
  De routes staan in `routes/communication.ts`. Elke `TurnRequest` krijgt ook de laatste handelingen
  mee (`recent`: Observed met het scherm uit Presented, ook ↩ Terug) voor de wisselregels van "AI
  kiest" (N13.1); de backend toetst elke wissel opnieuw aan I7.
- `server/src/experience/` — Experience per gebruiker (INTENTO-NEW-DESIGN §21 laag 1, §22, N12.1):
  `tally.ts` telt één afgerond gesprek puur uit Presented en Observed (per symbool, contact en vorm:
  getoond, gekozen, gekozen op de eerste plek); `stats.ts` claimt het gesprek en telt het op bij
  `ExperienceStat`, in één transactie en alleen als Experience aanstaat. `conversation.ts` roept dat aan
  bij elk einde van een gesprek; een fout daarbij breekt het gesprek niet.
  `summary.ts` (N12.2) maakt de samenvatting die met elke beurt naar de agentdienst gaat — alleen met
  Experience aan, alleen ids en aantallen, alleen symbolen uit de meegestuurde Vocabulary en contacten
  die nu aangeboden kunnen worden. De agentdienst ordent daarmee (vaakst gekozen eerst).
  `observations.ts` (N12.4) laat na afloop de Experience Agent terugkijken (`POST /v1/experience`):
  `conversation.ts` meldt het einde via `onSessionEnded`, de route start het los van de beurt (de
  tablet wacht nooit, een fout gaat naar de log en als mislukte `AgentDecision` in de provenance). Het
  verzoek bevat geen contactschermen; observaties met een contactnaam of URL gooit de backend weg. Wat
  overblijft, is een inference `experience_note` (versleuteld, met het gesprek binnen de bewaartermijn).
- `shared/src/agent-contract.ts` — dezelfde contracten in zod, voor de backend. De vitest-test leest
  `contracts/fixtures/` en `contracts/fields.json` en eist hetzelfde oordeel als pydantic.
- `server/src/vocabulary/` — de Vocabulary (INTENTO-NEW-DESIGN §15–17): lezen en filteren per
  organisatie (`repository.ts`), seed van de startset (`seed.ts`, `translation.ts`), afbeeldingen en
  ondertekende URL's (`assets.ts`), licenties (`licenses.ts`), de OpenSymbols-client voor zoeken en
  importeren (`opensymbols.ts`) en de ontbrekende woorden (`gaps.ts`: samenvoegen per concept per
  organisatie, zonder gebruiker of gesprek).
- `web/src/` — `main.tsx` (mount + interfacekeuze op de URL: `/tablet` → gebruikersapp,
  anders beheeromgeving), `App.tsx` (beheer: sessie-toestand + weergavekeuze),
  `TabletApp.tsx` (gebruikersapp op de tablet: koppelscherm, kopbalk, bronnen) met
  `TabletConversation.tsx` (het gesprek: startscherm, binary scherm met pictogram, vraag, JA links/NEE
  rechts, ↩ Terug en ⏹ Stoppen; multi-icon met 2 tot 8 tegels (twee per rij, vanaf vijf vier per
  rij) en "Geen van deze"; "Bedoel je …?" met alle pictogrammen van de boodschap; Klaar met de
  boodschap groot en "Nieuw gesprek"; hervat een lopend gesprek en meet de reactietijd; met voorlezen
  aan gaat letterlijk de schermtekst — of op Klaar de boodschap — naar `speech.ts`; bij 503
  `AGENT_UNAVAILABLE` of een onbereikbare backend "Het lukt nu even niet" met Opnieuw proberen — exact
  dezelfde handeling, met hetzelfde antwoord — en Stoppen), `api.ts`
  (injecteerbare, zod-validerende clients naar de backend: de beheer-`Api` en de losgekoppelde
  `DeviceApi` voor de tablet), beheercomponenten (`LoginForm`, `AdminUsersPage`, `SettingsForm`),
  `styles.css`.
- `VocabularyUploadDialog.tsx` — eigen afbeelding + woord (N8.2): bestand met voorbeeld, woord,
  synoniemen, concepten, contexten en het verplichte rechtenvinkje; opent na opslaan het nieuwe item.
  Alleen zichtbaar voor de beheerder.
- `ExternalImportDialog.tsx` — importeren uit OpenSymbols (N8.6): zoeken, per resultaat de licentie,
  niet-toegestane resultaten gemarkeerd en niet te kiezen, dan woord, concepten en contexten.
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
  profiel), Vocabulary (tegels met pictogram, label, licentie en bron; zoeken en bladeren via de
  gepagineerde `GET /vocabulary`), Audit-log en Mijn account. De oude AI-schermen (vraagmodus, gesprekken, AI-activiteit,
  conceptvoorstellen, voorkeuren, persoonlijke context, worker-tokens, AAC-bibliotheek, berichtenlijst)
  zijn weg (N0.3); de nieuwe beheerschermen uit INTENTO-NEW-DESIGN §49 komen per taak terug.
- **Begeleiderinterface** — dezelfde route-tak als de beheeromgeving, maar met een **kort menu**:
  Mijn gebruikers (de gekoppelde gebruikers met hun instellingen, `GET /caregiver/users`), Vocabulary en
  Bronnen (alleen lezen) en Mijn account. Een begeleider ziet geen ingangen naar beheer dat de server hem toch
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

## Gemeten duur van de agents (N6.13)

Gemeten op 6 oktober 2026 met `python -m agent_service.eval --set meting --runs 3`, met de echte
startset (99 platformitems) en via de lokale Ollama-proxy naar Ollama Cloud. De scenario's: een
gesimuleerde gebruiker bedoelt **hoofdpijn**, **dorst** of **duizelig** en zegt JA als het getoonde
woord of concept erbij hoort. Elke meting draaide alleen; tegelijk draaiende metingen deelden het
cloudmodel en waren twee tot drie keer trager (time-outs, terugval op de regels).

| Opstelling | Geslaagd | Vragen gem. | Beurt mediaan | Beurt p90 | Beurt max |
|---|---|---|---|---|---|
| `gpt-oss:120b-cloud`, standaard | 6/9 | 5,2 | 3,9 s | 5,8 s | 8,4 s |
| `gpt-oss:120b-cloud`, Validation + Safety met LLM | 6/9 | 6,2 | 4,6 s | 6,4 s | 17,5 s |
| `gpt-oss:20b-cloud`, standaard (1 ronde) | 2/3 | 4,7 | 12,3 s | 14,3 s | 15,4 s |

Gemiddelde duur per agentaanroep (120b, met Validation en Safety): Intent ±2,0 s, Question ±1,0 s,
Validation ±1,1 s, Safety ±1,3 s (die twee tegelijk), Icon ±0,2 s (meestal exact, zonder model). Met
20b duurt de Intent Agent ±7,8 s en haalt hij in 8 van de 19 aanroepen de time-out van 10 s niet.
Op de tablet (120b, standaard) duurt een gesprek "dorst" met vier schermen ±15 s, ±3–4 s per scherm.

**Conclusies.**

- **Model:** `gpt-oss:120b-cloud` is sneller én beter dan `gpt-oss:20b-cloud`. Lokale modellen zijn
  niet gemeten (bewuste keuze: alleen cloudmodellen).
- **Hoofdpijn en dorst slagen altijd** (1–4 vragen). Soms is de boodschap algemener dan bedoeld
  ("Pijn." in plaats van "Ik heb hoofdpijn.") — de gebruiker kan dan NEE zeggen.
- **Duizelig slaagt nooit.** De startset heeft geen woorden voor ziek zijn (geen "ziek", "misselijk",
  "duizelig"), en na een reeks NEE's loopt de Intent Agent de gevoelens uit de Vocabulary af in plaats
  van breder te zoeken; bij het maximum (S1) legt hij een gok met lage zekerheid voor. Zie N6.14–N6.16.
  **Na N6.14** (prompt `intent-v4`, breder zoeken na drie NEE) slaagt "duizelig" 3 van de 3 keer met
  `gpt-oss:120b-cloud` ("Ziek.", "Duizelig.", "Niet lekker."), met 4–11 vragen en een beurt-mediaan
  van 3,5 s.
- **Time-outs.** Per agent: Intent 10 s, Question 10 s, Icon 8 s per stap, Validation en Safety 8 s.
  Samen kon dat in het slechtste geval boven de 30 s van de backend (`AGENT_TIMEOUT_MS`) uitkomen.
  Daarom heeft elke beurt nu een **tijdsbudget** (`AGENT_TURN_BUDGET_SECONDS`, standaard 25 s): elke
  modelaanroep krijgt hooguit de resterende tijd, en met minder dan 1 s over nemen de regels het over.
  In de metingen onder belasting bleef de langste beurt daardoor op 25,05 s.

## Draaien in containers (fase 19)

Vier images, één `compose.yaml` in de repo-root:

| Dienst | Image | Bijzonderheid |
|---|---|---|
| `server` | `server/Dockerfile`, Debian + Node 24 | migreert in het entrypoint (`prisma migrate deploy`), draait als niet-root, SQLite op een named volume |
| `web` | `web/Dockerfile`, nginx-alpine | statische build; `VITE_API_URL` wordt **bij de build** ingebakken |
| `speech` | `speech-service/Dockerfile`, Python + Piper | alleen op het interne netwerk; stemmen uit een volume dat een eenmalige init-dienst vult |
| `vocabulary-import` | `server/Dockerfile` (zelfde image) | eenmalige klus: migreren, afbeeldingen van de startset naar het volume `intento-storage`, Vocabulary seeden; de server wacht tot hij klaar is |
| `agents` | `agent-service/Dockerfile`, Python + pydantic | geen `ports:`, `SERVICE_TOKEN` verplicht, healthcheck op `/health`; de backend bereikt hem op `http://agents:5003` |

Build-context van `server` en `web` is de **repo-root** (npm-workspaces, `shared/`). De database is
bewust SQLite; het PostgreSQL-pad staat als losse stap op de "na de MVP"-lijst. Afwegingen:
[adr/0016](adr/0016-containers-en-compose.md); bediening: README, sectie "Draaien in Docker".

## Gerelateerde documentatie

- Belangrijke keuzes met onderbouwing: [adr/](adr/)
- Datamodel: [data-model.md](data-model.md)
- Beveiliging: [security.md](security.md)
