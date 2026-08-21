# API

> Bron van waarheid zijn de zod-schema's in `shared/`. Houd dit overzicht kort;
> verwijs voor exacte velden naar de schema's/types. Volledige endpoint-planning:
> [../DESIGN.md](../DESIGN.md) §8.

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
| POST | `/users` | ADMIN + geverifieerd | Maakt een gebruiker in de eigen organisatie aan (`createUserRequestSchema`: `{ name, active? }`). Het communicatieprofiel wordt met standaardwaarden aangemaakt. `201` + `userPublicSchema`. Vereist een **geverifieerd e-mailadres** (T1.4) — onbevestigd → `403 EMAIL_NOT_VERIFIED`. |
| GET | `/admin/users` | ADMIN | Lijst van gebruikers **binnen de eigen organisatie** (`userListResponseSchema`). |
| GET | `/users/{id}` | ADMIN, CAREGIVER | Eén gebruiker inclusief profiel (`userPublicSchema`), of `403` bij een andere organisatie. Een CAREGIVER krijgt `403` als hij niet aan deze gebruiker gekoppeld is (T2.2). |
| PUT | `/users/{id}/settings` | ADMIN, CAREGIVER | Vervangt het volledige communicatieprofiel (`updateSettingsRequestSchema`: `iconsPerScreen`, `showText`, `aiLearningEnabled`, `supportMode`, `contextIndicator` — als PUT zijn alle velden verplicht). `iconsPerScreen` alléén **2/4/6/8** — anders `400 VALIDATION_ERROR`. `contextIndicator` (T2.4) schakelt de contextindicator (broodkruimel) in de tablet-UI aan/uit. `200` + `userPublicSchema`. Voor een CAREGIVER geldt dezelfde koppel-eis als bij `GET`. |
| DELETE | `/users/{id}` | ADMIN | Verwijdert de gebruiker (profiel verdwijnt mee). `204`. Een CAREGIVER krijgt `403 FORBIDDEN`. |

Rolkeuze (DESIGN §2): aanmaken/verwijderen is een beheerderstaak (ADMIN); een begeleider
mag instellingen beheren, maar sinds **T2.2** alléén voor gebruikers waaraan hij gekoppeld is.

### Persoonlijke context (T6.1)

Persoonlijke context van een gebruiker (belangrijke personen, huisdieren, plekken, favorieten,
routines — DESIGN §6.2 `PersonalContext`, §6.3, FR-013/020) waarmee de AI kan personaliseren, **maar
alléén met expliciete toestemming per rij** (`aiUsageAllowed`). De gevoelige velden (`name`,
`relationship`) worden **versleuteld** opgeslagen (AES-256-GCM, `ENCRYPTION_KEY`) en pas op de API-grens
ontsleuteld — plaintext PII staat nooit in de db (DESIGN §9.4). Toegang is tenant-gebonden en, voor een
CAREGIVER, beperkt tot **gekoppelde** gebruikers (zoals bij `/users/{id}/settings`).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/users/{id}/context` | ADMIN, CAREGIVER | Voegt een stuk context toe (`personalContextInputSchema`: `{ category, name, relationship?, aiUsageAllowed? }`). `category` is een gesloten taxonomie (`PERSON`/`PET`/`PLACE`/`ACTIVITY`/`FOOD`/`OBJECT`/`ROUTINE`/`OTHER`) — een onbekende waarde → `400 VALIDATION_ERROR`. `aiUsageAllowed` is **opt-in** (standaard `false`). `201` + `personalContextPublicSchema` (ontsleuteld). Andere organisatie of niet-gekoppelde CAREGIVER → `403 FORBIDDEN`. |
| GET | `/users/{id}/context` | ADMIN, CAREGIVER | Alle context van de gebruiker (`personalContextListResponseSchema`, ontsleuteld), gebruiker-/tenant-gefilterd. Zelfde `403`-regels. |
| PUT | `/users/{id}/context/{contextId}` | ADMIN, CAREGIVER | Vervangt één contextrij (`personalContextInputSchema`, zelfde velden/validatie als POST). De rij moet bij `{id}` horen — anders `404 CONTEXT_NOT_FOUND` (een id van een andere gebruiker lekt niet). `200` + `personalContextPublicSchema`. Zelfde `403`-regels. |
| DELETE | `/users/{id}/context/{contextId}` | ADMIN, CAREGIVER | Verwijdert één contextrij (na eigenaars-/tenantcontrole). Onbekende/vreemde rij → `404 CONTEXT_NOT_FOUND`. `204` bij succes. Zelfde `403`-regels. |

De web-beheeromgeving vult deze endpoints met een **stapsgewijze wizard** (T6.2): de begeleider legt personen,
plekken, favorieten en routines pictogram-ondersteund vast en beheert ze daarna (bewerken/verwijderen).

**AI-toestemmingsfilter (DESIGN §6.3).** Bij elke AI-aanroep in de gespreksflow (`/conversation/*`) laadt
de backend **alléén** de contextrijen met `aiUsageAllowed=true`, ontsleutelt ze en geeft ze als `userContext`
(`{ kind, value }`) mee in de beperkte prompt. Naast de persoonlijke context reizen ook de geleerde
**voorkeuren** (T6.3, `kind: 'preference'`) mee — mits leren aanstaat. Context/voorkeuren zonder toestemming
bereiken de AI dus nooit.

### Voorkeuren en leermechanisme (T6.3)

Geleerde voorkeuren van een gebruiker (DESIGN §3.8, §6.2 Preference, §7.1 taak 5, FR-014). Het leren zelf
gebeurt server-side bij `POST /conversation/{id}/confirm`: elk **bevestigd** concept versterkt de voorkeur —
maar **alléén** als `aiLearningEnabled=true` (uitschakelbaar) en **nooit** uit afwijzingen/correcties. De
onderstaande endpoints zijn de **beheerkant**; toegang volgt dezelfde regels als de persoonlijke context
(ADMIN of gekoppelde CAREGIVER, tenant-gebonden).

| Methode | Pad | Rol | Gedrag |
|---|---|---|---|
| GET | `/users/{id}/preferences` | ADMIN, CAREGIVER | Alle voorkeuren van de gebruiker, sterkste eerst (`preferenceListResponseSchema`: `{ id, userId, concept, label, confidence, count, suggestionStatus, suggested, createdAt }`). `label` = het opgezochte AAC-label; `suggested` = er staat een suggestie open. Andere organisatie of niet-gekoppelde CAREGIVER → `403 FORBIDDEN`. |
| POST | `/users/{id}/preferences/{prefId}/suggestion` | ADMIN, CAREGIVER | Handelt een **openstaande** suggestie af (`preferenceSuggestionActionSchema`: `{ action: 'accept' \| 'adjust' \| 'reject', category?, name? }`). `accept` neemt de voorkeur over als **persoonlijke context** (categorie afgeleid uit het AAC-concept, naam = label, `aiUsageAllowed=true`); `adjust` idem met opgegeven `category`+`name` (beide verplicht, anders `400`); `reject` weigert de suggestie. `200` + de bijgewerkte `preferencePublicSchema`. Onbekende/vreemde voorkeur → `404 PREFERENCE_NOT_FOUND`; geen openstaande suggestie → `409 NO_PENDING_SUGGESTION`. |

De begeleider-suggestie ontstaat automatisch: zodra een concept ≥ 3× bevestigd is, gaat `suggestionStatus`
van `none` → `pending` en verschijnt in de beheer-UI een voorstel ("Wil je '…' toevoegen als vaste context?")
met **accepteren / aanpassen / weigeren**. Een geweigerde (`dismissed`) of overgenomen (`accepted`) suggestie
komt niet terug.

### Profielexport en -import (T8.1, DESIGN §6.4, FR-019)

Gegevenseigenaarschap (DESIGN §4): het communicatieprofiel is eigendom van de gebruiker en is **draagbaar**
naar een andere omgeving. De export bevat het communicatieprofiel/de instellingen, de persoonlijke context en
de geleerde voorkeuren — **niet** account- of organisatiegegevens, id's of tokens. De payload wordt in zijn
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
zelf degene die aan tafel de vraag stelt. De lijst draagt daarom per account de `role`, zodat zichtbaar
blijft wie beheerder is. Een `USER`-account kan geen begeleider zijn (`400 NOT_A_CAREGIVER`).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/users/{id}/caregivers` | ADMIN | Alle CAREGIVER- én ADMIN-accounts van de eigen organisatie met per account de `role` en of het aan deze gebruiker gekoppeld is (`caregiverListResponseSchema`). |
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

### AAC-bibliotheek (T3.1, T3.2, T3.3)
De AAC-bibliotheek (`AacSymbol` + `AacConceptRelation`) is de beheerde woordenschat die de AI
begrenst (DESIGN §7.6). Ze is **gedeeld** — niet tenant-gebonden — maar niet publiek: zoeken vereist
een ingelogd account **óf** een gekoppeld apparaat (de tablet zoekt tijdens communicatie). Een
pictogram is óf een door een beheerder **geüploade afbeelding** (voorrang) óf een server-gerenderde
**SVG-placeholder** uit de emoji `glyph`.

**Zoeken en serveren (T3.1):**

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/aac/search?q=…` | account **of** apparaat | Zoekt hoofdletterongevoelig op concept, label én synoniemen (`aacSearchQuerySchema`; lege `q` → `400`). `200` + `aacSearchResponseSchema` (`{ symbols: [{ id, concept, label, category, glyph, synonyms, imageUrl, attribution }] }`; `attribution` = bron/licentie of `null`). Zonder account- of apparaat-auth → `401 NOT_AUTHENTICATED`. |
| GET | `/aac/topics` | account **of** apparaat | De symbolen die **antwoordopties hebben** (minstens één kind in de relatieboom) en dus als anker van een begeleidersvraag kunnen dienen (T9.7). `200` + `aacTopicListResponseSchema` (`{ topics: [AacSymbol] }`), alfabetisch op label, elk onderwerp één keer. Voedt de onderwerp-keuzelijst in de vraagmodus; precies de ankers die `POST /question/start` accepteert. Zonder auth → `401`. |
| GET | `/aac/images/{id}` | publiek | Pictogram van een symbool: de geüploade afbeelding met haar eigen `Content-Type`, of anders een `image/svg+xml`-placeholder (uit `glyph`+`label`), cachebaar. Bewust publiek: presentatiedata die de web-client als `<img src>` laadt. Onbekend id → `404 SYMBOL_NOT_FOUND`. `imageUrl` in de payload draagt na een upload een cache-buster `?v=<imageVersion>`. (Het oude pad met `.svg`-suffix blijft werken.) Antwoordt als enige route met `Cross-Origin-Resource-Policy: cross-origin`, zodat een web-client op een andere origin het plaatje als `<img src>` mag laden (T8.7, zie [security.md](security.md)); een 404 en alle andere routes houden `same-origin`. |

**Beheer (T3.2) — alléén ADMIN.** De bibliotheek is platformbreed gedeeld, dus deze routes worden
op **rol** bewaakt (niet tenant-gefilterd). Symbolen bekijken/zoeken, categorieën filteren, symbool
toevoegen/bewerken/verwijderen (incl. afbeelding-upload) en relaties leggen.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/aac/symbols?q=&category=` | ADMIN | Alle symbolen met relaties (`aacSymbolListResponseSchema`; elk symbool `aacSymbolAdminSchema` met `hasImage`, `children`/`parents`). Optioneel gefilterd op zoekterm en/of categorie. |
| POST | `/admin/aac/symbols` | ADMIN | Symbool aanmaken (`aacSymbolInputSchema`: `concept` op `^[a-z0-9-]+$`, `label`, `category`, `glyph`, `synonyms[]`). `201` + `aacSymbolAdminSchema`. Bestaand `concept` → `409 CONCEPT_EXISTS`. |
| PUT | `/admin/aac/symbols/{id}` | ADMIN | Symbool bewerken (volledige vervanging). Onbekend id → `404 SYMBOL_NOT_FOUND`; `concept`-botsing met ander symbool → `409 CONCEPT_EXISTS`. |
| DELETE | `/admin/aac/symbols/{id}` | ADMIN | Symbool verwijderen; relaties casceren mee. `204`. Onbekend id → `404`. |
| POST | `/admin/aac/symbols/{id}/image` | ADMIN | Pictogram uploaden (`multipart/form-data`, veld `file`). Allowlist PNG/JPEG/WebP → anders `415 UNSUPPORTED_IMAGE_TYPE`; groter dan `AAC_IMAGE_MAX_BYTES` → `413 IMAGE_TOO_LARGE`; geen bestand → `400 NO_FILE`. `200` + `aacSymbolAdminSchema` (`hasImage: true`). |
| POST | `/admin/aac/relations` | ADMIN | Relatie ouder→kind leggen (`aacRelationInputSchema`; `relation` standaard `"contains"`). `201` + het bijgewerkte oudersymbool. Zelfrelatie → `400 INVALID_RELATION`; onbekend symbool → `404 SYMBOL_NOT_FOUND`; bestaande relatie → `409 RELATION_EXISTS`. |
| DELETE | `/admin/aac/relations/{id}` | ADMIN | Relatie verwijderen. `204`. Onbekend id → `404 RELATION_NOT_FOUND`. |

**OpenSymbols-integratie (T3.3) — alléén ADMIN.** De backend proxyt namens de beheer-UI naar
[OpenSymbols](https://www.opensymbols.org/) (de client praat **nooit** rechtstreeks met externe
diensten, DESIGN §8.1). De integratie is uit als `OPENSYMBOLS_SECRET` leeg is → `503`. Een gekoppelde
afbeelding wordt **server-side** opgehaald en lokaal opgeslagen (dezelfde `AacSymbol.imageData`-opslag
als een upload), met bron/licentie op het symbool (`attribution`). Zie ADR-0006.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/aac/opensymbols/search?q=&locale=` | ADMIN | Zoekt bij OpenSymbols (`openSymbolsSearchQuerySchema`). `200` + `openSymbolsSearchResponseSchema` (`{ results: [{ id, name, imageUrl, extension, license, licenseUrl, author, authorUrl, sourceUrl }] }`). Alleen resultaten met een `https`-`imageUrl` worden teruggegeven. Niet geconfigureerd → `503 OPENSYMBOLS_UNAVAILABLE`; externe fout → `502 OPENSYMBOLS_ERROR`. |
| POST | `/admin/aac/symbols/{id}/opensymbols` | ADMIN | Gekozen afbeelding koppelen (`attachOpenSymbolsRequestSchema`: `imageUrl` (https), `license`, optioneel `licenseUrl`/`author`/`authorUrl`/`sourceUrl`). De backend haalt de bytes op (https-only + SSRF-guard), controleert content-type (PNG/JPEG/WebP → anders `415`) en grootte (`AAC_IMAGE_MAX_BYTES` → `413`), en slaat de afbeelding + bron/licentie op. `200` + `aacSymbolAdminSchema` (`hasImage: true`, `attribution` gevuld). Onbekend id → `404`; niet-`https`/interne host → `400 INVALID_IMAGE_URL`; externe/lege fout → `502`; niet geconfigureerd → `503`. |

### Gespreksflow — sessies, stappen en boodschap (T4.1, T4.3, T5.3)
Een gespreksessie (`ConversationSession`) is het tijdelijke communicatieproces waarin een gebruiker
via pictogramkeuzes zijn intentie opbouwt (DESIGN §3.1). Alle routes lopen op **apparaat-auth**
(`deviceAuthorize`, de `intento_device`-cookie): de tablet is aan precies één gebruiker gebonden,
dus elke sessie is automatisch **gebruiker-geïsoleerd** — een apparaat ziet nooit de sessies van een
andere gebruiker (`404 SESSION_NOT_FOUND`, bestaan lekt niet). De vraagselectie draait vanaf T5.2 op de
**AI-orchestrator**: de AAC-relatieboom levert de begrensde kandidaten (intentie-categorieën →
verfijning), de AI kiest/ordent daarbinnen, de **validatielaag** houdt onbekende concepten tegen en de
**interpretatie-zekerheid** (§7.4) bepaalt de fase. De beslissing is een **pure functie** van de reeds
gezette stappen (met de deterministische mock in tests), waardoor de terug-functie de vorige opties exact
herstelt.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/conversation/start` | apparaat | Start een `ACTIVE` sessie voor de eigen gebruiker. `201` + `conversationStateResponseSchema` (`{ sessionId, status, question: { prompt, options[] } \| null, done, confidence?, phase?, history[] }`): de eerste vraag toont de intentie-categorieën. |
| POST | `/conversation/{id}/next` | apparaat | **Kern-call:** keuze insturen (`conversationChoiceRequestSchema`, `{ symbolId }`) → stap opslaan en de door de **AI-orchestrator** gekozen **volgende vraag + opties** teruggeven (`conversationStateResponseSchema`), AAC-begrensd, gevalideerd, herhaling-vrij en op zekerheid geordend. `confidence` (interpretatie-zekerheid, §7.4) en `phase` (`select`/`refine`/`propose`) reizen mee. Bij een eindconcept of >85% zekerheid: `question: null`, `done: true`, `phase: 'propose'` (klaar voor een voorstel — T4.3/T5.3). Keuze buiten de huidige opties → `400 INVALID_CHOICE`; afgeronde sessie → `409 SESSION_NOT_ACTIVE`. |
| POST | `/conversation/{id}/choice` | apparaat | Keuze **alléén opslaan** (`{ symbolId }`). `201` + `conversationChoiceResponseSchema` (`{ sessionId, status, step, canRefine, history[] }`) — geen volgende vraag. Save-only primitive; een normale beurt gebruikt `/next`. Zelfde randen (`400`/`409`). |
| POST | `/conversation/{id}/back` | apparaat | Laatste keuze ongedaan maken (verwijdert de hoogste stap) en de vorige vraag/opties **exact** herstellen (`conversationStateResponseSchema`). Niets om ongedaan te maken → `400 NO_STEPS_TO_UNDO`. Bij een **vraagmodus**-sessie (T7.1) kan het door de begeleider gekozen topic-anker (de eerste stap) niet ongedaan worden gemaakt (`400` als alléén het anker rest), zodat het gesprek binnen de vraag blijft. |
| GET | `/conversation/pending` | apparaat | Openstaande **begeleidersvraag** ophalen (vraagmodus, T7.1). `200` + `pendingQuestionResponseSchema` (`{ state: conversationStateResponseSchema \| null }`): de nieuwste `ACTIVE` vraagmodus-sessie van de eigen gebruiker als volledige gesprekstoestand (met `caregiverQuestion` gevuld), of `null` → geen vraag klaar (de tablet start dan een vrij gesprek). |
| POST | `/conversation/{id}/correction` | apparaat | **Correctie** (❌ op een voorstel, T5.4, DESIGN §3.4, FR-009): `conversationCorrectionRequestSchema` (`{ type: "wrong_guess" }`, standaard — een lege body `{}` volstaat). De server **heranalyseert** de route en bepaalt uit de per-stap-zekerheid (`ConversationStep.confidence`, §7.4) de vermoedelijke **foutstap** (laagste zekerheid; tie → vroegste; terugval op de laatste stap), rolt die stap en alles erna terug, legt het afgewezen concept vast als **`CorrectionEvent`** en geeft een **gerichtere hervraag** terug (`conversationStateResponseSchema`) — **niet** terug naar het begin. Het afgewezen concept wordt de rest van de sessie **niet meer aangeboden** (§7.5). Er wordt niets geleerd/opgeslagen (sessie blijft `ACTIVE`). Zonder keuzes → `400 NO_STEPS_TO_CORRECT`; onbekend `type` → `400`; afgeronde sessie → `409 SESSION_NOT_ACTIVE`. |
| POST | `/conversation/{id}/generate` | apparaat | Boodschap **voorstellen** uit de gekozen concepten (T5.3): `200` + `conversationGenerateResponseSchema` (`{ sessionId, status, message, confidence, symbols[], history[] }`). De **AI-orchestrator** formuleert de zin (met `confidence`, §7.4), begrensd door de **safety-laag** die geen concept buiten de sessie doorlaat (§7.8); zonder AI-capability of bij een onveilige zin valt hij terug op de deterministische **sjabloon-zin**. **Vluchtig:** slaat niets op (DESIGN §3.6). Zonder gekozen concepten → `400 NO_STEPS_TO_GENERATE`; afgeronde sessie → `409 SESSION_NOT_ACTIVE`. |
| POST | `/conversation/{id}/confirm` | apparaat | Boodschap **bevestigen** (T5.3): rondt de sessie af (`status COMPLETED`) en slaat de boodschap op (`GeneratedMessage`, `confirmed: true`). `200` + `conversationConfirmResponseSchema` (`{ sessionId, status, message }`). De server hervormt de zin **server-side** uit de opgeslagen keuzes via de orchestrator (nooit vrije clienttekst), met dezelfde safety-terugval, zodat de bewaarde boodschap binnen de gekozen concepten blijft (DESIGN §7.8). Een **afwijzing** verloopt via `/correction` (gerichte hervraag, T5.4), niet hier — er wordt dan niets opgeslagen. Zelfde randen (`400 NO_STEPS_TO_GENERATE` / `409 SESSION_NOT_ACTIVE`). |

Ongeauthenticeerd (geen/ongeldige `intento_device`-cookie) → `401 DEVICE_NOT_LINKED`. Alleen **bevestigde**
communicatie wordt bewaard (DESIGN §3.6): `/generate` is vluchtig en afgewezen voorstellen belanden nooit
in de db — een `GeneratedMessage` bestaat pas na `/confirm`. Een **correctie** (❌) legt wél een
`CorrectionEvent` vast (correctie-signaal, géén communicatie-inhoud en géén leerdata: de `Preference`-laag
uit T6.3 wordt nooit door correcties geraakt); de afgewezen route blijft de rest van de sessie uitgesloten.
`conversationStateResponseSchema` draagt bij een vraagmodus-sessie ook `caregiverQuestion` (de letterlijke
begeleidersvraag) mee; bij een vrij gesprek is dat `null`/afwezig.

### Vraagmodus — begeleider stelt een vraag (T7.1, DESIGN §3.2, FR-012)
Een begeleider stelt een gekoppelde gebruiker een vraag ("Wat wil je drinken?"); de AI beperkt de
antwoorden en de gebruiker stelt zijn antwoord **zelf** samen en bevestigt (de begeleider bevestigt nooit
namens de gebruiker, DESIGN §2, §3.3). De vraag begrenst de antwoorden via een **AAC-topic-anker**: de
begeleider kiest naast de vraag een concept (bv. `drink`) waarvan de kinderen (water/sap/koffie/melk) de
antwoordopties vormen. Deze routes lopen op **account-auth** (sessiecookie), niet device-auth.

| Methode | Pad | Auth | Doel |
|---|---|---|---|
| GET | `/question/users` | ADMIN/CAREGIVER | Gebruikers waaraan dit account een vraag mag stellen: voor een CAREGIVER alléén de **gekoppelde** gebruikers, voor een ADMIN alle van de eigen organisatie (tenant-gefilterd). `200` + `userListResponseSchema`. |
| POST | `/question/start` | ADMIN/CAREGIVER | Start een vraagmodus-sessie: `questionStartRequestSchema` (`{ userId, question, anchorConcept }`). Maakt in één transactie een `ACTIVE` sessie (`mode: 'question'`, `caregiverQuestion`, `startedByAccountId`) met het topic-anker als vaste eerste stap. `201` + `questionStartResponseSchema` (`{ sessionId, userId, question }`). Tenant-grens (`assertSameTenant`) én begeleider-koppeling (`assertCaregiverAccess`) bewaakt: niet-gekoppelde CAREGIVER → `403`. Onbekend anker → `400 UNKNOWN_ANCHOR`; anker zonder kinderen (geen antwoordopties) → `400 ANCHOR_WITHOUT_OPTIONS`. |
| GET | `/question/users/{id}/conversation` | ADMIN/CAREGIVER | **Meekijken** met het lopende gesprek van een gekoppelde gebruiker (T7.2, DESIGN §3.3, FR-011). `200` + `caregiverConversationViewSchema` (`{ userId, userName, supportMode, session }`): een **read-only** snapshot uit de opgeslagen stappen (géén AI-aanroep) — of de gebruiker in **ondersteuningsmodus** staat, een eventuele `caregiverQuestion`, `mode`/`status` en het afgelegde pad (`history`/broodkruimel), of `session: null` als er geen `ACTIVE` gesprek loopt. Zelfde toegang als hierboven: niet-gekoppelde CAREGIVER of andere tenant → `403`. Kiezen/bevestigen kan hier niet — dat is exclusief van de gebruiker op de tablet. |

De vraag "verschijnt in de gebruikersapp": de tablet haalt de klaarstaande vraag op via
`GET /conversation/pending` en doorloopt daarna de gewone gespreksflow (`/next` → `/generate` →
`/confirm`) op die sessie. De begeleidersvraag reist als **context** (`questionContext`) mee in de
beperkte AI-prompt, zodat de AI de antwoorden op de vraag afstemt terwijl de opties AAC-begrensd blijven.

**Ondersteuningsmodus (T7.2, DESIGN §3.3, FR-011).** Staat `supportMode` in het communicatieprofiel aan,
dan tikt de begeleider aan namens de gebruiker; de tablet toont dat expliciet ("Ondersteuningsmodus
actief"), maar de betekenis blijft van de gebruiker. **Bevestigen kan nooit vanuit de begeleider-/beheer-UI**:
`POST /conversation/{id}/confirm` draait achter `forbidAccountSession` + `deviceAuthorize`. Draagt de
request een geldig **apparaat-token**, dan komt hij van de gekoppelde tablet van de gebruiker en gaat hij
door; draagt hij géén apparaat-token maar wél een account-sessie, dan `403 CONFIRM_REQUIRES_USER` — nog
vóór de device-auth (DESIGN §2, §3.3).

> **Waarom het apparaat wint (T9.5).** Cookies zijn per **origin**, niet per tab: een begeleider die in
> dezelfde browser is ingelogd in het beheer en daarnaast `/tablet` opent, stuurt onvermijdelijk beide
> cookies mee. De eerdere regel ("account-cookie ⇒ altijd 403") blokkeerde daardoor de gebruiker op zijn
> eigen tablet. De waarborg blijft even hard: bevestigen vereist een gekoppeld apparaat, en de beheer-/
> begeleider-UI heeft dat token niet.

## AI-orchestrator en validatielaag (intern, T5.1/T5.2/T5.3)

De AI is een **interne** laag; er is bewust **geen client-endpoint** dat rechtstreeks met de AI praat
(DESIGN §8.1). De interne interface backend ↔ orchestrator (DESIGN §8.2, `POST /ai/next-decision`) leeft
in `server/src/ai/` en is vanaf T5.2 achter `/conversation/{id}/next` gezet — er is dus **geen** nieuwe
publieke route; de vraagselectie is van de gescripte engine naar de orchestrator gewisseld.

De vorm van de interne AI-in-/uitvoer (zod, `server/src/ai/provider.ts` — **niet** in `@intento/shared`,
want de client kent ze niet):

- **Prompt (in):** `{ task: 'select_next_question', systemRules[], goal, aacRules[], userContext[],
  conversationContext[{concept, label}], lastChoice, availableSymbols[{concept, label}] }` — de beperkte,
  verse context (DESIGN §7.7), **zonder** chatgeschiedenis. `buildAiPrompt` is de enige bouwer; de
  sleutelset is gesloten. `availableSymbols` bevat alléén AAC-begrensde kandidaten, al ontdaan van reeds
  gekozen/afgewezen concepten (herhaling vermijden, §7.5).
- **Decision (uit):** `{ question, options[{symbol, confidence}], reason, confidence? }` — `symbol` is een
  **conceptsleutel**; per-optie-`confidence ∈ [0,1]`; de optionele top-level `confidence` is de
  **interpretatie-zekerheid** (§7.4). De orchestrator valideert de provider-uitvoer opnieuw (een
  provider/worker wordt nooit vertrouwd).
- **Boodschap-prompt (in, T5.3):** `{ task: 'generate_message', systemRules[], goal, aacRules[],
  userContext[], chosenConcepts[{concept, label}] }` — dezelfde beperkte, verse context (§7.7), **zonder**
  chatgeschiedenis en **zonder** opties/vraag; `buildMessagePrompt` is de enige bouwer.
- **Boodschap-resultaat (uit, T5.3):** `{ message, confidence? }`. De methode `generateMessage` is
  **optioneel** op een provider; ontbreekt ze (of levert ze een lege/onveilige zin), dan valt de
  conversatie-laag terug op de deterministische **sjabloon-zin** (`conversation/message.ts`). De
  **safety-laag** (`conversation/generate.ts`) toetst elke AI-zin tegen de AAC-bibliotheek: bevat de zin
  het label of een synoniem van een **niet-gekozen** concept, dan is hij onveilig (§7.8) en geldt de
  terugval. Zo bereikt een concept buiten de sessie de gebruiker (en de db) **nooit**.

**Validatielaag en confidence (T5.2, `ai/validation.ts` + `ai/thresholds.ts` + `conversation/decision.ts`):**

- **AAC-existentiecheck (§7.6, §7.8):** elk voorgesteld `symbol` moet bestaan in de bibliotheek. Bestaand
  concept → houden; synoniem/label → omzetten naar het echte concept; anders → een `ConceptProposal`
  (status `PENDING`) aanmaken en de optie **weglaten**. Een onbekend concept bereikt de gebruiker nooit.
- **Herhaling vermijden (§7.5):** al gekozen concepten (en optioneel expliciet uitgesloten concepten, bv.
  afgewezen keuzes bij een correctie — T5.4) vallen weg, vóór én na de AI-aanroep.
- **Confidence-drempels (§7.4):** de interpretatie-zekerheid bepaalt de fase — `select` (<60%, nieuwe
  vraag), `refine` (60–85%, verfijnen), `propose` (>85% of een eindconcept, boodschap voorstellen). Bij
  `propose` is er geen vraag meer (`question: null`, `done: true`). Overgebleven opties worden op zekerheid
  geordend (meest waarschijnlijke eerst).

Provider via env (`AI_PROVIDER`): `mock` (deterministisch, dev/test), `queue` (gedistribueerde workers —
T5.5, zie hieronder) of `ollama` (niet in-process; Ollama draait als worker achter de wachtrij — T5.6).
Zie [adr/0008](adr/0008-ai-provider-interface-and-orchestrator.md) en
[adr/0009](adr/0009-validation-layer-and-confidence-policy.md).

### AI-status (T9.4, DESIGN §7.2, §9.2)

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/ai/status` | account **of** apparaat | Draait er echt een AI mee? `200` + `aiStatusResponseSchema` (`{ mode, workerRequired, workersOnline, lastSeenAt, active }`). `mode` is de ingestelde `AI_PROVIDER`; `workerRequired` is waar bij `queue`; `workersOnline` telt de niet-ingetrokken worker-tokens met activiteit in de laatste 60 s; `active` is waar bij `queue` mét zo'n worker. Bewust **alleen infrastructuurmetadata** — geen prompts, gespreksinhoud, tokennamen of tenantgegevens, zodat ook de tablet het mag opvragen. Zonder auth → `401`. |

Beide interfaces tonen dit als een klein statuslampje ("AI denkt mee" / "Geen AI-worker actief" /
"Zonder AI"). Aanleiding is de gebruikerstest: de backend draaide op `AI_PROVIDER=mock` — de
deterministische mock-provider — en niets liet zien dat er geen AI meedacht.

## Gedistribueerde AI-workers — wachtrij en worker-protocol (T5.5, intern)

Bij `AI_PROVIDER=queue` zet de `QueueAiProvider` elke AI-aanvraag op een **DB-wachtrij** (`AiJob`) i.p.v.
ze in-process uit te voeren; externe workers (T5.6) halen jobs op en leveren gestructureerde output
terug. De client praat nog steeds **nooit** rechtstreeks met de AI — een worker is backend-infrastructuur.
De worker-uitvoer doorloopt exact dezelfde zod-parse (orchestrator) én AAC-validatielaag (T5.2), dus een
onbekend concept van een worker bereikt de gebruiker nooit. Zie [adr/0010](adr/0010-distributed-ai-worker-queue.md).

**Backpressure.** Boven `AI_WORKER_MAX_CONCURRENT_JOBS` gelijktijdige jobs krijgt de aanvrager
`WAITING_FOR_WORKER` met een positie; de gespreks-endpoints antwoorden dan met
`503 AI_WORKER_BUSY` + `Retry-After` (body: `{ error, waiting: true, position, retryAfterMs }`) i.p.v. te
blokkeren. Time-out/mislukking → `503 AI_WORKER_UNAVAILABLE`.

**Client-afhandeling (T5.7).** De tablet-app toont deze 503's niet als fout: ze verschijnen als een
rustige wachtstand ("Even geduld…", optioneel de plek in de rij) en de app **polt** de laatste
gespreks-actie na `Retry-After` automatisch opnieuw tot er een vraag/voorstel terugkomt. De web-client
valideert de responsvorm met het gedeelde `aiWaitingErrorSchema` en herkent de wacht-codes via
`isAiWaitingError` ([`web/src/api.ts`](../web/src/api.ts), [`web/src/TabletApp.tsx`](../web/src/TabletApp.tsx)).

**Worker-endpoints** (`server/src/routes/ai-worker.ts`) — **worker-initiated** (long-poll, robuust achter
NAT), authenticatie met een **worker-token** in de `Authorization: Bearer …`-header (apart van gebruiker-/
device-/sessietokens; **gehasht** at-rest, scope `ai:process`, intrekbaar/verlopend), per-IP rate-limited:

| Methode | Pad | Doel |
|---|---|---|
| POST | `/ai/worker/claim` | Claim de oudste wachtende job (long-poll). `200` + `{ job: { id, task, payload } }` (payload = de beperkte prompt-context) of `204` als er niets claimbaar is. |
| POST | `/ai/worker/jobs/{id}/heartbeat` | Lease verlengen tijdens lange inferentie. `200` + `{ leaseExpiresAt }`; niet (meer) eigenaar → `409 JOB_NOT_CLAIMED`. |
| POST | `/ai/worker/jobs/{id}/result` | Gestructureerd resultaat inleveren; **op de grens gevalideerd** tegen het bij de taak horende zod-schema (verkeerde vorm → `400`). `200`; niet (meer) eigenaar → `409`. |
| POST | `/ai/worker/jobs/{id}/fail` | Nette teruggave bij een fout (`{ message? }`): terug in de wachtrij (pogingen over) of afgeschreven. `200`; niet (meer) eigenaar → `409`. |

Auth-fouten: geen/onbekend token → `401 WORKER_UNAUTHENTICATED`; ingetrokken/verlopen → `403
WORKER_TOKEN_INACTIVE`; ontbrekende scope → `403 WORKER_SCOPE_DENIED`. Een worker-token wordt gemunt via
de beheer-UI (zie hieronder) of via de CLI
`npm run worker-token:create --workspace=server -- --name <label> [--ttl-days N] [--scopes ai:process]`
(het rauwe token wordt één keer getoond).

**Worker-tokenbeheer** (`server/src/routes/worker-tokens.ts`, T5.8) — beheer van dezelfde infrastructuur-
credentials via de beheer-UI. Worker-tokens zijn **platform-infrastructuur** (niet tenant-gebonden), dus
beheer is voorbehouden aan een **ADMIN van de platformorganisatie** (`Organization.isPlatform`): naast
`authorize({ roles: ['ADMIN'] })` hangt `requirePlatformOrg`. Het rauwe token verlaat de server alléén bij
aanmaken.

| Methode | Pad | Doel |
|---|---|---|
| GET | `/admin/worker-tokens` | Lijst van worker-tokens (naam, scopes, status `active`/`revoked`/`expired`, `lastSeenAt`, `expiresAt`). Nooit de hash of het rauwe token. |
| POST | `/admin/worker-tokens` | Nieuw token (`{ name, scopes?, ttlDays? }`). `201` + `{ workerToken, token }` — `token` is het **rauwe** token, hier één keer zichtbaar. |
| POST | `/admin/worker-tokens/{id}/revoke` | Token intrekken (idempotent). `200` + de bijgewerkte weergave; daarna weigert `workerAuthorize` het (`403`). Onbekend id → `404 WORKER_TOKEN_NOT_FOUND`. |

Auth-fouten: geen sessie → `401 NOT_AUTHENTICATED`; wel ADMIN maar geen platformorganisatie → `403
NOT_PLATFORM_ADMIN`; verkeerde rol → `403 FORBIDDEN`.

### Beheerdashboard en conceptvoorstellen (T7.3, DESIGN §5.2, FR-016)

Alle endpoints eisen `authorize({ roles: ['ADMIN'] })` (geen sessie → `401`; andere rol → `403 FORBIDDEN`).

**Dashboard** (`server/src/routes/dashboard.ts`) — beknopt overzicht van de **eigen organisatie**.
De tellingen zijn tenant-gefilterd op `organizationId` (T1.2); alleen `pendingProposals` is platformbreed
(de AAC-bibliotheek en haar voorstellen zijn gedeeld). De recente activiteit bevat **geen
communicatie-inhoud** (privacy by design, DESIGN §6.4): alleen gebruikersnaam, status/modus, het aantal
bevestigde boodschappen en het starttijdstip.

| Methode | Pad | Doel |
|---|---|---|
| GET | `/admin/dashboard` | `200` + `dashboardResponseSchema`: `{ users: { total, active }, caregivers: { total }, pendingProposals, recentActivity[] }`. |

**AI-conceptvoorstellen** (`server/src/routes/concept-proposals.ts`) — reviewlijst en beoordeling van
begrippen die de validatielaag (T5.2) vastlegde toen de AI een concept aandroeg dat niet in de bibliotheek
bestaat (de optie bereikte de gebruiker nooit). Net als het AAC-beheer **platformbreed gedeeld** (niet
tenant-gefilterd); rolcontrole (ADMIN) volstaat. Bij **goedkeuren** wordt het begrip als synoniem aan het
gekozen pictogram toegevoegd, zodat de validatielaag het voortaan herkent en de AI het mag aanbieden
(FR-016: "pas na goedkeuring beschikbaar voor de AI").

| Methode | Pad | Doel |
|---|---|---|
| GET | `/admin/concept-proposals` | Reviewlijst (openstaande `PENDING` eerst). `200` + `conceptProposalListResponseSchema` (elk voorstel met `concept`, `reason`, `status`, `linkedSymbol`). |
| POST | `/admin/concept-proposals/{id}/approve` | Koppel het begrip aan een bestaand pictogram (`{ symbolId }`). `200` + `conceptProposalSchema` (`status: "APPROVED"`, `linkedSymbol` gevuld). Onbekend voorstel → `404 PROPOSAL_NOT_FOUND`; onbekend pictogram → `404 SYMBOL_NOT_FOUND`; al goedgekeurd → `409 PROPOSAL_ALREADY_HANDLED`. |
| POST | `/admin/concept-proposals/{id}/reject` | Voorstel afwijzen; het begrip blijft buiten de AAC-begrenzing. `200` + `conceptProposalSchema` (`status: "REJECTED"`). Onbekend → `404`; al goedgekeurd → `409`. |

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
actor en **zonder** tenant (`organizationId: null`), zoals bij worker-tokens.

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
