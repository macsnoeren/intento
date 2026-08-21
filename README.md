# Intento

Intento is een AI-ondersteunde AAC-communicatieapplicatie voor mensen met een beperkt
communicatievermogen. De AI helpt de gebruiker zijn **intentie** te vinden via
pictogramkeuzes; de gebruiker blijft altijd eigenaar van de boodschap. Intento is
**geen chatbot**.

Zie [DESIGN.md](DESIGN.md) voor de volledige ontwerpbron en [TASKS.md](TASKS.md) voor
de gefaseerde takenlijst.

## Structuur (npm-workspaces-monorepo)

| Workspace | Inhoud |
|---|---|
| [`shared/`](shared/) | Gedeelde zod-schema's en types (bron van waarheid voor API-payloads, client én server). |
| [`server/`](server/) | Fastify 5-backend: `buildApp()`-factory, zod-gevalideerde env, health-endpoint, centrale foutafhandeling, security headers, Prisma-databaselaag. |
| [`web/`](web/) | React + Vite tablet-first webapp (gebruikersapp, begeleider- en beheeromgeving). Nu: beheeromgeving met login, **dashboard + AI-conceptvoorstellen** (T7.3), gebruikersbeheer (T2.1), begeleiderkoppeling (T2.2), tabletkoppeling (T2.3) en AAC-bibliotheekbeheer (T3.2, incl. OpenSymbols-koppeling T3.3); **gebruikersapp op de tablet** met de gespreksflow op `/tablet` (T4.2); **begeleiderinterface** met de vraagmodus (T7.1). |

Waarom een monorepo met deze indeling: zie [docs/adr/0002-monorepo-workspaces.md](docs/adr/0002-monorepo-workspaces.md).

Buiten de npm-workspaces staat [`ai-worker/`](ai-worker/): een **losstaande Python-applicatie** (T5.6) die
als externe Ollama-worker AI-jobs van de backend-wachtrij verwerkt. Het is bewust geen npm-workspace — het
is aparte deploybare infrastructuur met een eigen [README](ai-worker/README.md) en `.env`.

## Vereisten

- Node.js ≥ 22 (ontwikkeld op Node 24)
- Database: SQLite in dev/test (geen installatie nodig; Prisma beheert het bestand),
  PostgreSQL in productie. Zie [docs/adr/0003](docs/adr/0003-persistence-prisma-sqlite-postgres.md).

## Installeren

```bash
npm install                   # installeert deps en draait `prisma generate`
cp .env.example server/.env   # vul waarden in; secrets genereren voor productie
npm run db:migrate --workspace=server   # maakt de dev-database en past migraties toe
npm run db:seed    --workspace=server   # (optioneel) demo-data
```

## Draaien

```bash
npm run dev          # server (poort 3000) + web (poort 5173) tegelijk
npm run dev:server   # alleen de backend
npm run dev:web      # alleen de web-app
npm run build        # alle workspaces bouwen (shared → server → web)
```

Snel controleren of de server leeft:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","service":"intento-server","timestamp":"…"}
```

## Database

Prisma met SQLite (dev/test) en een PostgreSQL-compatibel schema. Schema:
[`server/prisma/schema.prisma`](server/prisma/schema.prisma). Draai vanuit de root met
`--workspace=server` (of vanuit `server/`):

```bash
npm run db:migrate --workspace=server          # nieuwe migratie maken + toepassen (dev)
npm run db:migrate:deploy --workspace=server   # bestaande migraties toepassen (ci/prod)
npm run db:seed --workspace=server             # seed-skelet draaien (idempotent)
npm run db:reset --workspace=server            # db leegmaken + opnieuw migreren + seeden
npm run db:studio --workspace=server           # Prisma Studio
```

Tests draaien tegen een aparte, per testrun verse testdatabase. Details:
[docs/data-model.md](docs/data-model.md).

## Auth (login)

Een nieuwe bezoeker kan zichzelf aanmelden (T1.3): `POST /auth/register` maakt in één
transactie een organisatie/familie + eerste `ADMIN`-account aan en logt meteen in. In de
web-app zit dit achter "Nieuwe omgeving aanmelden" op het loginscherm.

```bash
# Zelfaanmelding: organisatie + admin aanmaken en meteen ingelogd zijn.
curl -sc cookies.txt -X POST http://127.0.0.1:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"organizationName":"Familie De Vries","organizationType":"family","adminName":"Kim","email":"kim@intento.local","password":"sterk-wachtwoord-123"}'
```

Na registratie stuurt de server een **verificatiemail** (T1.4). Zonder `SMTP_URL` draait een
log-transport: de mail (met verificatielink) verschijnt in de serverlog i.p.v. echt verstuurd te
worden, zodat je lokaal zonder mailserver kunt verifiëren. Klik op de link (`.../verify-email?token=…`)
of wissel het token direct in via `POST /auth/verify-email`. Onbevestigde accounts mogen inloggen,
maar het aanmaken van gebruikers (`POST /users`) is geblokkeerd tot verificatie
(`403 EMAIL_NOT_VERIFIED`). Opnieuw versturen kan via `POST /auth/verify-email/resend` (neutraal,
rate-limited). Zie [docs/api.md](docs/api.md) en [docs/adr/0007](docs/adr/0007-email-verification-and-mail-transport.md).

Alternatief voor lokaal testen: `npm run db:seed` maakt een eerste `ADMIN`-account (meteen als
geverifieerd aangemaakt; herseeden verifieert een nog ongeverifieerde bootstrap-admin alsnog en laat het
wachtwoord ongemoeid). E-mail/wachtwoord komen uit `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
(default `admin@intento.local` / `change-me-admin` — buiten lokaal ontwikkelen overschrijven) en
seedt daarnaast de gedeelde AAC-bibliotheek (T3.1). Login zet een ondertekende httpOnly-sessie-cookie:

```bash
# Inloggen (cookie in cookies.txt bewaren) en het eigen account opvragen:
curl -sc cookies.txt -X POST http://127.0.0.1:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@intento.local","password":"change-me-admin"}'
curl -sb cookies.txt http://127.0.0.1:3000/auth/me
# ADMIN-only, gefilterd op de eigen organisatie (403 voor CAREGIVER/USER):
curl -sb cookies.txt http://127.0.0.1:3000/admin/accounts
curl -sb cookies.txt -X POST http://127.0.0.1:3000/auth/logout
```

Login is streng rate-limited en kent account-lockout na herhaald falen. Beschermde routes
lopen via het `authorize(...)`-preHandler (401 zonder sessie, 403 bij verkeerde rol) en
filteren tenant-data op `organizationId` (T1.2). Endpoints en foutcodes:
[docs/api.md](docs/api.md); afwegingen: [docs/adr/0004](docs/adr/0004-authentication-sessions.md),
[docs/adr/0005](docs/adr/0005-authorization-tenant-isolation.md).

## Gebruikersbeheer (beheeromgeving, T2.1)

Een beheerder beheert de communicerende gebruikers en hun communicatie-instellingen
(aantal opties 2/4/6/8, tekst tonen, AI-leren, ondersteuningsmodus — DESIGN §5.3). Via de
web-app: `npm run dev:web`, open <http://localhost:5173>, log in als admin en beheer
gebruikers (aanmaken, instellingen, verwijderen). De web-app praat met de backend op
`VITE_API_URL` (standaard `http://localhost:3000`).

```bash
# Gebruiker aanmaken (ADMIN), lijst, instellingen (alleen 2/4/6/8), verwijderen:
curl -sb cookies.txt -X POST http://127.0.0.1:3000/users \
  -H 'content-type: application/json' -d '{"name":"Sanne"}'
curl -sb cookies.txt http://127.0.0.1:3000/admin/users
curl -sb cookies.txt -X PUT http://127.0.0.1:3000/users/<id>/settings \
  -H 'content-type: application/json' \
  -d '{"iconsPerScreen":6,"showText":false,"aiLearningEnabled":false,"supportMode":true,"contextIndicator":true}'
curl -sb cookies.txt -X DELETE http://127.0.0.1:3000/users/<id>
```

Aanmaken/verwijderen is ADMIN; instellingen aanpassen mag ook een CAREGIVER, maar alléén voor
gebruikers waaraan hij gekoppeld is.

### Begeleiders koppelen (T2.2)

Een beheerder koppelt begeleiders (CAREGIVER-accounts) aan een gebruiker; die koppeling
bepaalt de toegang — een niet-gekoppelde begeleider krijgt `403` op de gebruiker-routes. In de
web-app verschijnt per geselecteerde gebruiker een paneel "Gekoppelde begeleiders" met een
schakelaar per begeleider.

```bash
# Begeleiders van een gebruiker bekijken (ADMIN) en koppelen/ontkoppelen:
curl -sb cookies.txt http://127.0.0.1:3000/admin/users/<id>/caregivers
curl -sb cookies.txt -X POST http://127.0.0.1:3000/admin/users/<id>/caregivers \
  -H 'content-type: application/json' -d '{"accountId":"<caregiver-account-id>","linked":true}'
```

### Tabletkoppeling (T2.3)

Een beheerder genereert een koppelcode voor een gebruiker; die code wisselt de tablet
eenmalig in voor een langlevend apparaat-token (cookie), waarna de tablet direct in de
gebruikersapp start zonder dagelijkse login. Codes verlopen en zijn eenmalig; code en token
staan alleen gehasht in de db. Het apparaat-token geeft alléén toegang tot de eigen gebruiker.
In de web-app verschijnt per geselecteerde gebruiker het paneel "Tablet koppelen".

```bash
# 1) Beheerder genereert een koppelcode (ADMIN):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/admin/users/<id>/device-code -d '{}'
# 2) Tablet wisselt de code in (geen login) → zet de intento_device-cookie:
curl -sc device.txt -X POST http://127.0.0.1:3000/devices/link \
  -H 'content-type: application/json' -d '{"code":"<koppelcode>"}'
# 3) Tablet haalt de eigen gebruiker op met het apparaat-token:
curl -sb device.txt http://127.0.0.1:3000/device/me
```

## AAC-bibliotheek (T3.1, T3.2, T3.3)

De AAC-bibliotheek is de gedeelde, beheerde pictogramwoordenschat die de AI begrenst (DESIGN §7.6).
`npm run db:seed` vult ze met een startset (~31 symbolen + relaties voor de voorbeeldflows uit
DESIGN §3). Zoeken kan met een ingelogd account **of** een gekoppeld apparaat en is
hoofdletterongevoelig op concept, label én synoniem. Een pictogram is óf een door een beheerder
geüploade/gekoppelde afbeelding óf een server-gerenderde SVG-placeholder uit de emoji-`glyph`.

Een **beheerder** onderhoudt de bibliotheek in de beheeromgeving (tab *AAC-bibliotheek*):
symbolen zoeken/filteren, toevoegen/bewerken/verwijderen, een pictogram uploaden (PNG/JPEG/WebP,
max `AAC_IMAGE_MAX_BYTES`) en begripsrelaties leggen (`POST /admin/aac/…`, ADMIN-only). De
bibliotheek is platformbreed gedeeld, dus dit is een rol-beperkte (niet tenant-gebonden) taak.

In plaats van zelf uploaden kan een beheerder ook een bestaand, vrij te gebruiken pictogram bij
[OpenSymbols](https://www.opensymbols.org/) opzoeken en koppelen (T3.3). De **backend** proxyt de
zoekactie en haalt de gekozen afbeelding **server-side** op (`https`-only + SSRF-guard + mime-/
groottecontrole), slaat 'm lokaal op en bewaart bron/licentie op het symbool. Zet
`OPENSYMBOLS_SECRET` (en eventueel `OPENSYMBOLS_API_URL`) in de env; zonder secret is de integratie
uit (endpoints antwoorden `503`). Zie [docs/adr/0006](docs/adr/0006-external-service-proxy-opensymbols.md).

```bash
# Zoeken op synoniem ("lopen" vindt concept "walking"); levert o.a. een imageUrl per symbool:
curl -sb cookies.txt "http://127.0.0.1:3000/aac/search?q=lopen"
# Het pictogram van een symbool ophalen (publiek; geüploade afbeelding of SVG-placeholder):
curl -s http://127.0.0.1:3000/aac/images/<symbol-id>
# Beheer: een symbool aanmaken (ADMIN):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/admin/aac/symbols \
  -H 'Content-Type: application/json' \
  -d '{"concept":"reading","label":"Lezen","category":"activity","glyph":"📖","synonyms":["boek lezen"]}'
# OpenSymbols zoeken (ADMIN; vereist OPENSYMBOLS_SECRET):
curl -sb cookies.txt "http://127.0.0.1:3000/admin/aac/opensymbols/search?q=dog"
```

## Gespreksflow op de tablet (T4.1 backend, T4.2 UI)

De **gebruikersapp op de tablet** is de derde interface (naast beheer- en begeleiderinterface) en
draait op de `/tablet`-URL: `npm run dev:web`, open <http://localhost:5173/tablet>. Ze werkt op het
apparaat-token uit de tabletkoppeling (hierboven) — geen dagelijkse login. Is het apparaat nog niet
gekoppeld, dan toont de app een koppelscherm dat een koppelcode inwisselt; daarna start ze direct in
de gespreksflow.

De flow zelf (DESIGN §3.1) draait op de **gescripte engine** (T4.1): een **startscherm** met de
intentievraag ("Wat wil je duidelijk maken?") en de categorieën, gevolgd door **keuzeschermen** met
telkens één vraag en grote pictogramopties. Het communicatieprofiel van de gebruiker stuurt de UI:
het aantal opties is begrensd tot `iconsPerScreen` (2/4/6/8) en tekstlabels verschijnen alleen bij
`showText`. Er is altijd een `↩ Terug`-knop (herstelt de vorige opties exact) en — als
`contextIndicator` in het profiel aanstaat (T2.4, per gebruiker) — een contextindicator die het
afgelegde pad toont. Het voorstellen en bevestigen van de uiteindelijke boodschap volgt in T4.3.

De backend-endpoints (apparaat-auth, elke sessie automatisch gebruiker-geïsoleerd):

```bash
# 1) Gesprek starten → eerste vraag (intentie-categorieën):
curl -sb device.txt -X POST http://127.0.0.1:3000/conversation/start
# 2) Keuze insturen → volgende vraag + opties (of done):
curl -sb device.txt -X POST http://127.0.0.1:3000/conversation/<sessie-id>/next \
  -H 'content-type: application/json' -d '{"symbolId":"<optie-id>"}'
# 3) Laatste keuze ongedaan maken → vorige vraag/opties exact hersteld:
curl -sb device.txt -X POST http://127.0.0.1:3000/conversation/<sessie-id>/back
# 4) Voorstel afwijzen (❌) → gerichte hervraag op de vermoedelijke foutstap (T5.4):
curl -sb device.txt -X POST http://127.0.0.1:3000/conversation/<sessie-id>/correction \
  -H 'content-type: application/json' -d '{"type":"wrong_guess"}'
```

Bij een correctie gaat de flow **niet** terug naar het begin: de server heranalyseert de route (laagste
per-stap-zekerheid), rolt de vermoedelijke foutstap terug, legt het afgewezen concept vast als
`CorrectionEvent` en biedt die route de rest van de sessie niet opnieuw aan (DESIGN §3.4, §7.5, FR-009).
Er wordt niets geleerd of opgeslagen.

## Vraagmodus — begeleider stelt een vraag (T7.1)

De **begeleiderinterface** (rol CAREGIVER; ook een ADMIN kan het) laat een begeleider een gekoppelde
gebruiker een vraag stellen ("Wat wil je drinken?"). De AI beperkt de antwoorden en de gebruiker stelt
zijn antwoord zelf samen en bevestigt — de begeleider bevestigt nooit namens de gebruiker (DESIGN §2,
§3.2, §3.3, FR-012). De begeleider kiest naast de vraag een **onderwerp** (AAC-topic, bv. "Drinken");
de kinderen daarvan (water/sap/koffie/melk) vormen de antwoordopties. De vraag verschijnt daarna in de
gebruikersapp op de tablet, die haar oppakt via `GET /conversation/pending` en de gewone gespreksflow
doorloopt.

```bash
# Begeleider (account-auth): gekoppelde gebruikers ophalen en een vraag stellen:
curl -sb cookies.txt "http://127.0.0.1:3000/question/users"
curl -sb cookies.txt -X POST http://127.0.0.1:3000/question/start \
  -H 'content-type: application/json' \
  -d '{"userId":"<gebruiker-id>","question":"Wat wil je drinken?","anchorConcept":"drink"}'
# Tablet (device-auth): de klaarstaande vraag oppakken:
curl -sb device.txt http://127.0.0.1:3000/conversation/pending
```

Alleen een aan de gebruiker **gekoppelde** begeleider (of een ADMIN in de eigen organisatie) mag een
vraag stellen; een niet-gekoppelde begeleider krijgt `403`. Het door de begeleider gekozen topic-anker
is de vaste eerste stap en kan door de gebruiker niet ongedaan worden gemaakt, zodat het gesprek binnen
de vraag blijft.

## AI-orchestrator, validatielaag en confidence (T5.1/T5.2)

De vraagselectie achter `POST /conversation/{id}/next` draait vanaf **T5.2** op de **AI-orchestrator**
(`server/src/ai/`), niet meer op de gescripte engine. Het fundament (T5.1): een provider-agnostische
**`AiProvider`**-interface, een **`AiOrchestrator`** die per aanroep de **beperkte, verse context**
samenstelt (systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze;
**geen** chatgeschiedenis) en de provider-uitvoer opnieuw valideert, en een **deterministische
mock-provider** voor dev en tests.

Daaromheen leggen T5.2's lagen de harde waarborgen uit DESIGN §7 op (`server/src/conversation/decision.ts`):
de **AAC-relatieboom** levert de begrensde kandidaten, **herhaling** wordt vermeden (reeds gekozen
concepten uitgesloten, terug blijft exact), de **validatielaag** (`ai/validation.ts`) houdt onbekende
concepten tegen (→ `ConceptProposal` voor de beheerder, T7.3) en de **interpretatie-zekerheid**
(`ai/thresholds.ts`, §7.4) bepaalt de fase `select`/`refine`/`propose`. Een verzonnen concept bereikt de
gebruiker **nooit**. De client praat nooit rechtstreeks met de AI (DESIGN §8.1); de AI-schema's staan
server-intern. Provider via `AI_PROVIDER` (`mock` standaard; `queue` voor gedistribueerde workers — zie
hieronder). Zie [docs/adr/0008](docs/adr/0008-ai-provider-interface-and-orchestrator.md),
[docs/adr/0009](docs/adr/0009-validation-layer-and-confidence-policy.md) en [docs/api.md](docs/api.md).

## Gedistribueerde AI-workers (T5.5)

Met **`AI_PROVIDER=queue`** zet de backend AI-aanvragen op een **DB-wachtrij** (`AiJob`) i.p.v. ze
in-process uit te voeren; externe workers (T5.6, bv. Ollama op een andere machine) halen jobs op via een
**worker-initiated** long-poll (robuust achter NAT) en leveren gestructureerde output terug. Diezelfde
orchestrator-validatie én AAC-validatielaag blijven gelden — een onbekend concept van een worker bereikt
de gebruiker nooit. Boven `AI_WORKER_MAX_CONCURRENT_JOBS` gelijktijdige jobs krijgt de client een
**`503 AI_WORKER_BUSY`** (met positie + `Retry-After`) i.p.v. te blokkeren; een gecrashte worker laat zijn
job na een lease-time-out automatisch teruglegggen.

De worker-endpoints (`/ai/worker/claim|heartbeat|result|fail`) vereisen een **worker-token** (apart
infrastructuur-credential, gehasht at-rest, scope `ai:process`, intrekbaar). Munt er een via de CLI:

```bash
npm run worker-token:create --workspace=server -- --name gpu-node-1 [--ttl-days 90]
```

…of via het tabblad **Worker-tokens** in de beheeromgeving (T5.8). Worker-tokens zijn platform-
infrastructuur, dus beheer is voorbehouden aan een **ADMIN van de platformorganisatie**
(`Organization.isPlatform` — de bootstrap-seed zet dit; een zelf-aangemelde organisatie krijgt het niet).

Het rauwe token wordt **één keer** getoond; zet het als `WORKER_TOKEN` in de
[standalone Ollama-worker](ai-worker/) (T5.6). Zie
[docs/adr/0010](docs/adr/0010-distributed-ai-worker-queue.md) en [docs/api.md](docs/api.md).

### Externe Ollama-worker (T5.6)

De [`ai-worker/`](ai-worker/)-applicatie (Python, stdlib-only) claimt jobs via het worker-protocol, draait
ze tegen een **Ollama**-endpoint (mogelijk op een andere machine) en levert gestructureerde output terug.
Een configureerbaar maximum (`MAX_THREADS`) begrenst de gelijktijdige Ollama-aanroepen zodat de site niet
wordt overvraagd. Opzet, draaien en testen: zie [ai-worker/README.md](ai-worker/README.md).

## Persoonlijke context en leren (T6.1–T6.3)

In de beheeromgeving (gebruikersdetail) legt een begeleider/beheerder **persoonlijke context** vast —
belangrijke personen, huisdieren, plekken, favorieten en routines (T6.1/T6.2, DESIGN §3.7 stap 3, §6.3).
Gevoelige velden staan **versleuteld at-rest** (AES-256-GCM, `ENCRYPTION_KEY`); per rij bepaalt een
opt-in-schakelaar of de AI die context mag zien (`aiUsageAllowed`). Alléén toegestane context bereikt de
beperkte AI-prompt.

Daarbovenop leert Intento **voorkeuren** (T6.3, DESIGN §3.8, FR-014): elke **bevestigde** boodschap
versterkt de gekozen concepten — maar alleen als *AI-leren* aanstaat voor die gebruiker, en nooit uit
afwijzingen/correcties. De voorkeuren reizen als extra context mee naar de AI. Wordt een concept vaak
gekozen (≥ 3×), dan verschijnt in het **Voorkeuren**-paneel een suggestie om het als vaste context toe te
voegen; de begeleider kan **accepteren, aanpassen of weigeren**.

```bash
# Voorkeuren van een gebruiker bekijken (ADMIN/gekoppelde CAREGIVER):
curl -sb cookies.txt http://127.0.0.1:3000/users/<id>/preferences
# Een openstaande suggestie overnemen als persoonlijke context:
curl -sb cookies.txt -X POST http://127.0.0.1:3000/users/<id>/preferences/<prefId>/suggestion \
  -H 'content-type: application/json' -d '{"action":"accept"}'
```

Zie [docs/api.md](docs/api.md) en [docs/data-model.md](docs/data-model.md).

## Profielexport en -import (T8.1)

Het communicatieprofiel is **eigendom van de gebruiker** en draagbaar (DESIGN §6.4, FR-019). Een beheerder
exporteert het profiel (instellingen + persoonlijke context + voorkeuren, **zonder** account-/organisatie-
gegevens) als **versleuteld** bestand en importeert het elders als nieuwe gebruiker. Het bestand is
onleesbaar zonder de omgevingssleutel (`ENCRYPTION_KEY`); import in een andere deployment vereist daarom
dezelfde sleutel. Beide acties zijn **ADMIN-only** en tenant-gebonden.

```bash
# Profiel exporteren (ADMIN) → { data, filename }; `data` is de versleutelde payload:
curl -sb cookies.txt http://127.0.0.1:3000/users/<id>/export > profiel.json
# Profiel importeren als nieuwe gebruiker (ADMIN + geverifieerd e-mailadres):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/users/import \
  -H 'content-type: application/json' \
  -d "{\"data\":\"$(jq -r .data profiel.json)\"}"
```

Zie [docs/api.md](docs/api.md) en [docs/security.md](docs/security.md).

## Audit-logging (T8.2)

Gevoelige acties laten een **onveranderlijk spoor** na (DESIGN §9.4): login (geslaagd én mislukt), logout,
registratie, e-mailverificatie, gebruikersbeheer + instellingen, begeleider-koppelingen, koppelcodes,
persoonlijke context, profielexport/-import, worker-tokens en conceptvoorstellen. Het spoor bevat **geen
communicatie-inhoud of vrije-tekst-PII** — alleen wie-wat-wanneer. Inzage via `GET /admin/audit-logs`
(ADMIN, tenant-gefilterd op de eigen organisatie) en de beheerpagina **Audit-log**. Zie
[docs/api.md](docs/api.md) en [docs/security.md](docs/security.md).

## MVP — Definition of Done (DESIGN §10.3)

Alle zes MVP-criteria zijn afgevinkt met bewijs in code + tests:

| Criterium | Bewijs |
|---|---|
| ✅ Gebruiker maakt zelfstandig een boodschap | Gescripte + AI-gestuurde gespreksflow (T4.1–T4.3, T5.1–T5.3); `conversation*.test.ts`, tablet-UI `TabletApp.tsx`. |
| ✅ AI stelt passende pictogramkeuzes voor | AI-orchestrator + validatielaag + confidence-drempels (T5.1/T5.2); `ai/*.test.ts` — onbekend concept bereikt de gebruiker nooit. |
| ✅ Gebruiker corrigeert fouten | Correctieflow (T5.4); `conversation-correction.test.ts` — gerichte hervraag, afgewezen route niet herhaald. |
| ✅ Begeleider ondersteunt | Vraagmodus + ondersteuningsmodus (T7.1/T7.2); server dwingt af dat bevestigen nooit vanuit een begeleiderssessie kan (`question.test.ts`, `/confirm` → 403). |
| ✅ Persoonlijke context wordt gebruikt | Versleutelde context + AI-inputfilter (T6.1/T6.2); alleen `aiUsageAllowed=true` in de prompt (`personal-context.test.ts`). |
| ✅ Gegevens veilig opgeslagen | argon2id + gehashte tokens, AES-256-GCM voor gevoelige velden, multi-tenant-isolatie, audit-logging (T8.2), `/security-review` zonder open bevindingen. |

## Kwaliteit (moet groen zijn — zie Definition of Done in CLAUDE.md)

```bash
npm run typecheck    # tsc --noEmit in elke workspace
npm run lint         # ESLint (flat config, type-aware)
npm test             # vitest in server en web
npm audit            # 0 kwetsbaarheden
npm run format       # Prettier schrijven (format:check om te controleren)
```

## Documentatie

- Architectuur: [docs/architecture.md](docs/architecture.md)
- API: [docs/api.md](docs/api.md)
- Datamodel: [docs/data-model.md](docs/data-model.md)
- Beveiliging: [docs/security.md](docs/security.md)
- Beslissingen (ADR): [docs/adr/](docs/adr/)
- Wijzigingen: [CHANGELOG.md](CHANGELOG.md)
