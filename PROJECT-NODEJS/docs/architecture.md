# Architectuur

> Beschrijf **wat** het systeem is en **waarom** het zo gebouwd is. Details die
> veranderen (exacte types, endpoints) horen in de code/schema's, niet hier.

## Overzicht
<Eén alinea + eventueel een simpel diagram: welke onderdelen zijn er en hoe
praten ze met elkaar.>

## Stack en keuzes
| Onderdeel | Keuze | Waarom |
|---|---|---|
| Taal/runtime | TypeScript (strict) / Node ≥ 22 | <reden> |
| HTTP-server | <bijv. Fastify 5> | <reden> |
| Validatie | zod | Runtime + type-inferentie, gedeeld client/server |
| Database | <SQLite / PostgreSQL> + Prisma | <reden> |
| Auth | argon2id + gehashte sessie-tokens | <reden> |
| ... | ... | ... |

## Mappenstructuur
<Korte uitleg per top-level map en de belangrijkste conventies
(buildApp()-factory, env.ts, dto-mappers, routes per domein).>

## Belangrijke patronen
- **`buildApp()` factory** — herbruikbaar in tests via `inject()`.
- **`env.ts`** — zod-gevalideerde env met prod-guards.
- **DTO-mappers** — scheiden DB-modellen van API-responses (geen secret-lekken).
- **Foutafhandeling** — centrale handler, `ZodError → 400`, eigen HttpError-helpers.

## Gerelateerde documentatie
- Belangrijke keuzes met onderbouwing: [adr/](adr/)
- Datamodel: [data-model.md](data-model.md)
- Beveiliging: [security.md](security.md)
