# 0002. Monorepo met npm workspaces (shared / server / web)

- **Status:** geaccepteerd
- **Datum:** 2026-07-08

## Context

Intento heeft een backend (Fastify), een web-frontend (React) en een verzameling
datacontracten (zod-schema's voor API-payloads) die client en server delen. DESIGN
§9.3 stelt npm workspaces met `server/`, `web/` en `shared/` voor, ter bevestiging via
ADR in fase 0. We willen dat de vorm van API-payloads op één plek staat en dat een
wijziging daarin client en server tegelijk laat falen bij typecheck, in plaats van
stilletjes uit elkaar te laten lopen.

## Beslissing

We gebruiken een **npm-workspaces-monorepo** met drie workspaces:

- **`shared/`** — zod-schema's en de daaruit afgeleide types; bron van waarheid voor
  API-payloads. Wordt gebouwd naar `dist/` en door de andere workspaces geïmporteerd
  als `@intento/shared`.
- **`server/`** — Fastify-backend met `buildApp()`-factory.
- **`web/`** — React + Vite tablet-app.

Gedeelde tooling (TypeScript-basisconfig, ESLint flat config, Prettier) staat in de
root; elke workspace heeft een eigen `package.json`, `tsconfig.json` en scripts. De
root-scripts (`typecheck`, `test`, `build`) fan-outen over de workspaces.

## Gevolgen

- Eén `npm install` installeert alles; `@intento/shared` wordt via workspace-symlink
  gekoppeld, dus geen publicatiestap tijdens ontwikkeling.
- Een contractwijziging in `shared/` breekt de typecheck van server én web meteen —
  precies wat we willen.
- `shared/` moet gebouwd zijn (`dist/`) voordat server/web ertegen bouwen; de
  root-`build` doet dit in volgorde (shared → server → web).
- Iets meer configuratie-overhead (drie `tsconfig`'s) dan één pakket.

## Alternatieven overwogen

- **Eén enkel pakket (geen workspaces)** — simpeler qua config, maar dan staan server-
  en web-code en hun deps door elkaar en is het contract niet als apart, herbruikbaar
  pakket af te dwingen.
- **Aparte repo's + gepubliceerd `shared`-pakket** — sterkere isolatie, maar versie- en
  publicatie-overhead die niet past bij één team dat lockstep ontwikkelt.
- **pnpm/turbo/nx** — krachtiger voor grote monorepo's, maar npm workspaces volstaat
  voor drie pakketten en vermijdt een extra toolafhankelijkheid (DESIGN §9.3-standaard).
