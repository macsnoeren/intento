# CLAUDE.md — Intento

## Project

Intento is een AI-ondersteunde AAC-communicatieapplicatie voor mensen die moeite hebben met spreken. De gebruiker communiceert met pictogrammen; een **agentic AI-architectuur** — gespecialiseerde agents onder regie van één orchestrator — helpt hem stap voor stap duidelijk te maken wat hij bedoelt. De gebruiker blijft altijd eigenaar van de boodschap. Intento is **geen chatbot**.

De applicatie wordt **herbouwd** zonder backward compatibiliteit: rollen, accounts, organisaties, tablet koppelen, spraak en Docker blijven; alle oude AI-logica, prompts, strategieën en AI-instellingen verdwijnen.

- **`INTENTO-NEW-DESIGN.md`** — het ontwerp en de enige ontwerpbron. §0 bevat de genomen besluiten, §52 de harde invarianten, §55 wat verdwijnt en wat blijft.
- **`TASKS-NEW_DESIGN.md`** — de gefaseerde takenlijst (taken `N<fase>.<nr>`). Er wordt **één taak per (schone) sessie** uitgevoerd.
- **`PROJECT-NODEJS/`** — het oorspronkelijke projectsjabloon (naslag; de werkregels hieronder komen daaruit).

## Werkwijze per sessie

1. Open `TASKS-NEW_DESIGN.md`, pak de **eerstvolgende niet-afgevinkte taak** (of de taak die de gebruiker noemt). Lees de genoemde secties van `INTENTO-NEW-DESIGN.md`.
2. Maak een kort plan voor die ene taak en bouw een **verticaal plakje**: data → server → UI → test. Blijf binnen de taakscope; noteer ontdekt meerwerk als nieuwe taak in `TASKS-NEW_DESIGN.md` in plaats van het nu te bouwen. Blijkt een taak groter dan gedacht, splits hem.
3. Verifieer echt: start de app, rook de happy path, draai alle checks (Definition of Done hieronder).
4. Werk documentatie bij, vink de taak af in `TASKS-NEW_DESIGN.md` en commit (wat + waarom) — alles in dezelfde commit.

## Kernprincipes (niet-onderhandelbaar)

1. **Test-gedreven.** Elke feature krijgt tests die je meteen draait. Geen groene test = niet af.
2. **Security by default.** Elke wijziging tegen bekende kwetsbaarheden controleren en direct fixen. `npm audit` en `pip-audit` moeten 0 tonen.
3. **Altijd nieuwste stabiele libraryversies** (`npm install <pkg>@latest`; check met `npm view <pkg> version`; Python: `pip index versions <pkg>`).
4. **Verticale plakjes.** Eén complete feature tegelijk, niet horizontale lagen.
5. **Na elke stap echt draaien en verifiëren** vóór je doorgaat.
6. **Strikt getypeerd.** TypeScript strict, Python met mypy strict. Geen `any`/`@ts-ignore`/`# type: ignore` zonder expliciete reden.
7. **Valideer op elke grens.** Alle externe input (body, query, params, env, agentantwoorden, LLM-uitvoer) via zod (TypeScript) of pydantic (Python).
8. **Harde garanties in code, niet in een prompt.** Wat nooit mag (versturen zonder JA, een symbool buiten de Vocabulary, …) wordt in de backend afgedwongen en getest (INTENTO-NEW-DESIGN §52). Een prompt mag helpen, maar is nooit de waarborg.
9. **Documentatie leeft mee.** Elke taak werkt de docs bij (in dezelfde commit). Code zonder bijgewerkte docs is niet af.
10. **DB-wijzigingen altijd via migraties**, nooit ad-hoc.
11. **Rapporteer eerlijk:** als iets faalt, zeg dat met de output. Geen "zou moeten werken".

## Domeinregels (uit INTENTO-NEW-DESIGN.md, altijd van kracht)

**De gebruiker beslist**
- De gebruiker is de bron van communicatie; de AI interpreteert, vraagt en stelt voor.
- Een boodschap is pas de boodschap van de gebruiker na zijn **JA op "Bedoel je: …?"**. Daarvóór is het een inference.
- Er wordt **nooit verstuurd** zonder een JA van de gebruiker op dát contact. De AI kiest nooit zelf een ontvanger.
- Niemand anders (begeleider, beheerder) kan een boodschap of verzending namens de gebruiker bevestigen.
- ↩ Terug en ⏹ Stoppen zijn op elk scherm van een lopend gesprek beschikbaar.

**Vocabulary**
- Tijdens een gesprek worden **alleen symbolen uit de eigen Vocabulary** gebruikt. Er wordt live nooit een pictogram gemaakt of verzonnen.
- Ontbreekt een woord, dan toont Intento het woord met het pictogram dat er het dichtst bij komt, en krijgt de beheerder een melding (gap). De betekenis van een symbool verandert nooit stilzwijgend.
- Alleen een beheerder voegt symbolen toe (import of eigen afbeelding + woord). De agentdienst kan de Vocabulary niet wijzigen.
- Elk symbool heeft licentie en herkomst; alleen licenties uit de toegestane lijst; bronvermelding is zichtbaar.

**Architectuur**
- De client praat **nooit rechtstreeks** met de AI: tablet → backend → agentdienst → Ollama.
- De **backend is de enige eigenaar van alle data**. De agentdienst is stateless tussen beurten en wordt alleen door de backend aangeroepen (met API-key).
- Elk antwoord van de agentdienst wordt in de backend opnieuw gevalideerd (zod + invarianten) voordat het wordt opgeslagen of getoond.
- De orchestrator bepaalt welke agent aan de beurt is; agents roepen elkaar niet aan. Elke LLM-agent heeft een regelgebaseerde terugval: nooit een leeg scherm.

**Observed / Presented / Inferred**
- Wat de gebruiker deed (Observed), wat er getoond werd (Presented) en wat de AI concludeert (Inferred) worden **apart** opgeslagen en nooit samengevoegd.
- Observed en Presented legt de **backend** vast; Inferred komt van de agents.

**Privacy en Experience**
- Provenance (Observed/Presented/Inferred, AI-beslissingen) wordt bewaard — versleuteld en alleen binnen de **bewaartermijn** van de organisatie (instelbaar, standaard 90 dagen).
- Persoonlijke gegevens (Session State, gespreksinhoud, bevestigde berichten, contactnamen en -e-mailadressen) staan versleuteld at-rest.
- Namen en e-mailadressen van contacten gaan **nooit** naar een LLM.
- Experience is per gebruiker (standaard aan), uit te zetten en te wissen. Experience is bewijs, geen waarheid: ranking ordent, maar verbergt nooit een optie.
- Elke query gefilterd op organisatie/gebruiker (multi-tenant-isolatie) én daarop getest.

## Stack

- **Backend:** Node.js ≥ 22 · TypeScript strict · Fastify 5 (`buildApp()`-factory) · zod · Prisma (SQLite dev, PostgreSQL prod) · argon2id + gehashte sessietokens.
- **Web:** React + Vite (tablet-first; tablet, beheeromgeving en operatorconsole in één app).
- **Agentdienst** (`agent-service/`, vervangt `ai-worker/`): Python ≥ 3.11 · stdlib-HTTP-server · pydantic · mypy strict · ruff · unittest · pip-audit. Bevat de orchestrator en de agents.
- **LLM:** Ollama, lokaal of cloud (met API-key), achter een provider-interface; `FakeProvider` in tests.
- **Spraakdienst** (`speech-service/`): Python + Piper, ongewijzigd.
- **Contracten** backend ↔ agentdienst: pydantic én zod, beide getest tegen `contracts/fixtures/`.
- **Deploy:** Docker compose.

Structuurkeuzes vastleggen als ADR in `docs/adr/`.

## Documentatie (aanmaken én bijhouden)

In dezelfde commit als de code: **`README.md`** (opzet/draaien/testen), **`docs/`** (architecture, api, data-model, security), **`docs/adr/`** (context → beslissing → gevolgen), **`CHANGELOG.md`** (per fase), **`.env.example`**, **`.env.docker.example`** en de `.env.example` van elke Python-dienst (elke variabele gedocumenteerd). Beschrijf *wat + waarom*, geen kopie van de code. Verouderde docs corrigeren of verwijderen. Een afwijking van `INTENTO-NEW-DESIGN.md` werk je in het ontwerp zelf bij, in dezelfde commit.

## Security-checklist (OWASP)

Injectie (geparametriseerde queries) · XSS (URL's `http(s)`-only valideren) · auth (argon2id, sessietokens gehasht at-rest, httpOnly+Secure, account-lockout) · access control (elke query op eigenaar/tenant filteren én testen) · rate limiting (streng op login) · security headers (helmet) · secrets via env, gevoelige velden versleuteld · uploads (alleen PNG/JPEG/WebP, groottelimiet, controle op de werkelijke inhoud, ondertekende vervallende URL's) · SVG alleen gecontroleerd en met een CSP zonder scripts · externe downloads alleen https van een bekende host, met limiet en time-out · service-to-service met een gedeeld geheim · HTTPS/WSS · audit-logging. Draai `/security-review` bij grotere fases en fix bevindingen meteen.

## Definition of Done (per taak)

- [ ] Werkt (app echt gedraaid / happy path gerookt)
- [ ] `npm run typecheck` groen
- [ ] `npm run lint` groen
- [ ] `npm run format:check` groen (de pre-commit hook bewaakt dit ook)
- [ ] `npm test` — alle tests groen (incl. nieuwe)
- [ ] Python geraakt? `npm run check:python` groen (ruff + mypy + unittest; vanaf N1.2 — daarvóór ruff en unittest per dienst)
- [ ] `npm audit` — 0 kwetsbaarheden; Python geraakt? `npm run audit:python` — 0 (vanaf N1.2)
- [ ] Input gevalideerd (zod/pydantic) + autorisatie/isolatie getest
- [ ] Raakt de taak een invariant uit INTENTO-NEW-DESIGN §52? Dan is die invariant getest
- [ ] Geen secrets in code; `.env.example`-bestanden bijgewerkt
- [ ] DB-wijziging via migratie (draait schoon op lege db)
- [ ] Documentatie bijgewerkt (README, `docs/`, CHANGELOG, `.env.example`, zo nodig `INTENTO-NEW-DESIGN.md`)
- [ ] Taak afgevinkt in `TASKS-NEW_DESIGN.md`
- [ ] Duidelijke commit (wat + waarom)
