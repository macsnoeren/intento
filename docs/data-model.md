# Datamodel

> Bron van waarheid is [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).
> Hier leggen we de **keuzes en werkwijze** uit die niet uit het schema alleen blijken.
> Ontwerpbron: [../DESIGN.md](../DESIGN.md) §6. Achtergrond bij de persistentiekeuzes:
> [adr/0003](adr/0003-persistence-prisma-sqlite-postgres.md).

## Stack en werkwijze

- **Prisma** als ORM en migratietool. Dev/test draaien op **SQLite**, productie op
  **PostgreSQL** — hetzelfde, PostgreSQL-compatibele schema (zie hieronder).
- **Prisma 7-opzet:** de connectie staat niet in het schema maar in
  [`server/prisma.config.ts`](../server/prisma.config.ts) (voor de CLI) en de runtime-client
  verbindt via een **driver adapter** in [`server/src/db/prisma.ts`](../server/src/db/prisma.ts).
- **Migraties verplicht:** elke schemawijziging via `npm run db:migrate`; nooit ad-hoc
  (CLAUDE.md kernprincipe 9). Migratiebestanden staan onder `server/prisma/migrations/` in
  versiebeheer.
- **Gegenereerde client** (`server/src/generated/prisma/`) staat **niet** in versiebeheer;
  `prisma generate` maakt hem (via `postinstall` en `build`).

## PostgreSQL-compatibiliteit

Het schema blijft bewust portabel zodat dev (SQLite) en prod (PostgreSQL) gelijk zijn:

- **Geen native enums** — SQLite ondersteunt die niet. Categorie-/type-velden (bijv.
  `Organization.type`, later rollen en contextcategorieën) zijn `String`; de toegestane
  waarden worden op de API-grens met **zod** afgedwongen, niet in de database.
- **Geen SQLite-only constructies.** De overstap naar PostgreSQL is dan een kwestie van
  `provider` in het schema + de driver adapter wisselen (ADR-0003), gevolgd door
  expliciet testen op PostgreSQL in de productiefase.

## Testdatabase

Tests draaien tegen een **gescheiden** SQLite-bestand (`server/prisma/test.db`), los van de
dev-database (`server/prisma/dev.db`). [`server/vitest.global-setup.ts`](../server/vitest.global-setup.ts)
verwijdert de oude testdatabase en past alle migraties opnieuw toe (`prisma migrate deploy`)
**per testrun**, zodat tests altijd tegen een schone db draaien die exact het migratieschema
volgt. `vitest.config.ts` wijst de test-`DATABASE_URL` naar dat bestand.

## Isolatie en privacy (van kracht vanaf latere taken)

- **Tenant-/eigenaar-isolatie:** elke query wordt gefilterd op `organizationId` en/of
  `userId` en daarop getest (DESIGN §9.4). `Organization` is de tenant-root.
- **Gevoelige velden:** persoonlijke context versleuteld at-rest; sessietokens gehasht.
- **Minimale opslag:** nooit AI-aannames, afgewezen boodschappen of onzekere voorspellingen
  opslaan (DESIGN §6.4).

## Entiteiten

Het volledige model uit DESIGN §6.2 (User, UserCommunicationProfile, PersonalContext,
Preference, AacSymbol, AacConceptRelation, ConversationSession, ConversationStep,
GeneratedMessage, CorrectionEvent, Device, ConceptProposal) wordt in latere taken
toegevoegd. Nu bestaat het fundament:

| Entiteit | Velden | Toelichting |
|---|---|---|
| **Organization** | `id`, `name`, `type`, `createdAt` | Intento-omgeving (family/care/personal) en tenant-root. Fundament-model uit T0.2; de rest hangt hier onder. |
| **Account** | `id`, `email` (uniek), `passwordHash`, `role`, `organizationId`, `failedLoginAttempts`, `lockedUntil`, `createdAt` | Login voor een persoon (T1.1). `role` = `ADMIN`/`CAREGIVER`/`USER` (zod op de grens). Wachtwoord alleen als argon2id-hash. `email` platformbreed uniek (login-keuze, ADR-0004). Lockout-velden voor brute-force-mitigatie. |
| **Session** | `id`, `tokenHash` (uniek), `accountId`, `createdAt`, `expiresAt` | Actieve login-sessie (T1.1). Alleen de **SHA-256-hash** van het sessietoken staat in de db; het rauwe token leeft in de httpOnly-cookie. Verlopen sessies zijn ongeldig en worden opgeruimd. |

Relaties: `Account.organizationId → Organization` (cascade delete); `Session.accountId →
Account` (cascade delete). Zo verdwijnt bij het verwijderen van een organisatie/account
netjes alle onderliggende auth-data.

## Seed

[`server/prisma/seed.ts`](../server/prisma/seed.ts) is idempotent (`npm run db:seed`) en
plaatst een demo-organisatie **en** een eerste `ADMIN`-account. E-mail/wachtwoord komen uit
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (dev-default met waarschuwing als niet gezet).
Herseeden overschrijft een bestaand wachtwoord niet. AAC-bibliotheek volgt in T3.1.

## Migratiegeschiedenis (kort)

- **`init`** (T0.2) — `Organization`.
- **`accounts_and_sessions`** (T1.1) — `Account`, `Session` + indexen/relaties.
