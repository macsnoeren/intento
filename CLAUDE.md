# CLAUDE.md — Intento

## Project

Intento is een AI-ondersteunde AAC-communicatieapplicatie voor mensen met een beperkt communicatievermogen. De AI helpt de gebruiker zijn **intentie** te vinden via pictogramkeuzes; de gebruiker blijft altijd eigenaar van de boodschap. Intento is **geen chatbot**.

- **`DESIGN.md`** — het geconsolideerde ontwerp (visie, requirements, flows, UX, datamodel, AI, API, architectuur). Dit is de ontwerpbron bij het bouwen; detailnaslag staat in `INTENTO-DESIGN/`.
- **`TASKS.md`** — de gefaseerde takenlijst. Er wordt **één taak per (schone) sessie** uitgevoerd.
- **`PROJECT-NODEJS/`** — het oorspronkelijke projectsjabloon (naslag; de werkregels hieronder komen daaruit).

## Werkwijze per sessie

1. Open `TASKS.md`, pak de **eerstvolgende niet-afgevinkte taak** (of de taak die de gebruiker noemt). Lees de bijbehorende DESIGN.md-secties.
2. Maak een kort plan voor die ene taak en bouw een **verticaal plakje**: data → server → UI → test. Blijf binnen de taakscope; noteer ontdekt meerwerk als nieuwe taak in `TASKS.md` in plaats van het nu te bouwen.
3. Verifieer echt: start de app, rook de happy path, draai alle checks (Definition of Done hieronder).
4. Werk documentatie bij, vink de taak af in `TASKS.md` en commit (wat + waarom) — alles in dezelfde commit.

## Kernprincipes (niet-onderhandelbaar)

1. **Test-gedreven.** Elke feature krijgt tests die je meteen draait. Geen groene test = niet af.
2. **Security by default.** Elke wijziging tegen bekende kwetsbaarheden controleren en direct fixen. `npm audit` moet 0 tonen.
3. **Altijd nieuwste stabiele libraryversies** (`npm install <pkg>@latest`; check met `npm view <pkg> version`).
4. **Verticale plakjes.** Eén complete feature tegelijk, niet horizontale lagen.
5. **Na elke stap echt draaien en verifiëren** vóór je doorgaat.
6. **TypeScript strict.** Geen `any`/`@ts-ignore` zonder expliciete reden.
7. **Valideer op elke grens.** Alle externe input (body, query, params, WS, env) via zod.
8. **Documentatie leeft mee.** Elke taak werkt de docs bij (in dezelfde commit). Code zonder bijgewerkte docs is niet af.
9. **DB-wijzigingen altijd via migraties**, nooit ad-hoc.
10. **Rapporteer eerlijk:** als iets faalt, zeg dat met de output. Geen "zou moeten werken".

## Domeinregels (uit DESIGN.md, altijd van kracht)

- De gebruiker is de bron van communicatie; de AI stelt alleen voor. Een begeleider kan nooit een boodschap namens de gebruiker bevestigen.
- De AI is begrensd door de AAC-bibliotheek: geen vrije concepten tijdens communicatie; nieuwe concepten alleen als voorstel ter beoordeling door een beheerder.
- De client praat **nooit rechtstreeks** met de AI; alles loopt via de backend (AI-Orchestrator + validatielaag).
- Privacy by design: minimale opslag, expliciete toestemming, persoonlijke gegevens versleuteld. Nooit opslaan: AI-aannames, afgewezen boodschappen, onzekere voorspellingen.
- Leren mag alleen van **bevestigde** communicatie en is uitschakelbaar per gebruiker.
- Elke query gefilterd op organisatie/gebruiker (multi-tenant-isolatie) én daarop getest.

## Stack

Node.js ≥ 22 · TypeScript strict · Fastify 5 (`buildApp()`-factory) · zod · Prisma (SQLite dev, PostgreSQL prod) · argon2id + gehashte sessietokens · React + Vite (tablet-first) · externe LLM-API achter provider-agnostische AI-Orchestrator. Structuurkeuzes vastleggen als ADR in `docs/adr/`.

## Documentatie (aanmaken én bijhouden)

In dezelfde commit als de code: **`README.md`** (opzet/draaien/testen), **`docs/`** (architecture, api, data-model, security), **`docs/adr/`** (context → beslissing → gevolgen), **`CHANGELOG.md`** (per fase) en **`.env.example`** (elke variabele gedocumenteerd). Beschrijf *wat + waarom*, geen kopie van de code. Verouderde docs corrigeren of verwijderen.

## Security-checklist (OWASP)

Injectie (geparametriseerde queries) · XSS (URL's `http(s)`-only valideren) · auth (argon2id, sessietokens gehasht at-rest, httpOnly+Secure, account-lockout) · access control (elke query op eigenaar/tenant filteren én testen) · rate limiting (streng op login) · security headers (helmet) · secrets via env, gevoelige velden versleuteld · uploads (groottelimiet, ondertekende vervallende URL's) · HTTPS/WSS · audit-logging. Draai `/security-review` bij grotere fases en fix bevindingen meteen.

## Definition of Done (per taak)

- [ ] Werkt (app echt gedraaid / happy path gerookt)
- [ ] `npm run typecheck` groen
- [ ] `npm run lint` groen
- [ ] `npm test` — alle tests groen (incl. nieuwe)
- [ ] `npm audit` — 0 kwetsbaarheden
- [ ] Input gevalideerd (zod) + autorisatie/isolatie getest
- [ ] Geen secrets in code; `.env.example` bijgewerkt
- [ ] DB-wijziging via migratie (draait schoon op lege db)
- [ ] Documentatie bijgewerkt (README, `docs/`, CHANGELOG, `.env.example`)
- [ ] Taak afgevinkt in `TASKS.md`
- [ ] Duidelijke commit (wat + waarom)
