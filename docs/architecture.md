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
  Zie [adr/0008](adr/0008-ai-provider-interface-and-orchestrator.md) en
  [adr/0009](adr/0009-validation-layer-and-confidence-policy.md).
- `server/src/conversation/decision.ts` — de **AI-beslissingslaag** (T5.2) die achter `/next` de
  gescripte vraagselectie vervangt: AAC-begrensde kandidaten uit de relatieboom → herhaling vermijden →
  orchestrator → validatielaag → confidence-gestuurde ordening/fase. Puur uit de opgeslagen stappen,
  zodat de terug-functie exact blijft en alles deterministisch met de mock te testen is.
- `server/src/conversation/generate.ts` — de **AI-boodschapgeneratie** (T5.3) achter `/generate` en
  `/confirm`: `composeMessage` laat de orchestrator een zin formuleren uit de bevestigde concepten en
  toetst die met een **safety-laag** tegen de AAC-bibliotheek — een zin met een concept **buiten de
  sessie** (§7.8) wordt verworpen ten gunste van de deterministische sjabloon-zin (`message.ts`), die per
  constructie binnen de gekozen concepten blijft. Zo bereikt een verzonnen/buiten-de-sessie begrip de
  gebruiker (en de db) nooit — ook niet bij een onbetrouwbare provider.
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
- **Validatielaag + confidence** (`ai/validation.ts`, `ai/thresholds.ts`, `conversation/decision.ts`,
  T5.2) — het harde vangnet achter de provider (DESIGN §7.4–7.6, §7.8). De beslissingslaag laadt de
  AAC-begrensde kandidaten uit de relatieboom, sluit reeds gekozen/afgewezen concepten uit (herhaling
  vermijden), laat de orchestrator kiezen/ordenen, en toetst **elke** voorgestelde optie tegen de
  bibliotheek: bestaand concept → houden; synoniem/label → omzetten; anders → `ConceptProposal` +
  weglaten. Een onbekend/verzonnen concept bereikt de gebruiker dus **nooit** — ook niet van een
  onbetrouwbare provider of latere externe worker. De **interpretatie-zekerheid** (§7.4) bepaalt de fase
  (`select` <60% / `refine` 60–85% / `propose` >85% of eindconcept). Zie
  [adr/0009](adr/0009-validation-layer-and-confidence-policy.md).

## Gerelateerde documentatie

- Belangrijke keuzes met onderbouwing: [adr/](adr/)
- Datamodel: [data-model.md](data-model.md)
- Beveiliging: [security.md](security.md)
