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
- Rate limiting: niet globaal; streng per-route waar geconfigureerd (nu `/auth/login`).

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
| GET | `/admin/accounts` | ADMIN | Lijst van logins **binnen de eigen organisatie** (`accountListResponseSchema`). Rol-beperkt (`403 FORBIDDEN` voor CAREGIVER/USER) en tenant-gefilterd op `organizationId`. Representatief voorbeeld van de autorisatie-/isolatielaag; volledig gebruikersbeheer volgt in T2.1. |

<Volgende domeinen (gebruikers, gesprek, AAC …) worden hier per taak toegevoegd.>
