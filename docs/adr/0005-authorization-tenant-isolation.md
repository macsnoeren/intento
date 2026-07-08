# 0005. Autorisatie en tenant-isolatie: preHandler-middleware + expliciete tenant-scope

- **Status:** geaccepteerd
- **Datum:** 2026-07-08

## Context

T1.2 vraagt om autorisatie (rolcontrole per route) en multi-tenant-isolatie: **elke query
gefilterd op `organizationId`**, aantoonbaar met tests dat organisatie A nooit data van
organisatie B ziet (DESIGN §2, §9.4; CLAUDE.md domeinregels). T1.1 leverde authenticatie
(sessie-cookie → account). We moeten kiezen *waar* en *hoe* we rol- en tenant-grenzen
afdwingen, zó dat het herbruikbaar is voor alle latere endpoints en moeilijk te vergeten.

## Beslissing

- **Autorisatie via één preHandler-factory** `authorize(prisma, { roles })`
  (`server/src/auth/authorize.ts`). Die resolvet het account uit de sessie-cookie (401
  `NOT_AUTHENTICATED` als dat mislukt), controleert optioneel de rol (403 `FORBIDDEN`) en
  zet het geverifieerde account op `request.account` (module-augmentatie). Een route is
  **alleen** beschermd als dit preHandler er expliciet voor hangt — geen impliciete globale
  auth die je per ongeluk "aan" laat staan. `requireAccount(request)` leest het account in
  de handler (faalt hard met 500 als de preHandler ontbreekt: programmeerfout).
- **Tenant-isolatie via expliciete helpers** (`server/src/auth/tenant.ts`):
  `tenantScope(account)` levert het `where`-fragment `{ organizationId }` voor lees-/
  lijstqueries; `assertSameTenant(account, resource)` bewaakt directe toegang op id en gooit
  403 als een record bij een andere organisatie hoort **of niet bestaat** (dezelfde fout,
  zodat het bestaan van resources in een andere tenant niet lekt — IDOR-mitigatie).
- **Foutcontract:** rol/tenant-weigering is `403 FORBIDDEN`, niet-ingelogd is `401
  NOT_AUTHENTICATED`, beide in de consistente structuur uit DESIGN §8.1.
- **Bewijs is verplicht:** herbruikbare testhelpers (`seedOrganization`, `seedAccount` met
  gedeelde `organizationId`, `loginCookie`) maken isolatietests kort. Elk beschermd endpoint
  krijgt 401/403- en cross-tenant-tests.

## Gevolgen

- Rol- en tenantcontrole staan op één plek; nieuwe endpoints hergebruiken dezelfde
  middleware en helpers in plaats van ad-hoc checks.
- `request.account` is overal na `authorize(...)` beschikbaar, inclusief `organizationId`
  voor `tenantScope`.
- Tenant-filtering blijft de **verantwoordelijkheid van de query-auteur**: de helper maakt
  het triviaal, maar dwingt niet op db-niveau af. Daarom is de isolatietest per endpoint
  onderdeel van de Definition of Done (afspraak, niet enkel conventie). Een sterkere garantie
  (Prisma-extension/RLS) is een latere optie als het aantal modellen groeit.
- `GET /admin/accounts` is toegevoegd als representatief ADMIN-only, tenant-gefilterd
  endpoint dat de laag end-to-end aantoont; volledig gebruikersbeheer volgt in T2.1.

## Alternatieven overwogen

- **Globale auth-hook met per-route uitzonderingen** — makkelijk iets te vergeten "open" te
  zetten; expliciete opt-in per route is veiliger en beter leesbaar.
- **Tenant-filtering afdwingen via Prisma-middleware/extension of Postgres RLS** — sterker
  (niet te vergeten), maar nu overkill bij weinig modellen en lastiger testbaar/portabel
  tussen SQLite en PostgreSQL. Bewaard als optie voor later.
- **404 i.p.v. 403 bij vreemde tenant** — 404 lekt minder, maar de acceptatiecriteria van
  T1.2 vragen expliciet 403 voor ongeautoriseerde toegang. We gebruiken 403 en voorkomen
  bestaans-lek juist door "bestaat niet" en "andere tenant" dezelfde 403 te geven.
