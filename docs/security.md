# Beveiliging

> Welke maatregelen genomen zijn en welke afwegingen gemaakt. Werk bij per taak.
> Draai `npm audit` (0 kwetsbaarheden) en `/security-review` bij grotere fases.
> Ontwerpbron: [../DESIGN.md](../DESIGN.md) §9.4 + CLAUDE.md security-checklist.

## Genomen maatregelen (OWASP-checklist)

- [x] **Security headers** — `@fastify/helmet` op alle responses (CSP, HSTS,
      `X-Content-Type-Options: nosniff`, `X-Frame-Options`, …). Getest in `app.test.ts`.
- [x] **CORS** — alleen de geconfigureerde `CORS_ORIGIN` met credentials.
- [x] **Secrets via env** — `SIGNING_SECRET`/`ENCRYPTION_KEY` uit env, nooit in code.
      **Prod-guard:** de server weigert te starten in productie met dev-default-secrets
      of met `COOKIE_SECURE=false`. Getest in `app.test.ts`.
- [x] **Input-validatie** — env via zod; consistente `ZodError → 400`. Alle latere
      externe input (body/query/params) via zod op elke grens.
- [x] **Geen detail-lek** — onbekende fouten → `500 INTERNAL_ERROR` zonder stacktrace
      of interne melding naar de client.
- [x] **Injectie** — via Prisma (geparametriseerd), vanaf T0.2.
- [x] **Auth** — argon2id-wachtwoordhash (`auth/password.ts`); sessietokens **gehasht
      at-rest** (SHA-256, alleen de hash in de db) in ondertekende httpOnly+Secure cookies
      met `SameSite=Lax` (`auth/session.ts`, `auth/cookie.ts`). Login-fouten zijn generiek
      (`INVALID_CREDENTIALS`) en constante-tijd (dummy-verify bij onbekende e-mail) zodat
      het bestaan van een account niet lekt. Getest in `auth/*.test.ts`, `routes/auth.test.ts`.
- [x] **Account-lockout / rate limiting** — na `LOGIN_MAX_ATTEMPTS` mislukte pogingen
      tijdelijke lockout (`LOGIN_LOCKOUT_MINUTES`); streng per-IP rate limit op `/auth/login`
      (`@fastify/rate-limit`, `global: false`). Getest (lockout → 423, overschrijding → 429).
- [x] **Zelfaanmelding (T1.3)** — `POST /auth/register` maakt organisatie + eerste ADMIN in
      één transactie (rolt terug bij een botsing, dus nooit een lege org zonder eigenaar).
      Wachtwoordsterkte-eis op de grens (`strongPasswordSchema`, ≥12 tekens). Uniciteit van de
      e-mail leunt op de db-constraint (`Account.email @unique`), niet op een losse "bestaat
      al?"-check — dat voorkomt een race én verraadt niet via responstijd of het adres bestaat.
      Een botsing geeft een **generieke** `409 REGISTRATION_FAILED` (geen account-enumeratie).
      Streng per-IP rate limit (`REGISTER_RATE_LIMIT_*`). De nieuwe org start leeg en
      volledig tenant-geïsoleerd. Getest in `routes/register.test.ts` (isolatie, generieke
      weigering, zwak wachtwoord/ongeldig type → 400, rate limit → 429).
- [x] **E-mailverificatie (T1.4)** — verificatietoken **gehasht at-rest** (SHA-256, alleen de
      hash in de db, `auth/email-verification.ts`), net als sessie-/apparaat-tokens; het rauwe
      256-bit token gaat alléén per mail naar de accounthouder. Tokens zijn **eenmalig**
      (`usedAt`) en **verlopen** (`EMAIL_VERIFICATION_TTL_HOURS`); een resend maakt het vorige
      ongebruikte token ongeldig. Inwisselen (`/auth/verify-email`) weigert onbekend/verlopen/
      gebruikt met dezelfde neutrale `400 INVALID_VERIFICATION_TOKEN`. **Opnieuw versturen**
      (`/auth/verify-email/resend`) is publiek, streng per-IP rate-limited (`RESEND_RATE_LIMIT_*`)
      en antwoordt **altijd** neutraal — of het adres bestaat, al geverifieerd is of onbekend
      (geen account-enumeratie). De mail-service is provider-agnostisch (`mail/transport.ts`):
      SMTP in productie (verplicht via prod-guard), log-transport in dev, geheugen-transport in
      tests. **Gekozen verificatie-gate:** onbevestigde accounts mogen inloggen en hun eigen
      gegevens bekijken, maar het aanmaken van gebruikers (`POST /users`, privacygevoelige
      personen) is geblokkeerd → `403 EMAIL_NOT_VERIFIED` (`requireVerifiedEmail`). Getest in
      `auth/email-verification.test.ts` en `routes/email-verification.test.ts`.
- [x] **Access control / IDOR** — autorisatie-middleware `authorize(prisma, { roles })`
      (`auth/authorize.ts`): geen/ongeldige sessie → `401 NOT_AUTHENTICATED`, verkeerde rol →
      `403 FORBIDDEN`. Tenant-isolatie via `tenantScope(account)` (where-filter op
      `organizationId`) en `assertSameTenant(account, resource)` (403 bij vreemde tenant,
      dezelfde fout als "bestaat niet" om bestaan niet te lekken) in `auth/tenant.ts`. Elke
      tenant-gebonden query wordt op `organizationId` gefilterd. Getest op isolatie tussen
      twee organisaties en op 401/403 in `routes/accounts.test.ts` en `auth/tenant.test.ts`.
      Fijnmaziger dan rol + tenant: een CAREGIVER ziet/beheert alléén de gebruikers waaraan hij
      gekoppeld is (`assertCaregiverAccess`, `auth/caregivers.ts`) — niet-gekoppeld → `403`.
      Getest in `routes/caregivers.test.ts` (T2.2). Read-only **meekijken** met een lopend gesprek
      (`GET /question/users/{id}/conversation`, T7.2) staat achter dezelfde tenant- + koppeling-check.
- [x] **Bevestigen is exclusief van de gebruiker (T7.2, DESIGN §2, §3.3, FR-011)** — een boodschap
      **bevestigen** kan nooit vanuit een begeleider-/beheerdersessie. `POST /conversation/{id}/confirm`
      draait achter `forbidAccountSession` (`auth/authorize.ts`) vóór `deviceAuthorize`: is er een geldige
      account-sessie op de request, dan `403 CONFIRM_REQUIRES_USER` — alleen de tablet (device-auth) mag
      bevestigen. In ondersteuningsmodus tikt de begeleider aan op de tablet, maar de betekenis (en het
      bevestigen) blijft van de gebruiker. Getest in `routes/conversation.test.ts` (caregiver-cookie → 403,
      device-cookie → 200).
- [x] **Apparaatkoppeling (T2.3)** — koppelcode én apparaat-token staan **gehasht at-rest**
      (SHA-256, alleen de hash in de db, `auth/device.ts`), net als sessietokens. Codes hebben
      ~40 bit entropie, zijn **eenmalig** (race-veilig geclaimd via conditionele update) en
      **verlopen** (`DEVICE_CODE_TTL_MINUTES`); een nieuwe code maakt de vorige ongeldig. Het
      apparaat-token leeft in een ondertekende httpOnly+Secure `intento_device`-cookie. `/devices/link`
      is publiek maar streng per-IP rate-limited tegen het raden van codes, en weigert generiek
      (`INVALID_LINK_CODE`) zonder onderscheid onbekend/verlopen/gebruikt. Het apparaat-token is
      een **aparte auth-pijler**: het geeft alléén toegang tot de eigen-gebruiker-endpoints
      (`/device/me`), nooit tot beheer-/accountroutes. Getest in `routes/devices.test.ts`.
- [x] **Uploads (T3.2)** — AAC-pictogramupload (`POST /admin/aac/symbols/{id}/image`, ADMIN-only)
      met **groottelimiet** (`AAC_IMAGE_MAX_BYTES`, `@fastify/multipart` kapt af → `413`) en een
      **mime-allowlist**: alleen `image/png`/`image/jpeg`/`image/webp`, dus **geen SVG** (dat kan
      script bevatten → XSS-risico bij serveren). Eén bestand per request. De bytes worden in de db
      bewaard en met een vast `Content-Type` geserveerd; het publieke `/aac/images/{id}` blijft
      niet-gevoelige presentatiedata (geen ondertekende URL's nodig in deze fase). Getest in
      `routes/aac.admin.test.ts` (type → `415`, te groot → `413`).
- [x] **Externe integratie / SSRF (T3.3)** — de OpenSymbols-koppeling loopt **volledig server-side**
      (`server/src/aac/opensymbols.ts`): de client praat nooit rechtstreeks met de externe dienst
      (DESIGN §8.1), credentials (`OPENSYMBOLS_SECRET`) staan alleen in de env. Elke te downloaden
      bron-URL moet **`https`** zijn (zod `httpsUrlSchema`) én passeert `assertSafeImageUrl`, die
      `localhost`, `*.local`/`*.internal` en loopback/link-local/private IP-bereiken (IPv4 + IPv6)
      weigert (SSRF-mitigatie). De opgehaalde afbeelding valt onder dezelfde **mime-allowlist**
      (PNG/JPEG/WebP, geen SVG → `415`) en **groottelimiet** (`AAC_IMAGE_MAX_BYTES` → `413`,
      inclusief een vroege `Content-Length`-check) als een upload; redirects worden geweigerd
      (`redirect: 'error'`) en er geldt een time-out. Externe fouten worden **niet gelekt** (nette
      `502`); zoekresultaten zonder `https`-afbeelding worden weggefilterd vóór ze de client bereiken.
      Getest in `routes/aac.opensymbols.test.ts` (niet-`https` → `400`, interne host → `400`,
      `415`/`413`/`502`/`503`, sanering van niet-`https`-resultaten).
- [x] **AI-grens en promptbegrenzing (T5.1)** — de AI loopt **volledig server-side** achter de
      AI-Orchestrator (`server/src/ai/`); de client praat nooit rechtstreeks met de LLM (DESIGN §8.1) en
      de AI-schema's staan bewust server-intern (niet in `@intento/shared`). Elke aanroep krijgt alléén de
      **beperkte, verse context** (systeemregels + doel + AAC-regels + toegestane gebruikerscontext +
      gesprekscontext + laatste keuze; **geen** chatgeschiedenis) via `buildAiPrompt`, waarvan de
      sleutelset gesloten is — er kan geen ongevraagde context (PII, vrije tekst) inlekken. De harde
      veiligheidsregels (DESIGN §7.8: nooit verzinnen/namens de gebruiker spreken/buiten de AAC-concepten)
      reizen als systeemregels mee. De provider-uitvoer wordt **opnieuw** zod-gevalideerd (een provider/
      worker wordt nooit vertrouwd; de AAC-existentiecheck volgt in T5.2). `AI_API_KEY` is een
      infrastructuur-credential in de env, nooit richting client. Gekozen richting: een **self-hosted**
      LLM (privacy by design), niet een externe cloud-API (ADR-0008). Getest in `server/src/ai/*.test.ts`.
- [x] **Gedistribueerde AI-workers / worker-token (T5.5)** — een externe worker is **backend-
      infrastructuur, geen vertrouwde component** (ADR-0010): de client praat nog steeds nooit met de AI,
      en **alle** worker-uitvoer wordt op de grens opnieuw zod-gevalideerd (`routes/ai-worker.ts`,
      verkeerde vorm → `400`) én loopt door de AAC-validatielaag (T5.2) — een onbekend concept van een
      worker bereikt de gebruiker nooit. Het **worker-token** is een aparte auth-pijler (naast account-/
      device-/sessietokens), **gehasht at-rest** (SHA-256, `ai/worker-token.ts`), 256-bit random, met een
      **scope** (`ai:process`), **intrekbaar** (`revokedAt`) en optioneel **verlopend** (`expiresAt`); het
      gaat als `Authorization: Bearer …` mee (geen cookie). `workerAuthorize` (`auth/worker.ts`) geeft
      `401` bij geen/onbekend token en `403` bij ingetrokken/verlopen/verkeerde-scope. De worker-endpoints
      zijn **per-IP rate-limited** (`AI_WORKER_RATE_LIMIT_*`). Een worker die zijn lease verliest (crash/
      time-out) kan zijn oude job niet meer voltooien (guarded update). De payload/het resultaat bevat
      **geen** communicatie-inhoud buiten AAC-concepten (privacy by design). **Backpressure** (503
      `AI_WORKER_BUSY`) voorkomt dat een piek de site laat blokkeren (DESIGN §9.4). Getest in
      `ai/job-queue.test.ts`, `ai/queue-provider.test.ts`, `routes/ai-worker.test.ts` en
      `routes/conversation-queue.test.ts`.
- [x] **Worker-tokenbeheer als platform-privilege (T5.8)** — worker-tokens zijn platform-
      **infrastructuur**, niet tenant-gebonden. Beheer (aanmaken/lijsten/intrekken) via de beheer-UI
      (`routes/worker-tokens.ts`) is daarom voorbehouden aan een **ADMIN van de platformorganisatie**
      (`Organization.isPlatform`, gezet door de bootstrap-seed): naast `authorize({ roles: ['ADMIN'] })`
      hangt `requirePlatformOrg` (`auth/authorize.ts`, `403 NOT_PLATFORM_ADMIN`). Zo kan een zelf-
      aangemelde familie/zorg-ADMIN (T1.3) **geen** infra-credential munten dat jobs van álle tenants zou
      verwerken — een privilege-escalatie/misbruik-vector wordt zo dichtgezet. Het **rauwe** token verlaat
      de server uitsluitend één keer bij aanmaken (daarna alleen de SHA-256-hash); de lijst-/detailweergave
      lekt nooit de hash of het rauwe token. Een ingetrokken token wordt onmiddellijk door
      `workerAuthorize` geweigerd (`403`). Getest in `routes/worker-tokens.test.ts` (platform-ADMIN
      maakt/lijst/trekt in, rauw token één keer, niet-platform-ADMIN → 403, ingetrokken token → 403).
- [x] **Persoonlijke context — versleuteling at-rest + toestemmingsfilter (T6.1)** — de gevoelige,
      vrij-tekst-PII van `PersonalContext` (`name`, `relationship`) wordt **versleuteld** opgeslagen met
      **AES-256-GCM** (`crypto/encryption.ts`, sleutel afgeleid uit `ENCRYPTION_KEY` via SHA-256): db-lekkage
      levert geen leesbare persoonsgegevens op, en geknoei aan de cijfertekst wordt bij het ontsleutelen
      gedetecteerd (auth-tag). Anders dan tokens (die we alleen *hashen*) is hier terugleesbaarheid nodig, dus
      versleuteling. Elke veldversleuteling krijgt een **nieuwe random IV** (nooit hergebruikt) en een
      versieprefix (`v1:`) voor latere rotatie. Toegang is tenant-/gebruiker-gebonden en, voor een CAREGIVER,
      beperkt tot **gekoppelde** gebruikers (`assertSameTenant` + `assertCaregiverAccess`). **AI-toestemmings-
      filter (DESIGN §6.3):** de gespreksflow laadt **alléén** context met `aiUsageAllowed=true` in de prompt
      (`users/personal-context.ts` → `loadAllowedUserContext`); context zonder expliciete toestemming bereikt
      de AI nooit. Getest in `crypto/encryption.test.ts` (roundtrip, unieke IV, tamper/verkeerde sleutel) en
      `routes/personal-context.test.ts` (rauwe-db-test: geen plaintext; toestemmingsfilter: niet-toegestane
      context nergens in de prompt; tenant-/caregiver-403; ongeldige categorie → 400).
- [x] **Profielexport/-import — versleuteld bestand + strikte toegang (T8.1)** — de export
      (`GET /users/{id}/export`) bundelt alléén het **profiel** (communicatie-instellingen, persoonlijke
      context, voorkeuren, weergavenaam) en **nooit** account-/organisatiegegevens, id's of tokens (DESIGN
      §6.4). De volledige payload wordt met dezelfde AES-256-GCM-`Encryptor` (`ENCRYPTION_KEY`) versleuteld,
      dus het exportbestand is **onleesbaar zonder de omgevingssleutel** (getest: de payload bevat geen
      plaintext-PII, en importeren met een andere sleutel → `400 IMPORT_INVALID`). Beide acties zijn
      **ADMIN-only** en tenant-gebonden (`assertSameTenant`); import eist bovendien een **geverifieerd
      e-mailadres** (`requireVerifiedEmail`, zoals `POST /users`) omdat het een echte persoon aanmaakt.
      Ongeldige/beschadigde invoer wordt netjes tot `400 IMPORT_INVALID` gemapt (nooit een 500, geen
      interne details). Geïmporteerde context wordt in de doelomgeving **opnieuw versleuteld** at-rest.
      **Restrisico/afweging:** de export gebruikt de omgevings-`ENCRYPTION_KEY`, dus cross-deployment-
      overdracht vereist dat beide omgevingen dezelfde sleutel delen; een wachtwoordgebaseerde exportsleutel
      is toekomstig werk. Getest in `routes/profile-transfer.test.ts`.
- [ ] **Transport** — HTTPS/WSS in productie; `trustProxy` via `TRUST_PROXY` (hop-count).
- [x] **Audit-logging (T8.2, DESIGN §9.4)** — een herbruikbare `recordAudit(...)` (`server/src/audit/`)
      schrijft een **append-only** spoor over gevoelige acties: login (geslaagd én mislukt, brute-force-
      detectie), logout, registratie, e-mailverificatie, gebruikersbeheer + instellingen, begeleider-
      koppelingen, koppelcodes, persoonlijke context (create/update/delete), profielexport/-import, worker-
      tokens en conceptvoorstellen. **Best-effort en nooit blokkerend**: een hapering in de audit-tabel laat
      de hoofdactie niet mislukken (fout gelogd, niet doorgegooid). **Geen communicatie-inhoud of vrije-tekst-
      PII**: alleen een stabiele `action`-sleutel, uitkomst, objectverwijzing en kleine niet-gevoelige
      `metadata`. Een mislukte login logt géén e-mailadres (voorkomt enumeratie in het log) en heeft geen
      account/tenant. Inzage via `GET /admin/audit-logs` is **ADMIN-only** en **tenant-gefilterd** op
      `organizationId` (een beheerder ziet nooit een ander tenant-spoor); het `ip`-veld blijft server-side.
      Het `AuditLog`-model heeft **bewust geen FK's** zodat het spoor een verwijderde actor/tenant overleeft.
      Getest in `routes/audit.test.ts` (login-succes/-failure, instellingen, context zonder PII, export,
      ADMIN-only + tenant-isolatie, CAREGIVER → 403).

## Bekende afwegingen / restrisico's

- `server.ts` bindt op `0.0.0.0`; op een gedeeld netwerk zonder firewall is de dev-server
  bereikbaar voor anderen. Voor productie hoort de app achter een reverse proxy (TLS).

## Reviewgeschiedenis

- **T8.2 (2026-07-12)** — `/security-review` over de audit-logging-fase en de meeliftende wijzigingen.
  **Geen HIGH/MEDIUM-bevindingen.** Gecontroleerd en akkoord: geen injectie (Prisma-parameters,
  `metadataJson` opaque opgeslagen), tenant-isolatie op `GET /admin/audit-logs`
  (`where organizationId`, ADMIN-only), geen PII/`ip` in de respons, een mislukte login logt geen
  e-mailadres (geen enumeratie), React-escaping in `AuditLogPage`, en `recordAudit` is best-effort zodat
  een audit-hapering de hoofdactie nooit breekt. Geen open bevindingen.
