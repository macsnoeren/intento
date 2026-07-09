# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## [Unreleased]

### Toegevoegd
- **T1.4 E-mailverificatie.** Verificatie van het bij zelfaanmelding (T1.3) aangemaakte
  admin-account. Nieuw veld `Account.emailVerifiedAt` (nullable) en nieuwe tabel
  `EmailVerificationToken` (migratie `email_verification`): het token staat **gehasht at-rest**
  (SHA-256, alleen de hash in de db), is **eenmalig** (`usedAt`) en **verloopt**
  (`EMAIL_VERIFICATION_TTL_HOURS`); een resend maakt het vorige ongebruikte token ongeldig.
  Endpoints: `POST`/`GET /auth/verify-email` wisselt het token in (`200 { verified, account }`;
  ongeldig/verlopen/gebruikt → neutrale `400 INVALID_VERIFICATION_TOKEN`) en
  `POST /auth/verify-email/resend` (publiek, streng rate-limited, **altijd** neutrale respons —
  geen account-enumeratie). Registratie verstuurt voortaan een verificatiemail (best-effort — een
  falende mailserver blokkeert de registratie niet). **Provider-agnostische mail-service**
  (`mail/transport.ts`): SMTP via nodemailer in productie (verplicht via prod-guard),
  log-transport in dev, geheugen-transport in tests (injecteerbaar via `buildApp({ mail })`).
  **Verificatie-gate:** onbevestigde accounts mogen inloggen en hun eigen gegevens bekijken, maar
  gebruikers aanmaken (`POST /users`) is geblokkeerd → `403 EMAIL_NOT_VERIFIED`
  (`requireVerifiedEmail`); de bootstrap-seed-admin is meteen geverifieerd. Publiek veld
  `account.emailVerified`. Web: **verificatiebanner** met "opnieuw versturen"-knop voor een
  onbevestigd account, en een **verificatiepagina** die het token uit de e-maillink (`?token=`)
  inwisselt. Gedeelde schema's: `verifyEmailRequestSchema`, `resendVerificationRequestSchema`,
  `verifyEmailResponseSchema`, `resendVerificationResponseSchema`. Env: `MAIL_FROM`, `SMTP_URL`,
  `EMAIL_VERIFICATION_URL_BASE`, `EMAIL_VERIFICATION_TTL_HOURS`, `RESEND_RATE_LIMIT_*`. ADR-0007.
  Server-, unit- en web-tests dekken de acceptatie (mail verstuurd bij registratie, geldig token →
  geverifieerd, verlopen/gebruikt/ongeldig geweigerd, resend rate-limited en enumeratie-veilig,
  token nergens plaintext, gate → 403). Gedocumenteerd in `docs/api.md`, `docs/data-model.md`,
  `docs/security.md`, `docs/adr/0007-*`, `.env.example`.
- **T1.3 Zelfaanmelding van een organisatie/familie.** Publiek registratie-endpoint
  `POST /auth/register`: maakt in **één transactie** een nieuwe `Organization` (`name` +
  `type` ∈ family/care/personal) plus het eerste `Account` met rol ADMIN (argon2id) en logt
  daarna meteen in (zelfde sessiemechanisme als T1.1: gehasht sessietoken in een ondertekende
  httpOnly+Secure cookie), respons `201` + `{ account }`. Security: de uniciteit van de e-mail
  leunt op de db-constraint (`Account.email @unique`) i.p.v. een losse "bestaat al?"-check —
  dat sluit een race tussen gelijktijdige registraties uit en verraadt niet via responstijd of
  een adres bestaat; een botsing → generieke `409 REGISTRATION_FAILED` (**geen account-enumeratie**,
  volledige non-enumeratie volgt met de e-mailverificatie in T1.4). Wachtwoordsterkte-eis op de
  grens (`strongPasswordSchema`, ≥12 tekens, niet één herhaald teken), streng per-IP rate limit
  (`REGISTER_RATE_LIMIT_*`), alle input zod-gevalideerd; de nieuwe org start leeg en volledig
  tenant-geïsoleerd (T1.2 blijft gelden). Nieuw (nullable) veld `Account.name` voor de
  weergavenaam van de admin (migratie `account_name`). Gedeelde schema's: `organizationTypeSchema`,
  `strongPasswordSchema`, `registerRequestSchema`. Web: **zelfaanmeldscherm** (`RegisterForm`,
  organisatienaam + type + adminnaam + e-mail + wachtwoord) met heen-en-weer-link vanaf het
  loginscherm; bij succes meteen in de beheeromgeving. Env: `REGISTER_RATE_LIMIT_MAX`,
  `REGISTER_RATE_LIMIT_WINDOW_MINUTES`. Server- en web-tests dekken de acceptatie (registreren →
  meteen ingelogd, generieke weigering bij dubbele e-mail zonder te lekken, tenant-isolatie,
  zwak wachtwoord/ongeldig type → 400, rate limit → 429). E-mailverificatie is als aparte taak
  T1.4 genoteerd. Gedocumenteerd in `docs/api.md`, `docs/data-model.md`, `docs/security.md`,
  `.env.example`.

- **T3.3 OpenSymbols-integratie.** In het AAC-beheer kan een beheerder nu een bestaand, vrij te
  gebruiken pictogram bij [OpenSymbols](https://www.opensymbols.org/) opzoeken en koppelen i.p.v.
  zelf te uploaden. De backend **proxyt** de externe dienst (de client praat nooit rechtstreeks,
  DESIGN §8.1): `GET /admin/aac/opensymbols/search?q=…` (ADMIN; gesaneerde resultaten — alleen
  resultaten met een `https`-afbeeldings-URL passeren) en `POST /admin/aac/symbols/:id/opensymbols`
  (haalt de gekozen afbeelding **server-side** op en slaat 'm lokaal op via de bestaande
  `AacSymbol.imageData`-opslag, T3.1/T3.2). Veiligheid: `imageUrl` moet `https` zijn (zod
  `httpsUrlSchema`) én mag geen interne/loopback-host zijn (SSRF-guard `assertSafeImageUrl` — weigert
  `localhost`, `*.local`/`*.internal` en private/loopback-IP-bereiken); het opgehaalde content-type
  moet in de mime-allowlist (PNG/JPEG/WebP → anders `415`) en de bytes binnen `AAC_IMAGE_MAX_BYTES`
  (→ `413`); een externe fout/lege respons → nette `502`, ontbrekende configuratie → `503`. De
  **bron/licentie** reist mee met het pictogram: nieuwe (nullable) velden `imageLicense`,
  `imageLicenseUrl`, `imageAuthor`, `imageAuthorUrl`, `imageSourceUrl` op `AacSymbol` (migratie
  `aac_opensymbols_attribution`), en een `attribution`-object op `aacSymbolSchema`; bij een
  zelf-geüploade afbeelding wordt oude attributie gewist. Gedeelde schema's: `aacAttributionSchema`,
  `httpsUrlSchema`, `openSymbolsSearchQuerySchema`, `openSymbolsResultSchema`,
  `openSymbolsSearchResponseSchema`, `attachOpenSymbolsRequestSchema`. De OpenSymbols-client is
  provider-agnostisch en injecteerbaar (mock in tests; echte `fetch`-implementatie met
  token-uitwisseling + time-out). Env: `OPENSYMBOLS_API_URL`, `OPENSYMBOLS_SECRET` (leeg =
  uitgeschakeld), `OPENSYMBOLS_TIMEOUT_MS`. Web: OpenSymbols-zoekpaneel in het symbooldetail
  (zoeken, resultaten met bronvermelding, koppelen) en attributieweergave onder het pictogram.
  Server- en web-tests dekken de acceptatie (zoeken → koppelen → lokaal opgeslagen met licentie/bron)
  en de fout-/veiligheidspaden (niet-`https`, SSRF, `415`/`413`/`502`/`503`, leeg resultaat). Zie
  ADR-0006. Gedocumenteerd in `docs/api.md`, `docs/data-model.md`, `docs/security.md`.

- **T3.2 AAC-beheer-UI.** Beheeromgeving om de gedeelde pictogrambibliotheek te onderhouden
  (ADMIN; de bibliotheek is platformbreed, dus rolcontrole i.p.v. tenant-filtering). Nieuwe
  admin-endpoints: `GET /admin/aac/symbols` (alle symbolen met relaties, optioneel gefilterd op
  `q`/`category`), `POST`/`PUT /admin/aac/symbols[/:id]` (aanmaken/bewerken; uniek `concept`,
  botsing → `409`; `concept` streng gevalideerd op `^[a-z0-9-]+$`), `DELETE /admin/aac/symbols/:id`
  (relaties casceren mee), `POST /admin/aac/symbols/:id/image` (multipart-upload; mime-allowlist
  PNG/JPEG/WebP → `415`, groottelimiet uit env → `413`), `POST /admin/aac/relations` (relatie
  ouder→kind; geen zelfrelatie → `400`, dubbel → `409`) en `DELETE /admin/aac/relations/:id`.
  Geüploade pictogrammen worden **in de db** bewaard (`AacSymbol.imageData`/`imageMimeType`/
  `imageVersion`, migratie `aac_admin_images`) en hebben voorrang bij het serveren; zonder upload
  valt `GET /aac/images/:id` terug op de SVG-glyph-placeholder. De afbeeldings-URL is nu
  `/aac/images/:id` met cache-buster `?v=<imageVersion>` na een upload (was `/aac/images/:id.svg`).
  Gedeelde schema's: `aacSymbolInputSchema` (met `aacConceptKeySchema`/`aacSynonymsSchema`),
  `aacSymbolAdminSchema` (+ `hasImage`, `children`/`parents` als `aacRelationEdgeSchema`),
  `aacSymbolListResponseSchema`, `aacRelationInputSchema`. Web: nieuwe **AAC-bibliotheekpagina**
  (zoeken/filteren, symbool toevoegen/bewerken/verwijderen, afbeelding uploaden, relaties leggen)
  en tabnavigatie (`AdminNav`) tussen Gebruikers- en AAC-beheer. Env: `AAC_IMAGE_MAX_BYTES`
  (standaard 512 KiB). Plugin `@fastify/multipart` (`throwFileSizeLimit: false` → afkappen +
  eigen `413`). Server- en web-tests dekken de acceptatie (symbool + relatie toevoegen en
  terugvinden via zoeken) en de upload-validatie (type/grootte). Gedocumenteerd in `docs/api.md`,
  `docs/data-model.md`, `docs/security.md`.

- **T3.1 AAC-model, seed en zoek-API.** Prisma-modellen `AacSymbol` (gedeelde, niet-tenant-gebonden
  pictogrammen: unieke `concept`-sleutel, `label`, `category`, `glyph`, `synonyms` als JSON en een
  afgeleide genormaliseerde `searchText`-zoekindex) en `AacConceptRelation` (begripsboom
  parent→child, samengestelde unieke `(parentId, childId, relation)`, beide `onDelete: Cascade`),
  migratie `aac_library`. Endpoints `GET /aac/search?q=…` (hoofdletterongevoelig zoeken op concept,
  label én synoniemen; toegankelijk voor een ingelogd **account óf** een gekoppeld **apparaat**,
  anders `401`) en `GET /aac/images/{id}.svg` (publiek, server-gerenderde SVG-placeholder uit de
  emoji `glyph` — echte uploads volgen in T3.2). Portabiliteitskeuze: één `contains` op de vooraf
  lowercased `searchText` + genormaliseerde zoekterm werkt identiek op SQLite en PostgreSQL, zonder
  DB-specifieke `mode: 'insensitive'`. Idempotente bibliotheek-seed (`server/src/aac/library.ts` +
  dataset `server/src/aac/data.ts`, ~31 symbolen + relaties voor de voorbeeldflows uit DESIGN §3),
  meegenomen in `npm run db:seed`. Gedeelde schema's (`aacCategorySchema`, `aacSymbolSchema`,
  `aacSearchQuerySchema`, `aacSearchResponseSchema`). Server-tests dekken schone/ idempotente seed,
  zoeken-op-synoniem, hoofdletterongevoeligheid, lege query (`400`), auth (account én device, `401`
  zonder), en het serveren/404 van pictogrammen. Gedocumenteerd in `docs/api.md`,
  `docs/data-model.md`.

- **T2.3 Tabletkoppeling (device).** Prisma-modellen `Device` (gekoppelde tablet aan één
  gebruiker; `tokenHash` uniek, `lastActive`) en `DeviceLinkCode` (koppelcode; `codeHash`
  uniek, `usedAt`, `expiresAt`), beide `onDelete: Cascade`, migratie `devices_and_link_codes`.
  Endpoints: `POST /admin/users/{id}/device-code` (ADMIN, tenant-gebonden, genereert een
  eenmalige verlopende koppelcode — plaintext eenmalig terug, oude ongebruikte code vervalt),
  `POST /devices/link` (publiek, streng rate-limited, wisselt code in voor een langlevend
  apparaat-token in een ondertekende httpOnly+Secure `intento_device`-cookie) en `GET /device/me`
  (device-auth, eigen gebruiker + apparaat). Nieuwe **aparte auth-pijler** `deviceAuthorize`
  (`server/src/auth/device.ts`): code én token **gehasht at-rest** (SHA-256), eenmalig gebruik
  race-veilig geclaimd; een device-token geeft alléén toegang tot eigen-gebruiker-endpoints,
  nooit tot beheer-/accountroutes. Gedeelde schema's (`deviceCodeResponseSchema`,
  `linkDeviceRequestSchema`, `devicePublicSchema`, `deviceSessionResponseSchema`). Env:
  `DEVICE_CODE_TTL_MINUTES`, `DEVICE_TOKEN_TTL_DAYS`, `DEVICE_LINK_RATE_LIMIT_*`. Gebruiker-
  serializer verplaatst naar `server/src/users/serialize.ts` (hergebruikt door device-routes).
  Beheer-UI: `DevicePanel` genereert en toont een koppelcode per gebruiker (via `Api.generateDeviceCode`).
  Server-tests dekken de end-to-end koppelflow, geweigerde verlopen/gebruikte/onbekende codes,
  scheiding van de auth-pijlers en tenant-isolatie; web-test dekt het genereren. Gedocumenteerd
  in `docs/api.md`, `docs/data-model.md`, `docs/security.md`, `.env.example`.

- **T2.2 Begeleiders koppelen.** Prisma-model `CaregiverAssignment` (many-to-many
  begeleider↔gebruiker, samengestelde PK `userId`+`accountId`, beide `onDelete: Cascade`),
  migratie `caregiver_assignments`. Endpoints `GET /admin/users/{id}/caregivers` (ADMIN,
  begeleiderlijst met `linked`-vlag) en `POST /admin/users/{id}/caregivers` (ADMIN, idempotent
  koppelen/ontkoppelen via `{ accountId, linked }`); beide tenant-gebonden (gebruiker én
  begeleider in de eigen organisatie, anders `403`; niet-CAREGIVER-account → `400 NOT_A_CAREGIVER`).
  Nieuwe toegangsregel: een CAREGIVER ziet/beheert alléén gekoppelde gebruikers —
  `assertCaregiverAccess` (`server/src/auth/caregivers.ts`) op `GET /users/{id}` en
  `PUT /users/{id}/settings` geeft `403` bij een niet-gekoppelde begeleider (ADMIN onverkort
  alle gebruikers van de eigen organisatie). Gedeelde schema's (`caregiverLinkSchema`,
  `caregiverListResponseSchema`, `linkCaregiverRequestSchema`). Beheer-UI: `CaregiversPanel`
  toont per geselecteerde gebruiker de begeleiders met aan/uit-schakelaars (via `Api`-methoden
  `listCaregivers`/`linkCaregiver`). Server- en web-tests dekken koppelen/ontkoppelen,
  idempotentie, rolcontrole en tenant-isolatie (niet-gekoppelde caregiver → 403). Gedocumenteerd
  in `docs/api.md`, `docs/data-model.md`, `docs/security.md`.

- **T2.1 Gebruikersbeheer en communicatieprofiel.** Prisma-modellen `User` (los van
  `Account`, tenant-gebonden, `active`-vlag) en `UserCommunicationProfile` (1-op-1:
  `iconsPerScreen` 2/4/6/8 standaard 4, `showText`, `aiLearningEnabled`, `supportMode`),
  migratie `users_and_communication_profile`. CRUD-endpoints `POST /users` (ADMIN),
  `GET /admin/users` (ADMIN), `GET /users/{id}` (ADMIN/CAREGIVER), `PUT /users/{id}/settings`
  (ADMIN/CAREGIVER, zod dwingt 2/4/6/8 af) en `DELETE /users/{id}` (ADMIN) — alle queries
  tenant-gefilterd, id-toegang via `assertSameTenant` (403 bij andere organisatie).
  Gedeelde schema's (`iconsPerScreenSchema`, `communicationProfileSchema`, `userPublicSchema`,
  `createUserRequestSchema`, `updateSettingsRequestSchema`, `userListResponseSchema`).
  Beheer-UI in de web-app: login-scherm, gebruikerslijst met aanmaken/verwijderen en een
  instellingenformulier (radioknoppen 2/4/6/8 + schakelaars), via een gevalideerde,
  injecteerbare `Api`-client (`web/src/api.ts`). Server- en web-tests dekken CRUD, validatie,
  rolcontrole (caregiver mag niet verwijderen) en tenant-isolatie. Gedocumenteerd in
  `docs/api.md`, `docs/data-model.md`.

- **T1.2 Autorisatie en tenant-isolatie.** Herbruikbare autorisatie-middleware
  `authorize(prisma, { roles })` (`server/src/auth/authorize.ts`): 401 `NOT_AUTHENTICATED`
  zonder geldige sessie, 403 `FORBIDDEN` bij verkeerde rol; zet het geverifieerde account op
  `request.account`. Tenant-isolatiehelpers `tenantScope(account)` (where-filter op
  `organizationId`) en `assertSameTenant(account, resource)` (`server/src/auth/tenant.ts`).
  `/auth/me` gebruikt nu dezelfde middleware. Representatief ADMIN-only, tenant-gefilterd
  endpoint `GET /admin/accounts` (`accountListResponseSchema`) toont de laag end-to-end.
  Herbruikbare testhelpers (`seedOrganization`, `seedAccount` met gedeelde org, `loginCookie`)
  en isolatie-/rol-tests (org A ziet nooit org B; 401/403). Gedocumenteerd in ADR-0005,
  `docs/api.md`, `docs/security.md` (access-control-vinkje), `docs/architecture.md`.

- **T1.1 Accounts, login en organisaties.** Prisma-modellen `Account`
  (rollen ADMIN/CAREGIVER/USER, platformbreed unieke e-mail, lockout-velden) en `Session`,
  migratie `accounts_and_sessions`. `POST /auth/login` (argon2id-wachtwoordhash, generieke
  constante-tijd foutrespons), `POST /auth/logout` en `GET /auth/me`. Sessietokens staan
  **alleen gehasht** (SHA-256) in de db; het rauwe token zit in een ondertekende
  httpOnly+Secure `intento_session`-cookie (`SameSite=Lax`). Account-lockout
  (`LOGIN_MAX_ATTEMPTS`/`LOGIN_LOCKOUT_MINUTES`) en strenge per-IP rate limiting op login
  (`@fastify/rate-limit`, `global: false`). Env uitgebreid met sessie-/lockout-/rate-limit-
  variabelen; seed maakt nu ook een eerste ADMIN-account (`SEED_ADMIN_*`). Gedocumenteerd in
  ADR-0004, `docs/api.md`, `docs/security.md`, `docs/data-model.md`. Nieuwe deps: `argon2`,
  `@fastify/cookie`, `@fastify/rate-limit`. `npm audit` blijft 0.

- **T0.2 Database-fundament.** Prisma 7 met SQLite (dev/test) en een PostgreSQL-compatibel
  schema (geen native enums; portabel). Verbinding via `prisma.config.ts` (CLI) en een
  `better-sqlite3` driver adapter in een Prisma-client-singleton (`server/src/db/prisma.ts`).
  Eerste migratie `init` (`Organization`), migratie-workflow (`db:migrate`/`:deploy`/`reset`)
  en idempotent seed-skelet (`db:seed`). Gescheiden testdatabase die per testrun vers wordt
  gemigreerd (vitest global setup) + voorbeeldtest die via Prisma schrijft/leest. Env
  `DATABASE_URL` toegevoegd; npm-`override` op `@prisma/dev` houdt `npm audit` op 0.
  Gedocumenteerd in ADR-0003 en `docs/data-model.md`.

### Beveiliging
- npm-`override` `@prisma/dev@^0.24.14` verhelpt een kwetsbare transitieve
  `@hono/node-server` (GHSA-92pp-h63x-v22m) zonder Prisma te downgraden.

- **T0.1 Projectskelet en tooling.** npm-workspaces-monorepo (`shared/`, `server/`,
  `web/`). Server: Fastify 5 met `buildApp()`-factory, zod-gevalideerde `env.ts` met
  prod-guards, `GET /health`, centrale foutafhandeling (`ZodError → 400`, consistente
  foutstructuur) en helmet security headers. Web: React + Vite tablet-first shell.
  Tooling: TypeScript strict, ESLint (flat, type-aware) + Prettier, vitest,
  npm-scripts (`dev`, `build`, `typecheck`, `lint`, `test`). Docs, `.env.example` en
  ADR-0002 (monorepo-keuze) toegevoegd.

---

## [0.1.0] — 2026-07-08 — Fase 0: fundament (in opbouw)
### Toegevoegd
- Projectskelet, TypeScript strict, ESLint/Prettier, vitest, health-endpoint.
