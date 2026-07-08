# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## [Unreleased]

### Toegevoegd
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
