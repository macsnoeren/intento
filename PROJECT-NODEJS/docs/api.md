# API

> Bron van waarheid zijn de zod-schema's in `shared/` (of de OpenAPI-generatie).
> Houd dit overzicht kort; verwijs voor exacte velden naar de schema's/types.

## Conventies
- Authenticatie: <bijv. httpOnly sessie-cookie voor gebruikers; Bearer-token voor devices>.
- Fouten: JSON `{ error, message }`, `ZodError → 400`, `401/403/404/409/413/429` waar passend.
- Rate limiting: globaal <n>/min, strenger op login/register.

## Endpoints

### Auth
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| POST | `/api/auth/register` | publiek | <...> |
| POST | `/api/auth/login` | publiek | <...> |
| POST | `/api/auth/logout` | ingelogd | <...> |
| GET | `/api/auth/me` | ingelogd | <...> |

### <Domein>
| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/api/<...>` | <rol> | <...> |

<Voeg secties toe per domein terwijl fases groeien.>
