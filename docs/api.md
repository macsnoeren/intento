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

### Auth (T1.1)
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/auth/login` | publiek | Body `{ email, password }` (`loginRequestSchema`). Bij succes: `200` + `{ account }` en een `intento_session`-cookie. Fout wachtwoord/onbekende e-mail → `401 INVALID_CREDENTIALS` (bewust generiek). Te veel pogingen → `423 ACCOUNT_LOCKED`. Te veel verzoeken → `429`. Streng rate-limited per IP. |
| POST | `/auth/logout` | cookie | Verwijdert de serverzijdige sessie en wist de cookie. Altijd `204`. |
| GET | `/auth/me` | cookie | Huidig account (`{ account }`) of `401 NOT_AUTHENTICATED`. |

Responsevorm `{ account }` = `authResponseSchema` (nooit `passwordHash` of lockout-velden).
`/auth/me` gebruikt sinds T1.2 hetzelfde `authorize(...)`-preHandler als beschermde routes.

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
| POST | `/users` | ADMIN | Maakt een gebruiker in de eigen organisatie aan (`createUserRequestSchema`: `{ name, active? }`). Het communicatieprofiel wordt met standaardwaarden aangemaakt. `201` + `userPublicSchema`. |
| GET | `/admin/users` | ADMIN | Lijst van gebruikers **binnen de eigen organisatie** (`userListResponseSchema`). |
| GET | `/users/{id}` | ADMIN, CAREGIVER | Eén gebruiker inclusief profiel (`userPublicSchema`), of `403` bij een andere organisatie. Een CAREGIVER krijgt `403` als hij niet aan deze gebruiker gekoppeld is (T2.2). |
| PUT | `/users/{id}/settings` | ADMIN, CAREGIVER | Vervangt het volledige communicatieprofiel (`updateSettingsRequestSchema`). `iconsPerScreen` alléén **2/4/6/8** — anders `400 VALIDATION_ERROR`. `200` + `userPublicSchema`. Voor een CAREGIVER geldt dezelfde koppel-eis als bij `GET`. |
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

<Volgende domeinen (gesprek, AAC …) worden hier per taak toegevoegd.>
