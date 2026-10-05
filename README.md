# Intento

Intento is een AI-ondersteunde AAC-communicatieapplicatie voor mensen die moeite hebben met
spreken. De gebruiker communiceert met pictogrammen; een **agentic AI-architectuur** —
gespecialiseerde agents onder regie van één orchestrator — helpt hem stap voor stap duidelijk te
maken wat hij bedoelt. De gebruiker blijft altijd eigenaar van de boodschap. Intento is **geen
chatbot**.

Zie [INTENTO-NEW-DESIGN.md](INTENTO-NEW-DESIGN.md) voor de ontwerpbron en
[TASKS-NEW_DESIGN.md](TASKS-NEW_DESIGN.md) voor de gefaseerde takenlijst.

> **Herbouw.** De gespreks- en AI-laag wordt herbouwd volgens het nieuwe ontwerp, zonder backward
> compatibiliteit (ontwerp §55, [ADR-0017](docs/adr/0017-agentic-architectuur.md)). Rollen,
> accounts, organisaties, tablet koppelen, spraak en Docker blijven; de oude gespreksflow, de
> AI-worker en de AI-instellingen verdwijnen. Delen van deze README beschrijven nog de oude
> situatie en worden per taak bijgewerkt.

## Structuur (npm-workspaces-monorepo)

| Workspace | Inhoud |
|---|---|
| [`shared/`](shared/) | Gedeelde zod-schema's en types (bron van waarheid voor API-payloads, client én server). |
| [`server/`](server/) | Fastify 5-backend: `buildApp()`-factory, zod-gevalideerde env, health-endpoint, centrale foutafhandeling, security headers, Prisma-databaselaag. |
| [`web/`](web/) | React + Vite tablet-first webapp (gebruikersapp, begeleider- en beheeromgeving). Nu: beheeromgeving met login, dashboard, gebruikersbeheer, begeleider-accounts en -koppeling, wachtwoordbeheer, tabletkoppeling, audit-log; **gebruikersapp op de tablet** op `/tablet` (gespreksflow in herbouw); **platform-operatorconsole** op `/operator`. Sinds T17.1 in één huisstijl, met een menu in de zijbalk in plaats van een rij tabs; de logobestanden staan in [`web/brand/`](web/brand/README.md). |

Waarom een monorepo met deze indeling: zie [docs/adr/0002-monorepo-workspaces.md](docs/adr/0002-monorepo-workspaces.md).

Buiten de npm-workspaces staat [`agent-service/`](agent-service/README.md): de **Python-agentdienst**
met de orchestrator en de agents (ADR-0017). Alleen de backend roept hem aan, met een gedeeld geheim; hij
is stateless en bewaart niets. Opzet, draaien en testen: zie de README van de dienst.

Buiten de npm-workspaces staat ook [`speech-service/`](speech-service/README.md): een **losstaande
Python-dienst** (T18.1) die met [Piper](https://github.com/OHF-Voice/piper1-gpl) tekst in spraak omzet,
lokaal en zonder cloud. De tablet leest daarmee voor wat er op zijn scherm staat; de backend praat namens
hem met die dienst. Zonder dienst blijft alles werken — de tablet valt dan terug op de stem van het
apparaat zelf. Zie [docs/adr/0015](docs/adr/0015-speech-synthesis-piper.md).

Aanzetten kost drie regels in `server/.env` (`SPEECH_PROVIDER=http`, `SPEECH_SERVICE_URL` en
`SPEECH_SERVICE_TOKEN`) plus een draaiende dienst met minstens de standaardstem. Dat
**`SPEECH_SERVICE_TOKEN`** is geen sleutel die je ergens ophaalt: het is een zelfverzonnen gedeeld
geheim tussen die twee processen, dat exact gelijk moet zijn aan `SERVICE_TOKEN` in
`speech-service/.env`. Genereer er een met
`python -c "import secrets; print('spr_' + secrets.token_hex(24))"`. De volledige opzet — stemmen
ophalen, het geheim, en wat te doen als beluisteren niet lukt — staat in
[`speech-service/README.md`](speech-service/README.md).

Wijzigt een begeleider de stem (of een andere instelling) terwijl de tablet openstaat, dan pakt de tablet
dat op zodra hij weer op de voorgrond komt.

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

Alles weer stoppen:

```bash
npm run stop         # backend, web-app, spraakdienst en AI-worker
```

Dat stopt precies de processen van dit project — herkenbaar aan hun commando **én** aan het feit dat ze
in deze repo draaien — en laat de rest met rust: je editor, je terminals, en **Ollama** (poort 11434),
dat een losse dienst is die je meestal juist wilt laten staan. Handig omdat een `tsx watch` of `vite`
die zijn poort al kwijt is anders stilletjes blijft hangen. Gebruik het liever dan `pkill -f intento`:
dat patroon staat ook in je eigen commandoregel, dus daarmee sluit je je eigen shell af. Het script
staat in [`scripts/stop.sh`](scripts/stop.sh); een dienst toevoegen is één regel in `TARGETS`.

Snel controleren of de server leeft:

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","service":"intento-server","timestamp":"…"}
```

## Draaien in Docker

De vier onderdelen hebben elk een eigen image; `compose.yaml` zet ze samen neer. De database is
**SQLite op een volume** ([ADR-0016](docs/adr/0016-containers-en-compose.md)) — bewust, want schema, migratielijn en
runtime-adapter zijn nu SQLite en de overstap naar PostgreSQL hoort een eigen, zichtbare stap te zijn.

```bash
cp .env.docker.example .env.docker    # vul de geheimen in (SIGNING_SECRET, ENCRYPTION_KEY, SPEECH_SERVICE_TOKEN)
npm run docker:build
npm run docker:up                     # web op http://localhost:8080, API op http://localhost:3000
npm run docker:logs                   # meekijken
npm run docker:down                   # stoppen (volumes blijven staan)
```

De npm-scripts geven `--env-file .env.docker` mee. Draai je `docker compose` met de hand, doe dat dan
ook — anders vindt Compose de variabelen niet die hij bij het inlezen nodig heeft.

**Wat waar draait.** `server` migreert bij elke start automatisch (`prisma migrate deploy`) en draait
als niet-root; `web` is een nginx met SPA-fallback, zodat een harde refresh op `/tablet` werkt;
`speech` luistert alleen op het compose-netwerk en krijgt zijn stemmen uit een volume dat een
eenmalige init-dienst vult. De oude AI-worker is verdwenen (ADR-0017); de agentdienst komt er in
N1.7 bij.

De web-app bakt de API-URL in bij de **build** (`VITE_API_URL`): wijs je hem naar een andere host, dan
hoort daar `npm run docker:build` bij. Dat de API een eigen poort heeft is een bewuste keuze — de SPA
heeft een route `/operator` en de API een routetak `/operator/*`, dus één origin delen zou botsen (zie
[docs/adr/0016](docs/adr/0016-containers-en-compose.md)).

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

Na registratie stuurt de server een **verificatiemail** (T1.4). Zonder mailserver draait een
log-transport: de mail (met verificatielink) verschijnt in de serverlog i.p.v. echt verstuurd te
worden, zodat je lokaal zonder mailserver kunt verifiëren. Klik op de link (`.../verify-email?token=…`)
of wissel het token direct in via `POST /auth/verify-email`. Onbevestigde accounts mogen inloggen,
maar het aanmaken van gebruikers (`POST /users`) is geblokkeerd tot verificatie
(`403 EMAIL_NOT_VERIFIED`). Opnieuw versturen kan via `POST /auth/verify-email/resend` (neutraal,
rate-limited). Zie [docs/api.md](docs/api.md) en [docs/adr/0007](docs/adr/0007-email-verification-and-mail-transport.md).

### Een echte mailserver instellen

Twee schrijfwijzen, en je kiest er één — allebei invullen en de app weigert te starten in plaats
van er stilletjes één te kiezen.

**De losse velden**, zoals een hostingpakket ze opgeeft. Dit is de makkelijkste weg: er zijn geen
codeerregels, dus een wachtwoord met `@`, `/`, `:`, `#` of `?` erin gaat er letterlijk in.

```ini
SMTP_HOST=mail.mijndomein.nl
SMTP_PORT=587           # leeglaten mag: de poort volgt dan uit SMTP_SECURE
SMTP_SECURE=tls         # tls (STARTTLS, 587) | ssl (implicit TLS, 465) | none (25)
SMTP_USER=noreply@jouwdomein.nl
SMTP_PASSWORD=het-wachtwoord-van-die-mailbox
SMTP_TIMEOUT_SECONDS=15
```

`SMTP_SECURE=tls` is het gangbaarst en de standaard; werkt dat niet, probeer dan `ssl`.
`none` schakelt TLS uit en mag **alleen zonder `SMTP_USER`** — met inloggegevens erbij zou het het
wachtwoord in platte tekst versturen, en daar weigert de app op te starten.

**Of alles in één `SMTP_URL`**: `smtp://…:587` voor STARTTLS, `smtps://…:465` voor TLS vanaf de
eerste byte. Schema en poort moeten bij elkaar passen; `smtps://` met een STARTTLS-poort geeft de
misleidende fout `wrong version number`. Let op dat een `/`, `?` of `#` in het wachtwoord hier
percent-gecodeerd moet worden — heb je zo'n wachtwoord, neem dan de losse velden.

TLS is bij beide manieren verplicht zodra er wordt ingelogd (`requireTLS`): lukt de
STARTTLS-upgrade niet, dan faalt de verzending in plaats van in platte tekst door te gaan.

Alternatief voor lokaal testen: `npm run db:seed` maakt een eerste `ADMIN`-account (meteen als
geverifieerd aangemaakt; herseeden verifieert een nog ongeverifieerde bootstrap-admin alsnog en laat het
wachtwoord ongemoeid). E-mail/wachtwoord komen uit `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
(default `admin@intento.local` / `change-me-admin` — buiten lokaal ontwikkelen overschrijven). Login zet een ondertekende httpOnly-sessie-cookie:

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
(tekst tonen, voorlezen en stem; de nieuwe instellingen uit INTENTO-NEW-DESIGN §50 volgen in N3.1). Via de
web-app: `npm run dev:web`, open <http://localhost:5173>, log in als admin en beheer
gebruikers (aanmaken, instellingen, verwijderen). De web-app praat met de backend op
`VITE_API_URL` (standaard `http://localhost:3000`).

```bash
# Gebruiker aanmaken (ADMIN), lijst, instellingen, verwijderen:
curl -sb cookies.txt -X POST http://127.0.0.1:3000/users \
  -H 'content-type: application/json' -d '{"name":"Sanne"}'
curl -sb cookies.txt http://127.0.0.1:3000/admin/users
curl -sb cookies.txt -X PUT http://127.0.0.1:3000/users/<id>/settings \
  -H 'content-type: application/json' \
  -d '{"showText":false,"speechEnabled":true,"speechVoice":"nl_NL-pim-medium"}'
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
beheerder én begeleider onder **Mijn account**. Vooral bedoeld
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

## De tablet

De **gebruikersapp op de tablet** draait op de `/tablet`-URL: `npm run dev:web`, open
<http://localhost:5173/tablet>. Ze werkt op het apparaat-token uit de tabletkoppeling (hierboven) —
geen dagelijkse login. Is het apparaat nog niet gekoppeld, dan toont de app een koppelscherm dat een
koppelcode inwisselt.

De gespreksflow wordt herbouwd (INTENTO-NEW-DESIGN §48, ADR-0017). Tot die er is, toont een
gekoppelde tablet een rustig scherm **"Nog niet beschikbaar"**.

> **Effecten en `<StrictMode>`.** De app draait in dev onder `<StrictMode>` (`main.tsx`), dat elk
> component bewust dubbel mount (mount → unmount → remount). Een "ben ik nog gemount?"-vlag moet daarom
> in de **effectbody** weer op `true` — zet je hem alleen bij de declaratie, dan blijft hij na de
> gesimuleerde unmount `false` en worden alle latere `setState`-aanroepen stil overgeslagen.

## Profielexport en -import (T8.1)

Het communicatieprofiel is **eigendom van de gebruiker** en draagbaar (INTENTO-NEW-DESIGN §1). Een beheerder
exporteert het profiel (de instellingen, **zonder** account-/organisatiegegevens) als **versleuteld** bestand en importeert het elders als nieuwe gebruiker. Het bestand is
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
profielexport/-import en platform-operatoracties (T8.3). Het spoor bevat **geen
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

## Ontwerp en huisstijl (T17.1)

De web-applicatie heeft één schil om alle ingelogde pagina's:

- **Zijbalk met menu** — de bestemmingen staan gegroepeerd naar wat je komt doen: *Overzicht*,
  *Organisatie* (Gebruikers), *Platform* (Audit-log) en *Account*. De nieuwe beheerschermen uit
  INTENTO-NEW-DESIGN §49 komen er per taak bij. Een **begeleider** ziet een kort menu: Mijn account. Op een smal scherm (tablet staand)
  schuift de zijbalk weg achter een menuknop.
- **Kopbalk** — de paginatitel met één regel uitleg, en rechts wie je bent (naam, rol) met de
  uitlogknop.
- **Voordeurschermen** — inloggen, aanmelden, e-mailadres bevestigen en het koppelen van een tablet
  delen één gecentreerde kaart met het logo erboven.
- **Overzicht → detail** (T17.2/T17.3) — schermen met veel inhoud werken in twee stappen. Je ziet
  eerst een **lijst over de volle breedte** (gebruikers als regels met hun profiel erbij); daar één item openen geeft dat item een **eigen scherm** met alles
  bij elkaar. Toevoegen, importeren en aanmaken zitten achter een knop met een dialoog, zodat het
  overzicht een overzicht blijft.
- **Onderdelen per detailscherm** (T17.4) — het scherm van één gebruiker heeft bovenaan een
  keuzebalk: Instellingen · Begeleiders · Tablet · Profiel & verwijderen. Eén onderdeel tegelijk, over een leesbare breedte. Verwijderen zit onder het laatste
  onderdeel, apart en met uitleg over wat er weggaat.
- **Tablet** — de gebruikersapp heeft een vaste, rustige kopbalk: linksboven het beeldmerk met
  "Intento", rechtsboven de naam van de gebruiker. Bewust klein: het keuzescherm
  eronder moet de aandacht houden.

De kleuren komen uit het logo (donkerblauw, turkoois, blauw, paars, oranje) en staan als
CSS-variabelen in `web/src/styles.css`. Het kleurverloop van de spraakbel komt in de interface alleen
terug als dunne accentlijn — nooit onder tekst.

### Logobestanden

Het bronlogo staat in [`web/brand/`](web/brand/README.md); daar leidt `generate-assets.py` de
web-bruikbare varianten uit af (transparant beeldmerk, liggende variant, volledig logo, favicons en
app-iconen) naar `web/public/`. Na een wijziging aan het bronlogo:

```bash
cd web/brand && python3 generate-assets.py     # vereist Pillow (python3-pil)
```

De paden staan in de code op één plek (`BRAND_ASSETS` in `web/src/Brand.tsx`); een test controleert
dat elk pad — ook die uit `index.html` — echt bestaat.

## Kwaliteit (moet groen zijn — zie Definition of Done in CLAUDE.md)

```bash
npm run typecheck    # tsc --noEmit in elke workspace
npm run lint         # ESLint (flat config, type-aware)
npm test             # vitest in server en web
npm audit            # 0 kwetsbaarheden
npm run format:check # Prettier-opmaak controleren (npm run format schrijft de fixes)
npm run check:python # ruff + mypy --strict + unittest voor agent-service en speech-service
npm run audit:python # pip-audit over de Python-afhankelijkheden: 0 kwetsbaarheden
```

De Python-checks draaien in `agent-service/.venv` (wordt bij de eerste keer aangemaakt, met de
`dev`-extra uit `agent-service/pyproject.toml`). Zie [`scripts/python.sh`](scripts/python.sh).

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
  golden. Aangeleverd naslagmateriaal (`PROJECT-NODEJS/`, `LICENSE`) is
  bewust uitgezonderd: dat onderhouden we niet zelf en Prettier negeert het al.

## Documentatie

- Architectuur: [docs/architecture.md](docs/architecture.md)
- API: [docs/api.md](docs/api.md)
- Datamodel: [docs/data-model.md](docs/data-model.md)
- Beveiliging: [docs/security.md](docs/security.md)
- Beslissingen (ADR): [docs/adr/](docs/adr/)
- Wijzigingen: [CHANGELOG.md](CHANGELOG.md)
