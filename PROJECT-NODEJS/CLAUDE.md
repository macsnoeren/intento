# CLAUDE.md

> Hernoem dit bestand naar `CLAUDE.md` in de root van je nieuwe project.
> Claude Code laadt het automatisch aan het begin van elke sessie.
> Volledige toelichting staat in `NODEJS-PROJECT-ARCHITECTURE.md`.

## Kernprincipes (niet-onderhandelbaar)

1. **Test-gedreven.** Elke feature krijgt tests die je meteen draait. Geen groene test = niet af.
2. **Security by default.** Elke wijziging tegen bekende kwetsbaarheden controleren en direct fixen. `npm audit` moet 0 tonen.
3. **Altijd nieuwste stabiele libraryversies** (`npm install <pkg>@latest`; check met `npm view <pkg> version`).
4. **Verticale plakjes.** Eén complete feature tegelijk (data → server → UI → test), niet horizontale lagen.
5. **Na elke stap echt draaien en verifiëren** vóór je doorgaat.
6. **TypeScript strict.** Geen `any`/`@ts-ignore` zonder expliciete reden.
7. **Valideer op elke grens.** Alle externe input (body, query, params, WS, env) via zod.
8. **Documentatie leeft mee.** Elke fase werkt de docs bij (in dezelfde commit). Code zonder bijgewerkte docs is niet af.

## Werkwijze

- Maak eerst een **gefaseerd plan** en leg het voor vóór je bouwt (fase 0 = fundament, dan één feature per fase).
- Bouw één fase tegelijk, verifieer echt (start de app, rook de happy path), commit pas als alles groen is.
- DB-wijzigingen altijd via **migraties**, nooit ad-hoc.
- Rapporteer eerlijk: als iets faalt, zeg dat met de output. Geen "zou moeten werken".

## Documentatie (aanmaken én bijhouden)

Houd deze bij in dezelfde commit als de code: **`README.md`** (opzet/draaien/testen), **`docs/`** (architecture, api, data-model, security), **`docs/adr/`** (korte beslissingsrecords: context → beslissing → gevolgen), **`CHANGELOG.md`** (per fase) en **`.env.example`** (elke variabele gedocumenteerd). Beschrijf *wat + waarom*, niet een kopie van de code. Verouderde docs corrigeren of verwijderen.

## Security-checklist (OWASP)

Injectie (geparametriseerde queries) · XSS (URL's `http(s)`-only valideren) · auth (argon2id, sessie-tokens gehasht at-rest, httpOnly+Secure, account-lockout) · access control (elke query op eigenaar/tenant filteren én testen) · rate limiting (streng op login) · security headers (helmet) · secrets via env, gevoelige velden versleuteld · uploads (groottelimiet, ondertekende vervallende URL's) · HTTPS/WSS · audit-logging. Draai `/security-review` bij grotere fases en fix bevindingen meteen.

## Definition of Done (per fase)

- [ ] Werkt (app echt gedraaid / happy path gerookt)
- [ ] `npm run typecheck` groen
- [ ] `npm run lint` groen
- [ ] `npm test` — alle tests groen (incl. nieuwe)
- [ ] `npm audit` — 0 kwetsbaarheden
- [ ] Input gevalideerd (zod) + autorisatie/isolatie getest
- [ ] Geen secrets in code; `.env.example` bijgewerkt
- [ ] DB-wijziging via migratie (draait schoon op lege db)
- [ ] Documentatie bijgewerkt (README, `docs/`, CHANGELOG, `.env.example`)
- [ ] Duidelijke commit (wat + waarom)
