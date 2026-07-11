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
      Getest in `routes/caregivers.test.ts` (T2.2).
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
- [ ] **Transport** — HTTPS/WSS in productie; `trustProxy` via `TRUST_PROXY` (hop-count).
- [ ] **Audit-logging** — security-relevante acties (T8.2).

## Bekende afwegingen / restrisico's

- `server.ts` bindt op `0.0.0.0`; op een gedeeld netwerk zonder firewall is de dev-server
  bereikbaar voor anderen. Voor productie hoort de app achter een reverse proxy (TLS).

## Reviewgeschiedenis

- _(nog geen `/security-review` gedraaid; gepland voor T8.2)_
