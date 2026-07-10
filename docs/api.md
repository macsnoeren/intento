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

### Auth (T1.1, T1.3, T1.4)
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/auth/register` | publiek | Body `{ organizationName, organizationType, adminName, email, password }` (`registerRequestSchema`). Maakt in **één transactie** een nieuwe `Organization` (`type` ∈ family/care/personal) + eerste ADMIN-`Account` (argon2id) en logt meteen in: `201` + `{ account }` en een `intento_session`-cookie. Verstuurt daarna een **verificatiemail** (T1.4, best-effort — een falende mailserver blokkeert de registratie niet). Reeds bestaand e-mailadres → `409 REGISTRATION_FAILED` (bewust generiek: lekt niet of het adres bestaat). Zwak wachtwoord (<12 tekens) / ongeldig `organizationType` / ongeldige e-mail → `400 VALIDATION_ERROR`. Te veel verzoeken → `429`. Streng rate-limited per IP. |
| POST | `/auth/login` | publiek | Body `{ email, password }` (`loginRequestSchema`). Bij succes: `200` + `{ account }` en een `intento_session`-cookie. Fout wachtwoord/onbekende e-mail → `401 INVALID_CREDENTIALS` (bewust generiek). Te veel pogingen → `423 ACCOUNT_LOCKED`. Te veel verzoeken → `429`. Streng rate-limited per IP. Onbevestigde accounts mogen inloggen (zie verificatie-gate hieronder). |
| POST | `/auth/logout` | cookie | Verwijdert de serverzijdige sessie en wist de cookie. Altijd `204`. |
| GET | `/auth/me` | cookie | Huidig account (`{ account }`) of `401 NOT_AUTHENTICATED`. |
| POST | `/auth/verify-email` | publiek | Body `{ token }` (`verifyEmailRequestSchema`). Wisselt het verificatietoken in: `200` + `{ verified: true, account }` (`verifyEmailResponseSchema`). Ongeldig/verlopen/reeds gebruikt token → `400 INVALID_VERIFICATION_TOKEN` (neutrale melding, geen enumeratie). |
| GET | `/auth/verify-email?token=…` | publiek | Zelfde logica als de POST-variant, zodat een directe klik op de maillink ook werkt. |
| POST | `/auth/verify-email/resend` | publiek | Body `{ email }` (`resendVerificationRequestSchema`). Verstuurt een nieuw token als er een **onbevestigd** account bij het adres hoort. Antwoordt **altijd** neutraal `200 { message }` (`resendVerificationResponseSchema`) — of het adres nu bestaat, al geverifieerd is, of onbekend. Streng rate-limited per IP → `429`. |

Responsevorm `{ account }` = `authResponseSchema` (nooit `passwordHash` of lockout-velden); `account.emailVerified` (boolean) geeft de verificatiestatus.
`/auth/me` gebruikt sinds T1.2 hetzelfde `authorize(...)`-preHandler als beschermde routes.

**Verificatie-gate (T1.4).** Onbevestigde accounts mogen inloggen en hun eigen gegevens bekijken, maar **gevoelige acties zijn geblokkeerd tot verificatie**. In de MVP is dat het aanmaken van gebruikers: `POST /users` → `403 EMAIL_NOT_VERIFIED` zolang `emailVerified` false is. De verificatietoken staat **gehasht** at-rest, is eenmalig en verloopt (`EMAIL_VERIFICATION_TTL_HOURS`).

### Accounts (T1.2)
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/accounts` | ADMIN | Lijst van logins **binnen de eigen organisatie** (`accountListResponseSchema`). Rol-beperkt (`403 FORBIDDEN` voor CAREGIVER/USER) en tenant-gefilterd op `organizationId`. Representatief voorbeeld van de autorisatie-/isolatielaag. |

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

### Begeleiders koppelen (T2.2)
Een beheerder bepaalt welke begeleiders (CAREGIVER-accounts) aan een gebruiker gekoppeld zijn.
De koppeling stuurt de toegang: een niet-gekoppelde begeleider krijgt op de gebruiker-routes
hierboven `403 FORBIDDEN`. Beide endpoints zijn tenant-gebonden (gebruiker én begeleider moeten
in de eigen organisatie zitten, anders `403`).

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/admin/users/{id}/caregivers` | ADMIN | Alle CAREGIVER-accounts van de eigen organisatie met per account of het aan deze gebruiker gekoppeld is (`caregiverListResponseSchema`). |
| POST | `/admin/users/{id}/caregivers` | ADMIN | Koppelt (`{ accountId, linked: true }`) of ontkoppelt (`linked: false`) één begeleider (`linkCaregiverRequestSchema`); idempotent. `200` + de bijgewerkte lijst. Account is geen CAREGIVER → `400 NOT_A_CAREGIVER`; account uit een andere organisatie → `403 FORBIDDEN`. |

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
| GET | `/aac/images/{id}` | publiek | Pictogram van een symbool: de geüploade afbeelding met haar eigen `Content-Type`, of anders een `image/svg+xml`-placeholder (uit `glyph`+`label`), cachebaar. Bewust publiek: presentatiedata die de web-client als `<img src>` laadt. Onbekend id → `404 SYMBOL_NOT_FOUND`. `imageUrl` in de payload draagt na een upload een cache-buster `?v=<imageVersion>`. (Het oude pad met `.svg`-suffix blijft werken.) |

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

### Gespreksflow — sessies en stappen (T4.1)
Een gespreksessie (`ConversationSession`) is het tijdelijke communicatieproces waarin een gebruiker
via pictogramkeuzes zijn intentie opbouwt (DESIGN §3.1). Alle routes lopen op **apparaat-auth**
(`deviceAuthorize`, de `intento_device`-cookie): de tablet is aan precies één gebruiker gebonden,
dus elke sessie is automatisch **gebruiker-geïsoleerd** — een apparaat ziet nooit de sessies van een
andere gebruiker (`404 SESSION_NOT_FOUND`, bestaan lekt niet). De vraagselectie draait in deze fase op
een **gescripte engine** over de AAC-relatieboom (intentie-categorieën → verfijning); de AI-orchestrator
neemt die rol later over achter dezelfde interface (fase 5). De "huidige vraag" is een **pure functie**
van de reeds gezette stappen, waardoor de terug-functie de vorige opties exact herstelt.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/conversation/start` | apparaat | Start een `ACTIVE` sessie voor de eigen gebruiker. `201` + `conversationStateResponseSchema` (`{ sessionId, status, question: { prompt, options[] } \| null, done, history[] }`): de eerste vraag toont de intentie-categorieën. |
| POST | `/conversation/{id}/next` | apparaat | **Kern-call:** keuze insturen (`conversationChoiceRequestSchema`, `{ symbolId }`) → stap opslaan en de **volgende vraag + opties** teruggeven (`conversationStateResponseSchema`). Bij een eindconcept: `question: null`, `done: true` (klaar voor een voorstel — T4.3). Keuze buiten de huidige opties → `400 INVALID_CHOICE`; afgeronde sessie → `409 SESSION_NOT_ACTIVE`. |
| POST | `/conversation/{id}/choice` | apparaat | Keuze **alléén opslaan** (`{ symbolId }`). `201` + `conversationChoiceResponseSchema` (`{ sessionId, status, step, canRefine, history[] }`) — geen volgende vraag. Save-only primitive; een normale beurt gebruikt `/next`. Zelfde randen (`400`/`409`). |
| POST | `/conversation/{id}/back` | apparaat | Laatste keuze ongedaan maken (verwijdert de hoogste stap) en de vorige vraag/opties **exact** herstellen (`conversationStateResponseSchema`). Niets om ongedaan te maken → `400 NO_STEPS_TO_UNDO`. |

Ongeauthenticeerd (geen/ongeldige `intento_device`-cookie) → `401 DEVICE_NOT_LINKED`. Alleen bevestigde
communicatie wordt uiteindelijk bewaard (DESIGN §3.6); het genereren en bevestigen van de boodschap
volgt in T4.3.

<Volgende domeinen (AI-orchestrator, …) worden hier per taak toegevoegd.>
