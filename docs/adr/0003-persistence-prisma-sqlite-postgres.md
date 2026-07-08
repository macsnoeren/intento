# 0003. Persistentie met Prisma (SQLite dev, PostgreSQL prod) via driver adapters

- **Status:** geaccepteerd
- **Datum:** 2026-07-08

## Context

Intento heeft een relationeel datamodel (DESIGN §6): organisaties, accounts, gebruikers,
AAC-symbolen en -relaties, gesprekssessies, voorkeuren, enz., met multi-tenant-isolatie
op `organizationId`. DESIGN §9.3 kiest Prisma met SQLite voor ontwikkeling en PostgreSQL
voor productie, met **verplichte migraties**. We willen lokaal zonder externe database
kunnen werken, maar wél een schema dat 1-op-1 naar PostgreSQL gaat.

Prisma 7 heeft de architectuur veranderd: de connectie-URL staat **niet meer** in
`schema.prisma`, er is een `prisma.config.ts` voor de CLI, en de runtime-client verbindt
via een **driver adapter** in plaats van een meegeleverde query-engine. Dat dwong een
paar concrete keuzes af.

## Beslissing

We gebruiken **Prisma** als ORM en migratietool, met:

- **`server/prisma/schema.prisma`** — bron van waarheid voor het datamodel. `datasource`
  bevat alleen `provider` (geen `url`, niet meer toegestaan in v7).
- **`server/prisma.config.ts`** — levert de connectie voor CLI-commando's (`migrate`,
  `db seed`, `studio`) uit `DATABASE_URL`, met een dev-default zodat het out-of-the-box
  werkt.
- **Driver adapter voor de runtime** — `@prisma/adapter-better-sqlite3` in dev/test; de
  client wordt als singleton opgezet in [`server/src/db/prisma.ts`](../../server/src/db/prisma.ts).
  Productie krijgt hier later `@prisma/adapter-pg` (PostgreSQL); alleen deze regel en
  `provider` in het schema wijzigen mee.
- **PostgreSQL-compatibel schema** — geen SQLite-only constructies en **geen native enums**
  (SQLite kent die niet). Categorie-/type-velden zijn `String`; de toegestane waarden
  worden op de API-grens met zod afgedwongen. Zo draait hetzelfde schema op SQLite én
  PostgreSQL.
- **Migraties verplicht** — elke schemawijziging via `npm run db:migrate` (`prisma migrate
  dev`); nooit ad-hoc. Migratiebestanden staan in versiebeheer.
- **Gegenereerde client niet in versiebeheer** — `server/src/generated/prisma/` wordt door
  `prisma generate` gemaakt (via `postinstall` en de `build`-stap) en is gitignored.

De **gegenereerde `@prisma/dev`-transitieve dependency** trok een kwetsbare
`@hono/node-server` mee (advisory GHSA-92pp-h63x-v22m). Die dev-server gebruiken we niet;
we forceren via een npm-`override` (`"@prisma/dev": "^0.24.14"`) een gepatchte versie zodat
`npm audit` op 0 blijft zonder Prisma te downgraden.

## Gevolgen

- Lokaal ontwikkelen en testen kan zonder externe database; tests draaien tegen een
  gescheiden SQLite-bestand dat per testrun vers wordt gemigreerd (`vitest.global-setup.ts`).
- De omslag naar PostgreSQL is klein en geïsoleerd (adapter + `provider`), maar moet in de
  productiefase expliciet worden getest — SQLite en PostgreSQL zijn niet 100% identiek.
- Geen native enums betekent dat validatie van toegestane waarden bij de applicatie ligt
  (zod op de grens), niet bij de database. Dat past bij "valideer op elke grens".
- Na een verse `npm install` moet `prisma generate` gedraaid hebben; dat regelt `postinstall`.
- De npm-`override` op `@prisma/dev` moet bij een Prisma-upgrade opnieuw beoordeeld worden.

## Alternatieven overwogen

- **SQLite ook in productie** — simpeler, maar schaalt niet naar meerdere organisaties en
  gelijktijdige gebruikers (DESIGN §9.5); PostgreSQL is de productiekeuze.
- **Direct op PostgreSQL ontwikkelen (Docker)** — dichter bij productie, maar zwaarder om
  op te zetten en strijdig met "lokaal zonder externe afhankelijkheden kunnen werken" in
  deze fase.
- **Query-builder (Kysely/Drizzle) of ruwe SQL** — meer controle, maar Prisma's migraties,
  typegeneratie en de sjabloonstandaard (DESIGN §9.3) wegen zwaarder voor dit project.
- **Prisma downgraden naar 6.x** om de audit-melding kwijt te raken — strijdig met "altijd
  nieuwste stabiele versie"; de `override` lost het gerichter op.
