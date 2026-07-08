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

Het volledige model uit DESIGN §6.2 (PersonalContext, Preference,
ConversationSession, ConversationStep, GeneratedMessage, CorrectionEvent,
ConceptProposal) wordt in latere taken toegevoegd. Nu bestaat:

| Entiteit | Velden | Toelichting |
|---|---|---|
| **Organization** | `id`, `name`, `type`, `createdAt` | Intento-omgeving (family/care/personal) en tenant-root. Fundament-model uit T0.2; de rest hangt hier onder. |
| **Account** | `id`, `email` (uniek), `passwordHash`, `role`, `organizationId`, `failedLoginAttempts`, `lockedUntil`, `createdAt` | Login voor een persoon (T1.1). `role` = `ADMIN`/`CAREGIVER`/`USER` (zod op de grens). Wachtwoord alleen als argon2id-hash. `email` platformbreed uniek (login-keuze, ADR-0004). Lockout-velden voor brute-force-mitigatie. |
| **Session** | `id`, `tokenHash` (uniek), `accountId`, `createdAt`, `expiresAt` | Actieve login-sessie (T1.1). Alleen de **SHA-256-hash** van het sessietoken staat in de db; het rauwe token leeft in de httpOnly-cookie. Verlopen sessies zijn ongeldig en worden opgeruimd. |
| **User** | `id`, `name`, `organizationId`, `active`, `createdAt` | De communicerende persoon (T2.1). Staat los van `Account`: een gebruiker hoeft geen eigen login te hebben. Tenant-gebonden via `organizationId`. `active` deactiveert zonder te verwijderen. |
| **UserCommunicationProfile** | `userId` (PK), `iconsPerScreen`, `showText`, `aiLearningEnabled`, `supportMode` | 1-op-1 communicatie-instellingen (T2.1, DESIGN §5.3). `iconsPerScreen` alléén 2/4/6/8 (standaard 4), afgedwongen met zod op de API-grens. Standaarden: tekst aan, leren aan, ondersteuning uit. |
| **CaregiverAssignment** | `userId` + `accountId` (samengestelde PK), `createdAt` | Koppeling begeleider↔gebruiker (T2.2, DESIGN §2, FR-017). Many-to-many tussen een CAREGIVER-`Account` en een `User`. Stuurt de toegang: een begeleider ziet/beheert alléén gekoppelde gebruikers. Samengestelde sleutel voorkomt dubbele koppelingen; tenant-grens (zelfde organisatie) op de API-grens bewaakt. |
| **Device** | `id`, `userId`, `type`, `tokenHash` (uniek), `lastActive`, `createdAt` | Gekoppelde tablet (T2.3, DESIGN §6.2, FR-018), aan **precies één** `User` gebonden. Alleen de **SHA-256-hash** van het langlevende apparaat-token staat in de db; het rauwe token leeft in de `intento_device`-cookie. Geeft alléén toegang tot de eigen gebruiker. `lastActive` voor monitoring (geen communicatie-inhoud). |
| **DeviceLinkCode** | `id`, `codeHash` (uniek), `userId`, `usedAt`, `expiresAt`, `createdAt` | Koppelcode die een beheerder genereert (T2.3, FR-018). Alleen de **SHA-256-hash** staat in de db; codes zijn **eenmalig** (`usedAt`) en **verlopen** (`expiresAt`). Wisselt op `POST /devices/link` in voor een `Device`. |
| **AacSymbol** | `id`, `concept` (uniek), `label`, `category`, `glyph`, `synonyms` (JSON), `searchText`, `createdAt` | Pictogram uit de AAC-bibliotheek (T3.1, DESIGN §6.2, FR-015). **Platformbreed gedeeld**, niet tenant-gebonden. `concept` = canonieke lowercase sleutel waarnaar relaties (en straks de AI) verwijzen; `label` = Nederlandse weergavetekst; `category` op de grens gevalideerd (zod-enum). `glyph` = emoji waaruit de server een SVG-placeholder rendert (MVP; T3.2 → geüploade bestanden). `synonyms` = extra zoektermen. `searchText` = afgeleide, genormaliseerde (lowercase) zoekindex uit concept+label+synoniemen. |
| **AacConceptRelation** | `id`, `parentId`, `childId`, `relation` (standaard `contains`) | Begripsrelatie tussen twee `AacSymbol`s (T3.1). Vormt de verfijningsboom (bv. `buiten` → `wandelen`, DESIGN §3.1). Samengestelde unieke sleutel `(parentId, childId, relation)` voorkomt dubbele relaties. |

Relaties: `Account.organizationId → Organization` (cascade delete); `Session.accountId →
Account` (cascade delete); `User.organizationId → Organization` (cascade delete);
`UserCommunicationProfile.userId → User` (cascade delete); `CaregiverAssignment.userId →
User` en `CaregiverAssignment.accountId → Account` (beide cascade delete — de koppeling
verdwijnt als de gebruiker of het begeleider-account wordt verwijderd); `Device.userId →
User` en `DeviceLinkCode.userId → User` (beide cascade delete — apparaten en openstaande codes
verdwijnen met de gebruiker). Zo verdwijnt bij het verwijderen van een organisatie/gebruiker
netjes alle onderliggende data. De AAC-bibliotheek staat hier **los** van: `AacSymbol`/
`AacConceptRelation` zijn gedeeld en niet aan een organisatie of gebruiker gekoppeld;
`AacConceptRelation.parentId`/`childId → AacSymbol` (beide cascade delete).

## AAC-zoekindex en portabiliteit

De zoek-API (`GET /aac/search?q=…`) matcht hoofdletterongevoelig op concept, label én
synoniemen. In plaats van per-DB-afhankelijk gedrag (SQLite `LIKE` is ASCII-hoofdletter­ongevoelig,
PostgreSQL niet — dat vereist `ILIKE`/`mode: 'insensitive'`) bewaren we een afgeleide,
vooraf-lowercased kolom `searchText` en normaliseren we ook de zoekterm naar lowercase. Eén
`contains` op `searchText` is dan **identiek portabel** op SQLite en PostgreSQL zonder DB-specifieke
opties. `searchText` wordt herbouwd bij elke wijziging (nu in de seed; T3.2 bij bewerken via de UI).
`synonyms` staat als `Json`-array — op beide databases ondersteund en op de grens met zod geparseerd.

## Seed

[`server/prisma/seed.ts`](../server/prisma/seed.ts) is idempotent (`npm run db:seed`) en
plaatst een demo-organisatie **en** een eerste `ADMIN`-account. E-mail/wachtwoord komen uit
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (dev-default met waarschuwing als niet gezet).
Herseeden overschrijft een bestaand wachtwoord niet. Het script seedt óók de **AAC-bibliotheek**
(T3.1) via [`server/src/aac/library.ts`](../server/src/aac/library.ts) met de dataset uit
[`server/src/aac/data.ts`](../server/src/aac/data.ts): symbolen worden op `concept` ge-upsert en
relaties op hun unieke combinatie — idempotent, dus herseeden levert geen duplicaten.

## Migratiegeschiedenis (kort)

- **`init`** (T0.2) — `Organization`.
- **`accounts_and_sessions`** (T1.1) — `Account`, `Session` + indexen/relaties.
- **`users_and_communication_profile`** (T2.1) — `User`, `UserCommunicationProfile` + index/relaties.
- **`caregiver_assignments`** (T2.2) — `CaregiverAssignment` (samengestelde PK + index op `accountId`).
- **`devices_and_link_codes`** (T2.3) — `Device` en `DeviceLinkCode` (unieke `tokenHash`/`codeHash`, index op `userId`).
- **`aac_library`** (T3.1) — `AacSymbol` (uniek `concept`, index op `category`) en `AacConceptRelation` (samengestelde unieke `(parentId, childId, relation)`, indexen op `parentId`/`childId`).
