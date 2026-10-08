# TASKS-NEW_DESIGN.md — Intento herbouw: agentic AI

Gefaseerde takenlijst voor de herbouw volgens `INTENTO-NEW-DESIGN.md` (hierna: **ONTWERP**). Elke taak is
bewust **klein**: één gedrag, met tests, in één schone sessie af te ronden. Een taak die tijdens het bouwen
groter blijkt, wordt gesplitst in plaats van half afgemaakt.

## Werkwijze

1. Start een **schone chatsessie** per taak (`/clear` of nieuwe sessie).
2. Prompt: `Voer taak N<nr> uit TASKS-NEW_DESIGN.md uit.` — CLAUDE.md en de genoemde ONTWERP-secties geven de context.
3. Taken worden **in volgorde** uitgevoerd; een taak is pas klaar als de Definition of Done uit `CLAUDE.md`
   volledig groen is. Voor Python-code geldt daarnaast (vanaf N1.2): `npm run check:python` en
   `npm run audit:python` groen.
4. Na afronding: taak afvinken (`[x]`), CHANGELOG bijwerken, committen (wat + waarom).
5. Ontdekt meerwerk? **Niet bouwen** — voeg het hier toe als nieuwe taak op de juiste plek.
6. Geen backward compatibiliteit: wat verdwijnt, mag gewoon weg (ONTWERP §55). Er komt geen
   overgangscode en geen datamigratie van oude gesprekken.

---

## Fase N0 — Opruimen en het nieuwe ontwerp als bron

- [x] **N0.1 Documentatie wijst naar het nieuwe ontwerp**
  *ONTWERP: §0, §55.* Alleen documentatie, geen code. `DESIGN.md`, `INTENTO-DESIGN/`, `TASKS.md`,
  `TEST.md` en `TEST-FEEDBACK.md` zijn al verwijderd en `CLAUDE.md` is al herschreven (2026-10-05).
  Wat overblijft: `README.md` en `docs/` (architecture, api, data-model, security) verwijzen naar
  `INTENTO-NEW-DESIGN.md` in plaats van `DESIGN.md`/`TASKS.md`, en vermelden kort dat de gespreks- en
  AI-laag herbouwd wordt. ADR-0017 "Agentic architectuur" (agentdienst, eigen orchestrator, stateless,
  backend als data-eigenaar, geen wachtrij); ADR 0008/0009/0010/0012/0013/0014 krijgen status
  "vervangen door 0017". CHANGELOG: nieuwe kop "Herbouw (agentic)".
  *Acceptatie:* `rg "DESIGN\.md|TASKS\.md|TEST-FEEDBACK" README.md docs/` vindt niets meer; `npm run
  format:check` groen.

- [x] **N0.2 Tablet: de oude gespreksflow eruit**
  *ONTWERP: §48, §55.* `TabletApp.tsx` houdt alleen het koppelen; na het koppelen een rustig scherm "Nog
  niet beschikbaar". Weg: keuzescherm, voorstelscherm, correctie, contextindicator, gok-tegel,
  `speech-hints.ts`. `speech.ts` blijft (wordt in N4.12 hergebruikt).
  *Acceptatie:* tablettests aangepast en groen; koppelen werkt nog (rooktest).

- [x] **N0.3 Beheer-UI: de oude AI-schermen eruit**
  *ONTWERP: §49, §55.* Weg: Vraagmodus, Gesprekken, AI-activiteit, Conceptvoorstellen, Voorkeuren,
  Persoonlijke context, Worker-tokens, AAC-bibliotheek, berichtenlijst + afhandelen, AI-statusbadge — en
  hun menu-items. In het instellingenformulier blijven alleen `showText`, voorlezen en stem staan.
  *Acceptatie:* web-tests aangepast en groen; het menu toont per rol alleen bestaande pagina's (test).

- [x] **N0.4 Server: de oude gespreks- en AI-code eruit**
  *ONTWERP: §55.* Weg: `server/src/conversation/`, `server/src/ai/`, de routes `conversation*`,
  `question`, `messages`, `concept-proposals`, `preferences`, `personal-context`, `ai-worker`,
  `worker-tokens`, `ai-status`, `conversation-history`, `aac`, plus `mail/caregiver-notification.ts`. De
  OpenSymbols-client verhuist naar `server/src/vocabulary/opensymbols.ts` (met zijn tests). Dashboard-
  tellingen ontdoen van verdwenen data. Verdwenen env-variabelen (`AI_*`, worker) uit `env.ts` en
  `.env.example`. De database blijft in deze taak nog ongemoeid.
  *Acceptatie:* alle checks groen; `rg "conversation|AiJob|WorkerToken" server/src` levert alleen nog
  het Prisma-schema op.

- [x] **N0.5 Database: oude tabellen en velden eruit**
  *ONTWERP: §39, §55.* Eén migratie die de tabellen uit §55 verwijdert, plus de profielvelden
  `iconsPerScreen`, `aiLearningEnabled`, `supportMode`, `contextIndicator`, `conversationStrategy` en
  `speechHints`. Seed en profielexport/-import inkorten tot wat overblijft (instellingen).
  `docs/data-model.md` bijwerken.
  *Acceptatie:* de migratielijn draait schoon op een lege database; de seed draait twee keer zonder fout.

- [x] **N0.6 De ai-worker eruit**
  *ONTWERP: §3.1, §55.* `ai-worker/` verwijderen; de compose-service `ai-worker` en het profiel `ai`
  verwijderen (ook uit `docker:down`/`docker:logs` in `package.json`); `.env.docker.example`, README,
  `docs/architecture.md` bijwerken. De twee open punten uit de oude takenlijst (wisselvallige
  wachtrijtests; JSON in code-fences) vervallen hiermee; de les over code-fences komt terug in N5.2.
  *Acceptatie:* `docker compose config` geldig; `npm run docker:up` start server, web en spraak.

- [x] **N0.7 Verwijzingen in de blijvende code**
  *ONTWERP: §55.* In de code die blijft (auth, users, devices, speech, crypto, mail, audit, web-schil)
  verwijzen comments naar `DESIGN §…` en oude `T`-nummers, uit een document dat niet meer bestaat.
  Vervangen door de juiste `INTENTO-NEW-DESIGN §…` of een ADR, of weghalen als de comment zonder
  verwijzing al duidelijk is. Geen gedragswijziging.
  *Acceptatie:* `rg "DESIGN §|DESIGN\.md" server/src web/src shared/src` vindt alleen nog
  `INTENTO-NEW-DESIGN`; alle checks groen.

## Fase N1 — De agentdienst (Python) staat

- [x] **N1.1 Skelet van de agentdienst**
  *ONTWERP: §3.1, §51.* Nieuwe map `agent-service/` met package `agent_service`, in dezelfde stijl als de
  spraakdienst: stdlib-HTTP-server, `config.py` met gevalideerde env (`HOST`, `PORT`, `SERVICE_TOKEN`),
  `GET /health` zonder token, een helper die de API-key controleert (constante-tijd-vergelijking), README
  en `.env.example`. Nog geen LLM, nog geen `/v1/turn`.
  *Acceptatie:* unittests voor config (ontbrekend token → duidelijke fout) en `/health`; handmatig gestart
  en met curl bevraagd.

- [x] **N1.2 Python-kwaliteit in de Definition of Done**
  *ONTWERP: §54.* pydantic (laatste stabiele versie) als dependency van de agentdienst; mypy strict voor
  `agent_service`; root-scripts `check:python` (ruff + mypy + unittest voor agent-service en
  speech-service) en `audit:python` (pip-audit). Vermelden in CLAUDE.md (DoD) en README.
  *Acceptatie:* beide scripts draaien groen; een opzettelijke typefout laat `check:python` falen
  (handmatig gecontroleerd en teruggedraaid).

- [x] **N1.3 Contracten v1 in pydantic**
  *ONTWERP: §5, §34, §51.* Modellen: `SessionState`, `Event` (start, answer_yes, answer_no,
  select_option, none_of_these), `Settings`, `VocabularyEntry`, `ContactEntry`, `TurnRequest`,
  `Presentation` + `Option` (met `representation: exact|stand_in`), `Inference`, `AgentDecision`, `Gap`,
  `TurnResponse`; allemaal met `contract_version: 1`. Voorbeeldbestanden in `contracts/fixtures/`
  (`valid/*.json` en `invalid/*.json`).
  *Acceptatie:* unittests: elk geldig voorbeeld wordt geaccepteerd, elk ongeldig voorbeeld geweigerd.

- [x] **N1.4 Dezelfde contracten in zod**
  *ONTWERP: §34.* `shared/src/agent-contract.ts` met dezelfde vormen in zod. Een vitest-test laadt
  dezelfde `contracts/fixtures/` en eist hetzelfde oordeel als pydantic.
  *Acceptatie:* de contracttest is groen; een veld dat alleen aan één kant bestaat, laat een test falen
  (handmatig gecontroleerd).

- [x] **N1.5 Orchestrator-skelet met regelgebaseerde agents**
  *ONTWERP: §4.1, §4.2, §6, §7 (terugval).* `orchestrator.py` als zuivere functie
  `step(request) -> TurnResponse` met de fasen uit §4.1 (`clarify`, `confirm_message`, `done`,
  `stopped`; de deelfasen komen in N11). Regelgebaseerde agents: Intent = startconcepten in volgorde;
  Question = "{label}?"; Icon = het item van dat concept. JA → "Bedoel je: {Label}?"; JA daarop → `done`.
  *Acceptatie:* unittests per overgang (start, NEE → volgend startconcept, JA → voorstel, JA → klaar,
  NEE op voorstel → terug naar `clarify`).

- [x] **N1.6 `POST /v1/turn`**
  *ONTWERP: §51.* Het endpoint achter de API-key: body valideren met pydantic, `step()` aanroepen,
  `TurnResponse` teruggeven. Fouten in de vorm `{ "error": { "code", "message" } }`. Logt nooit inhoud,
  alleen fase, duur en status.
  *Acceptatie:* tests: zonder key 401, ongeldige body 400, geldige start → geldige `TurnResponse`.

- [x] **N1.7 De agentdienst in Docker**
  *ONTWERP: §3.1.* Dockerfile + compose-service `agents` (geen `ports:`, `SERVICE_TOKEN` verplicht,
  healthcheck op `/health`). Backend-env `AGENT_SERVICE_URL` en `AGENT_SERVICE_TOKEN` in `env.ts`,
  `.env.example` en `.env.docker.example`.
  *Acceptatie:* `npm run docker:up` → `agents` wordt healthy; vanuit de servercontainer geeft `/health` 200.

## Fase N2 — Vocabulary: de basis en de startset (Mulberry)

- [x] **N2.1 Model `VocabularyItem`**
  *ONTWERP: §15, §39.* Migratie: id, `organizationId` (null = platform), labels, concepten, contexten
  (JSON), `partOfSpeech`, `isStart`, `sortOrder`, `status` (approved/retired), `labelStatus`
  (reviewed/machine), `source` (seed/external/own), licentievelden (`licenseKey`, `licenseUrl`,
  `author`, `authorUrl`, `sourceName`, `sourceUrl`, `sourceRef`, `importedAt`), assetvelden
  (`assetPath`, `mimeType`, `sha256`, `bytes`), `createdById`, tijden. Uniek op (`sourceName`,
  `sourceRef`) zodat een import nooit dubbelt. Repository `listAvailableVocabulary(orgId)` = platform +
  eigen organisatie, alleen approved.
  *Acceptatie:* migratie schoon op een lege db; isolatietest (org A ziet nooit items van org B).

- [x] **N2.2 Afbeeldingen opslaan en veilig serveren**
  *ONTWERP: §20, §51, §53.* Bestandsopslag in `STORAGE_DIR` (volume in compose). `GET /assets/:id` alleen
  met een ondertekende, vervallende URL (HMAC met `ASSET_URL_SECRET`, `exp`); headers: juist
  content-type, `nosniff`, voor SVG een CSP zonder scripts en externe resources, CORP zodat de web-app
  hem mag laden (zelfde les als bij de oude pictogrammen: helmets `same-origin` blokkeerde ze).
  Helper `signedAssetUrl(item)`.
  *Acceptatie:* tests: geldige URL 200; verlopen, gemanipuleerde of ingetrokken → 403/404.

- [x] **N2.3 Afbeeldingscontrole**
  *ONTWERP: §20.* Eén module `vocabulary/image-check.ts` voor alle afbeeldingen die binnenkomen: SVG
  (geldige XML met `<svg>`-root en viewBox; geen `<script>`, `<foreignObject>`, `on…`-attributen of
  externe `href`/`src`; maximale grootte) en PNG/JPEG/WebP (magic bytes, maximale grootte). Geeft een
  reden terug als hij weigert.
  *Acceptatie:* unittests met goede en kwade voorbeelden per regel, plus een echte Mulberry-SVG als
  fixture die geaccepteerd wordt.

- [x] **N2.4 Manifest van de Global Symbols-sets**
  *ONTWERP: §15.1 (stap 1).* Script `npm run vocabulary:manifest -- <slug>`: haalt via
  `https://globalsymbols.com/api/v1/pictos?symbolset=<slug>&page=…&per_page=…` alle pictos op (zod op
  elke pagina, beleefd tempo, time-out) en schrijft `vocabulary/sources/<slug>.manifest.json`: id,
  woordsoort, afbeeldings-URL, formaat, en de labels in `eng`, `deu` en `fra`. Plus de licentie en
  uitgever uit `/api/v1/symbolsets`. Draaien voor `mulberry` en `corona-symbols`; beide manifesten
  worden gecommit.
  *Acceptatie:* unittests tegen een nep-HTTP-server (paginering, ongeldige pagina → fout); de manifesten
  tellen 3.439 en 42 items.

- [x] **N2.5 Kernvertaling met de hand**
  *ONTWERP: §15.1 (stap 3), §6 (start).* `vocabulary/translations/<slug>.nl.json`, per Global Symbols-id:
  Nederlands label, synoniemen, concept (taalneutrale sleutel uit het Engelse label), context (vaste
  lijst), `isStart`, `status: reviewed`. ±80 woorden: ±8 startconcepten (pijn, eten, drinken, toilet,
  moe, blij, verdrietig, hulp), behoeften, gevoelens, lichaamsdelen en alle 42 zorgsymbolen van de Plus
  Collection. Het vertaalbestand heeft een zod-schema.
  *Acceptatie:* een test valideert het bestand en eist dat elk id in het manifest bestaat en dat elk
  concept uniek is.

- [x] **N2.6 Afbeeldingen downloaden**
  *ONTWERP: §15.1 (stap 2), §53.* Script `npm run vocabulary:images -- <slug>`: downloadt de afbeeldingen
  uit het manifest naar `STORAGE_DIR` (alleen https van `globalsymbols.com`, groottelimiet, time-out),
  laat elke afbeelding door N2.3 gaan, slaat sha256 op en slaat bestaande bestanden over. Een overzicht
  van geweigerde afbeeldingen aan het eind.
  *Acceptatie:* unittests met een nep-server (andere host → geweigerd, te groot → geweigerd, tweede run
  downloadt niets); handmatige run voor beide sets.

- [x] **N2.7 Seed van de startset**
  *ONTWERP: §15, §15.1.* De seed maakt platformitems van manifest + vertaling + afbeelding: alleen
  symbolen met een Nederlandse vertaling en een geaccepteerde afbeelding; licentie, uitgever en bron per
  item; `labelStatus` uit de vertaling. Plus één eigen item "geen afbeelding" (eenvoudige eigen SVG,
  licentie `own`). Idempotent.
  *Acceptatie:* de seed draait twee keer zonder dubbelingen; een symbool zonder vertaling komt er niet in
  (test); elk item heeft licentie en bron (test).

- [x] **N2.8 De startset in Docker**
  *ONTWERP: §15.1.* Een eenmalige compose-klus `vocabulary-import` (zoals `speech-voices`): downloadt de
  afbeeldingen in het opslagvolume en draait de seed; de server wacht tot hij klaar is. README:
  opnieuw importeren na een nieuwe vertaling.
  *Acceptatie:* een verse `npm run docker:up` levert een Vocabulary met afbeeldingen op; een tweede `up`
  downloadt niets opnieuw.

- [x] **N2.9 `GET /vocabulary`**
  *ONTWERP: §49, §51.* Lijst voor de beheeromgeving (beheerder en begeleider, alleen lezen), met
  ondertekende afbeeldings-URL's, gepagineerd en doorzoekbaar (ruim 3.400 items); zod op de response.
  *Acceptatie:* tests: rollen (tablet mag niet), isolatie, paginering, zoeken, ingetrokken items alleen
  met filter `retired`.

- [x] **N2.10 Beheer: Vocabulary-overzicht**
  *ONTWERP: §49.* Pagina met tegels (pictogram, label, licentiebadge, bron), een zoekveld en paginering.
  Menu-item "Vocabulary".
  *Acceptatie:* componenttest (lege lijst, lijst, zoeken, volgende pagina); rooktest in de browser.

- [x] **N2.11 Een item bewerken**
  *ONTWERP: §15, §16.* `PATCH /vocabulary/:id`: labels, concepten, contexten, `isStart`, `sortOrder`;
  een gewijzigd label wordt `reviewed`. Alleen de beheerder, alleen items van de eigen organisatie
  (platformitems alleen de platformbeheerder). Audit-log.
  *Acceptatie:* tests: validatie, rol, isolatie, platformitem door een org-beheerder → 403.

- [x] **N2.12 Beheer: item-detailscherm**
  *ONTWERP: §49.* Detailscherm (het bestaande overzicht → detail-patroon uit `docs/architecture.md`) met het formulier
  van N2.11.
  *Acceptatie:* componenttest; rooktest.

- [x] **N2.13 Een item intrekken**
  *ONTWERP: §15.* `POST /vocabulary/:id/retire` (en terugzetten): status `retired`; het item wordt nooit
  verwijderd zolang de provenance ernaar verwijst, en gaat niet meer naar de agentdienst. Knop in het
  detailscherm. Audit-log.
  *Acceptatie:* tests: ingetrokken item valt uit `listAvailableVocabulary`; rol en isolatie.

- [x] **N2.14 Bronvermelding**
  *ONTWERP: §15.* `GET /vocabulary/attributions` (publiek binnen de organisatie, ook voor de tablet) +
  pagina "Bronnen" in de beheeromgeving + link "Bronnen" op het startscherm van de tablet.
  *Acceptatie:* test: elk item met een CC BY-licentie staat in de lijst met auteur en bron.

- [x] **N2.15 Zoeken in de Vocabulary op woorden, niet op letters midden in een concept**
  *ONTWERP: §15, §49.* Gevonden bij N10.3: `searchText` wordt met `contains` doorzocht, dus "oma" vindt
  *buik* (concept `stomach`) en geen oma. In de Nederlandse labels mag een woord binnen een samenstelling
  blijven matchen ("pijn" → *hoofdpijn*); in concepten alleen op woordgrenzen (`chest_pain` → "pain",
  niet "oma" in `stomach`). Exacte treffers eerst; op SQLite en PostgreSQL hetzelfde.
  *Acceptatie:* tests: "oma" vindt geen `stomach`; "pijn" vindt *hoofdpijn*; "pain" vindt `chest_pain`.

## Fase N3 — Instellingen

- [x] **N3.1 Nieuwe communicatie-instellingen**
  *ONTWERP: §50.* Migratie: `interactionMode` (binary/multi/ai, standaard binary), `optionsPerScreen`
  (2–8, standaard 4), `questionStrategy` (standaard `general_to_specific`), `experienceEnabled`
  (standaard aan; bij het aanmaken van een gebruiker zichtbaar met uitleg), `maxQuestions` (5–30,
  standaard 15). `showText`, `speechEnabled` en `speechVoice` blijven. API + zod; de sleutels van de
  vraagstrategieën staan in `shared/`.
  *Acceptatie:* tests: grenzen, onbekende strategie → 400, begeleider alleen voor gekoppelde gebruikers.

- [x] **N3.2 Beheer: instellingenformulier**
  *ONTWERP: §7.1, §50.* De nieuwe velden, met per keuze een uitleg in begrijpelijke taal; "opties per
  scherm" alleen zichtbaar bij multi-icon.
  *Acceptatie:* componenttest; rooktest.

- [x] **N3.3 Bewaartermijn per organisatie**
  *ONTWERP: §50, §53.* Migratie `Organization.retentionDays` (7–365, standaard uit
  `RETENTION_DEFAULT_DAYS` = 90); `GET/PUT /organization/settings` (beheerder); veld in de beheeromgeving.
  Het opruimen zelf komt in N14.2. Audit-log.
  *Acceptatie:* tests: grenzen, rol, isolatie.

- [x] **N3.4 Begeleider: gekoppelde gebruikers en hun instellingen**
  *ONTWERP: §49, V7.* Ontdekt bij N0.3: met de vraagmodus verdween het enige scherm waarop een
  begeleider zijn gekoppelde gebruikers zag. Een menu-item "Mijn gebruikers" voor de CAREGIVER met de
  gekoppelde gebruikers (lezen via een nieuw `GET /caregiver/users`, tenant- en koppelingsgebonden) en
  per gebruiker het instellingenformulier van N3.2.
  *Acceptatie:* tests: een begeleider ziet alleen gekoppelde gebruikers; componenttest.

## Fase N4 — Eén gesprek van begin tot eind (zonder LLM)

- [x] **N4.1 Sessietabellen**
  *ONTWERP: §5, §39.* Migratie: `CommunicationSession` (userId, organizationId, status
  active/confirmed/stopped, startedAt, endedAt, currentTurn) en `SessionTurn` (sessionId, turn,
  `stateEncrypted`, `presentationEncrypted`, createdAt). Repository met versleuteling (bestaande crypto).
  *Acceptatie:* tests: opslaan/lezen ontsleutelt correct; in de db staat geen leesbare state; isolatie.

- [x] **N4.2 Provenance-tabellen**
  *ONTWERP: §26, §27, §39, §41.* Migratie: `PresentationEvent` (turn, kind, mode, tekst versleuteld,
  opties met volgorde en representatie), `ObservedEvent` (turn, type, optionRef, responseTimeMs),
  `Inference` (turn, agent, kind, payload versleuteld, confidence), `AgentDecision` (turn, agent,
  status, model, promptVersion, latencyMs, validatie, reden). Repository-functies.
  *Acceptatie:* tests: de drie soorten blijven gescheiden opgeslagen; isolatie.

- [x] **N4.3 Client voor de agentdienst**
  *ONTWERP: §3.1, §51.* `AgentServiceClient` in de backend: `POST /v1/turn` met API-key en time-out
  (`AGENT_TIMEOUT_MS`), response gevalideerd met de zod-contracten; fouten → `AgentUnavailableError`
  (503 `AGENT_UNAVAILABLE`). Plus een `FakeAgentClient` voor tests.
  *Acceptatie:* tests tegen een lokale nep-HTTP-server: goed antwoord, time-out, ongeldige vorm, 401.

- [x] **N4.4 Harde invarianten**
  *ONTWERP: §52.* Zuivere functie `checkTurnResponse(request, response)` voor I1, I4, I5, I6 en I7
  (I2 en I3 komen in N4.10 en N11.3). Schending → verwerpen + `AgentDecision` status `invalid`.
  *Acceptatie:* één test per invariant, met een geldig en een ongeldig voorbeeld.

- [x] **N4.5 Gesprek starten**
  *ONTWERP: §51.* `POST /communication/sessions` (apparaatsessie): een lopend gesprek wordt `stopped`;
  nieuwe sessie; `TurnRequest` met event `start`, instellingen en de beschikbare Vocabulary; agent
  aanroepen; invarianten; beurt + Presented + inferences + beslissingen opslaan; presentatie met
  ondertekende URL's terug.
  *Acceptatie:* tests met `FakeAgentClient`; een apparaat van org A kan geen sessie van org B zien.

- [x] **N4.6 Antwoorden**
  *ONTWERP: §26, §51.* `POST /communication/sessions/:id/answer`: `{ turn, answer }` /
  `{ turn, optionRef }` / `{ turn, noneOfThese }` + `responseTimeMs`. Een verouderde `turn` → 409.
  Observed opslaan vóór de agentaanroep.
  *Acceptatie:* tests: dubbele tik geeft 409; Observed staat er ook als de agent faalt.

- [x] **N4.7 Terug en Stoppen**
  *ONTWERP: §48, §51.* `back` zet de vorige momentopname terug, zonder agentaanroep (Observed `back`);
  niet mogelijk op beurt 0. `stop` → status `stopped` (Observed `stop`).
  *Acceptatie:* tests: na Terug is de presentatie exact gelijk aan die van de vorige beurt.

- [x] **N4.8 Hervatten**
  *ONTWERP: §51.* `GET /communication/sessions/current`: de huidige presentatie van het lopende gesprek,
  of `null`.
  *Acceptatie:* tests: na herladen dezelfde presentatie; een gestopt gesprek wordt niet hervat.

- [x] **N4.9 Tablet: start- en binary scherm**
  *ONTWERP: §12, §48.* Startscherm met één grote knop; binary scherm met pictogram, vraag, ✔ JA / ✖ NEE
  (vaste plek en kleur), ↩ Terug, ⏹ Stoppen. Meet de reactietijd en stuurt die mee.
  *Acceptatie:* componenttests (JA, NEE, Terug, Stoppen roepen de juiste API aan); rooktest met de
  regelgebaseerde orchestrator.

- [x] **N4.10 Bevestigde boodschap**
  *ONTWERP: §31, §52 (I2).* Migratie `CommunicationIntent` (sessionId, bericht versleuteld, concepten,
  confidence, confirmedAt). Alleen de backend maakt hem aan, alleen na een Observed JA op een
  `confirm_message`-presentatie met precies die tekst; sessie → `confirmed`.
  *Acceptatie:* tests: zonder JA geen intent; NEE slaat niets op; een agent die zelf "bevestigd" meldt,
  wordt genegeerd.

- [x] **N4.11 Tablet: "Bedoel je …?" en Klaar**
  *ONTWERP: §48.* Het voorstelscherm (pictogram + "Bedoel je: …?" + JA/NEE) en het Klaar-scherm
  (boodschap groot, "Nieuw gesprek").
  *Acceptatie:* componenttests; rooktest van start tot Klaar.

- [x] **N4.12 Tablet: voorlezen**
  *ONTWERP: §48.* Met voorlezen aan spreekt de tablet de vraag en de bevestigde boodschap uit (bestaande
  `speech.ts`), met "🔊 Nog eens" op het Klaar-scherm.
  *Acceptatie:* componenttest: precies de schermtekst gaat naar de spraaklaag.

- [x] **N4.13 Tablet: "Even geen hulp"**
  *ONTWERP: §48, §52.* Bij 503 `AGENT_UNAVAILABLE` het scherm "Het lukt nu even niet" met Opnieuw proberen
  en Stoppen. Rooktest van begin tot eind in Docker.
  *Acceptatie:* componenttest; rooktest met de agentdienst gestopt en weer gestart.

- [x] **N4.14 Oude tablet-CSS opruimen**
  *ONTWERP: §55.* Ontdekt bij N4.9: `styles.css` bevat nog klassen van de oude gespreksflow
  (`.option--guess`, `.option--new`, `.proposal__*`, `.topic-results`, `.tablet__question`,
  `.ai-status*`, …). Verwijderen wat geen component meer gebruikt.
  *Acceptatie:* geen klasse in `styles.css` zonder gebruik in `web/src` (grep-check); tablet en beheer
  zien er in de rooktest hetzelfde uit.

## Fase N5 — De LLM-laag in de agentdienst

- [x] **N5.1 Provider-interface en FakeProvider**
  *ONTWERP: §35.* `LlmProvider.complete_json(system, user, schema, timeout) -> dict`; `FakeProvider` met
  vaste antwoorden per aanroep, die ook alle prompts bewaart (voor tests als "contactnamen komen nooit in
  een prompt").
  *Acceptatie:* unittests.

- [x] **N5.2 OllamaProvider (lokaal en cloud)**
  *ONTWERP: §35.* `/api/chat` met `format` = JSON-schema en `stream: false`; `OLLAMA_URL`,
  `OLLAMA_MODEL`, optioneel `OLLAMA_API_KEY` (Bearer); time-out; code-fences en tekst rond de JSON
  weghalen (les uit de oude TO.2); hooguit één nieuwe poging bij ongeldige JSON.
  *Acceptatie:* unittests tegen een nep-HTTP-server: kaal, gefencet, met inleiding, time-out, 401.

- [x] **N5.3 Agent-envelop**
  *ONTWERP: §34.* Gemeenschappelijke vorm `AgentResult` (status success/fallback/failed, confidence,
  aannames, meta met model, promptversie en duur). De orchestrator zet elk resultaat om in een
  `AgentDecision` in de `TurnResponse`. Prompts staan als versiebestanden in `agent_service/prompts/`.
  *Acceptatie:* unittests: een falende agent levert `fallback` op, nooit een exceptie naar buiten.

- [x] **N5.4 Scenario-opstelling**
  *ONTWERP: §54.* `agent_service/scenarios/`: een gesimuleerde gebruiker (doel = een set concepten; zegt
  JA als het getoonde concept erbij hoort) speelt een heel gesprek via `step()`. Twee scenario's op de
  regelgebaseerde agents. CLI `python -m agent_service.eval --provider ollama` rapporteert
  slagingspercentage, aantal vragen en duur per agent.
  *Acceptatie:* de scenario's draaien in de unittests; de CLI draait tegen de FakeProvider.

## Fase N6 — De agents (Binary Mode)

- [x] **N6.1 Intent Agent v1**
  *ONTWERP: §6.* LLM-agent: input = antwoorden (concept, label, JA/NEE), getoonde opties, huidige
  hypotheses, compacte Vocabulary; output = hypotheses (concept, label, confidence), alternatieven,
  aannames, `needs_clarification`. Prompt `intent-v1`. Terugval = de regels uit N1.5.
  *Acceptatie:* unittests met FakeProvider: geldig, ongeldige JSON → terugval, time-out → terugval.

- [x] **N6.2 Hypotheses in de Session State**
  *ONTWERP: §36, §37.* De orchestrator bewaart de hypotheses per beurt en geeft ze als inference terug.
  Scenario: JA pijn, NEE hoofd, NEE buik → pijn blijft, de plek is nog open.
  *Acceptatie:* unittest + scenario.

- [x] **N6.3 Question Agent v1**
  *ONTWERP: §7, §34.* LLM-agent voor Binary Mode: één concept per vraag; output volgens §34 (concept,
  tekst, `required_symbols`, confidence). Prompt `question-v1`. Terugval "{label}?".
  *Acceptatie:* unittests met FakeProvider, inclusief terugval.

- [x] **N6.4 Vraagstrategieën**
  *ONTWERP: §7.1.* De drie strategieën (sleutel, label, uitleg, instructie) in de agentdienst; de
  instructie gaat mee naar de Question Agent. Een contracttest eist dat de sleutels in `shared/` en in
  Python gelijk zijn.
  *Acceptatie:* unittest: de instructie staat in de prompt (FakeProvider); contracttest groen.

- [x] **N6.5 Icon Agent: exact**
  *ONTWERP: §8 (stap 1).* Concept, label of synoniem van een item → `strong`/`exact`. Zonder LLM.
  *Acceptatie:* unittests (concept, label, synoniem, hoofdletters/spaties, geen treffer).

- [x] **N6.6 Icon Agent: het dichtstbijzijnde pictogram**
  *ONTWERP: §8 (stap 2–3), §17.* Geen exacte treffer → een korte lijst kandidaten (op tekst en context)
  → de LLM kiest, met een schema dat alleen bestaande ids toelaat. Zwakke match → `stand_in` met het
  woord van de gebruiker als label + een `Gap`; niets in de buurt → het pictogram "geen afbeelding".
  *Acceptatie:* unittests: "duizelig" → pictogram "ziek" als `stand_in` + gap; een verzonnen id van de
  LLM wordt geweigerd.

- [x] **N6.7 Validation Agent: regels**
  *ONTWERP: §9 (V1–V7).* De zeven regels als losse, benoemde controles.
  *Acceptatie:* één unittest per regel (geldig en ongeldig).

- [x] **N6.8 Opnieuw proberen bij een ongeldige vraag**
  *ONTWERP: §4.2 (stap 6).* Ongeldig → Question Agent nog eens, met de reden erbij (max. 2 keer), daarna
  de terugval.
  *Acceptatie:* unittests: na twee ongeldige vragen komt de terugval; de reden staat in de tweede prompt.

- [x] **N6.9 Safety Agent: regels**
  *ONTWERP: §10 (S1–S3).* Maximum aantal vragen (beste hypothese voorleggen, daarna "Wil je stoppen?"),
  geen voorstel zonder antwoord, versturen vraagt een JA.
  *Acceptatie:* unittests per regel; scenario dat het maximum bereikt.

- [x] **N6.10 Het voorstel "Bedoel je …?"**
  *ONTWERP: §6, §31.* De Intent Agent levert de zin zodra hij klaar is; de orchestrator stelt voor bij
  confidence ≥ `AGENT_PROPOSE_THRESHOLD` (0,85), geldige validatie en minstens één antwoord. NEE → die
  hypothese telt als afgewezen, terug naar `clarify`.
  *Acceptatie:* scenario "hoofdpijn" van start tot `done` met FakeProvider; NEE-scenario.

- [x] **N6.11 Validation Agent: LLM-deel**
  *ONTWERP: §9.* Optioneel (`AGENT_LLM_VALIDATION`): is de vraag begrijpelijk, past ze, stuurt ze?
  *Acceptatie:* unittests aan/uit; bij uitval van de LLM tellen alleen de regels.

- [x] **N6.12 Safety Agent: LLM-deel, en tegelijk met Validation**
  *ONTWERP: §10.* Optioneel (`AGENT_LLM_SAFETY`): is de vraag passend en niet belastend? Validation en
  Safety draaien tegelijk (threads).
  *Acceptatie:* unittests; een test laat zien dat de totale duur ongeveer de langste van de twee is.

- [x] **N6.13 Meten met echte Ollama**
  *ONTWERP: §54.* De eval-CLI tegen echte Ollama (lokaal en/of cloud) met de scenario's hoofdpijn, dorst
  en duizelig. Duur per agent en per beurt in `docs/architecture.md`; time-outs bijstellen. Nieuwe taken
  aanmaken als de duur onwerkbaar is.
  *Acceptatie:* het rapport staat in de docs; een rooktest op de tablet met echte Ollama.

- [x] **N6.14 Intent Agent: breder zoeken na een reeks NEE**
  *ONTWERP: §6, §36.* Ontdekt bij N6.13: na NEE op alle startconcepten loopt de Intent Agent de
  gevoelens uit de Vocabulary af (blij, verdrietig, bang, …) in plaats van een breder onderwerp te
  proberen ("niet lekker", "iets met je lichaam"). Prompt `intent-v4` en/of een regel in de orchestrator
  die na een aantal NEE's een categorie voorstelt.
  *Acceptatie:* scenario "duizelig" slaagt met de FakeProvider; de eval met `gpt-oss:120b-cloud` haalt
  "duizelig" in minstens 2 van de 3 rondes.

- [x] **N6.15 Startset: woorden voor ziek zijn**
  *ONTWERP: §15.1.* Ontdekt bij N6.13: de 99 platformitems missen woorden voor ziek zijn.
  *Uitkomst:* Mulberry en de Corona-set hebben **geen** symbool voor "ziek", "misselijk" of "duizelig";
  wel voor niezen/verkouden (5723) en het warm hebben (4804), die nu vertaald en geseed zijn (101
  platformitems; "dokter", "hoofdpijn", "buikpijn", "overgeven", "hoesten", "benauwd" waren er al). Een
  eigen label "koorts" op de thermometer (44457) is teruggedraaid: de seed overschrijft bewust geen
  labels van bestaande items, dus oude en nieuwe installaties zouden uit elkaar lopen. Voor de ontbrekende
  woorden werkt het ontwerp zoals bedoeld: het dichtstbijzijnde pictogram met een gap, tot een beheerder
  een eigen afbeelding toevoegt (fase N8).
  *Acceptatie:* de import seedt de nieuwe items met licentie en bron; de Vocabulary-pagina toont ze.

- [x] **N6.16 S1: geen voorstel op een gok**
  *ONTWERP: §10 (S1).* Ontdekt bij N6.13: bij het maximum legt de orchestrator de beste hypothese voor,
  ook als die een zekerheid van 0,25 heeft en nergens een JA op kwam ("Bedoel je: Eenzaam?"). Besluiten
  (ontwerp bijwerken): alleen voorstellen als er een JA was of de zekerheid boven een ondergrens ligt,
  anders meteen "Wil je stoppen?".
  *Acceptatie:* unittest en scenario; ontwerp §10 bijgewerkt.

## Fase N7 — Multi-icon Mode

- [x] **N7.1 Multi-icon in de agentdienst**
  *ONTWERP: §7, §13.* Question en Icon Agent leveren voor multi-icon één onderwerp met N verschillende
  opties (`optionsPerScreen`); "Geen van deze" = alle getoonde opties niet gekozen. Een bevestiging blijft
  binary.
  *Acceptatie:* unittests; scenario "dorst → water" in multi-icon.

- [x] **N7.2 Tablet: multi-icon scherm**
  *ONTWERP: §13, §48.* Raster met 2–8 tegels + "Geen van deze" + ↩ Terug + ⏹ Stoppen.
  *Acceptatie:* componenttests (2, 4 en 8 tegels; Geen van deze); rooktest.

## Fase N8 — Vocabulary aanvullen

- [x] **N8.1 Eigen afbeelding + woord: backend**
  *ONTWERP: §15, §53.* `POST /vocabulary/upload` (multipart via `@fastify/multipart`): alleen PNG, JPEG of
  WebP, max. `UPLOAD_MAX_BYTES` (1 MB), controle op de werkelijke inhoud (magic bytes), sha256; label +
  concepten; verplicht vinkje "wij mogen deze afbeelding gebruiken" → licentie `own` met uploader en
  datum. Alleen de beheerder. Audit-log.
  *Acceptatie:* tests: verkeerd type, te groot, valse extensie, begeleider → 403, isolatie.

- [x] **N8.2 Eigen afbeelding + woord: beheer-UI**
  *ONTWERP: §49.* Dialoog met voorbeeldweergave, woord, concepten en het vinkje.
  *Acceptatie:* componenttest; rooktest (het nieuwe woord verschijnt in een gesprek).

- [x] **N8.3 Toegestane licenties**
  *ONTWERP: §15.* `VOCABULARY_ALLOWED_LICENSES` (env, standaard: CC0, CC BY, CC BY-SA); een functie die
  de licentieteksten van OpenSymbols naar vaste sleutels omzet.
  *Acceptatie:* unittests voor de omzetting, inclusief onbekend → niet toegestaan.

- [x] **N8.4 Zoeken in een externe bron**
  *ONTWERP: §15.* `GET /vocabulary/external/search?q=` via de OpenSymbols-client; elk resultaat met
  licentie, auteur en `allowed: true/false`.
  *Acceptatie:* tests met een nep-OpenSymbols-client; rol.

- [x] **N8.5 Importeren uit een externe bron**
  *ONTWERP: §15, §53.* `POST /vocabulary/import`: alleen een toegestane licentie; de afbeelding wordt
  gedownload (alleen https, bekende host, groottelimiet, time-out, typecontrole) en in de eigen opslag
  gezet; licentie, auteur en bron opgeslagen. Audit-log.
  *Acceptatie:* tests: niet-toegestane licentie → 422, te groot → 422, andere host → 422, geslaagd → item.

- [x] **N8.6 Importeren: beheer-UI**
  *ONTWERP: §49.* Zoeken, licentie zien (niet-toegestane resultaten gemarkeerd en niet te kiezen),
  importeren met label.
  *Acceptatie:* componenttest; rooktest.

- [x] **N8.7 Machinevertaling van de rest van Mulberry**
  *ONTWERP: §15.1 (stap 3).* CLI `python -m agent_service.translate <slug>` met de OllamaProvider (N5.2):
  per symbool zonder Nederlandse vertaling het Engelse, Duitse en Franse label plus de woordsoort naar
  de LLM; terug een Nederlands label, synoniemen en een context uit de vaste lijst (pydantic-schema).
  Schrijft `status: machine` in het vertaalbestand; overschrijft nooit een `reviewed` regel; hervat waar
  hij gebleven was. Daarna draait de seed (N2.7) opnieuw en komen deze symbolen in de Vocabulary.
  *Acceptatie:* unittests met FakeProvider (werkwoord vs. zelfstandig naamwoord, `reviewed` blijft
  staan, hervatten); een handmatige run over de hele set; het vertaalbestand valideert (test uit N2.5).

- [x] **N8.8 Beheer: machinevertalingen nakijken**
  *ONTWERP: §15.1, §49.* Filter "machinevertaling, nog niet nagekeken" in het Vocabulary-overzicht;
  per item "Klopt" (→ `reviewed`) of verbeteren (N2.11). Teller van wat nog open staat.
  *Acceptatie:* tests op het filter en de statuswijziging; componenttest.

## Fase N9 — Ontbrekende woorden

- [x] **N9.1 Gaps opslaan**
  *ONTWERP: §17, §39.* Migratie `VocabularyGap` (organizationId, conceptKey, label, context,
  bestAvailableItemId, lastConfidence, occurrences, firstSeenAt, lastSeenAt, status
  open/resolved/dismissed). De backend voegt gaps uit de `TurnResponse` samen per concept per organisatie,
  zonder gebruiker of sessie.
  *Acceptatie:* tests: zelfde concept twee keer → `occurrences` 2; geen verwijzing naar gebruiker; isolatie.

- [x] **N9.2 Beheer: "Ontbrekende woorden"**
  *ONTWERP: §17, §49.* Lijst (woord, hoe vaak, laatst, beste pictogram) met "Woord toevoegen" (opent N8.2
  of N8.6, vooraf ingevuld; daarna `resolved`) en "Negeren".
  *Acceptatie:* tests op de endpoints; componenttest.

- [x] **N9.3 Melding aan de beheerder**
  *ONTWERP: §17.* Teller bij het menu-item; accountinstelling `notifyGapsByEmail`: één e-mail per nieuw
  ontbrekend woord (niet per keer dat het voorkomt).
  *Acceptatie:* tests: tweede keer hetzelfde woord → geen tweede e-mail; instelling uit → geen e-mail.

## Fase N10 — Contacten

- [x] **N10.1 Model en API**
  *ONTWERP: §28, §39.* Migratie `Contact` (userId, naam versleuteld, relatie, `vocabularyItemId`,
  e-mail versleuteld, `emailVerifiedAt`, `active`, `sortOrder`). CRUD voor de beheerder en een gekoppelde
  begeleider. Audit-log.
  *Acceptatie:* tests: validatie, rollen, isolatie; in de db staan naam en e-mail niet leesbaar.

- [x] **N10.2 E-mail-opt-in**
  *ONTWERP: §28 (V5).* Bij aanmaken of wijzigen van het e-mailadres een bevestigingsmail (patroon van de
  bestaande e-mailverificatie); publiek `GET /contacts/verify?token=`; opnieuw versturen. Alleen
  bevestigde contacten zijn bruikbaar.
  *Acceptatie:* tests: verlopen token, hergebruik, wijziging zet de bevestiging terug.

- [x] **N10.3 Beheer: contacten bij een gebruiker**
  *ONTWERP: §49.* Onderdeel "Contacten" in het gebruikersscherm: lijst, dialoog (naam, relatie,
  pictogram uit de Vocabulary, e-mail), status, volgorde aanpassen, opnieuw versturen.
  *Acceptatie:* componenttest; rooktest.

## Fase N11 — Delen en versturen

- [x] **N11.1 "Wil je dit sturen?"**
  *ONTWERP: §4.1, §31.* De backend stuurt de bevestigde, actieve contacten mee (id, naam, pictogram, nooit
  e-mail). Na een bevestigde boodschap en met minstens één contact: fase `share_ask`; NEE → `done`.
  *Acceptatie:* unittests; een FakeProvider-test laat zien dat contactnamen in geen enkele prompt staan.

- [x] **N11.2 Contact Agent (binary)**
  *ONTWERP: §28, §29.* Regels: volgorde = `sortOrder` (Experience komt in N12.2); "Wil je dit naar {naam}
  sturen?" één voor één; alle NEE → `done` "niet verstuurd".
  *Acceptatie:* unittests; scenario.

- [x] **N11.3 Versturen per e-mail**
  *ONTWERP: §32, §52 (I3).* Migratie `Delivery` (sessionId, intentId, contactId, kanaal, status, tijd).
  De backend verstuurt alleen na een Observed JA op dát contact, van deze gebruiker en bevestigd; de mail
  bevat de boodschap en de naam van de gebruiker. Mislukt → status `failed`. Audit-log.
  *Acceptatie:* tests: zonder JA niets; contact van een andere gebruiker → geweigerd; onbevestigd →
  geweigerd; mailfout → `failed`.

- [x] **N11.4 Tablet: contactvraag en Verstuurd**
  *ONTWERP: §48.* Het contactscherm (binary) en "Verstuurd naar moeder" / "Versturen is niet gelukt". Na
  een verzending verdwijnt ↩ Terug.
  *Acceptatie:* componenttests; rooktest met een echte (test)mailbox.

- [x] **N11.5 Contacten in multi-icon**
  *ONTWERP: §29.* Contacttegels (max. `optionsPerScreen`; "Geen van deze" → de volgende) + `confirm_send`
  "Naar {naam} sturen?".
  *Acceptatie:* unittests; componenttest.

- [x] **N11.6 Beheer: berichtenoverzicht**
  *ONTWERP: §32, §49.* `GET /messages` (alleen de beheerder): wanneer, gebruiker, boodschap, verstuurd aan
  (of "niet verstuurd"), status. Pagina in de beheeromgeving.
  *Acceptatie:* tests: isolatie, begeleider → 403; componenttest.

- [x] **N11.7 Kopie aan de beheerder**
  *ONTWERP: §32.* Accountinstelling `copySentMessages`: elke verzending gaat ook als kopie (met ontvanger)
  naar de beheerders van die organisatie die het aan hebben staan.
  *Acceptatie:* tests: aan → kopie, uit → geen kopie, beheerder van een andere org → nooit.

## Fase N12 — Experience

- [x] **N12.1 Tellen na afloop**
  *ONTWERP: §21 (laag 1), §22.* Migratie `ExperienceStat` (userId, subjectType symbol/contact/mode,
  subjectRef, presented, chosen, chosenAtFirstPosition, lastUsedAt). Bij het einde van een sessie berekent
  de backend de tellingen uit Presented en Observed — alleen als `experienceEnabled` aanstaat.
  *Acceptatie:* tests: uit → niets; aan → juiste tellingen, inclusief eerste plek.

- [x] **N12.2 Vaakst gekozen eerst**
  *ONTWERP: §2.4, §29 (besluit 7).* Een samenvatting van de Experience gaat mee in de `TurnRequest`;
  startconcepten, multi-icon-tegels en contacten worden geordend op `chosen` (gelijk → vaste volgorde).
  Ranking verbergt nooit een optie.
  *Acceptatie:* unittests in de agentdienst; backendtest: Experience uit → geen samenvatting.

- [x] **N12.3 Beheer: ervaring bekijken en wissen**
  *ONTWERP: §22, §49.* Per gebruiker in gewone taal wat er geleerd is; "Ervaring wissen"; bij uitzetten de
  vraag "ook wissen?". Audit-log.
  *Acceptatie:* tests: wissen verwijdert alles van die gebruiker en niets van een ander.

- [x] **N12.4 Experience Agent: observaties**
  *ONTWERP: §21 (laag 2).* `POST /v1/experience` in de agentdienst: observaties over een afgeronde sessie
  (LLM). De backend roept hem na afloop aan zonder dat de tablet wacht; opgeslagen als inference
  `experience_note`, getoond in N12.3 als "observatie, geen waarheid".
  *Acceptatie:* unittests met FakeProvider; backendtest: een falende aanroep raakt de sessie niet.

## Fase N13 — AI kiest de vorm

- [x] **N13.1 Vorm kiezen en wisselen**
  *ONTWERP: §14.* Bij `interactionMode = ai`: startvorm uit de Experience (anders binary); de
  wisselregels uit §14; niet binnen 3 beurten; inference `mode_change` met reden. De backend bewaakt I7.
  *Acceptatie:* unittests per regel; scenario met een wissel; backendtest: een expliciete vorm wisselt
  nooit.

## Fase N14 — Terugzien, bias en bewaartermijn

- [x] **N14.1 Beheer: een sessie terugzien**
  *ONTWERP: §27, §49.* `GET /communication/sessions/:id/provenance` (alleen de beheerder) + scherm met
  per beurt drie kolommen: Getoond / Gekozen / Gedacht, plus de agentbeslissingen (agent, status, duur).
  *Acceptatie:* tests: isolatie, begeleider → 403; componenttest.

- [x] **N14.2 Bewaartermijn uitvoeren**
  *ONTWERP: §53.* `purgeExpired(now)` verwijdert per organisatie sessies, momentopnamen, provenance,
  bevestigde berichten en verzendingen die ouder zijn dan `retentionDays`; draait bij het starten en
  daarna dagelijks.
  *Acceptatie:* tests met een vaste klok: net te oud → weg, net te jong → blijft, andere org ongemoeid.

- [ ] **N14.3 Bias-rapport**
  *ONTWERP: §24 (B4, B5), §25.* `GET /reports/bias` (beheerder) + pagina: aandeel keuzes op de eerste
  plek, JA-aandeel in binary, per contact de eerste plek, vormwisselingen, gaps, overconfidence.
  *Acceptatie:* tests op de berekende getallen met vaste testdata; isolatie.

## Fase N15 — Afronding van de MVP

- [ ] **N15.1 Profielexport en -import**
  *ONTWERP: §1 (eigenaarschap), §53, §28.* Export/import van instellingen, contacten en Experience
  (versleuteld zoals de bestaande export). Contacten met naam, relatie, e-mail en volgorde; bij importeren
  is elk contact weer onbevestigd (opt-in geldt per omgeving, N10.2) en vervalt het pictogram als het daar
  niet in de Vocabulary staat.
  *Acceptatie:* tests: rondgang export → import levert hetzelfde op (contacten onbevestigd); isolatie.

- [ ] **N15.2 Security review**
  *ONTWERP: §53.* `/security-review` over de hele herbouw; bevindingen meteen fixen. `npm audit` en
  `npm run audit:python` op 0.
  *Acceptatie:* rapport in `docs/security.md`; alle bevindingen opgelost of als taak vastgelegd.

- [ ] **N15.3 MVP-check**
  *ONTWERP: §43.* Volledige eval-run met echte Ollama, rooktest van alle schermen in Docker, docs compleet
  (README, `docs/`, CHANGELOG, `.env.example`).
  *Acceptatie:* elk punt uit §43 "Core" aantoonbaar aanwezig (lijst met verwijzing naar test of rooktest).

---

## Na de MVP (nog niet uitwerken)

Symbolen genereren (SVG + validator, ONTWERP §19–20) · SVG-uploads · System-wide Experience (§23) · een
ranking die corrigeert voor de plek waar een optie stond (§25) · semantische verrijking vanuit Experience
(§16) · andere LLM-aanbieders en provider-routing (§35) · eigen foto's van contacten · andere kanalen dan
e-mail (sms, push) · PostgreSQL-pad · offline-modus.
