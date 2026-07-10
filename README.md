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
| [`web/`](web/) | React + Vite tablet-first webapp (gebruikersapp, begeleider- en beheeromgeving). Nu: beheeromgeving met login, gebruikersbeheer (T2.1), begeleiderkoppeling (T2.2), tabletkoppeling (T2.3) en AAC-bibliotheekbeheer (T3.2, incl. OpenSymbols-koppeling T3.3); **gebruikersapp op de tablet** met de gespreksflow op `/tablet` (T4.2). |

Waarom een monorepo met deze indeling: zie [docs/adr/0002-monorepo-workspaces.md](docs/adr/0002-monorepo-workspaces.md).

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
geverifieerd aangemaakt). E-mail/wachtwoord komen uit `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
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
```

## AI-fundament (T5.1)

De AI-fase begint met het **fundament** onder de vraagselectie (`server/src/ai/`), nog **zonder** de
gescripte engine te vervangen (dat is T5.2, achter dezelfde `/conversation/{id}/next`). Het bestaat uit
een provider-agnostische **`AiProvider`**-interface, een **`AiOrchestrator`** die per aanroep de
**beperkte, verse context** samenstelt (systeemregels + doel + AAC-regels + gebruikerscontext +
gesprekscontext + laatste keuze; **geen** chatgeschiedenis) en de provider-uitvoer opnieuw valideert, en
een **deterministische mock-provider** voor dev en tests. De client praat nooit rechtstreeks met de AI
(DESIGN §8.1); de AI-schema's staan server-intern. Provider via `AI_PROVIDER` (`mock` standaard; `ollama`
volgt in T5.5/T5.6). Zie [docs/adr/0008](docs/adr/0008-ai-provider-interface-and-orchestrator.md) en
[docs/api.md](docs/api.md).

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
