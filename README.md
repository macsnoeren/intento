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
| [`web/`](web/) | React + Vite tablet-first webapp (gebruikersapp, begeleider- en beheeromgeving). Nu: beheeromgeving met login, **dashboard + AI-conceptvoorstellen** (T7.3), gebruikersbeheer (T2.1), begeleider-accounts (T2.4) en -koppeling (T2.2), eigen wachtwoord wijzigen (T2.5), accountlijst met tijdelijk-wachtwoord-markering (T2.6) en het uitgeven van een nieuw tijdelijk wachtwoord (T2.7), tabletkoppeling (T2.3) en AAC-bibliotheekbeheer (T3.2, incl. OpenSymbols-koppeling T3.3); **gebruikersapp op de tablet** met de gespreksflow op `/tablet` (T4.2); **begeleiderinterface** met de vraagmodus (T7.1); **platform-operatorconsole** op `/operator` (T8.3). |

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

Met een echte mailserver moeten schema en poort in `SMTP_URL` bij elkaar passen:
`smtp://…:587` voor STARTTLS, `smtps://…:465` voor TLS vanaf de eerste byte. De combinatie
`smtps://` met een STARTTLS-poort geeft de misleidende fout `wrong version number`. TLS is in
beide gevallen verplicht (`requireTLS`): lukt de STARTTLS-upgrade niet, dan faalt de verzending
in plaats van in platte tekst door te gaan.

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

### Begeleider-accounts aanmaken (T2.4)

Begeleiders hebben een eigen login (rol CAREGIVER). Een beheerder maakt die aan in de
beheeromgeving (paneel "Begeleider aanmaken", naast de gebruikerslijst): naam + e-mailadres,
waarna de **server** het account maakt en een **tijdelijk wachtwoord** genereert. Dat wachtwoord
wordt één keer getoond — daarna staat alleen de argon2id-hash in de db — en geef je via een veilig
kanaal door. Rol en organisatie komen altijd van de server: een meegestuurde `role` of
`organizationId` wordt genegeerd. Het nieuwe account verschijnt meteen in "Gekoppelde begeleiders"
(hieronder) en moet daar aan een gebruiker gekoppeld worden voordat de begeleider iets ziet.

```bash
# Begeleider-account aanmaken (ADMIN, e-mail geverifieerd):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/admin/accounts \
  -H 'content-type: application/json' -d '{"name":"Sam","email":"sam@intento.local"}'
# → 201 {"account":{…,"role":"CAREGIVER"},"temporaryPassword":"…"}  (wachtwoord: één keer zichtbaar)
```

Een reeds bestaand e-mailadres geeft bewust een neutrale `409` (geen account-enumeratie). Het
account start ongeverifieerd; er gaat best-effort een verificatiemail uit. De begeleider vervangt
het tijdelijke wachtwoord daarna zelf (hieronder) — en moet dat ook: zolang hij dat niet doet, komt
hij nergens (zie "Tijdelijk wachtwoord" hieronder).

### Eigen wachtwoord wijzigen (T2.5)

Elk ingelogd account wisselt zijn **eigen** wachtwoord via het paneel "Wachtwoord wijzigen": voor een
beheerder onder de tab **Mijn account**, voor een begeleider onderaan de vraagmodus. Vooral bedoeld
voor de begeleider die met het tijdelijke wachtwoord uit T2.4 binnenkomt — dat kent zijn beheerder
immers ook.

```bash
# Eigen wachtwoord wijzigen (elke rol, met sessie-cookie):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/auth/password \
  -H 'content-type: application/json' \
  -d '{"currentPassword":"tijdelijk-wachtwoord","newPassword":"mijn eigen wachtwoord"}'
# → 200 {"revokedSessions":2}   (aantal ándere sessies dat is uitgelogd)
```

Het huidige wachtwoord moet mee (her-authenticatie), het nieuwe moet ≥ 12 tekens zijn en anders dan
het huidige, en na een geslaagde wijziging worden **alle overige sessies van dat account
ingetrokken** — je blijft alleen ingelogd op het apparaat waar je het wijzigde. Er is geen manier om
via deze route het wachtwoord van iemand anders te zetten: het account komt uit de sessie. Een fout
huidig wachtwoord geeft `401 INVALID_CURRENT_PASSWORD`; de route is apart rate-limited.

### Tijdelijk wachtwoord: markering en gate (T2.6)

Een account dat is aangemaakt met een server-gegenereerd wachtwoord (T2.4) draagt de markering
`mustChangePassword`. Zolang die staat, kent **twee** mensen dat wachtwoord — de houder en de
beheerder die het aanmaakte — en laat de server alleen `GET /auth/me` en `POST /auth/password` toe;
al het overige geeft `403 PASSWORD_CHANGE_REQUIRED`. De web-app toont zo'n account daarom één
blokkerend scherm ("Kies eerst een eigen wachtwoord"); zodra het wachtwoord gewisseld is, valt de
markering weg en gaat de app zonder opnieuw inloggen door naar de gewone weergave.

De beheerder ziet in het paneel **"Logins"** (naast de gebruikerslijst) welke accounts nog op hun
tijdelijke wachtwoord zitten, zodat hij weet wie hij eraan moet herinneren. Zelf een wachtwoord
intypen voor iemand anders kan hij nergens; wat hij wél kan, is een **nieuw** tijdelijk wachtwoord
laten uitgeven (T2.7, hieronder).

```bash
# Logins van de eigen organisatie (ADMIN):
curl -sb cookies.txt http://127.0.0.1:3000/admin/accounts
# → 200 {"accounts":[{…,"emailVerified":true,"mustChangePassword":false}, …]}
```

Deze gate is strenger dan die van de e-mailverificatie (T1.4, waar alleen gevoelige acties dicht
staan): een onbevestigd adres is een *onbewezen* adres, een tijdelijk wachtwoord is een *levend,
gedeeld* wachtwoord. Accounts die vóór deze versie zijn aangemaakt, zijn niet met terugwerkende
kracht gemarkeerd — dat valt niet meer vast te stellen zonder werkende begeleiders buiten te sluiten.

### Nieuw tijdelijk wachtwoord uitgeven (T2.7)

Raakt iemand zijn tijdelijke wachtwoord kwijt — of strandt hij op de account-lockout — dan zit hij
klem: inloggen lukt niet, en zonder sessie is `POST /auth/password` onbereikbaar. Een beheerder geeft
daarom in het paneel **"Logins"** een **nieuw** tijdelijk wachtwoord uit (knop per login; het eigen
account heeft er bewust geen). De **server** genereert dat wachtwoord — een beheerder kiest nooit het
wachtwoord van een ander — en het account wordt meteen weer als "tijdelijk wachtwoord" gemarkeerd, dus
de houder kiest bij zijn eerstvolgende login zelf een wachtwoord. Alle lopende sessies van dat account
worden ingetrokken.

```bash
# Nieuw tijdelijk wachtwoord voor een login in de eigen organisatie (ADMIN, geen body):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/admin/accounts/<accountId>/password
# → 200 {"account":{…,"mustChangePassword":true},"temporaryPassword":"…","revokedSessions":2}
# Het eigen account → 403 CANNOT_RESET_OWN_PASSWORD; een ander (of onbekend) account buiten je
# organisatie → 403 FORBIDDEN.
```

Bewust géén publieke "wachtwoord vergeten"-flow per e-mail: Intento moet zonder mailserver bruikbaar
blijven en een tweede, publiek bereikbare weg naar een account vergroot het aanvalsoppervlak. Zie
[docs/security.md](docs/security.md) en [docs/api.md](docs/api.md).

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

> **Effecten en `<StrictMode>` (T8.5).** De app draait in dev onder `<StrictMode>` (`main.tsx`), dat
> elk component bewust dubbel mount (mount → unmount → remount) om onveilige effecten zichtbaar te
> maken. Een "ben ik nog gemount?"-vlag moet daarom in de **effectbody** weer op `true` — zet je hem
> alleen bij de declaratie, dan blijft hij na de gesimuleerde unmount `false` en worden alle latere
> `setState`-aanroepen stil overgeslagen (het scherm bleef zo hangen op "Laden…"). Gebruik bij
> voorkeur het `let active = true`-patroon binnen het effect zelf; een ref alleen wanneer de guard
> gedeeld wordt met event-handlers, zoals in `ConversationScreen`. Let op: tests die zonder
> StrictMode renderen zien dit soort fouten niet — `TabletApp.test.tsx` heeft er daarom expliciet
> twee die dat wél doen.

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

Bij een correctie gaat de flow **niet** terug naar het begin: de server rolt precies één stap terug (de
laatste keuze), legt het afgewezen concept vast als
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

Daaromheen leggen de lagen in `server/src/conversation/` de harde waarborgen uit DESIGN §7 op.
**Kandidatenselectie** (`candidates.ts`): de opties komen uit boomkinderen + kleinkinderen + retrieval over
de héle bibliotheek + geleerde voorkeuren, begrensd op `AI_MAX_CANDIDATES`. **Herhaling** wordt vermeden
(gekozen én afgewezen concepten uitgesloten, terug blijft exact) en de afwijzingen reizen **mee in de
prompt**, zodat de AI van richting kan veranderen. De **validatielaag** (`ai/validation.ts`) dedupliceert
elk voorgesteld begrip tegen concept/label/synoniem en maakt een écht nieuw begrip aan als gemarkeerd
nieuw woord (`AI_ALLOW_NEW_CONCEPTS`, → `ConceptProposal` + beheerlijst). De **interpretatie-zekerheid**
(`ai/thresholds.ts`, §7.4) bepaalt de fase `select`/`refine`/`propose` en wordt over beurten heen gedempt
via de **hypothese** (`hypothesis.ts`). De client praat nooit rechtstreeks met de AI (DESIGN §8.1); de
AI-schema's staan server-intern. Provider via `AI_PROVIDER` (`mock` standaard; `queue` voor
gedistribueerde workers — zie hieronder). Zie
[docs/adr/0008](docs/adr/0008-ai-provider-interface-and-orchestrator.md),
[docs/adr/0009](docs/adr/0009-validation-layer-and-confidence-policy.md),
[docs/adr/0012](docs/adr/0012-ai-generated-concepts.md) en [docs/api.md](docs/api.md).

> **De AI stuurt het gesprek (Fase 10).** Tot dan was de kandidatenset letterlijk de kinderen van één
> knoop in de begrippenboom: bij een smalle tak (`want` heeft er drie) had de AI geen ruimte om te
> achterhalen wat de gebruiker bedoelt, en "geen van deze past" zette hem terug op het startscherm. Nu
> put de AI uit de héle bibliotheek, weet ze wát er is afgewezen, en mag ze — als het woord er echt niet
> in staat — zélf een begrip aandragen: dat wordt meteen een bruikbaar pictogram met een ✨-markering, en
> komt in het beheer terecht onder **Nieuwe woorden**. Een boodschap wordt pas voorgesteld als de
> **gebruiker** zelf iets koos (in vraagmodus telt het anker van de begeleider niet mee, T9.14). Loopt een
> punt leeg, dan volgt eerst een vrije ronde, dan de intentiecategorieën, en pas dán een voorstel.

> **De gebruiker houdt de regie (T10.10/T10.11).** Een boodschap wordt pas voorgesteld als er ook niets
> meer te verfijnen valt — zeker weten *dát* iemand wil eten is niet hetzelfde als weten *wát*. Wil de
> gebruiker tóch hier stoppen, dan doet hij dat zelf met **"✅ Dit is genoeg"**; en ❌ Nee rolt precies
> één stap terug in plaats van zijn hele route weg te gooien.

> **Welke aanpak draait er? (Fase 11)** De knoppen die bepalen *hoe* de AI zoekt — bronvolgorde,
> aanbodgrootte, drempels, demping en de promptformulering — zijn gebundeld tot één benoemde
> **gespreksstrategie** (`conversation/strategy.ts`, DESIGN §7.10). De bestaande aanpak heet `refine`
> ("Stap voor stap verfijnen") en is de standaard. Die knoppen zijn niet neutraal: ze veronderstellen
> iemand die categorieën begrijpt en stapsgewijs verfijnt, en dat past niet bij iedereen. Wat een
> strategie **nooit** verandert zijn de garanties — eigenaarschap, deduplicatie, "afgewezen komt niet
> terug", de gesloten promptsleutelset en "nooit een leeg scherm"; die worden afgedwongen door één
> invariant-testsuite die over álle geregistreerde strategieën draait. Zie
> [docs/adr/0013](docs/adr/0013-conversation-strategies.md).

> **Draait er echt een AI? (T9.4/T9.8)** Met de standaard `AI_PROVIDER=mock` denkt er **geen** AI mee: de
> mock-provider kiest de bibliotheekvolgorde. Dat is aan de flow niet te zien, dus de server logt bij het
> opstarten welke modus draait (met een waarschuwing bij `mock`) en zowel de tablet als de beheeromgeving
> tonen een statuslampje uit `GET /ai/status` — "AI denkt mee", "Geen AI-worker actief" of "Zonder AI".
> Voor echte AI: `AI_PROVIDER=queue` **en** een draaiende [AI-worker](ai-worker/README.md). Wat de AI
> per aanvraag deed (vraag, aangedragen concepten, motivering, duur) staat in het beheer onder
> **AI-activiteit** (`GET /admin/ai/jobs`, platformbeheer) en in de serverlog (T9.15).

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
registratie, e-mailverificatie, wachtwoordwijziging, begeleider-accounts, gebruikersbeheer + instellingen, begeleider-koppelingen, koppelcodes,
persoonlijke context, profielexport/-import, worker-tokens, conceptvoorstellen en platform-operatoracties (T8.3). Het spoor bevat **geen
communicatie-inhoud of vrije-tekst-PII** — alleen wie-wat-wanneer. Inzage via `GET /admin/audit-logs`
(ADMIN, tenant-gefilterd op de eigen organisatie) en de beheerpagina **Audit-log**. Zie
[docs/api.md](docs/api.md) en [docs/security.md](docs/security.md).

## Platform-operatorconsole (T8.3)

Intento is strikt multi-tenant: elke ADMIN zit vast in zijn **eigen** organisatie. Daardoor was er tot nu toe
niemand die het platform zelf kon beheren — een omgeving aanmaken kon alleen via zelfaanmelding, en een
**misbruikte omgeving stoppen** kon helemaal niet. De operatorconsole vult dat gat, en is het enige deel van
Intento dat bewust over de tenant-grens heen kijkt (zie [ADR-0011](docs/adr/0011-platform-operator-console.md)).

Toegang vereist **twee** onafhankelijke voorwaarden: `Account.isOperator` én een organisatie met
`isPlatform=true`. De bootstrap-seed-admin krijgt beide; er is **geen API** om iemand tot operator te maken, dus
een organisatiebeheerder kan zichzelf niet promoveren. De routetak `/operator/*` hangt achter een **eigen**
guard (`operatorAuthorize`, niet `authorize()`) die `request.operator` zet en `request.account` leeg laat — de
tenant-helpers falen daar dus hard in plaats van stilletjes op de organisatie van de operator te filteren. Elk
ander account krijgt op elk operator-endpoint `403 NOT_OPERATOR`.

Wat de console toont is **beheermetadata**: welke omgevingen er zijn, hoe groot ze zijn, of ze actief zijn, en
welke logins erin zitten. Geen boodschappen, geen gesprekken, geen persoonlijke context — en zelfs geen namen
van gebruikers. Er is bewust geen "inloggen als", geen wachtwoord-reset in andermans omgeving en geen
eerste-admin bij een nieuwe omgeving: elk daarvan zou een operator stilzwijgend toegang tot communicatie geven.

**Deactiveren** (`Organization.active=false`) is geen verwijdering maar wel een onmiddellijke stop: login,
bestaande accountsessies én gekoppelde tablets worden geweigerd met `403 ORGANIZATION_SUSPENDED`. De gegevens
blijven staan; hervatten is één klik. De platformorganisatie zelf is beschermd, zodat een operator zichzelf niet
buitensluit. Elke actie wordt geaudit met de operator als actor.

De console draait op de aparte URL **`/operator`** (`npm run dev:web`, open <http://localhost:5173/operator>) —
niet als tab in het gewone beheer; een operator vindt 'm via één link op "Mijn account".

```bash
# Inloggen als de bootstrap-admin (die is ook operator) en de omgevingen bekijken:
curl -sc cookies.txt -X POST http://127.0.0.1:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@intento.local","password":"change-me-admin"}'
curl -sb cookies.txt http://127.0.0.1:3000/operator/organizations
# Een omgeving neerzetten (zonder accounts — de beheerder meldt zich zelf aan):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/operator/organizations \
  -H 'content-type: application/json' -d '{"name":"Zorggroep Noord","type":"care"}'
# Een misbruikte omgeving stoppen (en later weer hervatten):
curl -sb cookies.txt -X POST http://127.0.0.1:3000/operator/organizations/<id>/deactivate -d '{}'
curl -sb cookies.txt -X POST http://127.0.0.1:3000/operator/organizations/<id>/activate -d '{}'
```

Zie [docs/api.md](docs/api.md) en [docs/security.md](docs/security.md).

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
npm run format:check # Prettier-opmaak controleren (npm run format schrijft de fixes)
```

### Opmaak wordt afgedwongen

`format:check` hoorde lang niet bij de Definition of Done en niets dwong het af, waardoor de
opmaak stilletjes afdreef tot 34 bestanden rood stonden. Sinds T8.6 staat het in de Definition
of Done én bewaakt een **pre-commit hook** het:

- De hook staat in [.githooks/pre-commit](.githooks/pre-commit) en draait Prettier alleen over de
  *staged* bestanden, dus hij kost nauwelijks tijd.
- `npm install` installeert hem via het `prepare`-script (`git config core.hooksPath .githooks`);
  handmatig kan dat met `npm run prepare`. Overslaan in een noodgeval: `git commit --no-verify`.
- Regeleindes liggen dubbel vast — [.gitattributes](.gitattributes) (`* text=auto eol=lf`) en
  `endOfLine: "lf"` in `.prettierrc.json` — zodat een checkout of editor op Windows geen CRLF
  terugbrengt. Dat was eerder de reden dat vier bestanden volledig als "verkeerd opgemaakt"
  golden. Aangeleverd naslagmateriaal (`INTENTO-DESIGN/`, `PROJECT-NODEJS/`, `LICENSE`) is
  bewust uitgezonderd: dat onderhouden we niet zelf en Prettier negeert het al.

## Documentatie

- Architectuur: [docs/architecture.md](docs/architecture.md)
- API: [docs/api.md](docs/api.md)
- Datamodel: [docs/data-model.md](docs/data-model.md)
- Beveiliging: [docs/security.md](docs/security.md)
- Beslissingen (ADR): [docs/adr/](docs/adr/)
- Wijzigingen: [CHANGELOG.md](CHANGELOG.md)
