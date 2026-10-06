# API

> Bron van waarheid zijn de zod-schema's in `shared/`. Houd dit overzicht kort;
> verwijs voor exacte velden naar de schema's/types. Volledige endpoint-planning:
> [../INTENTO-NEW-DESIGN.md](../INTENTO-NEW-DESIGN.md) §51. De gespreks- en AI-endpoints worden
> herbouwd ([ADR-0017](adr/0017-agentic-architectuur.md)).

## Conventies

- Authenticatie: ondertekende httpOnly+Secure sessie-cookie (`intento_session`) voor
  personen (vanaf T1.1); langlevend apparaat-token voor gekoppelde tablets (vanaf T2.3).
- Autorisatie (T1.2): beschermde routes hangen het `authorize(...)`-preHandler ervoor.
  Geen/ongeldige sessie → `401 NOT_AUTHENTICATED`; verkeerde rol → `403 FORBIDDEN`. Elke
  query op tenant-gebonden data wordt op `organizationId` gefilterd (`tenantScope(account)`),
  zodat een organisatie nooit data van een andere organisatie ziet (DESIGN §9.4). De
  kolom "Rol" hieronder geeft aan welke rollen een route toelaat.
- Fouten: consistente structuur `{ "error": { "code", "message" } }` (DESIGN §8.1).
  `ZodError` en Fastify-validatie → `400 VALIDATION_ERROR`; onbekende route →
  `404 NOT_FOUND`; onverwacht → `500 INTERNAL_ERROR` (zonder interne details).
- Rate limiting: niet globaal; streng per-route waar geconfigureerd (`/auth/login`, `/devices/link`).
- Apparaat-auth (T2.3): een **tweede** authenticatiepijler naast de accounts. Een gekoppelde
  tablet stuurt de ondertekende httpOnly+Secure `intento_device`-cookie mee; `deviceAuthorize`
  zet het geverifieerde `Device` op de request. Een device-token werkt **niet** op account-/
  beheerroutes en omgekeerd. Geen/ongeldig apparaat → `401 DEVICE_NOT_LINKED`.

## Endpoints

### Systeem
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/health` | publiek | Liveness-check; `{ status, service, timestamp }`. Geen auth, geen DB. |

### Auth (T1.1, T1.3, T1.4, T2.5, T2.6)
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/auth/register` | publiek | Body `{ organizationName, organizationType, adminName, email, password }` (`registerRequestSchema`). Maakt in **één transactie** een nieuwe `Organization` (`type` ∈ family/care/personal) + eerste ADMIN-`Account` (argon2id) en logt meteen in: `201` + `{ account }` en een `intento_session`-cookie. Verstuurt daarna een **verificatiemail** (T1.4, best-effort — een falende mailserver blokkeert de registratie niet). Reeds bestaand e-mailadres → `409 REGISTRATION_FAILED` (bewust generiek: lekt niet of het adres bestaat). Zwak wachtwoord (<12 tekens) / ongeldig `organizationType` / ongeldige e-mail → `400 VALIDATION_ERROR`. Te veel verzoeken → `429`. Streng rate-limited per IP. |
| POST | `/auth/login` | publiek | Body `{ email, password }` (`loginRequestSchema`). Bij succes: `200` + `{ account }` en een `intento_session`-cookie. Fout wachtwoord/onbekende e-mail → `401 INVALID_CREDENTIALS` (bewust generiek). Te veel pogingen → `423 ACCOUNT_LOCKED`. Te veel verzoeken → `429`. Streng rate-limited per IP. Onbevestigde accounts mogen inloggen (zie verificatie-gate hieronder). |
| POST | `/auth/password` | cookie (elke rol) | Body `{ currentPassword, newPassword }` (`changePasswordRequestSchema`). Wisselt het **eigen** wachtwoord — het account komt uit de sessie, niet uit de body, dus niemand wijzigt dat van een ander. `200` + `{ revokedSessions }` (`changePasswordResponseSchema`): het aantal **overige** sessies van dit account dat is ingetrokken (de huidige sessie blijft geldig). Fout huidig wachtwoord → `401 INVALID_CURRENT_PASSWORD`; nieuw wachtwoord < 12 tekens of gelijk aan het huidige → `400 VALIDATION_ERROR`; zonder sessie → `401 NOT_AUTHENTICATED`. Rate-limited per IP (`PASSWORD_CHANGE_RATE_LIMIT_MAX`) → `429`. Blijft bereikbaar voor een account met een nog niet vervangen tijdelijk wachtwoord (T2.6) — dit is de enige uitweg uit die gate; een geslaagde wissel wist `mustChangePassword`. |
| POST | `/auth/logout` | cookie | Verwijdert de serverzijdige sessie en wist de cookie. Altijd `204`. |
| GET | `/auth/me` | cookie | Huidig account (`{ account }`) of `401 NOT_AUTHENTICATED`. Ook bereikbaar met een nog niet vervangen tijdelijk wachtwoord (T2.6), zodat de client `mustChangePassword` kan lezen en de houder naar het wachtwoordscherm kan sturen. |
| POST | `/auth/verify-email` | publiek | Body `{ token }` (`verifyEmailRequestSchema`). Wisselt het verificatietoken in: `200` + `{ verified: true, account }` (`verifyEmailResponseSchema`). Ongeldig/verlopen/reeds gebruikt token → `400 INVALID_VERIFICATION_TOKEN` (neutrale melding, geen enumeratie). |
| GET | `/auth/verify-email?token=…` | publiek | Zelfde logica als de POST-variant, zodat een directe klik op de maillink ook werkt. |
| POST | `/auth/verify-email/resend` | publiek | Body `{ email }` (`resendVerificationRequestSchema`). Verstuurt een nieuw token als er een **onbevestigd** account bij het adres hoort. Antwoordt **altijd** neutraal `200 { message }` (`resendVerificationResponseSchema`) — of het adres nu bestaat, al geverifieerd is, of onbekend. Streng rate-limited per IP → `429`. |

Responsevorm `{ account }` = `authResponseSchema` (nooit `passwordHash` of lockout-velden); `account.emailVerified` (boolean) geeft de verificatiestatus en `account.mustChangePassword` (boolean, T2.6) of het account nog op het tijdelijke wachtwoord uit T2.4 draait.
`/auth/me` gebruikt sinds T1.2 hetzelfde `authorize(...)`-preHandler als beschermde routes.

**Eigen wachtwoord wijzigen (T2.5).** Nodig omdat een begeleider met het **tijdelijke** wachtwoord uit T2.4 binnenkomt: dat is door de beheerder aangemaakt en bij hem bekend, dus het hoort vervangen te kunnen worden. Eigenschappen:

- **Her-authenticatie:** het huidige wachtwoord moet mee, zodat een gekaapte sessie of een onbeheerd ingelogd scherm het account niet kan overnemen.
- **Alleen het eigen account:** het verzoek kent geen account-id; de server pakt het account uit de sessie.
- **Overige sessies ingetrokken:** na een wijziging blijven alleen de sessies van het wijzigende apparaat over — wie het oude wachtwoord kende, ligt eruit. Apparaat-tokens (T2.3) staan hier los van: die horen bij een *gebruiker*, niet bij dit account.
- **Geen lockout:** anders dan bij login telt een mislukte poging hier niet mee voor `LOGIN_MAX_ATTEMPTS` — een gekaapte sessie zou de eigenaar anders eenvoudig kunnen buitensluiten. Brute-force wordt door de rate limiting op de route afgevangen.
- Audit: `auth.password_change` (success én failure), zonder ooit een wachtwoord of hash te loggen.
- Anders dan bij login mág de foutmelding hier concreet zijn ("het huidige wachtwoord klopt niet"): de aanroeper is al als dít account geauthenticeerd, dus er valt niets te enumereren.

**Verificatie-gate (T1.4).** Onbevestigde accounts mogen inloggen en hun eigen gegevens bekijken, maar **gevoelige acties zijn geblokkeerd tot verificatie**. In de MVP is dat het aanmaken van gebruikers (`POST /users`) en van begeleider-accounts (`POST /admin/accounts`, T2.4) → `403 EMAIL_NOT_VERIFIED` zolang `emailVerified` false is. De verificatietoken staat **gehasht** at-rest, is eenmalig en verloopt (`EMAIL_VERIFICATION_TTL_HOURS`).

**Tijdelijk-wachtwoord-gate (T2.6).** Een account dat nog op het **server-gegenereerde** wachtwoord uit T2.4 draait (`mustChangePassword` true) mag **alléén** `GET /auth/me` en `POST /auth/password` (plus `POST /auth/logout`, die geen `authorize` gebruikt). Elke andere route geeft `403 PASSWORD_CHANGE_REQUIRED`. Bewust **harder** dan de verificatie-gate hierboven: een onbevestigd adres is een onbewezen adres, maar een tijdelijk wachtwoord is een levend wachtwoord dat ook de beheerder kent. De gate zit daarom in `authorize(...)` zelf (default-deny, opt-out per route via `allowPendingPasswordChange`) in plaats van als opt-in guard per gevoelige route — zo staat een nieuwe route er automatisch achter. Een geslaagde `POST /auth/password` wist de markering en heft de gate op, zonder opnieuw inloggen.

### Accounts (T1.2, T2.4, T2.6, T2.7)
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/accounts` | ADMIN | Lijst van logins **binnen de eigen organisatie** (`accountListResponseSchema`). Rol-beperkt (`403 FORBIDDEN` voor CAREGIVER/USER) en tenant-gefilterd op `organizationId`. Representatief voorbeeld van de autorisatie-/isolatielaag. Per account zijn `emailVerified` (T1.4) en `mustChangePassword` (T2.6) zichtbaar, zodat de beheerder ziet wie nog op een tijdelijk wachtwoord zit. |
| POST | `/admin/accounts` | ADMIN + geverifieerd | Maakt een **begeleider-account** in de eigen organisatie (T2.4, `createCaregiverRequestSchema`: `{ name, email }`). `201` + `createCaregiverResponseSchema` (`{ account, temporaryPassword }`). Zie hieronder. |
| POST | `/admin/accounts/{id}/password` | ADMIN + geverifieerd | Geeft een **nieuw tijdelijk wachtwoord** uit voor een account in de eigen organisatie (T2.7). Geen body. `200` + `resetAccountPasswordResponseSchema` (`{ account, temporaryPassword, revokedSessions }`). Eigen account → `403 CANNOT_RESET_OWN_PASSWORD`; account uit een andere organisatie of onbekend id → `403 FORBIDDEN` (dezelfde fout voor beide, geen enumeratie). Rate-limited per IP (`PASSWORD_RESET_RATE_LIMIT_MAX`) → `429`. Zie hieronder. |

**Begeleider-accounts (T2.4).** `POST /admin/accounts` is de plek waar CAREGIVER-logins ontstaan; zonder dit endpoint bleef de koppelweergave van T2.2 leeg. Eigenschappen:

- **Rol en organisatie komen van de server**, niet uit de body: de rol staat vast op `CAREGIVER` en de organisatie is die van de aanroepende ADMIN. Een meegestuurde `role`/`organizationId` wordt genegeerd (geen privilege-escalatie, geen account in een andere tenant).
- **Geen wachtwoordveld.** De server genereert een tijdelijk wachtwoord (256 bit) en geeft dat **één keer** terug in het antwoord; daarna kent de db alleen de argon2id-hash. De beheerder geeft het via een veilig kanaal door. Gekozen boven een uitnodigingsmail met wachtwoord-instellink zodat Intento zonder mailserver bruikbaar blijft (zie `docs/security.md`).
- Het account start **ongeverifieerd**; er gaat best-effort een verificatiemail uit (T1.4). Een falende mailserver laat het aanmaken niet mislukken.
- Het account start met `mustChangePassword` (T2.6) en kan dus niets anders dan zijn eigen wachtwoord wisselen tot dat gebeurd is — zie de tijdelijk-wachtwoord-gate hierboven.
- Bestaat het e-mailadres al (ook in een **andere** organisatie), dan `409 ACCOUNT_CREATE_FAILED` met een **neutrale** melding — geen account-enumeratie.
- Vereist een **geverifieerd** e-mailadres van de ADMIN (`403 EMAIL_NOT_VERIFIED`), net als `POST /users`. Aanmaken wordt geaudit als `account.create` (rol als context, nooit het wachtwoord).

**Nieuw tijdelijk wachtwoord uitgeven (T2.7).** `POST /admin/accounts/{id}/password` is de **weg terug** voor een vastgelopen account: sinds de harde gate van T2.6 kan iemand die zijn tijdelijke wachtwoord kwijt is (of die op de lockout is gestrand) niets meer — inloggen lukt niet en zonder sessie is `POST /auth/password` onbereikbaar. Eigenschappen:

- **De server genereert het wachtwoord**, net als bij aanmaken; de beheerder kiest dus nooit het wachtwoord van een ander (dat blijft de kern van T2.5). Het komt **één keer** terug in het antwoord; at-rest staat alleen de argon2id-hash.
- Het account is daarna **opnieuw gemarkeerd** (`mustChangePassword`) en komt dus meteen op de tijdelijk-wachtwoord-gate terecht: de houder kiest bij de eerstvolgende login zelf een wachtwoord.
- **Alle** sessies van het doelaccount worden ingetrokken (`revokedSessions`) — anders dan bij T2.5, waar de eigen sessie juist blijft. Elke lopende sessie hoort bij het oude wachtwoord, dus die moeten allemaal dood.
- De **lockout-boekhouding** wordt schoongeveegd (`failedLoginAttempts`, `lockedUntil`), anders loopt het account na de uitgifte nog steeds tegen zijn blokkade aan.
- **Nooit het eigen account** (`403 CANNOT_RESET_OWN_PASSWORD`): dat loopt via `POST /auth/password`, mét her-authenticatie. **Nooit cross-tenant**: `assertSameTenant` geeft dezelfde `403 FORBIDDEN` voor "andere organisatie" en "bestaat niet".
- Geaudit als `account.password_reset` (rol + aantal ingetrokken sessies als context, nooit het wachtwoord).
- **Gekozen boven een publieke "wachtwoord vergeten"-flow per e-mail**: Intento moet zonder mailserver bruikbaar blijven, en een tweede, publiek bereikbare weg naar een account vergroot het aanvalsoppervlak. Een e-mailflow blijft mogelijk als latere aanvulling (zelfde tokeneigenschappen als T1.4). Zie `docs/security.md`.

### Gebruikers (T2.1)
Gebruikers (`User`) zijn de communicerende personen, met een 1-op-1 communicatieprofiel
(`UserCommunicationProfile`). Alles is tenant-gebonden: elke query op `organizationId`
gefilterd; toegang op id via een andere organisatie geeft `403 FORBIDDEN` (bestaan lekt niet).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/users` | ADMIN + geverifieerd | Maakt een gebruiker in de eigen organisatie aan (`createUserRequestSchema`: `{ name, active?, experienceEnabled? }`; Experience staat standaard aan). Het communicatieprofiel wordt met standaardwaarden aangemaakt. `201` + `userPublicSchema`. Vereist een **geverifieerd e-mailadres** (T1.4) — onbevestigd → `403 EMAIL_NOT_VERIFIED`. |
| GET | `/admin/users` | ADMIN | Lijst van gebruikers **binnen de eigen organisatie** (`userListResponseSchema`). |
| GET | `/users/{id}` | ADMIN, CAREGIVER | Eén gebruiker inclusief profiel (`userPublicSchema`), of `403` bij een andere organisatie. Een CAREGIVER krijgt `403` als hij niet aan deze gebruiker gekoppeld is (T2.2). |
| PUT | `/users/{id}/settings` | ADMIN, CAREGIVER | Vervangt het volledige communicatieprofiel (`updateSettingsRequestSchema`, alle velden verplicht): `interactionMode` (`binary`/`multi`/`ai`), `optionsPerScreen` (2–8), `questionStrategy` (`general_to_specific`/`concrete_first`/`short_and_calm`), `experienceEnabled`, `maxQuestions` (5–30), `showText`, `speechEnabled`, `speechVoice`. Ongeldig of onvolledig → `400 VALIDATION_ERROR`. `200` + `userPublicSchema`. Voor een CAREGIVER geldt dezelfde koppel-eis als bij `GET`. |
| DELETE | `/users/{id}` | ADMIN | Verwijdert de gebruiker (profiel verdwijnt mee). `204`. Een CAREGIVER krijgt `403 FORBIDDEN`. |

Rolkeuze (DESIGN §2): aanmaken/verwijderen is een beheerderstaak (ADMIN); een begeleider
mag instellingen beheren, maar sinds **T2.2** alléén voor gebruikers waaraan hij gekoppeld is.

### Profielexport en -import (T8.1, DESIGN §6.4, FR-019)

Gegevenseigenaarschap (DESIGN §4): het communicatieprofiel is eigendom van de gebruiker en is **draagbaar**
naar een andere omgeving. De export bevat de weergavenaam en het communicatieprofiel (contacten en Experience volgen in
N15.1) — **niet** account- of organisatiegegevens, id's of tokens. De payload wordt in zijn
geheel versleuteld met de omgevingssleutel (`ENCRYPTION_KEY`), dus het bestand is **onleesbaar zonder die
sleutel**. Beide acties zijn **ADMIN-only** en tenant-gebonden.

| Methode | Pad | Rol | Gedrag |
|---|---|---|---|
| GET | `/users/{id}/export` | ADMIN | Exporteert het profiel als versleuteld bestand (`profileExportResponseSchema`: `{ data, filename }`). `data` = de ondoorzichtige, versleutelde payload; de beheer-UI biedt die als download aan. Andere organisatie → `403 FORBIDDEN` (bestaan lekt niet). |
| POST | `/users/import` | ADMIN + geverifieerd e-mailadres | Importeert een eerder geëxporteerd profiel (`profileImportRequestSchema`: `{ data, name? }`) als **nieuwe** gebruiker in de eigen organisatie. `name` overschrijft optioneel de geëxporteerde weergavenaam. `201` + `userPublicSchema`. Ongeldig/beschadigd bestand of gemaakt met een andere sleutel → `400 IMPORT_INVALID`; onbevestigd e-mailadres → `403 EMAIL_NOT_VERIFIED`. |

> **Sleutel-let op:** import in een andere deployment werkt alleen als die deployment dezelfde `ENCRYPTION_KEY`
> deelt (MVP-keuze). Een wachtwoordgebaseerde exportsleutel voor cross-omgeving-overdracht is toekomstig werk.

### Begeleiders koppelen (T2.2, T9.1)
Een beheerder bepaalt welke begeleiders aan een gebruiker gekoppeld zijn. De koppeling stuurt de
toegang: een niet-gekoppelde begeleider krijgt op de gebruiker-routes hierboven `403 FORBIDDEN`. Beide
endpoints zijn tenant-gebonden (gebruiker én begeleider moeten in de eigen organisatie zitten, anders
`403`).

Sinds T9.1 kan **ook een ADMIN-account** begeleider zijn: in kleine organisaties is de beheerder vaak
zelf de begeleider aan tafel. De lijst draagt daarom per account de `role`, zodat zichtbaar
blijft wie beheerder is. Een `USER`-account kan geen begeleider zijn (`400 NOT_A_CAREGIVER`).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/users/{id}/caregivers` | ADMIN | Alle CAREGIVER- én ADMIN-accounts van de eigen organisatie met per account de `role` en of het aan deze gebruiker gekoppeld is (`caregiverListResponseSchema`). |
| GET | `/caregiver/users` | ADMIN, CAREGIVER | De gebruikers waaraan dít account als begeleider gekoppeld is, binnen de eigen organisatie (`userListResponseSchema`, op naam). Voor het scherm "Mijn gebruikers" van de begeleider; instellingen wijzigt hij via `PUT /users/{id}/settings`. |
| POST | `/admin/users/{id}/caregivers` | ADMIN | Koppelt (`{ accountId, linked: true }`) of ontkoppelt (`linked: false`) één begeleider (`linkCaregiverRequestSchema`); idempotent. `200` + de bijgewerkte lijst. Account is geen CAREGIVER/ADMIN → `400 NOT_A_CAREGIVER`; account uit een andere organisatie → `403 FORBIDDEN`. |

### Tabletkoppeling (T2.3)
Een tablet wordt via een koppelcode aan **precies één** gebruiker gebonden en start daarna
direct in de gebruikersapp zonder dagelijkse login. Code én apparaat-token staan alléén gehasht
in de db (SHA-256); codes verlopen (`DEVICE_CODE_TTL_MINUTES`) en zijn eenmalig. Het apparaat-token
leeft in de langlevende `intento_device`-cookie (`DEVICE_TOKEN_TTL_DAYS`).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/admin/users/{id}/device-code` | ADMIN | Genereert een koppelcode voor een gebruiker in de eigen organisatie. `201` + `deviceCodeResponseSchema` (`{ code, expiresAt }`) — de **plaintext** code wordt hier één keer teruggegeven. Een eerdere ongebruikte code wordt ongeldig. Andere organisatie → `403 FORBIDDEN`. |
| POST | `/devices/link` | publiek | Wisselt een koppelcode in (`linkDeviceRequestSchema`, `{ code }`; genormaliseerd). Bij succes: `201` + `deviceSessionResponseSchema` (`{ device, user }`) en de `intento_device`-cookie. Onbekend/verlopen/al gebruikt → `400 INVALID_LINK_CODE` (bewust generiek). Streng rate-limited per IP. |
| GET | `/device/me` | apparaat | Eigen gebruiker + apparaat (`deviceSessionResponseSchema`). Enige data waartoe een apparaat-token toegang geeft. Geen/ongeldig apparaat → `401 DEVICE_NOT_LINKED`. |

### Spraakuitvoer (T18.1/T18.2, DESIGN §5.3, §8.1, §9.4)

De tablet laat uitspreken wat er op zijn scherm staat; de backend praat namens hem met de losstaande
spraakdienst (`speech-service/`, Piper). De client praat **nooit** rechtstreeks met die dienst — wie iets
mag laten uitspreken is een autorisatievraag. Beide routes antwoorden met **binaire audio** in plaats van
JSON (`audio/wav`) en met `Cache-Control: no-store`: de zin van een gebruiker hoort niet in een
tussenliggende cache te blijven hangen. Fouten houden wél de gewone JSON-foutvorm. Zonder geconfigureerde
dienst (`SPEECH_PROVIDER=none`) antwoorden ze met `503 SPEECH_UNAVAILABLE`; de tablet valt dan terug op de
stem van het apparaat zelf. Beide zijn rate-limited (`SPEECH_RATE_LIMIT_MAX`) → `429`.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/device/speech` | device-cookie | Body `{ text }` (`speakRequestSchema`, 1–300 tekens na trimmen). Geeft `audio/wav` van díé tekst. De **stem** komt uit het communicatieprofiel van de gebruiker achter de apparaatsessie — de tablet kiest hem niet en kan ook niet namens een andere gebruiker laten spreken. Staat `speechEnabled` uit → `403 SPEECH_DISABLED`. Is de gekozen stem `device` (de tablet spreekt zelf) → `400 SPEECH_VOICE_ON_DEVICE`. Zonder apparaatsessie → `401`. Identieke (tekst, stem) komt uit een **geheugencache** (`hash(tekst + stem)`, `SPEECH_CACHE_MAX_ENTRIES`); er wordt niets op schijf bewaard. |
| POST | `/admin/users/:id/speech-preview` | cookie (ADMIN, CAREGIVER) | Body `{ text, voice }` (`speechPreviewRequestSchema`). Laat één zin horen met een **expliciete** stem, zodat de begeleider stemmen kan vergelijken vóór hij kiest — het profiel wordt hierbij niet aangeraakt. Tenant-gefilterd; een CAREGIVER moet aan de gebruiker gekoppeld zijn (anders `403`). Onbekende stem (niet in `SPEECH_VOICE_CATALOG`) → `400`. |

De **stemcatalogus** staat in `@intento/shared` (`SPEECH_VOICE_CATALOG`), zodat server en beheer-UI
dezelfde lijst gebruiken. Een stem-id is de naam van een Piper-model (`nl_NL-pim-medium`), eventueel met
`#<spreker>` voor een meersprekermodel, of de sleutel `device` voor "de tablet spreekt zelf". Zie
[ADR-0015](adr/0015-speech-synthesis-piper.md) en [`speech-service/README.md`](../speech-service/README.md).

### Vocabulary (N2.9, INTENTO-NEW-DESIGN §15, §49)

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/vocabulary?q=&status=&labelStatus=&page=&pageSize=` | ADMIN, CAREGIVER | De items die voor de eigen organisatie beschikbaar zijn (platform + eigen, nooit van een andere organisatie), gesorteerd op `sortOrder`. `q` zoekt hoofdletterongevoelig in labels, synoniemen en concepten; `status` is standaard `approved` (ingetrokken items alleen met `status=retired`); `pageSize` 1–100 (standaard 24). `200` + `vocabularyListResponseSchema` (`{ items, total, page, pageSize }`); per item `scope` (`platform`/`organization`), licentie en herkomst, en een ondertekende `imageUrl` (`null` zonder afbeelding of bij een ingetrokken item). Een tablet (apparaatsessie) krijgt `401`. |
| GET | `/vocabulary/attributions` | account of apparaat | De bronvermelding (`attributionListResponseSchema`): per bron naam, licentie, maker, of naamsvermelding vereist is, en de symbolen (id + label) die deze organisatie gebruikt (platform + eigen, alleen `approved`). Voor iedereen binnen de organisatie, ook de tablet; zonder sessie `401`, gedeactiveerde organisatie `403`. |
| POST | `/vocabulary/{id}/retire` · `/vocabulary/{id}/restore` | ADMIN | Intrekken (`status: retired`) of terugzetten (`approved`). Een item wordt nooit verwijderd; ingetrokken gaat het niet meer naar de agentdienst en levert `/assets` hem niet meer. Zelfde rechten als `PATCH`; geaudit als `vocabulary.retire`/`vocabulary.restore`. Idempotent. `200` + het item. |
| PATCH | `/vocabulary/{id}` | ADMIN | Bewerkt `labels` (eerste = hoofdlabel, rest synoniemen), `concepts` (conceptsleutels), `contexts` (vaste lijst), `isStart`, `sortOrder` (`vocabularyUpdateRequestSchema`, strict, minstens één veld). Een gewijzigd label wordt `labelStatus: reviewed`. Alleen items van de eigen organisatie; een platformitem alleen door een beheerder van de platformorganisatie (anders `403 PLATFORM_ITEM`); een item van een andere organisatie of een onbekend id → `403 FORBIDDEN`. Geaudit als `vocabulary.update` (met de veldnamen, niet de waarden). `200` + het bijgewerkte item. |

### Organisatie (N3.3, INTENTO-NEW-DESIGN §50, §53)

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/organization/settings` | ADMIN | De bewaartermijn van de eigen organisatie (`organizationSettingsSchema`: `{ retentionDays, retentionDaysDefault, usesDefault }`). |
| PUT | `/organization/settings` | ADMIN | `{ retentionDays: 7–365 \| null }` (`null` = de standaard `RETENTION_DEFAULT_DAYS` volgen). Altijd de eigen organisatie; geaudit als `organization.settings.update`. `200` + de nieuwe instellingen; buiten de grenzen `400`. |

### Afbeeldingen (N2.2, INTENTO-NEW-DESIGN §51, §53)

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/assets/{id}?exp=…&sig=…` | geen sessie; ondertekende URL | De afbeelding van een Vocabulary-item. De backend geeft de URL uit (`signedAssetUrl`) aan wie het item mag zien; de handtekening is een HMAC-SHA256 over `id.exp` met `ASSET_URL_SECRET` en verloopt na `ASSET_URL_TTL_SECONDS`. Ongeldig of verlopen → `403 INVALID_ASSET_SIGNATURE`; onbekend, ingetrokken of zonder bestand → `404 ASSET_NOT_FOUND`. Headers: het opgeslagen `Content-Type`, `nosniff`, `Cross-Origin-Resource-Policy: cross-origin` (de web-app laadt hem als `<img>` vanaf een andere origin) en voor SVG een CSP zonder scripts en externe resources. |

### Beheerdashboard

`GET /admin/dashboard` (ADMIN; geen sessie → `401`, andere rol → `403`): beknopt overzicht van de **eigen
organisatie**, tenant-gefilterd op `organizationId`. `200` + `dashboardResponseSchema`:
`{ users: { total, active }, caregivers: { total } }`.

### Audit-log (T8.2, DESIGN §9.4)

`authorize({ roles: ['ADMIN'] })` (geen sessie → `401`; andere rol → `403 FORBIDDEN`). Het spoor van
**gevoelige acties** (login, instellingen, persoonlijke context, profielexport/-import, beheer) wordt
server-side geschreven door `recordAudit(...)` (`server/src/audit/`) als **neveneffect** van de bijbehorende
handeling — best-effort, nooit blokkerend, en **zonder communicatie-inhoud** (alleen wie-wat-wanneer). De
inzage-lijst is tenant-gefilterd op `organizationId`: een ADMIN ziet alleen het spoor van de **eigen
organisatie**. Mislukte pre-auth acties (mislukte login) hebben geen tenant en verschijnen daarom bewust niet
in een organisatie-lijst. Het `ip`-veld blijft server-side (niet in de respons).

| Methode | Pad | Doel |
|---|---|---|
| GET | `/admin/audit-logs?limit=` | `200` + `auditLogListResponseSchema`: `{ entries[] }` (nieuwste eerst, `limit` 1–200, standaard 50). Elke regel: `action`, `outcome`, `accountId`, `targetType`, `targetId`, `metadata`, `createdAt` — **geen** `ip`, **geen** communicatie-inhoud. |

### Platform-operatorconsole (T8.3, DESIGN §9.1, §9.4, ADR-0011)

`operatorAuthorize(...)` — een **eigen** guard, niet `authorize()` (geen sessie → `401`; elk ander account,
inclusief een gewone ADMIN of een platform-ADMIN zonder de vlag → `403 NOT_OPERATOR`). Toegang vereist twee
onafhankelijke voorwaarden: `Account.isOperator` **én** een organisatie met `isPlatform=true`; de vlag wordt
alleen door de bootstrap-seed gezet en is via geen enkele API uit te delen.

Dit is het **enige** deel van de API dat niet op `organizationId` filtert — bewust, en bewust ingekaderd: de
guard zet `request.operator` en laat `request.account` leeg, zodat de tenant-helpers hier hard falen in plaats
van stilletjes op de organisatie van de operator te filteren. De responses dragen uitsluitend
**beheermetadata**: geen communicatie-inhoud, geen persoonlijke context, geen voorkeuren, en geen namen van
gebruikers (die blijven binnen hun eigen omgeving). Elke muterende actie wordt geaudit met de operator als
actor en **zonder** tenant (`organizationId: null`).

Deactiveren is geen verwijdering maar wel een harde, onmiddellijke stop: `Organization.active=false` wordt
afgedwongen bij login, op bestaande accountsessies (`authorize()`) én op gekoppelde tablets
(`deviceAuthorize()`), telkens met `403 ORGANIZATION_SUSPENDED`. De platformorganisatie zelf is beschermd,
zodat een operator zichzelf niet buitensluit.

| Methode | Pad | Doel |
|---|---|---|
| GET | `/operator/organizations` | `200` + `operatorOrganizationListResponseSchema`: alle organisaties (nieuwste eerst) met `name`, `type`, `active`, `isPlatform`, `userCount`, `accountCount`, `createdAt`. |
| POST | `/operator/organizations` | `201` + `operatorOrganizationSchema`. Body `{ name, type }` (`createOperatorOrganizationRequestSchema`). Zet een omgeving neer **zonder accounts** — de beheerder ervan meldt zich zelf aan (T1.3). Nooit `isPlatform`. |
| GET | `/operator/organizations/{id}` | `200` + `operatorOrganizationDetailSchema`: de organisatie, haar `accounts[]` (e-mail, naam, rol, `emailVerified`, `mustChangePassword`, `isOperator`, `createdAt` — nooit de hash) en `users[]` (**id/status/datum, geen naam**). `404 ORGANIZATION_NOT_FOUND` bij onbekend id. |
| POST | `/operator/organizations/{id}/deactivate` | `200` + `operatorOrganizationSchema` (`active: false`). Idempotent. `400 PLATFORM_ORGANIZATION_PROTECTED` op de platformorganisatie. |
| POST | `/operator/organizations/{id}/activate` | `200` + `operatorOrganizationSchema` (`active: true`). Idempotent. |

De console draait in de web-app op de aparte route `/operator` (`web/src/OperatorConsole.tsx`) — niet als tab
in het tenant-beheer; een operator vindt 'm via één link op "Mijn account".
