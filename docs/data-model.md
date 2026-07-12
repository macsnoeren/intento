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

Het model volgt DESIGN §6.2. Nu bestaat:

| Entiteit | Velden | Toelichting |
|---|---|---|
| **Organization** | `id`, `name`, `type`, `isPlatform`, `createdAt` | Intento-omgeving (family/care/personal) en tenant-root. Fundament-model uit T0.2; via zelfaanmelding (T1.3) maakt een bezoeker er zelf één aan. `type` gevalideerd op de grens (`organizationTypeSchema`). `isPlatform` (T5.8, standaard `false`) markeert de **platform-/operatororganisatie**: alléén ADMINs daarvan mogen platform-brede infrastructuur (worker-tokens) beheren. De bootstrap-seed zet dit op `true`; publieke zelfaanmelding nooit. |
| **Account** | `id`, `email` (uniek), `name?`, `passwordHash`, `role`, `organizationId`, `failedLoginAttempts`, `lockedUntil`, `emailVerifiedAt?`, `createdAt` | Login voor een persoon (T1.1). `role` = `ADMIN`/`CAREGIVER`/`USER` (zod op de grens). `name` is de weergavenaam van de accounthouder (gevuld bij zelfaanmelding T1.3; nullable — geseede accounts en login vereisen er geen). Wachtwoord alleen als argon2id-hash. `email` platformbreed uniek (login-keuze, ADR-0004). Lockout-velden voor brute-force-mitigatie. `emailVerifiedAt` (T1.4): `null` = nog niet geverifieerd (geseede/bestaande accounts blijven `null`; de bootstrap-seed-admin wordt wél geverifieerd), anders het bevestigingsmoment. |
| **Session** | `id`, `tokenHash` (uniek), `accountId`, `createdAt`, `expiresAt` | Actieve login-sessie (T1.1). Alleen de **SHA-256-hash** van het sessietoken staat in de db; het rauwe token leeft in de httpOnly-cookie. Verlopen sessies zijn ongeldig en worden opgeruimd. |
| **EmailVerificationToken** | `id`, `tokenHash` (uniek), `accountId`, `usedAt`, `expiresAt`, `createdAt` | E-mailverificatietoken (T1.4). Alleen de **SHA-256-hash** staat in de db; het rauwe token gaat per mail naar de accounthouder. Tokens zijn **eenmalig** (`usedAt`) en **verlopen** (`expiresAt`); een nieuw token (resend) maakt het vorige ongebruikte token van dat account ongeldig. Cascade delete met het account. |
| **User** | `id`, `name`, `organizationId`, `active`, `createdAt` | De communicerende persoon (T2.1). Staat los van `Account`: een gebruiker hoeft geen eigen login te hebben. Tenant-gebonden via `organizationId`. `active` deactiveert zonder te verwijderen. |
| **UserCommunicationProfile** | `userId` (PK), `iconsPerScreen`, `showText`, `aiLearningEnabled`, `supportMode`, `contextIndicator` | 1-op-1 communicatie-instellingen (T2.1/T2.4, DESIGN §5.3). `iconsPerScreen` alléén 2/4/6/8 (standaard 4), afgedwongen met zod op de API-grens. Standaarden: tekst aan, leren aan, ondersteuning uit, contextindicator aan. `contextIndicator` bepaalt of de tablet-UI de broodkruimel van het gekozen pad toont. |
| **CaregiverAssignment** | `userId` + `accountId` (samengestelde PK), `createdAt` | Koppeling begeleider↔gebruiker (T2.2, DESIGN §2, FR-017). Many-to-many tussen een CAREGIVER-`Account` en een `User`. Stuurt de toegang: een begeleider ziet/beheert alléén gekoppelde gebruikers. Samengestelde sleutel voorkomt dubbele koppelingen; tenant-grens (zelfde organisatie) op de API-grens bewaakt. |
| **Device** | `id`, `userId`, `type`, `tokenHash` (uniek), `lastActive`, `createdAt` | Gekoppelde tablet (T2.3, DESIGN §6.2, FR-018), aan **precies één** `User` gebonden. Alleen de **SHA-256-hash** van het langlevende apparaat-token staat in de db; het rauwe token leeft in de `intento_device`-cookie. Geeft alléén toegang tot de eigen gebruiker. `lastActive` voor monitoring (geen communicatie-inhoud). |
| **DeviceLinkCode** | `id`, `codeHash` (uniek), `userId`, `usedAt`, `expiresAt`, `createdAt` | Koppelcode die een beheerder genereert (T2.3, FR-018). Alleen de **SHA-256-hash** staat in de db; codes zijn **eenmalig** (`usedAt`) en **verlopen** (`expiresAt`). Wisselt op `POST /devices/link` in voor een `Device`. |
| **AacSymbol** | `id`, `concept` (uniek), `label`, `category`, `glyph`, `imageData`?, `imageMimeType`?, `imageVersion`, `imageLicense`?, `imageLicenseUrl`?, `imageAuthor`?, `imageAuthorUrl`?, `imageSourceUrl`?, `synonyms` (JSON), `searchText`, `createdAt` | Pictogram uit de AAC-bibliotheek (T3.1, uitgebreid in T3.2/T3.3; DESIGN §6.2, FR-015). **Platformbreed gedeeld**, niet tenant-gebonden. `concept` = canonieke lowercase sleutel waarnaar relaties (en straks de AI) verwijzen; `label` = Nederlandse weergavetekst; `category` op de grens gevalideerd (zod-enum). `glyph` = emoji-fallback waaruit de server een SVG-placeholder rendert. `imageData`/`imageMimeType` = een door een beheerder geüploade **of** via OpenSymbols opgehaalde afbeelding (T3.2/T3.3), **in de db** bewaard (`Bytes`, portabel op SQLite/PostgreSQL) en met voorrang bij het serveren; `null` = terugvallen op de glyph. `imageVersion` telt uploads en dient als cache-buster (`?v=`) in `imageUrl`. De `image*`-attributievelden (T3.3) dragen bron/licentie van een externe afbeelding (OpenSymbols) zodat de CC-attributie meereist; alle `null` bij een zelf-geüploade afbeelding of de glyph. `synonyms` = extra zoektermen. `searchText` = afgeleide, genormaliseerde (lowercase) zoekindex uit concept+label+synoniemen. |
| **AacConceptRelation** | `id`, `parentId`, `childId`, `relation` (standaard `contains`) | Begripsrelatie tussen twee `AacSymbol`s (T3.1). Vormt de verfijningsboom (bv. `buiten` → `wandelen`, DESIGN §3.1). Samengestelde unieke sleutel `(parentId, childId, relation)` voorkomt dubbele relaties. |
| **ConversationSession** | `id`, `userId`, `status`, `mode`, `caregiverQuestion`, `startedByAccountId`, `startedAt` | Tijdelijk communicatieproces waarin een gebruiker via pictogramkeuzes zijn intentie opbouwt (T4.1, DESIGN §3.1). Aan **precies één** `User` gebonden → gebruiker-isolatie: een tablet ziet alléén de eigen sessies. `status` = `ACTIVE`/`COMPLETED`/`ABANDONED` (zod op de grens); in T4.1 alleen `ACTIVE` (T4.3 rondt af). **Vraagmodus (T7.1, DESIGN §3.2):** `mode` = `free`/`question`; bij `question` bevat `caregiverQuestion` de letterlijke begeleidersvraag (context voor de AI en getoond in de gebruikersapp) en `startedByAccountId` het CAREGIVER/ADMIN-account dat de vraag stelde. |
| **ConversationStep** | `id`, `sessionId`, `order`, `question`, `selectedConcept`, `selectedSymbolId?`, `confidence?`, `createdAt` | Eén keuze in een gesprek (T4.1). `order` (0-based) bepaalt de volgorde en maakt de terug-functie exact (hoogste stap verwijderen herstelt de vorige context). `question` = de getoonde prompttekst; `selectedConcept`/`selectedSymbolId` = het gekozen concept/symbool (geen harde FK naar `AacSymbol` i.v.m. de muteerbare gedeelde bibliotheek — historie blijft leesbaar via `selectedConcept`). `confidence` = de interpretatie-zekerheid van de nieuwe toestand na deze keuze (T5.2, DESIGN §7.4); `null` in de gescripte engine (T4.1). Samengestelde unieke `(sessionId, order)`. |
| **GeneratedMessage** | `id`, `sessionId`, `message`, `confirmed`, `createdAt` | Door de (gescripte) engine voorgestelde en door de gebruiker **bevestigde** boodschap (T4.3, DESIGN §3.1, §3.6, §6.2, FR-007). Kernprincipe: alleen **bevestigde** communicatie wordt bewaard — een rij bestaat pas na `POST /conversation/{id}/confirm`; het voorstellen (`/generate`) is vluchtig en raakt de db niet. `message` = de sjabloon-gebaseerde zin uit de gekozen concepten (de AI-orchestrator neemt dit later over — T5.3). `confirmed` in de MVP altijd `true` (afgewezen voorstellen worden nooit opgeslagen); expliciet gemodelleerd conform DESIGN §6.2. In de MVP hoogstens één per sessie (bevestigen rondt de sessie af → `COMPLETED`). |
| **CorrectionEvent** | `id`, `sessionId`, `type`, `stepOrder`, `rejectedConcept`, `createdAt` | Een correctie van de gebruiker (❌ op een voorstel, T5.4, DESIGN §3.4, §6.2, §7.6, FR-009). De heranalyse rolt de vermoedelijke foutstap (laagste `ConversationStep.confidence`, §7.4) en alles erna terug en legt hier vast wélk concept op welke stap (`stepOrder`) is afgewezen. `type` = `wrong_guess` (zod op de grens; enige waarde in de MVP). Het `rejectedConcept` blijft de rest van de sessie uitgesloten van de aangeboden opties (§7.5). **Correctie-signaal, géén leerdata**: raakt nooit de `Preference`-laag (T6.3) en bevat **geen** communicatie-inhoud (privacy by design, §3.6). Index op `sessionId`, cascade delete met de sessie. |
| **PersonalContext** | `id`, `userId`, `category`, `nameEncrypted`, `relationshipEncrypted?`, `aiUsageAllowed`, `createdAt`, `updatedAt` | Persoonlijke context van een gebruiker (T6.1, DESIGN §6.2, §6.3, §9.4, FR-013/020): personen, huisdieren, plekken, favorieten, routines waarmee de AI kan personaliseren. **Versleuteld at-rest**: de gevoelige vrij-tekst-PII (`name`, `relationship`) wordt als AES-256-GCM-cijfertekst opgeslagen (`ENCRYPTION_KEY`) — plaintext staat nooit in de db en wordt pas op de API-grens ontsleuteld. `aiUsageAllowed` (opt-in, standaard `false`) is de **toestemming per rij**: alléén rijen met `true` belanden in het AI-contextobject (§6.3). `category` = `PERSON`/`PET`/`PLACE`/`ACTIVITY`/`FOOD`/`OBJECT`/`ROUTINE`/`OTHER` (zod op de grens). Aan **precies één** `User` gebonden (gebruiker-/tenant-isolatie); index op `userId`, cascade delete met de gebruiker. |
| **Preference** | `id`, `userId`, `concept`, `confidence`, `count`, `source`, `suggestionStatus`, `createdAt`, `updatedAt` | Een geleerde voorkeur van een gebruiker (T6.3, DESIGN §3.8, §6.2, §7.1 taak 5, FR-014). Leert **alléén uit bevestigde communicatie** (`POST /conversation/{id}/confirm`) en **alléén als** `UserCommunicationProfile.aiLearningEnabled=true` — nooit uit afwijzingen/correcties (§3.4 punt 4) of onzekere aannames. Bevat **geen** communicatie-inhoud: alleen de canonieke AAC-`concept`sleutel, een afgeleide `confidence` (0–1, groeit met `count` × 0,2, geklemd op 1), de teller `count` (aantal bevestigingen) en `source` (`confirmed_usage`, enige waarde in de MVP). `suggestionStatus` = `none`/`pending`/`accepted`/`dismissed` stuurt de **begeleider-suggestie** (§3.8): bij `count ≥ 3` gaat een `none` → `pending` (de begeleider krijgt een voorstel om het als persoonlijke context toe te voegen); accepteren/aanpassen → `accepted` (+ een `PersonalContext`-rij), weigeren → `dismissed` (komt niet terug). Aan **precies één** `User` gebonden; unieke `(userId, concept)`, index op `userId`, cascade delete met de gebruiker. |
| **ConceptProposal** | `id`, `concept` (uniek), `reason`, `status`, `linkedSymbolId?`, `createdAt`, `updatedAt` | Een door de AI voorgesteld **nieuw begrip** dat (nog) niet in de AAC-bibliotheek bestaat (T5.2, DESIGN §6.2, §7.6, FR-016). De **validatielaag** maakt zo'n voorstel aan wanneer de AI tijdens communicatie een concept aandraagt dat noch als concept, noch als synoniem bestaat: de optie wordt weggelaten (bereikt de gebruiker **nooit**) en het begrip belandt hier ter beoordeling door een beheerder (T7.3). `concept` is **uniek** → herhaalde voorstellen vormen één openstaand item (idempotente upsert). `status` = `PENDING`/`APPROVED`/`REJECTED` (zod op de grens); `linkedSymbolId` = na goedkeuring het gekoppelde `AacSymbol` (geen harde FK, net als bij `ConversationStep`). Niet tenant-gebonden (de bibliotheek is platformbreed gedeeld). Index op `status` voor de reviewlijst. |
| **WorkerToken** | `id`, `name`, `tokenHash` (uniek), `scopes`, `revokedAt?`, `expiresAt?`, `lastSeenAt?`, `createdAt` | Infrastructuur-credential voor een externe AI-worker (T5.5, DESIGN §7.2, §9.4, ADR-0010). **Losstaand** van gebruiker-/device-/sessietokens (een worker is geen gebruiker en geen tenant). Alleen de **SHA-256-hash** staat in de db; het rauwe token gaat als `Authorization: Bearer …` mee. `scopes` (komma-gescheiden, `ai:process`) begrenst wat het mag; **intrekbaar** (`revokedAt`) en optioneel **verlopend** (`expiresAt`). Niet tenant-gebonden. Index op `revokedAt`. Beheer (aanmaken/lijsten/intrekken) via de CLI (`worker-token:create`) of de beheer-UI voor een **platform-ADMIN** (T5.8); de status in die UI (`active`/`revoked`/`expired`) wordt afgeleid uit `revokedAt`/`expiresAt`. |
| **AiJob** | `id`, `task`, `status`, `payloadJson`, `resultJson?`, `errorMessage?`, `attempts`, `claimedById?`, `claimedAt?`, `leaseExpiresAt?`, `expiresAt`, `createdAt`, `updatedAt` | Eén AI-aanvraag in de gedistribueerde wachtrij (T5.5, DESIGN §7.2, §7.7, §9.2, ADR-0010). De DB is de bron van waarheid zodat een herstart/crash geen aanvraag verliest. `payloadJson` = de door `buildAiPrompt`/`buildMessagePrompt` samengestelde **beperkte** context; `resultJson` = de door de worker ingeleverde, opnieuw met zod gevalideerde uitvoer (nooit vertrouwen). `task` = `select_next_question`/`generate_message`; `status` = `WAITING_FOR_WORKER`/`QUEUED`/`CLAIMED`/`SUCCEEDED`/`FAILED`/`EXPIRED` (zod op de grens). Lease-velden (`leaseExpiresAt`, `attempts`) verzorgen crash-herstel; `expiresAt` de wachtrij-timeout. Bevat **geen** communicatie-inhoud buiten AAC-concepten (privacy by design, §3.6, §9.4). `claimedById → WorkerToken` (SetNull). Indexen op `(status, createdAt)` en `claimedById`. |

Relaties: `Account.organizationId → Organization` (cascade delete); `Session.accountId →
Account` (cascade delete); `EmailVerificationToken.accountId → Account` (cascade delete);
`User.organizationId → Organization` (cascade delete);
`UserCommunicationProfile.userId → User` (cascade delete); `CaregiverAssignment.userId →
User` en `CaregiverAssignment.accountId → Account` (beide cascade delete — de koppeling
verdwijnt als de gebruiker of het begeleider-account wordt verwijderd); `Device.userId →
User` en `DeviceLinkCode.userId → User` (beide cascade delete — apparaten en openstaande codes
verdwijnen met de gebruiker). Zo verdwijnt bij het verwijderen van een organisatie/gebruiker
netjes alle onderliggende data. De AAC-bibliotheek staat hier **los** van: `AacSymbol`/
`AacConceptRelation` zijn gedeeld en niet aan een organisatie of gebruiker gekoppeld;
`AacConceptRelation.parentId`/`childId → AacSymbol` (beide cascade delete).
`ConversationSession.userId → User` (cascade delete — sessies verdwijnen met de gebruiker);
`ConversationStep.sessionId → ConversationSession` (cascade delete),
`GeneratedMessage.sessionId → ConversationSession` (cascade delete — bevestigde boodschappen
verdwijnen met de sessie) en `CorrectionEvent.sessionId → ConversationSession` (cascade delete —
correcties verdwijnen met de sessie). `ConversationStep`
heeft bewust géén FK naar `AacSymbol`: de gedeelde bibliotheek is muteerbaar, dus een verwijderd
symbool mag de historie niet cascaderen — het `selectedConcept` blijft de leesbare sleutel.

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
plaatst een demo-organisatie (als **platformorganisatie**, `isPlatform: true` — T5.8) **en** een eerste `ADMIN`-account. E-mail/wachtwoord komen uit
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (dev-default met waarschuwing als niet gezet).
De geseede bootstrap-admin wordt meteen als **geverifieerd** aangemaakt (T1.4) — die is door de
operator ingericht, niet via publieke zelfaanmelding. Herseeden overschrijft een bestaand wachtwoord niet. Het script seedt óók de **AAC-bibliotheek**
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
- **`aac_admin_images`** (T3.2) — `AacSymbol` uitgebreid met `imageData` (`Bytes`, nullable), `imageMimeType` (nullable) en `imageVersion` (`Int`, default 0) voor geüploade pictogrammen.
- **`aac_opensymbols_attribution`** (T3.3) — `AacSymbol` uitgebreid met `imageLicense`, `imageLicenseUrl`, `imageAuthor`, `imageAuthorUrl` en `imageSourceUrl` (alle `String`, nullable) voor de bron/licentie van een via OpenSymbols gekoppelde afbeelding.
- **`account_name`** (T1.3) — `Account` uitgebreid met `name` (`String`, nullable) voor de weergavenaam van de accounthouder bij zelfaanmelding.
- **`email_verification`** (T1.4) — `Account` uitgebreid met `emailVerifiedAt` (`DateTime`, nullable) en de nieuwe tabel `EmailVerificationToken` (unieke `tokenHash`, index op `accountId`, cascade delete).
- **`conversation_sessions_and_steps`** (T4.1) — `ConversationSession` (index op `userId`, cascade delete) en `ConversationStep` (samengestelde unieke `(sessionId, order)`, index op `sessionId`, cascade delete).
- **`contextindicator_setting`** (T2.4) — `UserCommunicationProfile` uitgebreid met `contextIndicator` (`Boolean`, default `true`) voor de per-user aan/uit-schakelaar van de contextindicator in de tablet-UI.
- **`generated_messages`** (T4.3) — nieuwe tabel `GeneratedMessage` (`sessionId`, `message`, `confirmed` (`Boolean`, default `true`), index op `sessionId`, cascade delete) voor de bij bevestiging opgeslagen boodschap.
- **`concept_proposals`** (T5.2) — nieuwe tabel `ConceptProposal` (`concept` uniek, `reason`, `status` (default `PENDING`), `linkedSymbolId` nullable, `updatedAt`, index op `status`) voor door de AI voorgestelde, nog niet bestaande begrippen die de validatielaag afvangt (ter beoordeling in T7.3). Niet tenant-gebonden.
- **`correction_events`** (T5.4) — nieuwe tabel `CorrectionEvent` (`sessionId`, `type` (default `wrong_guess`), `stepOrder`, `rejectedConcept`, index op `sessionId`, cascade delete) voor de correctieflow (❌ op een voorstel): legt de teruggerolde foutstap en het afgewezen concept vast (correctie-signaal, geen leerdata).
- **`ai_worker_queue`** (T5.5) — nieuwe tabellen `WorkerToken` (`tokenHash` uniek, `scopes`, `revokedAt`/`expiresAt`/`lastSeenAt` nullable, index op `revokedAt`) en `AiJob` (`task`, `status` (default `QUEUED`), `payloadJson`, `resultJson`/`errorMessage` nullable, `attempts`, `claimedById`/`claimedAt`/`leaseExpiresAt` nullable, `expiresAt`, `updatedAt`, indexen op `(status, createdAt)` en `claimedById`; `claimedById → WorkerToken` SetNull) voor de gedistribueerde AI-wachtrij en het worker-protocol. Niet tenant-gebonden (infrastructuur).
- **`organization_is_platform`** (T5.8) — `Organization` uitgebreid met `isPlatform` (`Boolean`, default `false`) om de platform-/operatororganisatie te markeren; alléén ADMINs daarvan mogen worker-tokens beheren.
- **`personal_context`** (T6.1) — nieuwe tabel `PersonalContext` (`userId`, `category`, `nameEncrypted`, `relationshipEncrypted` nullable, `aiUsageAllowed` (default `false`), `createdAt`, `updatedAt`, index op `userId`, cascade delete met `User`) voor de persoonlijke context. Gevoelige velden **versleuteld at-rest** (AES-256-GCM, `ENCRYPTION_KEY`); alléén rijen met `aiUsageAllowed=true` gaan naar de AI (DESIGN §6.3).
- **`preferences`** (T6.3) — nieuwe tabel `Preference` (`userId`, `concept`, `confidence` (default `0`), `count` (default `0`), `source` (default `confirmed_usage`), `suggestionStatus` (default `none`), `createdAt`, `updatedAt`, unieke `(userId, concept)`, index op `userId`, cascade delete met `User`) voor het leermechanisme. Voorkeuren worden alléén bij een **bevestigde** boodschap bijgewerkt en alléén als `aiLearningEnabled=true` (DESIGN §3.8, FR-014); ze bevatten geen communicatie-inhoud.
- **`question_mode`** (T7.1) — `ConversationSession` uitgebreid met `mode` (`String`, default `free`), `caregiverQuestion` (`String?`) en `startedByAccountId` (`String?`) voor de vraagmodus: een begeleider start een sessie met een vraag als context en een topic-anker dat de antwoorden begrenst (DESIGN §3.2, FR-012).
