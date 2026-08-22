# Architectuur

> Beschrijft **wat** het systeem is en **waarom** het zo gebouwd is. Details die
> veranderen (exacte types, endpoints) horen in de code/schema's. Volledige
> ontwerpbron: [../DESIGN.md](../DESIGN.md).

## Overzicht

Intento is een monorepo met drie workspaces. De web-app (tablet) praat uitsluitend
met de backend-API; de backend praat met de LLM via een AI-Orchestrator met validatielaag
(fundament vanaf T5.1, `server/src/ai/`). De client praat **nooit** rechtstreeks met de AI (DESIGN §8.1).

```
web (React/Vite, tablet)  ──HTTP──▶  server (Fastify 5)  ──▶  AI-Orchestrator + AAC (later)
        │                                   │
        └────────── shared (zod-schema's/types) ──────────┘
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
| AI | Self-hosted LLM achter AI-Orchestrator | Fundament vanaf T5.1; provider-agnostisch, mock in tests. Zie [adr/0008](adr/0008-ai-provider-interface-and-orchestrator.md). |

## Mappenstructuur

- `shared/src/` — zod-schema's en afgeleide types (`ApiError`, `HealthResponse`, …).
- `server/src/` — `env.ts` (gevalideerde config), `app.ts` (`buildApp()`-factory),
  `server.ts` (entrypoint dat luistert), `errors.ts` (centrale foutafhandeling),
  `routes/` (één bestand per domein), `db/` (Prisma-client-singleton).
- `server/prisma/` — `schema.prisma` (datamodel), `migrations/`, `seed.ts`. De
  CLI-config staat in `server/prisma.config.ts`.
- `server/src/ai/` — de AI-laag: de provider-agnostische `AiProvider`-interface (`provider.ts`), de
  `AiOrchestrator` (`orchestrator.ts`), de beperkte-context-bouw (`prompt.ts`) en de deterministische
  `MockAiProvider` (`mock-provider.ts`) uit T5.1, plus vanaf T5.2 de **validatielaag** (`validation.ts`,
  die AI-opties tegen de AAC-bibliotheek toetst en onbekende concepten als `ConceptProposal` afvangt) en
  de **confidence-drempels** (`thresholds.ts`, §7.4). Server-intern — de client praat nooit met de AI.
  Vanaf T5.5 óók de **gedistribueerde wachtrij**: `job-queue.ts` (enqueue met backpressure, atomair
  claimen, resultaat/heartbeat, opportunistische sweep voor crash-herstel en wachtrij-timeout),
  `queue-provider.ts` (de `QueueAiProvider` achter dezelfde interface), `worker-token.ts`
  (infrastructuur-credential, gehasht + scoped) en `errors.ts` (`AiWorkerBusyError`/
  `AiWorkerUnavailableError` → 503). De worker-endpoints staan in `routes/ai-worker.ts` (worker-initiated
  long-poll, `auth/worker.ts`). Zie [adr/0008](adr/0008-ai-provider-interface-and-orchestrator.md),
  [adr/0009](adr/0009-validation-layer-and-confidence-policy.md) en
  [adr/0010](adr/0010-distributed-ai-worker-queue.md).
- `server/src/conversation/decision.ts` — de **AI-beslissingslaag** (T5.2) die achter `/next` de
  gescripte vraagselectie vervangt: AAC-begrensde kandidaten uit de relatieboom → herhaling vermijden →
  orchestrator → validatielaag → confidence-gestuurde ordening/fase. Puur uit de opgeslagen stappen,
  zodat de terug-functie exact blijft en alles deterministisch met de mock te testen is.
- `server/src/conversation/generate.ts` — de **AI-boodschapgeneratie** (T5.3) achter `/generate` en
  `/confirm`: `composeMessage` laat de orchestrator een zin formuleren uit de bevestigde concepten en
  toetst die met een **safety-laag** tegen de AAC-bibliotheek — een zin met een concept **buiten de
  sessie** (§7.8) wordt verworpen ten gunste van de deterministische sjabloon-zin (`message.ts`), die per
  constructie binnen de gekozen concepten blijft. Zo bereikt een verzonnen/buiten-de-sessie begrip de
  gebruiker (en de db) nooit — ook niet bij een onbetrouwbare provider. De scan telt sinds T10.9 alleen
  **betekenisdragende** termen: functiewoorden (lidwoorden, voornaamwoorden, voorzetsels, hulp- en modale
  werkwoorden) komen in elke Nederlandse zin voor en bewijzen niets over een concept — "wil" is zinsbouw,
  geen smokkelroute voor `want`.
- `server/src/conversation/message.ts` — de **deterministische sjabloon-zin**: begint de route met een
  intentiecategorie, dan draagt die het zinsframe ("Ik wil …", "Ik voel me …") en verfijnt de rest;
  begint ze met een gewoon begrip — mogelijk sinds de AI ook op het startscherm een concept mag aandragen
  (T10.6) — dan geldt het neutrale **onderwerp-frame** en is elk gekozen concept inhoud (T10.9).
- `server/src/conversation/correction.ts` — de **correctie-heranalyse** (T5.4) achter `/correction`:
  `analyzeCorrection` kiest puur uit de opgeslagen stappen de vermoedelijke foutstap (laagste
  `ConversationStep.confidence`, §7.4) die wordt teruggerold. Het afgewezen concept wordt als
  `CorrectionEvent` vastgelegd en blijft de rest van de sessie uitgesloten (via `decideNextQuestion`'s
  `excludeConcepts`), zodat dezelfde foutieve route nooit terugkomt (§7.5). De flow gaat **niet** terug
  naar het begin en er wordt **niet** van geleerd (correctie-signaal, geen `Preference`-mutatie).
- `web/src/` — `main.tsx` (mount + interfacekeuze op de URL: `/tablet` → gebruikersapp,
  anders beheeromgeving), `App.tsx` (beheer: sessie-toestand + weergavekeuze),
  `TabletApp.tsx` (gebruikersapp op de tablet: koppelscherm + gespreksflow, T4.2), `api.ts`
  (injecteerbare, zod-validerende clients naar de backend: de beheer-`Api` en de losgekoppelde
  `DeviceApi` voor de tablet), beheercomponenten (`LoginForm`, `AdminUsersPage`, `SettingsForm`),
  `styles.css`.

## Interfaces in de web-app

De web-app bundelt de drie interfaces uit DESIGN §5.2, gescheiden op de URL en op
authenticatiepijler:

- **Gebruikersapp (tablet)** — `/tablet`, `TabletApp.tsx`, op **device-auth** (aparte cookie,
  T2.3). Kent via de `DeviceApi` alléén eigen-gebruiker-endpoints (`/device/me`, `/devices/link`,
  `/conversation/*`) — nooit beheer- of accountroutes. Rendert de gescripte gespreksflow (T4.1):
  startscherm + keuzeschermen, begrensd door het communicatieprofiel (`iconsPerScreen`, `showText`),
  met `↩ Terug` en een contextindicator die per gebruiker aan/uit kan (`contextIndicator`, T2.4). Bij
  een eindconcept volgt het **voorstelscherm** (T4.3): de gegenereerde zin + pictogramreeks met
  ✅ Ja / ❌ Nee — bevestigen slaat de boodschap op en rondt de sessie af, ❌ gaat terug naar de vraag.
- **Beheeromgeving** — overige paden, `App.tsx`, op **account-auth** (`/auth/*`, ADMIN/CAREGIVER).
- **Begeleiderinterface** — volgt in latere fases (vraag- en ondersteuningsmodus, fase 7).

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
  consistente structuur `{ error: { code, message } }` (DESIGN §8.1).
- **Autorisatie + tenant-isolatie** — beschermde routes hangen het
  `authorize(prisma, { roles })`-preHandler ervoor (401 zonder sessie, 403 bij verkeerde
  rol) en zetten `request.account`. Tenant-gebonden queries filteren op `organizationId`
  via `tenantScope(account)` / `assertSameTenant(...)` (`auth/tenant.ts`). Zie
  [adr/0005](adr/0005-authorization-tenant-isolation.md).
- **Prisma-client-singleton** (`db/prisma.ts`) — verbindt via een driver adapter
  (SQLite in dev/test) op basis van `DATABASE_URL`; wordt op `globalThis` bewaard zodat
  `tsx watch` niet telkens een nieuwe verbinding opent. Zie [data-model.md](data-model.md).
- **AI-Orchestrator** (`ai/`) — de tussenlaag tussen de gespreksflow en de LLM. Per aanroep stelt hij
  de **beperkte, verse context** samen (`buildAiPrompt`: systeemregels + doel + AAC-regels +
  gebruikerscontext + gesprekscontext + laatste keuze + toegestane opties — géén chatgeschiedenis) en
  **valideert de provider-uitvoer opnieuw** met zod. De provider zit achter de injecteerbare
  `AiProvider`-interface (mock in tests, self-hosted LLM later), net als de OpenSymbols-client. Zie
  [adr/0008](adr/0008-ai-provider-interface-and-orchestrator.md).
- **Kandidatenselectie** (`conversation/candidates.ts`, T10.2) — stelt per beurt samen waaruit de AI mag
  kiezen. Vóór Fase 10 was dat letterlijk `loadChildSymbols(laatste keuze)`: de kinderen van één knoop in
  de relatieboom, en dus de hele wereld die het model zag. Bij een smalle tak (`want` heeft er drie) had
  de AI geen enkele ruimte om te achterhalen wat de gebruiker bedoelt. Nu komt de set uit vier bronnen,
  ontdubbeld en begrensd op `AI_MAX_CANDIDATES`: **boomkinderen** → **kleinkinderen** (de concrete dingen
  achter een abstracte tak) → **retrieval** over de héle bibliotheek (op `searchText`, gevoed door de
  begeleidersvraag, de toegestane persoonlijke context en de labels van het gekozen pad) → **geleerde
  voorkeuren**. De boom blijft het sterkste signaal, maar is niet langer de grens. Zie
  [adr/0012](adr/0012-ai-generated-concepts.md).

- **Validatielaag + confidence** (`ai/validation.ts`, `ai/thresholds.ts`, `conversation/decision.ts`,
  T5.2, herzien in Fase 10) — de laag tussen provider en gebruiker (DESIGN §7.4–7.6, §7.8). De
  beslissingslaag sluit reeds gekozen/afgewezen concepten uit (herhaling vermijden) en geeft de
  afwijzingen **expliciet mee in de prompt** (T10.4), zodat "geen van deze past" een richtingverandering
  uitlokt in plaats van stil te verdwijnen. Elke voorgestelde optie gaat langs de bibliotheek: bestaand
  concept → houden; synoniem/label → omzetten; aantoonbaar nieuw → als `AI_ALLOW_NEW_CONCEPTS` aanstaat
  een symbool aanmaken met herkomst `ai` en status `PENDING` (inclusief pictogramzoekopdracht) plus een
  `ConceptProposal`, anders alleen het voorstel en weglaten (T10.6). De deduplicatie op trap 1/2 gaat
  altijd voor — zonder die volgorde loopt de bibliotheek vol met bijna-duplicaten.
  De **interpretatie-zekerheid** (§7.4) bepaalt de fase (`select` <60% / `refine` 60–85% / `propose` >85%
  of eindconcept) en wordt sinds T10.8 over beurten heen **gedempt** via de hypothese, zodat één
  zelfverzekerd modelantwoord geen boodschap forceert. Verder gelden: voorstellen mag pas ná een keuze van
  de **gebruiker** (het anker van de begeleider in vraagmodus telt niet mee, T9.14); het aanbod heeft een
  onder- én bovengrens (T9.10/T10.5) zodat er altijd genoeg te kiezen is én "Geen van deze past" niet in
  één klap alles uitsluit; en loopt een punt leeg, dan volgt eerst een **vrije ronde** (de AI mag zelf
  begrippen aandragen), daarna de intentiecategorieën, en pas als laatste een boodschapvoorstel. Zie
  [adr/0009](adr/0009-validation-layer-and-confidence-policy.md) en
  [adr/0012](adr/0012-ai-generated-concepts.md).

- **Vastgelegd vraagaanbod en hypothese** (`conversation/offer.ts`, `conversation/hypothesis.ts`, T10.3/
  T10.8) — de sessie bewaart het nog onbeantwoorde aanbod (`ConversationSession.pendingOffer`) en elke
  stap bewaart wat er bij die vraag is aangeboden (`ConversationStep.offeredConcepts`). Nodig omdat de
  beslissing sinds Fase 10 géén pure functie van de stappen meer is: `↩ Terug` herstelt daardoor exact
  wat de gebruiker zag, en een keuze wordt gevalideerd tegen wat er werkelijk is aangeboden in plaats van
  tegen de boom. De **hypothese** houdt per beurt bij wat de AI denkt dat de gebruiker bedoelt (concepten
  + gedempte zekerheid + geschiedenis); ze levert het kantelpunt voor de correctieflow en wordt bij
  `/confirm` gewist — een onzekere aanname is geen bewaarde communicatie (DESIGN §3.6).
- **Gespreksstrategieën** (`conversation/strategy.ts`, T11.2) — de benoemde manier waarop de AI
  probeert te achterhalen wat de gebruiker bedoelt (DESIGN §7.10). De knoppen die de aanpak bepalen —
  bronvolgorde (`candidates.ts`), aanbodgrootte (`decision.ts`), confidence-drempels (`ai/thresholds.ts`),
  demping (`hypothesis.ts`) en de promptfragmenten (`ai/prompt.ts`) — zijn geen verspreide constanten meer
  maar de **parameters van één strategie**, met een sleutel, een label en een uitleg voor de begeleider.
  Dat is geen opruimactie: die waarden coderen een aanname over de persoon, en die aanname hoort een
  keuze te zijn (DESIGN §5.3). De domeinregels vallen er hard buiten — eigenaarschap, deduplicatie,
  "afgewezen komt niet terug", de gesloten promptsleutelset en "nooit een leeg scherm" variëren niet mee
  en worden afgedwongen met één invariant-testsuite over álle geregistreerde strategieën. Strategieën
  zijn ingebouwd (code, stabiele sleutel), niet beheerd in de database; de **selectie** loopt gesprek →
  gebruiker → standaard en ligt vast voor de duur van het gesprek. De registry kent **`refine`** (stap
  voor stap verfijnen, de standaard), **`explore`** (concreet vóór abstract, groter aanbod, lagere
  voorsteldrempel), **`calm`** (klein aanbod, hoge drempel, sterke demping) en **`context-first`**
  (voorkeuren en persoonlijke context vóór de boom); de gekozen sleutel wordt bij het starten van een
  gesprek vastgelegd op de sessie (`ConversationSession.strategy`), zodat een instelling die halverwege
  wijzigt een lopend gesprek niet van aanpak laat wisselen; de actieve sleutel staat in de
  AI-beslissingslogregel en op de AI-job (`AiJob.strategy`, buiten de prompt om meegereisd via
  `AiCallMeta`) en het label in de meekijkweergave van de begeleider; `decision.ts` leest er de parameters uit, en de env-grenzen (`AI_MAX_CANDIDATES`,
  `AI_ALLOW_NEW_CONCEPTS`) blijven als **plafond** gelden — een strategie kan ze aanscherpen, nooit
  oprekken. Zie [adr/0013](adr/0013-conversation-strategies.md).
- **Gedistribueerde AI-wachtrij** (`ai/job-queue.ts`, `ai/queue-provider.ts`, `routes/ai-worker.ts`,
  T5.5) — bij `AI_PROVIDER=queue` zet de `QueueAiProvider` aanvragen op een DB-wachtrij (`AiJob`) i.p.v.
  ze in-process uit te voeren; externe workers (T5.6) claimen jobs via **worker-initiated** long-poll
  (robuust achter NAT) met een gehasht, scoped **worker-token**. **Backpressure**: boven
  `AI_WORKER_MAX_CONCURRENT_JOBS` → `WAITING_FOR_WORKER` + positie → 503 `AI_WORKER_BUSY` i.p.v.
  blokkeren. **Crash-herstel zonder timer**: een opportunistische sweep (bij enqueue/claim/poll) legt een
  verlopen lease terug (na `AI_WORKER_MAX_ATTEMPTS` → FAILED) en laat nooit-opgepakte jobs verlopen. De
  worker-uitvoer loopt door **dezelfde** orchestrator-zod-parse én validatielaag — een worker wordt nooit
  vertrouwd. Zie [adr/0010](adr/0010-distributed-ai-worker-queue.md).

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

## Gerelateerde documentatie

- Belangrijke keuzes met onderbouwing: [adr/](adr/)
- Datamodel: [data-model.md](data-model.md)
- Beveiliging: [security.md](security.md)
