# TEST.md — Intento handmatig doorlopen

Dit is het **testdraaiboek** voor Intento: een doorlopend pad van "niets draait" naar "ik heb de hele
applicatie gezien en weet dat ze werkt". Elke stap noemt de **actie** en het **verwachte resultaat**;
wijkt het af, dan is dat een bevinding (zie [§9 Testrapport](#9-testrapport)).

Bedoeld voor een handmatige acceptatietest. De geautomatiseerde tests (`npm test`) horen daar in
[deel A](#deel-a--geautomatiseerde-checks) bij, maar vervangen het doorlopen niet: een groene suite
zegt niets over pictogrammen die cross-origin niet laden of een scherm dat blijft hangen op "Laden…".

| Deel | Wat | Tijd |
|---|---|---|
| [0](#0-voorbereiding) | Voorbereiding: installeren, database, app starten | ~10 min |
| [A](#deel-a--geautomatiseerde-checks) | Geautomatiseerde checks (Definition of Done) | ~4 min |
| [B](#deel-b--rooktest-via-de-api) | Rooktest via de API (curl) — snel álle flows raken | ~15 min |
| [C](#deel-c--handmatig-door-de-ui) | Handmatig door de vier interfaces klikken | ~30 min |
| [D](#deel-d--beveiliging-en-grenzen) | Beveiliging en grenzen (negatieve tests) | ~15 min |
| [E](#deel-e--ai-workers-queue-modus) | AI-workers in queue-modus (optioneel) | ~15 min |

> **Nulmeting.** Deel A en B zijn op 2026-08-21 volledig doorlopen op deze werkplek; de uitkomsten
> staan in [§10 Referentie-uitkomst](#10-referentie-uitkomst). Wijkt jouw run daarvan af, dan is er
> iets veranderd — niet alleen "anders".

---

## 0. Voorbereiding

### 0.1 Node-versie

```bash
node -v      # moet v22 of hoger zijn
```

- [ ] **Verwacht:** `v22.x` of hoger (ontwikkeld op Node 24).

> **Valkuil.** Draait er een oude systeem-Node (bv. v12), dan falen `npm`/`npx` met een cryptische
> `SyntaxError: Unexpected token '.'` uit `internal/modules/cjs/loader.js`. Dat is **geen projectfout**:
> zet eerst een Node ≥ 22 vooraan in je `PATH`.

### 0.2 Installeren en configureren

```bash
npm install                                # deps + `prisma generate` + pre-commit-hook
cp .env.example server/.env                # alleen als server/.env nog niet bestaat
```

- [ ] **Verwacht:** installatie zonder fouten; `server/.env` bestaat.

De defaults in `.env.example` zijn geschikt voor lokaal testen: SQLite, mock-AI, log-transport voor
e-mail (geen mailserver nodig). Laat `OPENSYMBOLS_SECRET` leeg tenzij je [C.4](#c4-aac-bibliotheek)
wilt testen.

### 0.3 Database opzetten

```bash
npm run db:migrate:deploy --workspace=server   # migraties toepassen
npm run db:seed --workspace=server             # bootstrap-admin + AAC-bibliotheek
```

- [ ] **Verwacht:** `Seed klaar: organisatie "Demo-omgeving" (seed-demo-org), admin
      "admin@intento.local", 31 AAC-symbolen.`

Wil je van een schone lei beginnen (aanrader vóór een volledige testronde):

```bash
npm run db:reset --workspace=server            # leegmaken + migreren + seeden
```

> **Valkuil — sla de seed niet over.** Zonder AAC-bibliotheek start een gesprek meteen op `done` en
> krijg je `NO_STEPS_TO_GENERATE` ("Maak eerst een keuze."). Dat lijkt een app-fout, maar is een
> lege bibliotheek.

### 0.4 De app starten

```bash
npm run dev          # backend (3000) + web (5173) tegelijk
```

Of apart in twee terminals: `npm run dev:server` en `npm run dev:web`.

```bash
curl -s http://127.0.0.1:3000/health
```

- [ ] **Verwacht:** `{"status":"ok","service":"intento-server","timestamp":"…"}`
- [ ] **Verwacht:** <http://localhost:5173> toont het loginscherm.

---

## Deel A — Geautomatiseerde checks

Dit is de Definition of Done uit `CLAUDE.md`. Alles moet groen zijn vóór je handmatig gaat testen —
anders test je een bekend-kapotte build.

```bash
npm run typecheck      # tsc --noEmit in shared, server, web
npm run lint           # ESLint (type-aware)
npm run format:check   # Prettier
npm test               # vitest in server + web
npm audit              # kwetsbaarheden
```

- [ ] `npm run typecheck` — geen fouten (drie workspaces achter elkaar, zonder uitvoer).
- [ ] `npm run lint` — geen uitvoer.
- [ ] `npm run format:check` — `All matched files use Prettier code style!`
- [ ] `npm test` — server **45 bestanden / 355 tests**, web **15 bestanden / 83 tests**, alles passed.
- [ ] `npm audit` — `found 0 vulnerabilities`.

De Python-worker heeft zijn eigen suite (volledig offline, backend en Ollama worden gestubd):

```bash
cd ai-worker && python3 -m unittest discover -t . -s . -p "test_*.py"
```

- [ ] **Verwacht:** `Ran 24 tests … OK` (twee "mislukt"-regels in de uitvoer horen erbij: dat zijn de
      tests die bewust een Ollama-fout en een onbekende taak afhandelen).

---

## Deel B — Rooktest via de API

Snelste manier om élke flow één keer te raken. Alles met `curl` + `jq`, zonder browser. Werk in een
tijdelijke map, zodat cookiebestanden niet in het project belanden:

```bash
mkdir -p /tmp/intento-test && cd /tmp/intento-test
export API=http://127.0.0.1:3000
```

De cookiebestanden zijn je "sessies": `admin.txt` (beheerder), `cg.txt` (begeleider),
`device.txt` (tablet), `nieuw.txt` (zelf-aangemelde beheerder).

### B.1 Zelfaanmelding en e-mailverificatie

```bash
curl -sc nieuw.txt -X POST $API/auth/register -H 'content-type: application/json' \
  -d '{"organizationName":"Testomgeving","organizationType":"family","adminName":"Kim",
       "email":"kim@test.local","password":"sterk-wachtwoord-123"}' | jq .account
```

- [ ] **Verwacht:** `201`-achtig antwoord met `role: "ADMIN"`, `emailVerified: false` en een **nieuw**
      `organizationId` (niet `seed-demo-org`).

Zonder verificatie mag je nog geen gebruikers aanmaken:

```bash
curl -sb nieuw.txt -X POST $API/users -H 'content-type: application/json' -d '{"name":"Test"}'
```

- [ ] **Verwacht:** `403 EMAIL_NOT_VERIFIED` — "Bevestig eerst je e-mailadres…".

De verificatiemail wordt zonder `SMTP_URL` **gelogd** in plaats van verstuurd. Haal het token uit de
serverlog (de terminal waarin `npm run dev:server` draait) en wissel het in:

```bash
# zoek in de serverlog naar:  .../verify-email?token=<TOKEN>
curl -sb nieuw.txt -X POST $API/auth/verify-email -H 'content-type: application/json' \
  -d '{"token":"<TOKEN>"}' | jq '{verified, email: .account.email}'
curl -sb nieuw.txt -X POST $API/users -H 'content-type: application/json' -d '{"name":"Test"}' | jq .name
```

- [ ] **Verwacht:** `verified: true`, en daarna slaagt het aanmaken van de gebruiker wél (`"Test"`).

### B.2 Inloggen als beheerder en een gebruiker aanmaken

Voor de rest van deel B werken we in de geseede demo-omgeving:

```bash
curl -sc admin.txt -X POST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@intento.local","password":"change-me-admin"}' | jq .account
USER_ID=$(curl -sb admin.txt -X POST $API/users -H 'content-type: application/json' \
  -d '{"name":"Sanne"}' | jq -r .id)
echo "USER_ID=$USER_ID"
```

- [ ] **Verwacht:** login geeft `role: "ADMIN"`, `emailVerified: true`, `isOperator: true`.
- [ ] **Verwacht:** `USER_ID` is gevuld; de nieuwe gebruiker krijgt een standaardprofiel
      (`iconsPerScreen: 4`, `showText: true`, `aiLearningEnabled: true`).

Instellingen aanpassen (alleen 2/4/6/8 zijn geldig):

```bash
curl -sb admin.txt -X PUT $API/users/$USER_ID/settings -H 'content-type: application/json' \
  -d '{"iconsPerScreen":6,"showText":true,"aiLearningEnabled":true,"supportMode":false,
       "contextIndicator":true}' | jq .communicationProfile
curl -sb admin.txt -X PUT $API/users/$USER_ID/settings -H 'content-type: application/json' \
  -d '{"iconsPerScreen":5,"showText":true,"aiLearningEnabled":true,"supportMode":false,
       "contextIndicator":true}'
```

- [ ] **Verwacht:** de eerste geeft `iconsPerScreen: 6`; de tweede wordt **geweigerd** met `400` (zod
      laat alleen 2/4/6/8 toe).

### B.3 Begeleider-account, tijdelijk wachtwoord en koppeling

```bash
curl -sb admin.txt -X POST $API/admin/accounts -H 'content-type: application/json' \
  -d '{"name":"Sam","email":"sam@test.local"}' > cg.json
jq '{id: .account.id, role: .account.role, mustChange: .account.mustChangePassword}' cg.json
TMP=$(jq -r .temporaryPassword cg.json); CG_ID=$(jq -r .account.id cg.json)
```

- [ ] **Verwacht:** `role: "CAREGIVER"`, `mustChangePassword: true`, en een tijdelijk wachtwoord dat
      **één keer** wordt getoond.

Koppel de begeleider aan de gebruiker:

```bash
curl -sb admin.txt -X POST $API/admin/users/$USER_ID/caregivers -H 'content-type: application/json' \
  -d "{\"accountId\":\"$CG_ID\",\"linked\":true}" | jq .caregivers
```

- [ ] **Verwacht:** de begeleider staat er met `linked: true`.

Log in als begeleider en zie dat de tijdelijk-wachtwoord-gate dichtstaat:

```bash
curl -sc cg.txt -X POST $API/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"sam@test.local\",\"password\":\"$TMP\"}" | jq .account.mustChangePassword
curl -sb cg.txt $API/question/users
```

- [ ] **Verwacht:** inloggen lukt (`true`), maar élke andere route geeft
      `403 PASSWORD_CHANGE_REQUIRED`.

Eigen wachtwoord kiezen, daarna gaat de gate open:

```bash
curl -sb cg.txt -X POST $API/auth/password -H 'content-type: application/json' \
  -d "{\"currentPassword\":\"$TMP\",\"newPassword\":\"begeleider-eigen-wachtwoord\"}"
curl -sb cg.txt $API/question/users | jq '[.users[].name]'
```

- [ ] **Verwacht:** `{"revokedSessions":0}` (andere sessies van dít account worden uitgelogd; die zijn
      er nu niet), daarna `["Sanne"]`.

### B.4 Tabletkoppeling

```bash
CODE=$(curl -sb admin.txt -X POST $API/admin/users/$USER_ID/device-code \
  -H 'content-type: application/json' -d '{}' | jq -r .code)
echo "koppelcode: $CODE"
curl -sc device.txt -X POST $API/devices/link -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\"}" | jq .user.name
curl -sb device.txt $API/device/me | jq '{user: .user.name, device: .device.type}'
```

- [ ] **Verwacht:** een 8-tekenige code, daarna `"Sanne"` en `device: "tablet"`.
- [ ] **Verwacht:** dezelfde code een tweede keer inwisselen geeft
      `400 INVALID_LINK_CODE` — "Koppelcode ongeldig, verlopen of al gebruikt."

### B.5 Gespreksflow: van intentie naar bevestigde boodschap

```bash
SESSION=$(curl -sb device.txt -X POST $API/conversation/start | tee start.json | jq -r .sessionId)
jq '{prompt: .question.prompt, opties: [.question.options[].concept]}' start.json
```

- [ ] **Verwacht:** `"Wat wil je duidelijk maken?"` met de intentiecategorieën
      `ask, problem, feel, want, say`.

Kies achtereenvolgens *iets willen* → *drinken* → *water*:

```bash
kies() { curl -sb device.txt -X POST $API/conversation/$SESSION/next \
  -H 'content-type: application/json' -d "{\"symbolId\":\"$1\"}"; }

WANT=$(jq -r '.question.options[]|select(.concept=="want").id' start.json)
kies $WANT > s1.json;  jq '{prompt: .question.prompt, opties: [.question.options[].concept]}' s1.json
DRINK=$(jq -r '.question.options[]|select(.concept=="drink").id' s1.json)
kies $DRINK > s2.json; jq '{prompt: .question.prompt, opties: [.question.options[].concept]}' s2.json
WATER=$(jq -r '.question.options[]|select(.concept=="water").id' s2.json)
kies $WATER > s3.json; jq '{done, phase, confidence}' s3.json
```

- [ ] **Verwacht:** stap 1 → `drink, eat, do-activity`; stap 2 → `coffee, milk, juice, water`;
      stap 3 → `done: true`, `phase: "propose"`.

Boodschap voorstellen en bevestigen:

```bash
curl -sb device.txt -X POST $API/conversation/$SESSION/generate -d '{}' \
  -H 'content-type: application/json' | jq '{message, confidence}'
curl -sb device.txt -X POST $API/conversation/$SESSION/confirm -d '{}' \
  -H 'content-type: application/json' | jq
```

- [ ] **Verwacht:** voorstel `"Ik wil water."`, en na bevestigen `status: "COMPLETED"` met diezelfde
      boodschap. Vóór de bevestiging wordt er **niets** opgeslagen.

### B.6 Terug (↩) en correctie (❌)

```bash
S2=$(curl -sb device.txt -X POST $API/conversation/start | tee b6.json | jq -r .sessionId)
W=$(jq -r '.question.options[]|select(.concept=="want").id' b6.json)
curl -sb device.txt -X POST $API/conversation/$S2/next -H 'content-type: application/json' \
  -d "{\"symbolId\":\"$W\"}" | jq '[.question.options[].concept]'
curl -sb device.txt -X POST $API/conversation/$S2/back | jq '[.question.options[].concept]'
```

- [ ] **Verwacht:** na `back` staan **exact** de startopties er weer
      (`ask, problem, feel, want, say`).

Loop nu opnieuw door naar een voorstel (zoals in B.5) en wijs het af:

```bash
curl -sb device.txt -X POST $API/conversation/$S2/correction -H 'content-type: application/json' \
  -d '{"type":"wrong_guess"}' | jq '{prompt: .question.prompt, opties: [.question.options[].concept]}'
```

- [ ] **Verwacht:** de flow gaat **niet** terug naar het begin, maar naar de vermoedelijke foutstap —
      en de afgewezen route ontbreekt in de opties (na afwijzen van "water" via "drink" blijven bij
      `"want"` alleen `eat, do-activity` over).

### B.7 Vraagmodus (begeleider stelt een vraag)

```bash
curl -sb cg.txt -X POST $API/question/start -H 'content-type: application/json' \
  -d "{\"userId\":\"$USER_ID\",\"question\":\"Wat wil je drinken?\",\"anchorConcept\":\"drink\"}" | jq
curl -sb device.txt $API/conversation/pending \
  | jq '{prompt: .state.question.prompt, opties: [.state.question.options[].concept]}'
```

- [ ] **Verwacht:** de tablet vindt de klaarstaande vraag; de opties zijn de kinderen van het gekozen
      onderwerp: `coffee, milk, juice, water`.

### B.8 AAC-bibliotheek en pictogrammen

```bash
curl -sb admin.txt "$API/aac/search?q=lopen" | jq '[.symbols[] | {concept, label}]'
SYM=$(curl -sb admin.txt "$API/aac/search?q=water" | jq -r '.symbols[0].id')
curl -sI $API/aac/images/$SYM | grep -i 'http/\|content-type\|cross-origin-resource'
```

- [ ] **Verwacht:** zoeken op synoniem "lopen" vindt concept `walking` ("Wandelen") — de zoek is
      hoofdletterongevoelig op concept, label én synoniem.
- [ ] **Verwacht:** het pictogram geeft `200` met `cross-origin-resource-policy: cross-origin`.
      Staat daar `same-origin`, dan laden de pictogrammen in de web-app niet (regressie T8.7).

### B.9 Dashboard, conceptvoorstellen en audit-log

```bash
curl -sb admin.txt $API/admin/dashboard | jq '{users, caregivers, pendingProposals}'
curl -sb admin.txt $API/admin/concept-proposals | jq '[.proposals[] | {concept, status}]'
curl -sb admin.txt $API/admin/audit-logs | jq '[.entries[:6][] | {action, createdAt}]'
```

- [ ] **Verwacht:** het dashboard telt jouw gebruikers/begeleiders en toont recente gesprekken.
- [ ] **Verwacht:** het audit-spoor bevat je acties van zojuist (`auth.login`, `account.create`,
      `caregiver.link`, `device.code.create`, `auth.password_change`) — en **geen** boodschapinhoud.

### B.10 Profielexport en -import

```bash
curl -sb admin.txt $API/users/$USER_ID/export > profiel.json
jq -r '{filename, begin: .data[0:20]}' profiel.json
curl -sb admin.txt -X POST $API/users/import -H 'content-type: application/json' \
  -d "$(jq -c '{data}' profiel.json)" | jq '{id, name}'
```

- [ ] **Verwacht:** `data` begint met `v1:` en is verder onleesbaar (versleuteld met `ENCRYPTION_KEY`).
- [ ] **Verwacht:** de import maakt een **nieuwe** gebruiker met hetzelfde profiel en een nieuw `id`.

### B.11 Operatorconsole

```bash
curl -sb admin.txt $API/operator/organizations | jq '[.organizations[] | {name, active, isPlatform, userCount}]'
```

- [ ] **Verwacht:** álle omgevingen (over tenants heen), met de platformorganisatie op
      `isPlatform: true`. Alleen **beheermetadata** — geen gebruikersnamen, geen gespreksinhoud.

Een omgeving stoppen en hervatten (gebruik de zelf-aangemelde "Testomgeving" uit B.1, **niet** de
platformorganisatie):

```bash
ORG=$(curl -sb admin.txt $API/operator/organizations \
  | jq -r '.organizations[]|select(.name=="Testomgeving").id')
curl -sb admin.txt -X POST $API/operator/organizations/$ORG/deactivate -d '{}' \
  -H 'content-type: application/json' | jq .active
curl -sb nieuw.txt $API/auth/me
curl -sb admin.txt -X POST $API/operator/organizations/$ORG/activate -d '{}' \
  -H 'content-type: application/json' | jq .active
```

- [ ] **Verwacht:** na deactiveren `active: false` en een **bestaande sessie** van die omgeving krijgt
      meteen `403 ORGANIZATION_SUSPENDED`. Na activeren werkt ze weer; er gaat geen data verloren.

---

## Deel C — Handmatig door de UI

Start `npm run dev` en gebruik een browser. De drie interfaces zitten achter één build op eigen paden:
beheer op `/`, de gebruikersapp op `/tablet`, de operatorconsole op `/operator`.

> **Test de tablet-app op tabletformaat.** De UI is tablet-first; zet je browservenster op ± 1024×768
> of gebruik de apparaatweergave van de dev-tools.

### C.1 Beheeromgeving — <http://localhost:5173>

- [ ] Loginscherm: inloggen met `admin@intento.local` / `change-me-admin`.
- [ ] "Nieuwe omgeving aanmelden" toont het zelfaanmeldformulier (organisatie + eerste beheerder).
- [ ] Na inloggen staan de tabs: **Dashboard · Gebruikers · AAC-bibliotheek · Conceptvoorstellen ·
      Worker-tokens · Audit-log · Mijn account**. De actieve tab is niet klikbaar.
- [ ] Is het e-mailadres nog niet bevestigd, dan staat er een verificatiebanner bovenaan.
- [ ] **Dashboard:** aantallen gebruikers/begeleiders, openstaande conceptvoorstellen en recente
      gesprekken.
- [ ] **Gebruikers:** een gebruiker aanmaken, selecteren en zijn instellingen aanpassen
      (2/4/6/8 pictogrammen, tekst tonen, AI-leren, ondersteuningsmodus, contextindicator).
- [ ] Per geselecteerde gebruiker verschijnen de panelen **Gekoppelde begeleiders**, **Tablet koppelen**,
      **Persoonlijke context** en **Voorkeuren**.
- [ ] **Begeleider aanmaken** toont het tijdelijke wachtwoord **één keer** — noteer het.
- [ ] **Logins**: hier zie je wie nog op een tijdelijk wachtwoord zit, met per login een knop voor een
      **nieuw** tijdelijk wachtwoord (bij je eigen account staat die knop er bewust niet).
- [ ] **Mijn account:** wachtwoord wijzigen; een operator ziet hier de link naar de operatorconsole.

### C.2 Gebruikersapp op de tablet — <http://localhost:5173/tablet>

- [ ] Nog niet gekoppeld: het scherm vraagt om een **koppelcode**. Genereer er een in de
      beheeromgeving (Gebruikers → Tablet koppelen) en voer hem in.
- [ ] Na koppelen start de app **direct** in de gespreksflow — geen login.
- [ ] Startscherm: "Wat wil je duidelijk maken?" met grote pictogramtegels.
- [ ] Het aantal tegels volgt `iconsPerScreen`; met `showText: false` verdwijnen de tekstlabels.
- [ ] Staat `contextIndicator` aan, dan toont "Gekozen pad" het afgelegde pad.
- [ ] **↩ Terug** herstelt het vorige scherm exact.
- [ ] Na de laatste keuze verschijnt **"Klopt dit?"** met de gekozen pictogrammen en de zin.
- [ ] **✅ Ja** → "Boodschap bevestigd". **❌ Nee** → een gerichtere hervraag, niet terug naar het begin.
- [ ] **Pictogrammen zijn zichtbaar** (geen gebroken afbeeldingen) — zie B.8 als ze ontbreken.
- [ ] Herlaad de pagina midden in een gesprek: het scherm komt terug en blijft **niet** hangen op
      "Laden…" (regressie T8.5, StrictMode).

### C.3 Begeleiderinterface — inloggen als CAREGIVER

- [ ] Log uit en in met het begeleider-account. Bij een tijdelijk wachtwoord verschijnt eerst het
      blokkerende scherm **"Kies eerst een eigen wachtwoord"**; daarna gaat de app door **zonder**
      opnieuw inloggen.
- [ ] **Vraag stellen:** kies een gekoppelde gebruiker, typ "Wat wil je drinken?" en kies met
      **Onderwerp zoeken** het onderwerp "Drinken".
- [ ] De vraag verschijnt op de tablet; de antwoordopties zijn de kinderen van dat onderwerp.
- [ ] **Meekijken met het gesprek** toont het gekozen pad live — maar er is nergens een knop om
      namens de gebruiker te bevestigen.
- [ ] Een niet-gekoppelde gebruiker staat niet in de lijst.

### C.4 AAC-bibliotheek

- [ ] Tab **AAC-bibliotheek**: zoeken/filteren op categorie werkt.
- [ ] Een symbool toevoegen (concept, label, categorie, emoji-glyph, synoniemen) en terugvinden via
      een synoniem.
- [ ] Een pictogram uploaden (PNG/JPEG/WebP). Een te groot bestand wordt geweigerd (`413`).
- [ ] Begripsrelaties leggen; het nieuwe kind verschijnt daarna als optie in de gespreksflow.
- [ ] *Alleen met `OPENSYMBOLS_SECRET`:* zoeken bij OpenSymbols en een pictogram koppelen; bron en
      licentie komen op het symbool te staan. Zonder secret antwoorden die endpoints `503` — dat is
      correct gedrag, geen fout.

### C.5 Operatorconsole — <http://localhost:5173/operator>

- [ ] Ingelogd als bootstrap-admin: **Operatorconsole** met alle omgevingen.
- [ ] **Nieuwe omgeving** aanmaken (zonder accounts — de beheerder meldt zich zelf aan).
- [ ] Een omgeving deactiveren en weer activeren.
- [ ] Ingelogd als gewone beheerder of begeleider: de console is onbereikbaar (`403 NOT_OPERATOR`).

---

## Deel D — Beveiliging en grenzen

Negatieve tests: hier hoort het **mis** te gaan. Elke stap die tóch slaagt, is een ernstige bevinding.

### D.1 Tenant-isolatie

```bash
curl -sb admin.txt $API/admin/users | jq '[.users[].name]'   # demo-omgeving
curl -sb nieuw.txt $API/admin/users | jq '[.users[].name]'   # Testomgeving
```

- [ ] **Verwacht:** twee **disjuncte** lijsten. Elke beheerder ziet uitsluitend zijn eigen organisatie.
- [ ] **Verwacht:** een `USER_ID` uit de ene omgeving opvragen met de sessie van de andere geeft `403`
      (niet `404` met inhoud, en zeker geen data).

### D.2 Rollen

```bash
curl -sb cg.txt $API/admin/accounts                       # begeleider → beheerroute
curl -sb cg.txt $API/operator/organizations               # begeleider → operatorroute
curl -s     $API/admin/users                              # zonder sessie
```

- [ ] **Verwacht:** `403 FORBIDDEN`, `403 NOT_OPERATOR` en `401` — in die volgorde.

### D.3 De begeleider bevestigt nooit namens de gebruiker

Start via de vraagmodus (B.7) een gesprek en probeer het vanuit de **begeleiderssessie** te bevestigen:

```bash
PSID=$(curl -sb device.txt $API/conversation/pending | jq -r .state.sessionId)
curl -sb cg.txt -X POST $API/conversation/$PSID/confirm -d '{}' -H 'content-type: application/json'
```

- [ ] **Verwacht:** `403 CONFIRM_REQUIRES_USER` — "Alleen de gebruiker kan zelf een boodschap
      bevestigen". Dit is een domeinregel, geen detail.

### D.4 Een verzonnen concept bereikt de gebruiker nooit

Dit is de kern van de validatielaag. Volledig te testen met een eigen worker in queue-modus
([deel E](#deel-e--ai-workers-queue-modus)): laat de worker een concept teruggeven dat niet in de
AAC-bibliotheek staat.

- [ ] **Verwacht:** het verzonnen concept staat **niet** tussen de opties op de tablet.
- [ ] **Verwacht:** het duikt op als `PENDING` bij `GET /admin/concept-proposals` (tab
      **Conceptvoorstellen**), ter beoordeling door een beheerder.

### D.5 Rate limiting en account-lockout

Gebruik een **onbestaand** e-mailadres: de IP-rate-limit test je dan zonder je eigen beheerder buiten
te sluiten.

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $API/auth/login \
    -H 'content-type: application/json' \
    -d '{"email":"onbekend@test.local","password":"fout-wachtwoord"}'
done; echo
```

- [ ] **Verwacht:** `401 401 401 401 401 401 401 401 401 401 429 429` — tien pogingen (`LOGIN_RATE_LIMIT_MAX`),
      daarna dicht. Een onbekend adres geeft dezelfde `401` als een fout wachtwoord: geen
      account-enumeratie.
- [ ] **Account-lockout** (apart van de rate limit): dezelfde lus tegen een **bestaand** account
      blokkeert dat account na `LOGIN_MAX_ATTEMPTS` pogingen voor `LOGIN_LOCKOUT_MINUTES`. Doe dit als
      laatste van deel D — of geef jezelf via een tweede beheerder een nieuw tijdelijk wachtwoord (B.3).

> Na deze stap is inloggen vanaf jouw IP ± een minuut geblokkeerd (`LOGIN_RATE_LIMIT_WINDOW_MINUTES`).
> Even wachten volstaat; een reset is niet nodig.

### D.6 Gestopte omgeving

- [ ] Na `deactivate` (B.11): login, bestaande accountsessies **én** gekoppelde tablets van die
      omgeving krijgen `403 ORGANIZATION_SUSPENDED`.
- [ ] De platformorganisatie zelf laat zich niet deactiveren.

---

## Deel E — AI-workers (queue-modus)

Standaard draait Intento op de **mock**-provider: deterministisch, geen netwerk, geen sleutel. Wil je
de gedistribueerde route testen, zet dan `AI_PROVIDER=queue`:

```bash
AI_PROVIDER=queue npm run dev:server
```

> **Let op:** in queue-modus heeft **elke** AI-aanroep een worker nodig — ook
> `POST /conversation/start`. Draait er niets, dan krijg je terecht
> `503 AI_WORKER_UNAVAILABLE` met een `retryAfterMs`. Dat is backpressure, geen crash.

Munt een worker-token (of gebruik de tab **Worker-tokens** in de beheeromgeving; dat kan alleen als
ADMIN van de platformorganisatie):

```bash
npm run worker-token:create --workspace=server -- --name test-worker
```

- [ ] **Verwacht:** het rauwe token (`wrk_…`) wordt **één keer** getoond.

### E.1 Met de echte Ollama-worker

Vereist een bereikbare Ollama **met een opgehaald model** (`ollama pull gemma3:4b`).

```bash
cd ai-worker && cp .env.example .env      # vul BACKEND_URL, WORKER_TOKEN, OLLAMA_URL, OLLAMA_MODEL
python3 -m ai_worker
```

- [ ] **Verwacht:** de worker logt claim → resultaat, en de vraag/het voorstel verschijnt in de
      tablet-app. Zonder opgehaald model faalt de job netjes (`fail`) zonder dat de worker crasht.

### E.2 Zonder Ollama: het protocol los testen

Wil je alleen de wachtrij en de validatielaag testen, dan volstaat een worker van twintig regels die
een vast antwoord teruggeeft. Claim-respons is `{"job":{"id","task","payload"}}`; de toegestane
concepten staan in `payload.availableSymbols`, en het resultaat gaat naar
`POST /ai/worker/jobs/{id}/result`:

```python
# testworker.py — claimt jobs en antwoordt zonder Ollama
import json, urllib.request, sys
BASE, TOKEN = 'http://127.0.0.1:3000', sys.argv[1]
def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
        headers={'content-type': 'application/json', 'authorization': 'Bearer ' + TOKEN})
    raw = urllib.request.urlopen(req, timeout=40).read()
    return json.loads(raw) if raw else None
while True:
    body = post('/ai/worker/claim', {})
    if not body or 'job' not in body:
        continue
    job = body['job']
    ctx = job.get('payload') or {}
    if job['task'] == 'select_next_question':
        allowed = [o['concept'] if isinstance(o, dict) else o for o in ctx.get('availableSymbols') or []]
        result = {'question': 'Wat wil je?', 'reason': 'testworker', 'confidence': 0.8,
                  'options': [{'symbol': c, 'confidence': 0.8} for c in allowed[:4]]}
    else:
        result = {'message': 'Ik wil water.', 'confidence': 0.9}
    post(f"/ai/worker/jobs/{job['id']}/result", result)
    print('job', job['id'], 'afgehandeld', flush=True)
```

```bash
python3 testworker.py wrk_<jouw-token>
```

- [ ] **Verwacht:** met de worker aan levert `POST /conversation/start` gewoon een vraag op, met de
      opties die de worker koos.
- [ ] **D.4-test:** zet in `options` een verzonnen concept (bv. `{'symbol':'raketschip',…}`) vóór de
      echte. De tablet ziet het **niet**, en `GET /admin/concept-proposals` toont
      `raketschip · PENDING`.

---

## Deel F — Spraakuitvoer (T18)

Zonder spraakdienst blijft alles werken: de tablet valt terug op de stem van het apparaat zelf, en de
spraakendpoints antwoorden met `503 SPEECH_UNAVAILABLE`. Wil je de echte, lokale synthese testen:

```bash
cd speech-service
python -m venv .venv && . .venv/bin/activate && pip install piper-tts
python -m piper.download_voices --data-dir voices nl_NL-pim-medium nl_BE-nathalie-medium
SERVICE_TOKEN=lokaal-geheim python -m speech_service
```

- [ ] `curl http://127.0.0.1:5002/health` → **Verwacht:** `{"status":"ok","voices":[…]}` met de
      gedownloade stemmen.

Start de backend daarnaast met de dienst erachter:

```bash
SPEECH_PROVIDER=http SPEECH_SERVICE_URL=http://127.0.0.1:5002 \
  SPEECH_SERVICE_TOKEN=lokaal-geheim npm run dev:server
```

### F.1 De rookproef in één commando

```bash
SPEECH_SERVICE_URL=http://127.0.0.1:5002 SPEECH_SERVICE_TOKEN=lokaal-geheim \
  npx tsx src/scripts/smoke-speech.ts     # vanuit server/
```

- [ ] **Verwacht:** `status=200 type=audio/wav bytes=… wav=true in ~200 ms`, en een tweede regel
      `herhaling: status=200 in <10 ms (cache)` — de tweede keer komt uit de geheugencache.

### F.2 Op de tablet

- [ ] Zet in de beheeromgeving bij een gebruiker (Gebruikers → *naam* → Instellingen) **"De tablet leest
      voor wat er op het scherm staat"** aan.
- [ ] Klik bij een stem op **🔊 Beluister**. **Verwacht:** je hoort de zin "Ik wil graag water drinken."
      en er wordt **niets** opgeslagen (het bolletje van de stem verspringt niet).
- [ ] Kies een stem en sla op. Open `/tablet`. **Verwacht:** de vraag wordt voorgelezen zodra het scherm
      verschijnt, met een knop **🔊 Nog eens** ernaast.
- [ ] Tik een pictogram aan. **Verwacht:** de vorige zin stopt en de nieuwe vraag klinkt.
- [ ] Loop door tot het voorstelscherm en bevestig. **Verwacht:** eerst de voorgestelde zin, na ✅
      dezelfde zin als bevestigde boodschap.
- [ ] Ga vier keuzeschermen door (heen, `↩ Terug`, heen). **Verwacht:** op het vierde scherm klinkt ná de
      vraag een kort zetje over de bediening ("Staat het er niet bij? Tik op Staat er niet bij.").
- [ ] Zet in de instellingen **"Stem van het apparaat"** en herhaal op een Android-tablet of iPad.
      **Verwacht:** de tablet spreekt zelf, met de stem van het apparaat — voorlopig de enige weg naar
      een Nederlandse vrouwenstem (zie T18.5).

- [ ] Verander in de beheeromgeving de stem terwijl `/tablet` openstaat, en tik op de tablet op **🔄
      Opnieuw beginnen**. **Verwacht:** het volgende gesprek klinkt in de nieuwe stem, zonder de pagina
      te verversen (T18.6). Hetzelfde gebeurt als je de tablet naar een ander tabblad/app wegzet en weer
      terugkomt. Midden in een lopend gesprek verandert er bewust niets.
- [ ] Blijft de tablet de apparaatstem gebruiken terwijl er een servertem gekozen is? Open de
      browserconsole van de tablet. **Verwacht:** bij elke terugval staat daar de reden (`serverstem
      mislukt, …`) — een 403 (spraak staat uit), een onbereikbare backend, of geblokkeerd geluid.

> **iOS:** Safari staat geluid pas toe ná een aanraking. Het eerste scherm kan daarom stil blijven tot
> je één keer tikt; daarna spreekt de app ook uit zichzelf. Dit hoort op een écht apparaat getest te
> worden, niet in een desktopbrowser.

## Deel G — De stack in Docker (fase 19)

Vereist Docker met de Compose-plug-in. Alles hieronder draait naast je gewone ontwikkelopstelling; de
containers gebruiken hun eigen database (een volume), niet je `server/prisma/dev.db`.

```bash
cp .env.docker.example .env.docker    # vul SIGNING_SECRET, ENCRYPTION_KEY en SPEECH_SERVICE_TOKEN
npm run docker:build
npm run docker:up
```

- [ ] `docker compose --env-file .env.docker ps` → **Verwacht:** `server`, `web` en `speech` zijn
      `healthy`; `speech-voices` is `exited (0)` (dat is de eenmalige stemmen-download).
- [ ] `curl http://localhost:3000/health` → **Verwacht:** `{"status":"ok",…}`.
- [ ] Open <http://localhost:8080> en meld een organisatie aan. **Verwacht:** het lukt — dat bewijst dat
      de migraties op het lege volume gedraaid hebben en dat `argon2` en `better-sqlite3` in het image
      werken.
- [ ] Ga naar <http://localhost:8080/tablet> en druk op **F5**. **Verwacht:** de pagina laadt (geen 404);
      dat is de SPA-fallback van nginx.
- [ ] `docker compose --env-file .env.docker exec server id` → **Verwacht:** `uid=1000(node)`, dus niet
      root.
- [ ] `docker compose --env-file .env.docker exec server node dist/scripts/smoke-speech.js` →
      **Verwacht:** `status=200 type=audio/wav … wav=true`, en een tweede regel met een cachetreffer.
- [ ] `npm run docker:down && npm run docker:up` → **Verwacht:** je account bestaat nog (inloggen lukt)
      en de stemmen worden niet opnieuw gedownload (`ls -l /voices` toont dezelfde tijdstempels).

### G.1 Met de AI-worker

```bash
docker compose --env-file .env.docker exec server \
  node dist/scripts/create-worker-token.js --name docker-worker
# zet het token in .env.docker als WORKER_TOKEN en AI_PROVIDER=queue, daarna:
docker compose --env-file .env.docker --profile ai up -d
```

- [ ] `GET /ai/status` als ingelogde beheerder → **Verwacht:** `"workersOnline": 1` en `"active": true`.
- [ ] **Let op:** Ollama luistert standaard alleen op `127.0.0.1` en is dan **niet** bereikbaar vanuit
      een container. Start hem als `OLLAMA_HOST=0.0.0.0 ollama serve`, of zet `OLLAMA_URL` op een Ollama
      elders. Zonder bereikbare Ollama draait de worker wel, maar faalt elke job.

## 8. Opruimen

```bash
# dev-servers stoppen: Ctrl-C in de terminals, of gericht:
pkill -f "[t]sx watch"      # backend  (de blokhaken voorkomen dat pkill zijn eigen commando raakt)
pkill -f "[v]ite"          # web
rm -rf /tmp/intento-test    # cookiebestanden en json-uitvoer
npm run db:reset --workspace=server   # database terug naar de geseede uitgangsstand
```

- [ ] **Verwacht:** na de reset staat er weer een schone demo-omgeving met 31 AAC-symbolen, en zijn de
      testgebruikers, begeleiders, worker-tokens en conceptvoorstellen weg.

---

## 9. Testrapport

Noteer per deel wat je zag. Een bevinding is pas bruikbaar met de **echte uitvoer** erbij — geen
"werkte niet".

```
Datum:            ____________     Tester: ____________
Commit (git rev-parse --short HEAD): ____________
Node-versie:      ____________

Deel A  geautomatiseerde checks   [ ] groen  [ ] rood → welke:
Deel B  rooktest via de API       [ ] groen  [ ] rood → welke stap:
Deel C  handmatig door de UI      [ ] groen  [ ] rood → welk scherm:
Deel D  beveiliging en grenzen    [ ] groen  [ ] rood → welke stap:
Deel E  AI-workers (optioneel)    [ ] groen  [ ] rood  [ ] n.v.t.

Bevindingen (stap · verwacht · gezien · uitvoer):
1.
2.
```

Bevindingen horen als taak in [TASKS.md](TASKS.md) — bouw ze niet stilzwijgend mee in een lopende taak.

---

## 10. Referentie-uitkomst

Volledig doorlopen op **2026-08-21** (commit `bd0f59a`, branch `test/application-test-1`, Node 24.19.0,
`AI_PROVIDER=mock`, SQLite-dev-db). Deel A, B, D en E zijn met echte aanroepen tegen een draaiende
server geverifieerd; deel C is niet geautomatiseerd doorlopen — de stappen daar volgen de UI-code.

| Check | Uitkomst |
|---|---|
| `npm run typecheck` | groen (shared, server, web) |
| `npm run lint` | groen |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm test` | server 45 bestanden / 355 tests, web 15 / 83 — alles passed |
| `npm audit` | 0 kwetsbaarheden |
| `ai-worker` unittests | 24 tests OK |
| Seed | organisatie "Demo-omgeving", admin `admin@intento.local`, 31 AAC-symbolen |
| Zelfaanmelding + verificatie | `EMAIL_NOT_VERIFIED` vóór, gebruiker aanmaken lukt ná verificatie |
| Tabletkoppeling | code → `intento_device`-cookie → `/device/me` geeft de eigen gebruiker |
| Gespreksflow | `want → drink → water` → `"Ik wil water."` → `COMPLETED` |
| ↩ Terug | startopties exact hersteld |
| ❌ Correctie | terug naar de `want`-stap; `drink` niet opnieuw aangeboden (`eat, do-activity`) |
| Vraagmodus | vraag komt op de tablet met opties `coffee, milk, juice, water` |
| Begeleider bevestigt | `403 CONFIRM_REQUIRES_USER` |
| Tenant-isolatie | `['Testgebruiker']` vs. `['Sanne', …]` — disjunct |
| Pictogram | `200`, `cross-origin-resource-policy: cross-origin` |
| Profielexport/-import | `v1:`-payload, import geeft nieuwe gebruiker met hetzelfde profiel |
| Operatorconsole | alle omgevingen zichtbaar; begeleider → `403 NOT_OPERATOR` |
| Queue-modus | claim → resultaat → vraag op de tablet; zonder worker `503 AI_WORKER_UNAVAILABLE` |
| Validatielaag | verzonnen `raketschip` niet in de opties, wel `PENDING` conceptvoorstel |

---

## Verwante documentatie

- [README.md](README.md) — opzetten, draaien en alle endpoints met voorbeelden
- [DESIGN.md](DESIGN.md) — ontwerpbron: flows (§3), UX (§5), AI (§7), API (§8)
- [docs/api.md](docs/api.md) — endpoints en foutcodes
- [docs/security.md](docs/security.md) — beveiligingsmaatregelen en -afwegingen
- [TASKS.md](TASKS.md) — takenlijst; bevindingen komen hier terecht
