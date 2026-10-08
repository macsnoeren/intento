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
| GET · POST | `/users/{id}/contacts` | ADMIN, CAREGIVER | Contacten van een gebruiker (N10.1, §28): `GET` → `contactListResponseSchema` in de vaste volgorde; `POST` met `{ name, relation?, email, vocabularyItemId?, sortOrder? }` (`contactCreateRequestSchema`, strict; naam 1–60 en relatie 1–40 tekens zonder stuurtekens, e-mail in kleine letters) → `201` + het contact. Zonder `sortOrder` komt het contact achteraan. Het pictogram moet een bruikbaar item uit de Vocabulary van de organisatie zijn (`422 SYMBOL_NOT_AVAILABLE`). Een nieuw contact is nog niet bevestigd (`emailVerified: false`) en krijgt meteen een bevestigingsmail (N10.2); mislukt die, dan staat het contact er toch en kan de mail opnieuw. Naam en e-mail staan versleuteld in de database en gaan nooit naar de agentdienst. Gebruiker van een andere organisatie of een niet-gekoppelde begeleider → `403`. Geaudit als `contact.create`, zonder naam of e-mail. |
| PATCH · DELETE | `/users/{id}/contacts/{contactId}` | ADMIN, CAREGIVER | Wijzigen (`contactUpdateRequestSchema`: `name`, `relation` (of `null`), `email`, `vocabularyItemId` (of `null`), `active`, `sortOrder`; minstens één veld) of verwijderen (`204`). Een **ander** e-mailadres zet de bevestiging terug, laat de oude link vervallen en stuurt een nieuwe bevestigingsmail; hetzelfde adres (ook in andere hoofdletters) niet. Een contact dat niet bij deze gebruiker hoort → `404`. Geaudit als `contact.update` (veldnamen en of het adres veranderde) en `contact.delete`. |
| POST | `/users/{id}/contacts/{contactId}/verification` | ADMIN, CAREGIVER | De bevestigingsmail opnieuw versturen (N10.2); de vorige link vervalt. Al bevestigd → `409 ALREADY_VERIFIED`; mail mislukt → `502 MAIL_FAILED`. Streng rate-limited (`RESEND_RATE_LIMIT_*`). Geaudit als `contact.verification.send`. `204`. |
| GET | `/contacts/verify?token=` | publiek | Werkt deze bevestigingslink nog? `{ valid }`. **Verandert niets**: een mailscanner die de link opent, geeft geen toestemming. Rate-limited (30/min). |
| POST | `/contacts/verify` | publiek | Het contact geeft zelf toestemming (opt-in, V5): `{ token }` → `200 { verified: true }`. Onbekend, verlopen of al gebruikt geven dezelfde `400 INVALID_OR_EXPIRED`. Token eenmalig, alleen als hash opgeslagen, standaard 7 dagen geldig (`CONTACT_VERIFICATION_TTL_HOURS`). Geaudit als `contact.verify` (zonder account, met de organisatie). |
| GET | `/messages?page=&pageSize=` | ADMIN | Berichtenoverzicht (N11.6, §32): de bevestigde berichten van de eigen organisatie, nieuwste eerst (`messageListResponseSchema`): wanneer, gebruiker (id en naam), de boodschap (ontsleuteld) en per verzending de naam van het contact (`null` als het verwijderd is), status (`sending`/`sent`/`failed`) en tijd; geen verzendingen = niet verstuurd. `pageSize` 1–100 (standaard 25). Elke opvraging wordt geaudit als `message.list` (zonder inhoud). Begeleider `403`. |
| GET · DELETE | `/users/{id}/experience` | ADMIN | Ervaring van een gebruiker (N12.3, §22, §49). `GET` → `userExperienceSchema`: `enabled` (staat Experience aan), de bovenste 12 symbolen (woord, ondertekende afbeelding-URL, `presented`, `chosen`, `chosenAtFirstPosition`, `lastUsedAt`; ook een ingetrokken item, dan zonder afbeelding), de contacten die nog bestaan (met naam, ontsleuteld), de vormen en `symbolCount` (alle getelde symbolen). Plus `notes`: de observaties van de Experience Agent uit de laatste 10 bekeken gesprekken (N12.4; `about`, `text`, `confidence`, `createdAt`), nieuwste eerst — observaties, geen waarheid. `DELETE` = "Ervaring wissen": alle tellingen én observaties van deze gebruiker weg → `{ deleted }`; al bekeken gesprekken tellen daarna niet opnieuw mee. Geaudit als `experience.view` en `experience.clear` (met het aantal, zonder woorden of namen). Gebruiker van een andere organisatie of onbekend id → `403`; begeleider `403`. |
| GET | `/users/{id}/sessions?page=&pageSize=` | ADMIN | De gesprekken van een gebruiker (N14.1, §49), nieuwste eerst (`sessionListResponseSchema`): id, begin, einde, status (`active` zolang het loopt, anders `confirmed`/`stopped`) en het aantal getoonde schermen. Geen inhoud. `pageSize` 1–100 (standaard 25). Gebruiker van een andere organisatie of onbekend id → `403`; begeleider `403`. |
| GET | `/communication/sessions/{id}/provenance` | ADMIN | Eén gesprek terugzien (N14.1, §26, §27; `sessionReviewSchema`): per beurt **Getoond** (soort, vorm, tekst, boodschap, opties met label, concept, dekking en plek), **Gekozen** (de handelingen met plek en reactietijd), **Gedacht** (inferences: agent, soort, payload, zekerheid) en de **agentbeslissingen** (agent, status, model, promptversie, duur, validatie, reden) — apart, zoals opgeslagen. Ontsleuteld, dus geaudit als `session.view` (zonder inhoud). Gesprek van een andere organisatie of onbekend id → `403`; begeleider `403`. Alleen binnen de bewaartermijn. |
| GET | `/reports/bias?days=&userId=` | ADMIN | Bias-rapport (N14.3, §24 B4/B5; `biasReportSchema`) over de eigen organisatie, of één gebruiker daarvan, binnen de bewaartermijn of de laatste `days` (1–365) dagen: aandeel keuzes op de eerste plek bij tegels (met wat je bij toeval verwacht), JA-aandeel bij ja/nee-vragen, per contact hoe vaak gekozen en hoe vaak als eerste aangeboden, vormwisselingen bij "AI kiest", ontbrekende woorden (organisatiebreed) en overconfidence (voorstellen ≥ 0,9 met NEE; een stijging ≥ 0,4 zonder JA of keuze). Contactnamen ontsleuteld, verwijderd contact → `null`. `userId` van een andere organisatie of onbekend → `403`; begeleider `403`. |
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
| GET | `/vocabulary?q=&status=&labelStatus=&page=&pageSize=` | ADMIN, CAREGIVER | De items die voor de eigen organisatie beschikbaar zijn (platform + eigen, nooit van een andere organisatie), gesorteerd op `sortOrder`. `q` zoekt hoofdletterongevoelig: in labels en synoniemen overal in het woord ("pijn" → hoofdpijn), in concepten alleen aan het begin van een woord ("pain" → `chest_pain`, maar "oma" niet → `stomach`); exacte labeltreffers staan vooraan (N2.15); `status` is standaard `approved` (ingetrokken items alleen met `status=retired`); `pageSize` 1–100 (standaard 24). `200` + `vocabularyListResponseSchema` (`{ items, total, page, pageSize, machineOpen }`); `machineOpen` telt de machinevertalingen in gebruik die deze organisatie mag nakijken (N8.8): de eigen items, en de startset alleen voor de platformorganisatie. `labelStatus=machine` filtert op dezelfde set, zodat een organisatie geen startsetitems te zien krijgt die ze niet kan wijzigen; per item `scope` (`platform`/`organization`), licentie en herkomst, en een ondertekende `imageUrl` (`null` zonder afbeelding of bij een ingetrokken item). Een tablet (apparaatsessie) krijgt `401`. |
| GET | `/vocabulary/attributions` | account of apparaat | De bronvermelding (`attributionListResponseSchema`): per bron naam, licentie, maker, of naamsvermelding vereist is, en de symbolen (id + label) die deze organisatie gebruikt (platform + eigen, alleen `approved`). Voor iedereen binnen de organisatie, ook de tablet; zonder sessie `401`, gedeactiveerde organisatie `403`. |
| POST | `/vocabulary/{id}/retire` · `/vocabulary/{id}/restore` | ADMIN | Intrekken (`status: retired`) of terugzetten (`approved`). Een item wordt nooit verwijderd; ingetrokken gaat het niet meer naar de agentdienst en levert `/assets` hem niet meer. Zelfde rechten als `PATCH`; geaudit als `vocabulary.retire`/`vocabulary.restore`. Idempotent. `200` + het item. |
| GET | `/vocabulary/external/search?q=` | ADMIN | Zoeken in OpenSymbols via de backend (N8.4). `q` 1–100 tekens. Per resultaat: naam, https-afbeeldings-URL, licentie (tekst en URL), auteur, bron, plus `licenseKey` (vaste sleutel, bv. `CC-BY-SA-4.0`, of `UNKNOWN`) en `allowed` (volgens `VOCABULARY_ALLOWED_LICENSES`). Hooguit 50 resultaten; 30 zoekopdrachten per minuut. Zonder `OPENSYMBOLS_SECRET` `503 EXTERNAL_SOURCE_UNAVAILABLE`; bron faalt `502 EXTERNAL_SEARCH_FAILED`. |
| POST | `/vocabulary/import` | ADMIN | Een extern symbool overnemen (N8.5): `{ query, id, label, synonyms?, concepts, contexts? }` (`externalImportRequestSchema`). De server zoekt het symbool opnieuw bij OpenSymbols op en neemt licentie, auteur, bron en afbeelding **van de bron**, nooit van de client. Alleen een toegestane licentie (`422 LICENSE_NOT_ALLOWED`); de afbeelding alleen via https van een host uit `VOCABULARY_IMAGE_HOSTS` (`422 IMAGE_HOST_NOT_ALLOWED`), hooguit `UPLOAD_MAX_BYTES` (`422 IMAGE_TOO_LARGE`), PNG/JPEG/WebP op inhoud (`422 UNSUPPORTED_IMAGE`). Gekopieerd naar `external/<organisatie>/<sha256>`; per organisatie één keer (`409 ALREADY_IMPORTED`). Onbekend id `404`, bron faalt `502`, niet ingesteld `503`. Geaudit als `vocabulary.import`. `201` + het item. |
| POST | `/vocabulary/upload` | ADMIN | Eigen afbeelding + woord (multipart, N8.1). Velden: `file` (PNG, JPEG of WebP, hooguit `UPLOAD_MAX_BYTES`), `label`, `synonyms` en `concepts` en `contexts` als kommalijst, en `rightsConfirmed=true` ("wij mogen deze afbeelding gebruiken", verplicht; `vocabularyUploadFieldsSchema`). De inhoud wordt gecontroleerd (magic bytes), niet de extensie of het opgegeven type; SVG wordt geweigerd. Opgeslagen onder `own/<organisatie>/<sha256>.<ext>`; licentie `own` met de beheerder als uploader en de datum. Voor de eigen organisatie; geaudit als `vocabulary.upload`. `201` + het item. Verkeerd type `415 UNSUPPORTED_IMAGE`, te groot `413 IMAGE_TOO_LARGE`, ontbrekend vinkje of ongeldige velden `400`, begeleider `403`. |
| GET | `/vocabulary/gaps?status=` | ADMIN | Ontbrekende woorden van de eigen organisatie (N9.2, §17): `status` `open` (standaard), `dismissed` of `resolved`; vaakst en laatst eerst, hooguit 200. Per woord concept, woord, context, hoe vaak, eerst/laatst gezien, status en het pictogram dat de gebruiker in plaats ervan zag (`bestAvailable`: id, label, ondertekende `imageUrl`, of `null`). Plus `open`: het aantal open woorden. Nooit een gebruiker of gesprek. Begeleider `403`, ongeldige status `400`. |
| GET | `/vocabulary/gaps/count` | ADMIN | Alleen `{ open }`: het aantal open ontbrekende woorden van de eigen organisatie, voor de teller in het menu (N9.3). |
| GET · PUT | `/account/notifications` | ADMIN | Meldingen van het eigen account: `{ notifyGapsByEmail, copySentMessages }` (`accountNotificationsSchema`); `PUT` wijzigt één of beide (`accountNotificationsUpdateSchema`, strict, minstens één veld). `notifyGapsByEmail` (N9.3): één e-mail per **nieuw** ontbrekend woord van de organisatie, niet per keer dat het voorkomt. `copySentMessages` (N11.7): een kopie van elke geslaagde verzending in de organisatie, met de ontvanger erbij. Alleen met een bevestigd e-mailadres; allebei standaard uit. `PUT` geaudit als `account.notifications.update`. Begeleider `403`. |
| POST | `/vocabulary/gaps/{id}/resolve` · `…/dismiss` · `…/reopen` | ADMIN | Opgelost (na "Woord toevoegen"), negeren of weer openzetten. Alleen woorden van de eigen organisatie; een woord van een andere organisatie of een onbekend id → `403 FORBIDDEN` (verraadt niet of het bestaat). Geaudit als `vocabulary.gap.resolve`/`.dismiss`/`.reopen`, zonder het woord. `200` + het woord. |
| PATCH | `/vocabulary/{id}` | ADMIN | Bewerkt `labels` (eerste = hoofdlabel, rest synoniemen), `concepts` (conceptsleutels), `contexts` (vaste lijst), `isStart`, `sortOrder` (`vocabularyUpdateRequestSchema`, strict, minstens één veld). Een gewijzigd label wordt `labelStatus: reviewed`; `{ labelStatus: 'reviewed' }` alleen ("Klopt", N8.8) doet dat zonder het woord te veranderen. Terug naar `machine` kan niet (`400`). Alleen items van de eigen organisatie; een platformitem alleen door een beheerder van de platformorganisatie (anders `403 PLATFORM_ITEM`); een item van een andere organisatie of een onbekend id → `403 FORBIDDEN`. Geaudit als `vocabulary.update` (met de veldnamen, niet de waarden). `200` + het bijgewerkte item. |

### Organisatie (N3.3, INTENTO-NEW-DESIGN §50, §53)

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/organization/settings` | ADMIN | De bewaartermijn van de eigen organisatie (`organizationSettingsSchema`: `{ retentionDays, retentionDaysDefault, usesDefault }`). |
| PUT | `/organization/settings` | ADMIN | `{ retentionDays: 7–365 \| null }` (`null` = de standaard `RETENTION_DEFAULT_DAYS` volgen). Altijd de eigen organisatie; geaudit als `organization.settings.update`. `200` + de nieuwe instellingen; buiten de grenzen `400`. |

### Gesprekken op de tablet (N4.5, INTENTO-NEW-DESIGN §48, §51, §52)

Alleen met een **apparaatsessie** (device-cookie); de tablet praat nooit met de agentdienst. Een beurt
geeft altijd `communicationTurnSchema`: `{ sessionId, turn, presentation }`, waarbij de presentatie
alleen bevat wat de tablet toont (`kind`, `mode`, `text`, `message`, en per optie `ref`, `kind`,
`label`, ondertekende `imageUrl`, `representation`, `position`) — geen concepten, Vocabulary-ids of
contact-ids — plus `canGoBack` (of ↩ Terug hier kan: niet op het eerste scherm, niet na een verzending). Rate limit 60 per minuut.

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/communication/sessions` | apparaat | Start een gesprek. Een lopend gesprek van deze gebruiker wordt `stopped`. De backend legt Observed `start` vast, stuurt de agentdienst event `start` met de instellingen uit het profiel en de beschikbare Vocabulary (platform + eigen organisatie, `approved`), toetst het antwoord aan de harde invarianten en slaat momentopname, Presented, Inferred en beslissingen op. `201` + de beurt. Agentdienst onbereikbaar, time-out, ongeldig of invariant geschonden → `503 AGENT_UNAVAILABLE` (vastgelegd als `AgentDecision` `failed`/`invalid`; het nieuwe gesprek wordt gestopt). Geen symbolen → `503 VOCABULARY_EMPTY`. Zonder gekoppeld apparaat `401`. |
| GET | `/communication/sessions/current` | apparaat | Het lopende gesprek hervatten (na herladen): `{ current: <beurt> }` met exact het scherm dat er stond (verse afbeeldings-URL's, geen agentaanroep), of `{ current: null }`. Een gestopt of afgerond gesprek wordt nooit hervat. |
| POST | `/communication/sessions/{id}/answer` | apparaat | Antwoord op het huidige scherm (`answerRequestSchema`): `{ turn, answer: "yes" \| "no" }`, `{ turn, optionRef }` of `{ turn, noneOfThese: true }`, elk met optioneel `responseTimeMs`. JA/NEE alleen op een binary of bevestigingsscherm, een tegel of "Geen van deze" alleen in multi-icon (anders `400 ANSWER_NOT_ALLOWED`; een ref die niet op het scherm stond `400 UNKNOWN_OPTION`). Observed (type, ref, plek, reactietijd) wordt vastgelegd **vóór** de agentaanroep, bij de beurt van het beantwoorde scherm; het nieuwe scherm krijgt het volgende beurtnummer. `200` + de beurt. Verouderde `turn` (dubbele tik, twee tegelijk) → `409 STALE_TURN`; gesprek afgelopen → `409 SESSION_ENDED`; niets te antwoorden (klaar/gestopt) → `409 NOTHING_TO_ANSWER`; niet van deze gebruiker → `404 SESSION_NOT_FOUND`; agent faalt → `503 AGENT_UNAVAILABLE` (het gesprek blijft op het huidige scherm, opnieuw proberen kan). JA op een "Bedoel je: …?"-scherm legt de **bevestigde boodschap** vast (`CommunicationIntent`, I2) vóór de agentaanroep; het gesprek wordt `confirmed`. Een herhaalde JA na een agentfout telt niet dubbel. JA op "Wil je dit naar {naam} sturen?" (of in multi-icon "Naar {naam} sturen?") **verstuurt** de bevestigde boodschap per e-mail (N11.3, I3): alleen de backend, alleen na deze Observed JA op een scherm met precies dat ene contact, alleen naar een contact van deze gebruiker dat actief en bevestigd is (anders `409 CANNOT_SEND`, niets verstuurd). De mail bevat de boodschap en de naam van de gebruiker. Vastgelegd als `Delivery` (`sent`/`failed`), uniek per gesprek en contact (een herhaalde JA verstuurt niet nog eens), en geaudit als `message.send`. Een mailfout breekt het gesprek niet: status `failed`. Na een geslaagde verzending is ↩ Terug weg. Het scherm direct na een verzending heeft `delivery: { contactName, status: "sent" | "failed" }` (anders `null`), zodat de tablet "Verstuurd naar Mama" of "Versturen is niet gelukt" toont. "Klaar" en JA op "Wil je stoppen?" sluiten het gesprek af. Een agent die "Klaar" toont zonder (of met een andere) bevestigde boodschap, of een "Bedoel je" waarvan de tekst niet precies de boodschap is, wordt verworpen (`503`, `AgentDecision` `invalid`). |
| POST | `/communication/sessions/{id}/back` | apparaat | ↩ Terug: `{ turn }` (`backRequestSchema`). Zet de vorige momentopname (state én presentatie) **exact** terug als nieuwe beurt, zonder agentaanroep; Observed `back` bij het verlaten scherm, Presented opnieuw vastgelegd. Nog eens Terug gaat verder terug. Terug vanaf "Wil je dit sturen?" naar het "Bedoel je"-scherm maakt de JA ongedaan: de bevestigde boodschap vervalt en het gesprek is weer `active` (de provenance houdt JA en Terug vast); een nieuwe JA bevestigt opnieuw. `200` + de beurt. Op het eerste scherm of na een verzending `409 CANNOT_GO_BACK`; verouderde `turn` `409 STALE_TURN`. |
| POST | `/communication/sessions/{id}/stop` | apparaat | ⏹ Stoppen: Observed `stop`, gesprek `stopped`; er wordt niets vastgesteld of verstuurd. `204`. Al afgelopen `409 SESSION_ENDED`; niet van deze gebruiker `404`. |

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
