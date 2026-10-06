# Datamodel

> Bron van waarheid is [`server/prisma/schema.prisma`](../server/prisma/schema.prisma).
> Hier leggen we de **keuzes en werkwijze** uit die niet uit het schema alleen blijken.
> Ontwerpbron: [../INTENTO-NEW-DESIGN.md](../INTENTO-NEW-DESIGN.md) §39. De gesprekstabellen worden
> herbouwd ([ADR-0017](adr/0017-agentic-architectuur.md)). Achtergrond bij de persistentiekeuzes:
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

## Isolatie en privacy

- **Tenant-/eigenaar-isolatie:** elke query wordt gefilterd op `organizationId` en/of
  `userId` en daarop getest (ADR-0005). `Organization` is de tenant-root.
- **Gevoelige velden** (INTENTO-NEW-DESIGN §53): Session State, presentatieteksten, inferences,
  bevestigde berichten, contactnamen en e-mailadressen versleuteld at-rest (AES-256-GCM,
  `ENCRYPTION_KEY`); sessie- en apparaattokens gehasht.
- **Provenance wordt wél bewaard** (Observed, Presented, Inferred en de AI-beslissingen), versleuteld en
  alleen binnen de bewaartermijn van de organisatie; zonder die gegevens is feedback-loop-bescherming
  onmogelijk (INTENTO-NEW-DESIGN §25, §53). Die tabellen komen in fase N4.

## Entiteiten

Het model volgt INTENTO-NEW-DESIGN §39. Nu bestaat:

| Entiteit | Velden | Toelichting |
|---|---|---|
| **Organization** | `id`, `name`, `type`, `isPlatform`, `active`, `createdAt` | Intento-omgeving (family/care/personal) en tenant-root. Fundament-model uit T0.2; via zelfaanmelding (T1.3) maakt een bezoeker er zelf één aan. `type` gevalideerd op de grens (`organizationTypeSchema`). `isPlatform` (T5.8, standaard `false`) markeert de **platform-/operatororganisatie**: alléén ADMINs daarvan mogen platform-brede infrastructuur (worker-tokens) beheren. De bootstrap-seed zet dit op `true`; publieke zelfaanmelding nooit. `active` (T8.3, standaard `true`) is de **deactivatieschakelaar van de platform-operator**: `false` = de omgeving is gestopt wegens misbruik, wat login, bestaande accountsessies én gekoppelde tablets weigert (`403 ORGANIZATION_SUSPENDED`). Bewust geen verwijdering — de gegevens blijven staan en hervatten is één klik; de platformorganisatie zelf kan niet gedeactiveerd worden. |
| **Account** | `id`, `email` (uniek), `name?`, `passwordHash`, `role`, `organizationId`, `failedLoginAttempts`, `lockedUntil`, `emailVerifiedAt?`, `mustChangePassword`, `isOperator`, `createdAt` | Login voor een persoon (T1.1). `role` = `ADMIN`/`CAREGIVER`/`USER` (zod op de grens). `name` is de weergavenaam van de accounthouder (gevuld bij zelfaanmelding T1.3; nullable — geseede accounts en login vereisen er geen). Wachtwoord alleen als argon2id-hash. `email` platformbreed uniek (login-keuze, ADR-0004). Lockout-velden voor brute-force-mitigatie. `emailVerifiedAt` (T1.4): `null` = nog niet geverifieerd (geseede/bestaande accounts blijven `null`; de bootstrap-seed-admin wordt wél geverifieerd), anders het bevestigingsmoment. `mustChangePassword` (T2.6): `true` zolang het account nog op het server-gegenereerde tijdelijke wachtwoord uit T2.4 draait — gezet bij aanmaken, gewist bij `POST /auth/password`; zolang het staat mag het account alléén zijn eigen gegevens bekijken en zijn wachtwoord wisselen. `isOperator` (T8.3, standaard `false`): **platform-operator** — mag via `/operator` over tenants heen organisaties beheren. Bewust een aparte vlag naast `role` (die blijft over de eigen organisatie gaan) en alléén geldig binnen een organisatie met `isPlatform=true`; wordt uitsluitend door de bootstrap-seed gezet, nooit via een API (ADR-0011). |
| **Session** | `id`, `tokenHash` (uniek), `accountId`, `createdAt`, `expiresAt` | Actieve login-sessie (T1.1). Alleen de **SHA-256-hash** van het sessietoken staat in de db; het rauwe token leeft in de httpOnly-cookie. Verlopen sessies zijn ongeldig en worden opgeruimd. |
| **EmailVerificationToken** | `id`, `tokenHash` (uniek), `accountId`, `usedAt`, `expiresAt`, `createdAt` | E-mailverificatietoken (T1.4). Alleen de **SHA-256-hash** staat in de db; het rauwe token gaat per mail naar de accounthouder. Tokens zijn **eenmalig** (`usedAt`) en **verlopen** (`expiresAt`); een nieuw token (resend) maakt het vorige ongebruikte token van dat account ongeldig. Cascade delete met het account. |
| **User** | `id`, `name`, `organizationId`, `active`, `createdAt` | De communicerende persoon (T2.1). Staat los van `Account`: een gebruiker hoeft geen eigen login te hebben. Tenant-gebonden via `organizationId`. `active` deactiveert zonder te verwijderen. |
| **UserCommunicationProfile** | `userId` (PK), `showText`, `speechEnabled`, `speechVoice` | Communicatie-instellingen, 1-op-1 aan `User`. De oude AI-instellingen zijn in N0.5 verwijderd; de nieuwe communicatie-instellingen (INTENTO-NEW-DESIGN §50) volgen in N3.1. |
| **CaregiverAssignment** | `userId` + `accountId` (samengestelde PK), `createdAt` | Koppeling begeleider↔gebruiker (T2.2, DESIGN §2, FR-017). Many-to-many tussen een CAREGIVER-`Account` en een `User`. Stuurt de toegang: een begeleider ziet/beheert alléén gekoppelde gebruikers. Samengestelde sleutel voorkomt dubbele koppelingen; tenant-grens (zelfde organisatie) op de API-grens bewaakt. |
| **Device** | `id`, `userId`, `type`, `tokenHash` (uniek), `lastActive`, `createdAt` | Gekoppelde tablet (T2.3, DESIGN §6.2, FR-018), aan **precies één** `User` gebonden. Alleen de **SHA-256-hash** van het langlevende apparaat-token staat in de db; het rauwe token leeft in de `intento_device`-cookie. Geeft alléén toegang tot de eigen gebruiker. `lastActive` voor monitoring (geen communicatie-inhoud). |
| **DeviceLinkCode** | `id`, `codeHash` (uniek), `userId`, `usedAt`, `expiresAt`, `createdAt` | Koppelcode die een beheerder genereert (T2.3, FR-018). Alleen de **SHA-256-hash** staat in de db; codes zijn **eenmalig** (`usedAt`) en **verlopen** (`expiresAt`). Wisselt op `POST /devices/link` in voor een `Device`. |
| **VocabularyItem** | `id`, `organizationId?`, `labels`, `concepts`, `contexts` (JSON-arrays), `searchText`, `partOfSpeech?`, `isStart`, `sortOrder`, `status`, `labelStatus`, `source`, `licenseKey`, `licenseUrl?`, `author?`, `authorUrl?`, `sourceName?`, `sourceUrl?`, `sourceRef?`, `importedAt?`, `assetPath?`, `mimeType?`, `sha256?`, `bytes?`, `createdById?`, `createdAt`, `updatedAt` | De eigen Vocabulary (INTENTO-NEW-DESIGN §15). `organizationId` null = platformitem (startset); anders van één organisatie. Een organisatie ziet platform + eigen items, nooit die van een andere (`listAvailableVocabulary`). `status` `approved`/`retired` (nooit verwijderd), `labelStatus` `reviewed`/`machine`, `source` `seed`/`external`/`own`. Licentie en herkomst per item; `(sourceName, sourceRef)` uniek zodat een import nooit dubbelt. De JSON-lijsten worden bij het lezen met zod gevalideerd. |
| **AuditLog** | `id`, `action`, `outcome`, `accountId?`, `organizationId?`, `targetType?`, `targetId?`, `ip?`, `metadataJson?`, `createdAt` | Append-only spoor van een **gevoelige actie** (T8.2, DESIGN §9.4): login (geslaagd én mislukt), instellingen, persoonlijke context, profielexport/-import en beheeracties (gebruikers, begeleider-koppelingen, worker-tokens, conceptvoorstellen). `action` = stabiele sleutel (`audit/actions.ts`, bv. `auth.login`, `user.settings.update`); `outcome` = `success`/`failure`. Bevat **nooit communicatie-inhoud of vrije-tekst-PII**: alleen wie (`accountId`), waar (`organizationId`), wat (`targetType`/`targetId`) en een kleine, niet-gevoelige `metadataJson` (bv. een mislukkingsreden — nooit een e-mailadres, zodat het log geen enumeratie oplevert). `accountId`/`organizationId` zijn `null` bij pre-auth acties (mislukte login). **Bewust géén FK's** naar `Account`/`Organization`: het spoor is onafhankelijk en moet een verwijderde actor/tenant overleven (cascade zou juist het bewijs wissen). De lijst-API filtert op `organizationId` → een ADMIN ziet alleen het eigen-tenant-spoor. `ip` blijft server-side (niet in de publieke vorm). Indexen op `(organizationId, createdAt)`, `accountId` en `action`. |

Relaties: `Account.organizationId → Organization` (cascade delete); `Session.accountId →
Account` (cascade delete); `EmailVerificationToken.accountId → Account` (cascade delete);
`User.organizationId → Organization` (cascade delete);
`UserCommunicationProfile.userId → User` (cascade delete); `CaregiverAssignment.userId →
User` en `CaregiverAssignment.accountId → Account` (beide cascade delete — de koppeling
verdwijnt als de gebruiker of het begeleider-account wordt verwijderd); `Device.userId →
User` en `DeviceLinkCode.userId → User` (beide cascade delete — apparaten en openstaande codes
verdwijnen met de gebruiker); `VocabularyItem.organizationId → Organization` (cascade delete — de
eigen items verdwijnen met de organisatie; platformitems hebben geen organisatie) en
`VocabularyItem.createdById → Account` (set null). Zo verdwijnt bij het verwijderen van een
organisatie/gebruiker netjes alle onderliggende data.

## Seed

[`server/prisma/seed.ts`](../server/prisma/seed.ts) is idempotent (`npm run db:seed`) en
plaatst een demo-organisatie (als **platformorganisatie**, `isPlatform: true` — T5.8) **en** een eerste `ADMIN`-account. E-mail/wachtwoord komen uit
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (dev-default met waarschuwing als niet gezet). De logica zelf
staat in [`server/src/db/bootstrap-seed.ts`](../server/src/db/bootstrap-seed.ts), zodat script en tests
dezelfde code draaien. De geseede bootstrap-admin wordt meteen als **geverifieerd** aangemaakt (T1.4) — die
is door de operator ingericht, niet via publieke zelfaanmelding. Bij **herseeden** wordt een bestaande
bootstrap-admin die nog `emailVerifiedAt = null` heeft (bv. aangemaakt vóór de T1.4-migratie) alsnog
geverifieerd (T1.5, gerichte `updateMany` op `emailVerifiedAt: null`); een al gezette verificatiedatum en
het wachtwoord blijven ongemoeid. De Vocabulary-startset komt in N2.7 in de seed.

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
- **`correction_event_refine_round`** (T12.3) — `CorrectionEvent.rejectedConcept` wordt **nullable**, zodat een verfijnronde (T10.12) vastgelegd kan worden als gebeurtenis zónder uitsluiting. Bestaande rijen houden hun concept; de migratie herschrijft alleen de kolomdefinitie.
- **`ai_worker_queue`** (T5.5) — nieuwe tabellen `WorkerToken` (`tokenHash` uniek, `scopes`, `revokedAt`/`expiresAt`/`lastSeenAt` nullable, index op `revokedAt`) en `AiJob` (`task`, `status` (default `QUEUED`), `payloadJson`, `resultJson`/`errorMessage` nullable, `attempts`, `claimedById`/`claimedAt`/`leaseExpiresAt` nullable, `expiresAt`, `updatedAt`, indexen op `(status, createdAt)` en `claimedById`; `claimedById → WorkerToken` SetNull) voor de gedistribueerde AI-wachtrij en het worker-protocol. Niet tenant-gebonden (infrastructuur).
- **`organization_is_platform`** (T5.8) — `Organization` uitgebreid met `isPlatform` (`Boolean`, default `false`) om de platform-/operatororganisatie te markeren; alléén ADMINs daarvan mogen worker-tokens beheren.
- **`personal_context`** (T6.1) — nieuwe tabel `PersonalContext` (`userId`, `category`, `nameEncrypted`, `relationshipEncrypted` nullable, `aiUsageAllowed` (default `false`), `createdAt`, `updatedAt`, index op `userId`, cascade delete met `User`) voor de persoonlijke context. Gevoelige velden **versleuteld at-rest** (AES-256-GCM, `ENCRYPTION_KEY`); alléén rijen met `aiUsageAllowed=true` gaan naar de AI (DESIGN §6.3).
- **`preferences`** (T6.3) — nieuwe tabel `Preference` (`userId`, `concept`, `confidence` (default `0`), `count` (default `0`), `source` (default `confirmed_usage`), `suggestionStatus` (default `none`), `createdAt`, `updatedAt`, unieke `(userId, concept)`, index op `userId`, cascade delete met `User`) voor het leermechanisme. Voorkeuren worden alléén bij een **bevestigde** boodschap bijgewerkt en alléén als `aiLearningEnabled=true` (DESIGN §3.8, FR-014); ze bevatten geen communicatie-inhoud.
- **`question_mode`** (T7.1) — `ConversationSession` uitgebreid met `mode` (`String`, default `free`), `caregiverQuestion` (`String?`) en `startedByAccountId` (`String?`) voor de vraagmodus: een begeleider start een sessie met een vraag als context en een topic-anker dat de antwoorden begrenst (DESIGN §3.2, FR-012).
- **`audit_logging`** (T8.2) — nieuwe tabel `AuditLog` (`action`, `outcome` (default `success`), `accountId`/`organizationId`/`targetType`/`targetId`/`ip`/`metadataJson` nullable, `createdAt`, indexen op `(organizationId, createdAt)`, `accountId` en `action`) voor het audit-spoor van gevoelige acties. **Geen FK's** (onafhankelijk, onveranderlijk spoor dat een verwijderde actor/tenant overleeft); bevat geen communicatie-inhoud. Niet cascade-gebonden.
- **`account_must_change_password`** (T2.6) — `Account` uitgebreid met `mustChangePassword` (`Boolean`, default `false`) als markering dat het account nog op het tijdelijke wachtwoord uit T2.4 draait. Bestaande rijen krijgen `false`: van een account dat vóór deze migratie is aangemaakt valt niet meer vast te stellen of het wachtwoord al vervangen is, en achteraf iedereen markeren zou werkende begeleiders buitensluiten. Vanaf nu markeert alleen `POST /admin/accounts` een nieuw account.
- **`operator_console_and_org_active`** (T8.3) — `Account` uitgebreid met `isOperator` (`Boolean`, default `false`) en `Organization` met `active` (`Boolean`, default `true`) voor de platform-operatorconsole (ADR-0011). Bestaande rijen krijgen de veilige defaults: niemand is operator tot de bootstrap-seed de vlag zet, en elke bestaande omgeving blijft actief. Samen ontgrendelen ze de enige routetak die bewust niet op `organizationId` filtert (`/operator/*`, eigen guard) én maken ze deactivatie van een misbruikte omgeving mogelijk zonder gegevensverlies.
- **`conversation_offer_and_hypothesis`** (T10.3/T10.8) — `ConversationSession` uitgebreid met `pendingOffer` (`Json`, nullable) en `hypothesis` (`Json`, nullable); `ConversationStep` uitgebreid met `offeredConcepts` (`Json`, default `[]`). Legt vast wat er is **aangeboden** en wat de AI **denkt**, zodat `↩ Terug` exact herstelt en de voorsteldrempel niet op één modelantwoord vuurt.
- **`ai_generated_symbols`** (T10.6) — `AacSymbol` uitgebreid met `origin` (`String`, default `library`) en `reviewStatus` (`String`, default `APPROVED`) plus een index op `reviewStatus`, voor begrippen die de AI tijdens een gesprek aandroeg en die de beheerder nog moet beoordelen.
- **`message_acknowledgements`** (T13.3) — nieuwe tabel `MessageAcknowledgement` (`messageId` uniek, `accountId`, `createdAt`, index op `accountId`, cascade delete op beide FK's) waarmee een begeleider een bevestigde boodschap als **opgepakt** aftekent. Bewust naast `GeneratedMessage` in plaats van erin: de boodschap van de gebruiker blijft daarmee na het bevestigen onaangeroerd (DESIGN §2, ADR-0014).
- **`conversation_step_guess_concept`** (T16.3) — `ConversationStep` uitgebreid met `guessConcept` (`String?`): welke aangeboden tegel als **gok** van de AI gemarkeerd was (strategie `guess`, DESIGN §7.10). Bestaande rijen krijgen `null` — daar was geen gok, en een markering achteraf verzinnen zou de terugblik vervalsen. Nodig omdat `↩ Terug` en de correctieflow het scherm herstellen uit de stap: zonder deze kolom zou de gemarkeerde tegel na een stap terug een gewone optie worden.
- **`speech_output`** (T18.2) — `UserCommunicationProfile` uitgebreid met `speechEnabled` (`Boolean`, default `false`), `speechVoice` (`String`, default `"nl_NL-pim-medium"`) en `speechHints` (`Boolean`, default `true`) voor spraakuitvoer op de tablet.
- **`drop_old_ai_layer`** (N0.5, herbouw) — verwijdert de tabellen van de oude AI-laag (`AacSymbol`,
  `AacConceptRelation`, `ConversationSession`, `ConversationStep`, `GeneratedMessage`,
  `MessageAcknowledgement`, `CorrectionEvent`, `ConceptProposal`, `Preference`, `PersonalContext`,
  `AiJob`, `WorkerToken`) en de profielvelden `iconsPerScreen`, `aiLearningEnabled`, `supportMode`,
  `contextIndicator`, `conversationStrategy` en `speechHints`. Geen datamigratie: de herbouw is zonder
  backward compatibiliteit (INTENTO-NEW-DESIGN §55).
- **`vocabulary_item`** (N2.1) — nieuwe tabel `VocabularyItem` met licentie-, herkomst- en assetvelden,
  uniek op `(sourceName, sourceRef)`, indexen op `(organizationId, status)` en `(status, labelStatus)`.
