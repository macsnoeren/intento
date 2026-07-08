# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## [Unreleased]

### Toegevoegd
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
