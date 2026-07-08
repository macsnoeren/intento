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
- [ ] **Uploads** — groottelimiet, content-type-check, ondertekende URL's (AAC-fase).
- [ ] **Transport** — HTTPS/WSS in productie; `trustProxy` via `TRUST_PROXY` (hop-count).
- [ ] **Audit-logging** — security-relevante acties (T8.2).

## Bekende afwegingen / restrisico's

- `server.ts` bindt op `0.0.0.0`; op een gedeeld netwerk zonder firewall is de dev-server
  bereikbaar voor anderen. Voor productie hoort de app achter een reverse proxy (TLS).

## Reviewgeschiedenis

- _(nog geen `/security-review` gedraaid; gepland voor T8.2)_
