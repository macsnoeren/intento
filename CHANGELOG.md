# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## Herbouw (agentic)

De gespreks- en AI-laag wordt herbouwd volgens `INTENTO-NEW-DESIGN.md`, zonder backward
compatibiliteit. Per taak uit `TASKS-NEW_DESIGN.md` een regel hieronder.

### N0.1 — documentatie wijst naar het nieuwe ontwerp

- `DESIGN.md`, `INTENTO-DESIGN/`, `TASKS.md`, `TEST.md` en `TEST-FEEDBACK.md` zijn verwijderd;
  `INTENTO-NEW-DESIGN.md` is de enige ontwerpbron en `TASKS-NEW_DESIGN.md` de takenlijst.
  `CLAUDE.md` is herschreven voor de herbouw.
- README en `docs/` verwijzen naar het nieuwe ontwerp en melden dat de gespreks- en AI-laag herbouwd
  wordt.
- **ADR-0017 "Agentic architectuur"**: een stateless Python-agentdienst met eigen orchestrator, de
  backend als enige data-eigenaar, geen wachtrij. ADR-0008, 0009, 0010, 0012, 0013 en 0014 zijn
  daarmee vervangen.
- `npm audit` weer op 0: fastify 5.12.5 en nodemailer 10.

### N0.2 — tablet: de oude gespreksflow eruit

- `TabletApp.tsx` houdt alleen het koppelen; een gekoppelde tablet toont een rustig scherm "Nog niet
  beschikbaar". Keuzescherm, voorstelscherm, correctie, contextindicator, gok-tegel, wachtstand voor de
  AI-wachtrij en de gesproken bedieningszetjes (`speech-hints.ts`) zijn weg.
- `DeviceApi` kent alleen nog `deviceMe`, `linkDevice` en `speakText`. `speech.ts` blijft voor het
  voorlezen in de nieuwe flow.

### N2.15 — zoeken in de Vocabulary op woorden

- In labels en synoniemen zoekt `q` overal in het woord (Nederlandse samenstellingen: "pijn" →
  hoofdpijn), in concepten alleen aan het begin van een woord: "oma" vindt niet meer *buik* via
  `stomach`. Exacte labeltreffers staan vooraan; de pagina's lopen daarover door.
- Migratie `vocabulary_concept_text`: nieuw veld `conceptText`, `searchText` bevat alleen nog de labels;
  bestaande items worden in de migratie opnieuw opgebouwd.
- Tests op de gevallen uit de taak plus paginering; op de echte startset gerookt ("oma" → oma eerst).

### N10.3 — contacten in de beheeromgeving

- Onderdeel **Contacten** bij een gebruiker (beheerder: tabblad in het gebruikersscherm; begeleider:
  onder de instellingen van zijn gebruiker). Per contact pictogram, naam, relatie, e-mail en status
  (bevestigd / wacht op bevestiging / uit); omhoog en omlaag voor de volgorde op de tablet; opnieuw
  versturen zolang het contact niet bevestigde; wijzigen en verwijderen (met bevestiging).
- Dialoog voor toevoegen en wijzigen: naam, relatie, e-mail, pictogram zoeken in de eigen Vocabulary,
  en bij wijzigen "Aanbieden op de tablet". Een nieuw adres meldt dat er een bevestigingsmail volgt.
- De lijstregels van "Ontbrekende woorden" en "Contacten" delen nu de klassen `item-list`/`item-row`.
- Componenttests; in de browser gerookt op desktop en telefoonbreedte.
- Ontdekt: zoeken in de Vocabulary matcht ook midden in concepten ("oma" vindt *buik* via `stomach`) →
  N2.15.

### N10.2 — contacten: e-mail-opt-in

- Bij aanmaken en bij een nieuw e-mailadres gaat er een bevestigingsmail naar het contact (token zoals
  bij de e-mailverificatie: alleen de hash, eenmalig, 7 dagen, `CONTACT_VERIFICATION_TTL_HOURS`). De mail
  noemt het contact en de organisatie, niet de gebruiker.
- Openbare pagina `/contact-bevestigen` in de web-app: `GET /contacts/verify?token=` kijkt alleen of de
  link werkt, de toestemming is een klik op "Ja" (`POST /contacts/verify`). Zo geeft een mailscanner
  geen toestemming. Afwijking van de taaktekst (die alleen een GET noemde), vastgelegd in het ontwerp.
- `POST /users/{id}/contacts/{contactId}/verification`: opnieuw versturen (vorige link vervalt; al
  bevestigd → 409). Een mislukte mail breekt het aanmaken niet.
- Tests: verlopen token, hergebruik, misvormd token, wijziging zet de bevestiging terug en laat de oude
  link vervallen, opnieuw versturen, isolatie; componenttest van de pagina; end-to-end gerookt.

### N10.1 — contacten: model en API

- Nieuwe tabel `Contact` (migratie `contact`): per gebruiker naam en e-mailadres **versleuteld**,
  relatie, pictogram uit de Vocabulary, bevestigd-op, actief en volgorde.
- `GET`/`POST /users/{id}/contacts`, `PATCH`/`DELETE /users/{id}/contacts/{contactId}` voor de beheerder
  en een gekoppelde begeleider; zod-validatie (geen stuurtekens, e-mail in kleine letters), pictogram
  alleen uit de eigen Vocabulary, een nieuw e-mailadres is weer onbevestigd. Geaudit zonder naam of
  e-mail.
- Tests: validatie, rollen, isolatie (andere organisatie, andere gebruiker), versleuteling in de
  database, audit.
- Ontdekt: de profielexport (T8.1) neemt contacten nog niet mee → N10.4.

### N9.3 — melding aan de beheerder

- Teller bij "Ontbrekende woorden" in het menu (`GET /vocabulary/gaps/count`), opnieuw geteld bij elke
  paginawissel en na een actie op de pagina; schermlezers horen "Ontbrekende woorden, 3 open".
- Accountinstelling `notifyGapsByEmail` (migratie `notify_gaps_by_email`, standaard uit) onder "Mijn
  account" → "Meldingen": één e-mail per **nieuw** ontbrekend woord, niet per keer dat het voorkomt;
  alleen aan beheerders van die organisatie met een bevestigd e-mailadres. De mail noemt het woord en
  de link naar de web-app (`APP_BASE_URL`), nooit de gebruiker. Verstuurd los van de beurt: de tablet
  wacht niet op de mailserver en een mislukte mail breekt het gesprek niet.
- Tests: tweede keer hetzelfde woord → geen tweede e-mail; instelling uit → geen e-mail; niet aan een
  begeleider, een ander organisatie of een onbevestigd adres; een mislukte mail laat het gesprek door
  gaan. Met de cloud gerookt: twee keer "niet lekker" in één gesprek gaf één e-mail.

### N9.2 — beheer: "Ontbrekende woorden"

- Nieuwe pagina in het beheermenu (alleen de beheerder): per woord het pictogram dat de gebruiker zag,
  hoe vaak, wanneer het laatst en de context; tabbladen Open / Genegeerd / Opgelost en een teller.
- **Eigen afbeelding** of **Uit externe bron** opent de bestaande dialoog (N8.2/N8.6) vooraf ingevuld
  met woord, concept en context (de externe zoekterm is het concept, want die bron is Engelstalig); na
  het toevoegen is het woord opgelost. Het concept blijft precies dat van de gap, zodat de iconagent het
  nieuwe symbool de volgende keer exact vindt. **Negeren** en **Weer openzetten**.
- `GET /vocabulary/gaps` en `POST /vocabulary/gaps/{id}/resolve|dismiss|reopen`: eigen organisatie,
  IDOR → 403, geaudit zonder het woord.
- Tests op de endpoints (lijst, statussen, audit, isolatie, rollen) en componenttests; in de browser
  gerookt op desktop en telefoonbreedte.

### N9.1 — gaps opslaan

- Nieuwe tabel `VocabularyGap` (migratie `vocabulary_gap`): per organisatie en concept het woord, de
  context, het beste pictogram, de laatste zekerheid, hoe vaak, eerst en laatst gezien, en een status
  (`open`/`resolved`/`dismissed`). Geen gebruiker of gesprek.
- De turn-engine legt de `gaps` uit elk (gevalideerd) agentantwoord vast (`recordGaps`): hetzelfde concept
  telt per beurt één keer; een opgelost woord dat weer voorkomt gaat terug naar `open`.
- Tests: samenvoegen (`occurrences` 2), geen verwijzing naar gebruiker of gesprek, isolatie tussen
  organisaties, statusregels, en een heel gesprek met een stand-in. Met de cloud gerookt: "niet lekker"
  (`unwell`) kwam als gap binnen.

### N8.8 — machinevertalingen nakijken

- Vocabulary-overzicht: keuze "Vertaling" (Alle / Machinevertaling, nog niet nagekeken) en een teller
  "N machinevertalingen nog na te kijken". Detailscherm: knop **Klopt** (→ `reviewed`, het woord blijft);
  verbeteren gaat via het bestaande formulier (N2.11), dat een gewijzigd label ook `reviewed` maakt.
- `GET /vocabulary` geeft `machineOpen`; die telling en het filter gaan alleen over wat deze organisatie
  mag wijzigen (eigen items; de startset alleen voor de platformorganisatie). `PATCH` accepteert
  `labelStatus: 'reviewed'`.
- Terug naar het overzicht laadt de lijst opnieuw, zodat een nagekeken item uit het filter valt en de
  teller klopt.
- Tests op filter, telling, isolatie en de statuswijziging (server) en componenttests (web); in de
  browser gerookt (teller 3.377 → 3.376 na "Klopt").

### N8.7 — machinevertaling van de rest van Mulberry

- `python -m agent_service.translate <slug>` (agentdienst): per batch Engels, Duits, Frans en woordsoort
  naar de LLM (prompt `translate-v1`, pydantic-schema); terug label, synoniemen en context. Schrijft
  `status: machine`, raakt nooit een `reviewed` regel, schrijft na elke batch atomair en hervat waar hij
  gebleven was. Dubbele concepten (vier keer *drink* in Mulberry) krijgen `_2`, `_3`, ….
- `contracts/vocabulary_contexts.json` en `contracts/concept_from_english.json`: de vaste contextlijst en
  de regel Engels label → concept, getest in de agentdienst, `shared` en de server.
- Hele Mulberry-set vertaald met `gpt-oss:120b-cloud` (3.380 regels, eerste run 31 mislukt, tweede run
  0); het vertaalbestand valideert en de seed zet 3.480 platformitems in de Vocabulary. De kwaliteit is
  bruikbaar, maar niet foutloos (zie `vocabulary/README.md`); nakijken is N8.8.
- In de browser gerookt: binair gesprek met de cloud naar "Drinken." in vier stappen (17 s), multi-icon
  in twee stappen.

### N8.6 — importeren: beheer-UI

- "+ Uit externe bron" op de Vocabulary-pagina (alleen de beheerder): zoeken in OpenSymbols, per
  resultaat afbeelding, naam, licentie en auteur; resultaten met een niet-toegestane of onbekende licentie
  zijn gemarkeerd en niet te kiezen. Na een keuze: Nederlands woord, synoniemen, concepten (voorgevuld uit
  de naam) en contexten, dan importeren; het nieuwe item opent. `Api.searchExternal`/`importExternal`.
- Componenttests; in de browser gerookt tot de melding dat de externe bron niet is ingesteld (geen
  `OPENSYMBOLS_SECRET` in deze omgeving, dus geen echte zoekresultaten).

### N8.5 — importeren uit een externe bron

- `POST /vocabulary/import` (alleen de beheerder): de server haalt licentie, auteur en afbeelding
  opnieuw bij OpenSymbols op (de client stuurt alleen zoekopdracht en id), staat alleen toegestane
  licenties toe, downloadt alleen via https van `VOCABULARY_IMAGE_HOSTS` (nieuw) met limiet, time-out
  en typecontrole (geen SVG), kopieert naar de eigen opslag en slaat licentie, auteur en bron op. Per
  organisatie één keer. Audit `vocabulary.import`.
- Tests: niet-toegestane en onbekende licentie, andere host, te groot (gemeten en aangekondigd), SVG,
  onbekend id, begeleider, dubbel, twee organisaties. De standaardhosts zijn die waar OpenSymbols zijn
  afbeeldingen serveert; niet tegen de live API gecontroleerd (geen `OPENSYMBOLS_SECRET` hier).

### N8.4 — zoeken in een externe bron

- `GET /vocabulary/external/search?q=` (alleen de beheerder, rate limit): zoekt via de bestaande
  OpenSymbols-client en geeft per resultaat de vaste licentiesleutel en `allowed`. Zonder configuratie
  503, bij een fout van de bron 502. `buildApp({ openSymbols })` voor een nep-client in tests.
- Tests met een nep-client (licenties, eigen lijst, rol, validatie, 503/502). Niet gerookt tegen de echte
  OpenSymbols-API: er is in deze omgeving geen `OPENSYMBOLS_SECRET`; de dev-server geeft netjes 503.

### N8.3 — toegestane licenties

- `server/src/vocabulary/licenses.ts`: licentieteksten en -URL's van externe bronnen ("CC BY-SA",
  "Creative Commons Attribution-ShareAlike 3.0", "public domain", creativecommons.org-URL's) worden een
  vaste sleutel (`CC0`, `CC-BY-SA-3.0`, …); onherkenbaar wordt `UNKNOWN` en is nooit toegestaan.
- `VOCABULARY_ALLOWED_LICENSES` (nieuw, standaard `CC0,CC-BY,CC-BY-SA`; in `.env.example` en
  `.env.docker.example`), met zod op de families gecontroleerd.

### N8.2 — eigen afbeelding + woord: beheer-UI

- "+ Eigen afbeelding toevoegen" op de Vocabulary-pagina (alleen de beheerder): dialoog met voorbeeld,
  woord, synoniemen, concepten, contexten en het verplichte vinkje; een ander bestandstype wordt al in
  de browser geweigerd; na opslaan opent het nieuwe item. `Api.uploadVocabularyItem` (FormData).
- Gerookt in de browser: "ijsje" toegevoegd, als startconcept gemarkeerd, en het verschijnt als tegel
  in een gesprek op de tablet.

### N8.1 — eigen afbeelding + woord: backend

- `POST /vocabulary/upload` (multipart, alleen de beheerder): PNG, JPEG of WebP herkend aan de inhoud
  (SVG geweigerd), hooguit `UPLOAD_MAX_BYTES`, sha256, opgeslagen onder `own/<organisatie>/<sha256>`;
  woord, synoniemen, concepten en contexten (`vocabularyUploadFieldsSchema` in shared); verplicht vinkje
  → licentie `own` met uploader en datum. Audit `vocabulary.upload`.
- Tests: verkeerd type (415), valse extensie, te groot (413), ontbrekend vinkje of ongeldige velden
  (400), begeleider (403), isolatie tussen organisaties. Gerookt met curl.

### N7.2 — tablet: multi-icon scherm

- Multi-icon op de tablet: de vraag, een raster met 2 tot 8 tegels (pictogram met het woord, als knop
  met het woord als naam), "Geen van deze", ↩ Terug en ⏹ Stoppen; geen JA/NEE. Een tegel stuurt
  `optionRef`, "Geen van deze" `noneOfThese`, met beurt en reactietijd.
- Ontdekt bij de rooktest: met 8 tegels per scherm verschenen er maar 5, omdat de Intent Agent hooguit 5
  hypotheses gaf. Nu tot 8, en de agent krijgt het aantal tegels mee (prompt `intent-v5`).
- Gerookt in de browser met het echte model: 4 en 8 tegels, "Geen van deze", Stoppen, en
  "drinken" → "Bedoel je: Drinken?" → Klaar.

### N7.1 — Multi-icon in de agentdienst

- Een gesprek begint in de ingestelde vorm (`multi` bij Multi-icon). In multi-icon: een onderwerpvraag
  (prompt `question_multi-v1`, terugval "Wat bedoel je?", gekeurd met V1 t/m V6) met 2 tot
  `options_per_screen` verschillende tegels uit de hypotheses. Een gekozen tegel telt als JA; "Geen van
  deze" wijst alle getoonde concepten af. Bevestigingen blijven binary. Gebeurtenissen die niet bij het
  scherm passen geven een protocolfout.
- De gesimuleerde gebruiker kiest tegels; scenario "dorst → water" in multi-icon. Via de backend
  gerookt met het echte model: "Wat heb je nodig?" met vier tegels, daarna "Bedoel je: Drinken?".

### N6.16 — S1: geen voorstel op een gok

- Bij het maximum aantal vragen legt de orchestrator alleen voor wat de gebruiker bevestigde, of de
  bovenste hypothese als die minstens 0,5 zeker is; anders meteen "Wil je stoppen?". Ontwerp §10 (S1)
  bijgewerkt. Aanleiding: in N6.13 eindigde "duizelig" met "Bedoel je: Eenzaam?" op 0,25 zekerheid.

### N6.15 — startset: woorden voor ziek zijn

- Vertaald en geseed: "niezen" (verkouden, Mulberry 5723) en "het warm hebben" (warm, zweten, Mulberry
  4804) in de context `health`; de startset telt nu 101 platformitems.
- Mulberry en de Corona-set hebben geen symbool voor "ziek", "misselijk" of "duizelig": die lopen via het
  dichtstbijzijnde pictogram met een gap, tot een beheerder een eigen afbeelding toevoegt. Een
  herlabeling van de thermometer naar "koorts" is teruggedraaid omdat de import bestaande labels bewust
  niet overschrijft (anders lopen installaties uiteen); dat staat nu in `vocabulary/README.md`.

### N6.14 — Intent Agent: breder zoeken na een reeks NEE

- De Intent Agent krijgt `nee_op_rij` (NEE sinds het laatste JA) en prompt `intent-v4`: na drie NEE een
  breder onderwerp ("niet lekker"), daarna preciezer. Scenario "duizelig" slaagt met de FakeProvider;
  gemeten met `gpt-oss:120b-cloud` 3/3 (was 0/3), 4–11 vragen.

### N6.13 — meten met echte Ollama

- Eval-CLI uitgebreid: meetscenario's hoofdpijn, dorst en duizelig (`--set meting`), een eigen
  Vocabulary (`--vocabulary`), `--llm-validation`/`--llm-safety`, duur per beurt (mediaan, p90, max) en
  per agent (gem., max). De gesimuleerde gebruiker herkent ook Nederlandse woorden.
- Gemeten met Ollama Cloud (alleen cloudmodellen): `gpt-oss:120b-cloud` 6/9, beurt mediaan 3,9 s, p90
  5,8 s; met Validation + Safety 4,6 s / 6,4 s; `gpt-oss:20b-cloud` trager en vaker time-outs. Hoofdpijn
  en dorst slagen altijd, duizelig nooit. Tabletrooktest met het echte model: "dorst" in ±15 s. Het
  rapport staat in `docs/architecture.md`.
- **Tijdsbudget per beurt** (`AGENT_TURN_BUDGET_SECONDS`, nieuw, standaard 25 s): de time-outs per agent
  konden samen boven de 30 s van de backend uitkomen; nu krijgt elke modelaanroep hooguit de resterende
  tijd.
- Nieuwe taken N6.14 (breder zoeken na veel NEE), N6.15 (woorden voor ziek zijn in de startset) en
  N6.16 (S1: geen voorstel op een gok).
- Beveiliging: nieuwe kritieke advisory voor `shell-quote` (GHSA-pqg4-j6r4-53mv, via de dev-tool
  `concurrently`, die 1.9.0 vastpint): override naar `shell-quote@^1.12.0`; `npm audit` weer 0.

### N6.12 — Safety Agent: LLM-deel, tegelijk met Validation

- Optioneel (`AGENT_LLM_SAFETY`, nieuw, standaard false; in de `.env`-voorbeelden en compose): het model
  beoordeelt of de vraag passend en niet belastend is (prompt `safety-v1`); afkeuring → nieuwe poging
  met de reden, uitval → alleen regels.
- Staan Validation en Safety allebei aan, dan draaien hun LLM-delen tegelijk in twee threads; een test
  laat zien dat de duur ongeveer de langste van de twee is. Gemeten met `gpt-oss:120b-cloud`: een beurt
  met alles aan ±5 s (keuringen samen ±2 s in plaats van ±3,5 s).

### N6.11 — Validation Agent: LLM-deel

- Optioneel (`AGENT_LLM_VALIDATION`, nieuw, standaard false; in de `.env`-voorbeelden en compose): na
  de regels beoordeelt het model of de vraag begrijpelijk is, past en stuurt (prompt `validation-v1`).
  Een afkeuring gaat als reden mee naar de nieuwe poging van de Question Agent; bij uitval van het model
  tellen alleen de regels. Gemeten met `gpt-oss:120b-cloud`: ±0,8 s extra per vraag.

### N6.10 — het voorstel "Bedoel je …?"

- Met een taalmodel stelt de orchestrator voor bij confidence ≥ `AGENT_PROPOSE_THRESHOLD` (nieuw, 0,5–1,
  standaard 0,85; in `.env.example`, `.env.docker.example` en compose), een geldige V7 en minstens één
  antwoord, met de zin van de Intent Agent of anders het woord. V7 weigert nu ook een zin met een naam
  of URL. NEE → afgewezen, terug naar `clarify`. Het pictogram bij een nieuw concept komt van de Icon
  Agent.
- Scenario "hoofdpijn" van start tot `done` ("Ik heb hoofdpijn.", 2 vragen) en een NEE-scenario.
- Gemeten met `gpt-oss:120b-cloud`: 2/2 geslaagd met 1 en 3 vragen (was 10–15), 4–12 s per gesprek.

### N6.9 — Safety Agent: regels

- `agent_service/agents/safety.py`: S1 (maximum aantal vragen), S2 (geen voorstel zonder antwoord) en
  S3 (versturen alleen na een JA op dát contact, voor N11). De orchestrator legt bij S1 de beste
  hypothese voor en gaat na een NEE daarop naar "Wil je stoppen?"; S2 blokkeert een voorstel zonder
  antwoord. Ingrijpen staat als `safety-agent` in de beslissingen. Scenario met een model dat eindeloos
  blijft verfijnen: na 5 vragen het voorstel.

### N6.8 — opnieuw proberen bij een ongeldige vraag

- Elke vraag gaat met het pictogram erbij door V1 t/m V6; de keuring staat als `validation-agent` in de
  beslissingen. Afgekeurd → de Question Agent nog eens met de reden (`afgekeurd`, prompt
  `question-v2`); na twee ongeldige vragen de regelgebaseerde vraag (`fallback`, validatie `invalid`).
  Het pictogram wordt nu vóór de vraag gekozen (één keer per beurt).
- De scenario-Vocabulary heeft nu ook "geen afbeelding", zoals de echte startset: zonder dat item faalde
  de Icon Agent op een eigen concept van het model en eindigde "bedoelt dorst" in "Wil je stoppen?".
- Gemeten met `gpt-oss:120b-cloud`: 2/2 geslaagd, maar 10–15 vragen per gesprek (45–75 s): het model
  blijft verfijnen met eigen concepten. N6.9 (maximum) en N6.10 (drempel) moeten dat begrenzen.

### N6.7 — Validation Agent: regels

- `agent_service/agents/validation.py`: V1 t/m V7 als losse, benoemde controles met een `Finding`
  (regel, reden zonder inhoud, actie `reject` of — bij tegenstrijdige antwoorden — `clarify`), plus
  `validate_question` voor V1 t/m V6. Standaard voorsteldrempel 0,85. Een unittest per regel, geldig
  en ongeldig. Het inzetten in de vraagstroom volgt in N6.8.

### N6.6 — Icon Agent: het dichtstbijzijnde pictogram

- Zonder exacte treffer: verwante woorden van het model → tekstzoekopdracht (≤ 10 kandidaten) → het
  model kiest met een schema dat alleen die ids of `none` toelaat; een verzonnen id wordt geweigerd.
  Resultaat: `stand_in` met het woord van de gebruiker + een `Gap` (prompt `icon-v1`). Niets in de buurt,
  geen model of uitval: "geen afbeelding" met een gap.
- De orchestrator zet de gaps in de `TurnResponse`; "Bedoel je …?" toont hetzelfde pictogram als de
  vraag (met de gap). De Intent Agent mag een eigen concept noemen (prompt `intent-v3`).
- Gemeten met `gpt-oss:120b-cloud`: "duizelig" → "ziek" (0,85), "ruimteschip" → "geen afbeelding", ±1–2 s.
  "dorst" gaf de ene keer "drinken" (0,9) en de andere keer "geen afbeelding": de keuze van het model
  wisselt; N6.13 meet dat.

### N6.5 — Icon Agent: exact

- `agent_service/agents/icon.py`: exact op concept, label of synoniem (genormaliseerd voor
  hoofdletters, spaties en `_`) → `semantic_match: strong`, `representation: exact`, zonder LLM; het
  woord onder het pictogram blijft een woord van het item. Vervangt `rule_icon`.
  `VocabularyIndex.for_label` zoekt op label of synoniem.

### N6.4 — vraagstrategieën

- `agent_service/agents/strategies.py`: `general_to_specific`, `concrete_first` en `short_and_calm` met
  label, uitleg en instructie; de instructie van de ingestelde strategie gaat mee naar de Question Agent.
- `contracts/question_strategies.json` als gedeelde referentie: Python (`STRATEGIES`, het
  contracttype) en `shared/` (sleutels, catalogus, zod-schema) worden er allebei tegen getest.

### N6.3 — Question Agent v1

- `agent_service/agents/question.py` met prompt `question-v1` (bijgewerkt vóór het eerste gebruik): de
  vraag over het gekozen concept, volgens §34 (concept, tekst, `required_symbols`, confidence).
  Nagekeken: zelfde concept, vraag van 3 tot 80 tekens met vraagteken, geen URL, niet eerder gesteld;
  anders de terugval "{Label}?".
- `FakeProvider` kan per agent een eigen rij antwoorden geven (`routes`).
- Gemeten met `gpt-oss:120b-cloud`: 2/2 geslaagd, "Heb je pijn?" in plaats van "Pijn?", ±1,3 s per
  vraag; samen met de Intent Agent ±3 s per beurt en 6–7 vragen per gesprek (zie N6.2).

### N6.2 — hypotheses in de Session State

- De orchestrator houdt hypotheses, aannames en onzekerheden bij in de state en geeft ze elke beurt als
  inference terug. De vraag gaat over de eerste nog niet gevraagde hypothese; met een taalmodel volgt
  op een JA een preciezere vraag zolang de Intent Agent iets open ziet, anders het voorstel. Is er
  niets meer te vragen maar wel een JA, dan het voorstel in plaats van "Wil je stoppen?".
- Prompt `intent-v2` met `uncertainties`. Opnieuw beginnen wist ook de gestelde vragen.
- Scenario "JA pijn, NEE hoofd, NEE buik": pijn blijft, "waar de pijn zit" staat open, daarna
  "Bedoel je: Pijn?".
- Gemeten met `gpt-oss:120b-cloud`: 4/4 geslaagd, maar nu 6 vragen per gesprek (±13–16 s): het model
  blijft verfijnen. Het maximum (N6.9) en de voorsteldrempel (N6.10) moeten dat inperken.
- De determinismetest gebruikt een vaste klok (de gemeten duur verschilde soms 1 ms).

### N6.1 — Intent Agent v1

- `agent_service/agents/intent.py` met prompt `intent-v1`: hypotheses (concept, label, confidence),
  aannames, `needs_clarification` en eventueel de zin, uit de antwoorden, het getoonde scherm, de
  vorige hypotheses, de afgewezen concepten en een compacte Vocabulary (≤ 150 woorden). Gevalideerd en
  nagekeken (afgewezen/dubbel/onbekend eruit; het woord bij een symbool blijft van dat item, I1);
  terugval op de startconcepten.
- `step(request, llm=…)`: de dienst bouwt bij het starten een `OllamaProvider` uit de config; zonder
  `OLLAMA_URL` alleen regels. De eval-CLI geeft de provider door.
- Gemeten met `gpt-oss:120b-cloud`: 12/12 geslaagd, gemiddeld ±1,1 s per aanroep. Een eerste versie van
  de prompt met Nederlandse sleutels in de invoer viel 4 van de 6 keer door de validatie (het model nam
  de invoersleutels over); de invoer gebruikt nu dezelfde sleutels als het schema.

### N5.4 — scenario-opstelling

- `agent_service/scenarios/`: een gesimuleerde gebruiker met een doel (set concepten) speelt een heel
  gesprek via `step()`; scenario's "bedoelt pijn" en "bedoelt dorst" slagen op de regelgebaseerde
  agents en draaien in de unittests.
- `python -m agent_service.eval --provider fake|ollama [--runs N]`: slagingspercentage, vragen, beurten
  en duur per scenario, en per agent aantal, status en gemiddelde duur. De provider gaat via
  `engine_for` naar de orchestrator; de LLM-agents zelf volgen in N6.

### N5.3 — agent-envelop

- `agent_service/agents/envelope.py`: `AgentResult` (waarde, status success/fallback/failed,
  confidence, aannames, meta met model, promptversie en duur) en `run_agent`, dat eerst het LLM-deel
  probeert en bij elke fout terugvalt op de regels; nooit een exceptie naar buiten. `to_decision()`
  maakt er de `AgentDecision` van. De orchestrator laat elke agent hierdoorheen lopen; faalt de
  Question- of Icon-agent helemaal, dan volgt "Wil je stoppen?" in plaats van een leeg scherm.
- `agent_service/prompts/`: prompts als versiebestanden (`question-v1.md`) met `load_prompt`.
- Fix (N5.2): een HTTP-foutrespons van Ollama wordt nu gesloten (ResourceWarning).

### N5.2 — OllamaProvider (lokaal en cloud)

- `agent_service/llm/ollama.py`: `POST /api/chat` met `format` = JSON-schema en `stream: false`;
  `OLLAMA_URL`, `OLLAMA_MODEL`, optioneel `OLLAMA_API_KEY` (Bearer, alleen over https). Time-out over
  de hele aanroep; code-fences en tekst rond de JSON worden weggehaald; hooguit één nieuwe poging bij
  ongeldige JSON, geen bij time-out of 401.
- Config: `OllamaSettings` (sleutel nooit in `repr`); zonder `OLLAMA_URL` geen LLM. Doorgegeven in
  compose en gedocumenteerd in de `.env`-voorbeelden.
- Tests tegen een nep-HTTP-server: kaal, gefencet, met inleiding, Bearer, nieuwe poging, time-out, 401,
  500, onbereikbaar.

### N5.1 — provider-interface en FakeProvider

- `agent_service/llm/`: `LlmProvider` (één methode `complete_json(system, user, schema, timeout)`),
  `LlmError` met een reden en zonder prompt of antwoord in de melding, en `FakeProvider` met vaste
  antwoorden per aanroep (object, fout of functie) die elke prompt bewaart.

### N4.14 — oude tablet-CSS opgeruimd

- `styles.css` van ±2.090 naar ±1.500 regels: de klassen van de oude gespreksflow (keuzeraster,
  gok-tegel, voorstelscherm, vraagmodus, AI-wachtrij en -status, contexten, review, wizard, …) zijn weg.
- Nieuwe test `styles.test.ts`: elke klasse in `styles.css` moet als klassenaam in een component staan.
  Tablet en beheer gerookt in de browser: ongewijzigd.

### N4.13 — tablet: "Even geen hulp"

- Bij 503 `AGENT_UNAVAILABLE` (of een onbereikbare backend) toont de tablet "Het lukt nu even niet" met
  Opnieuw proberen en Stoppen. Opnieuw proberen herhaalt precies dezelfde handeling: het antwoord
  (beurt én reactietijd) ligt vast op het moment van de tik. Stoppen gaat altijd terug naar het begin.
- Rooktest in Docker: gesprek starten, agentdienst stoppen, "Het lukt nu even niet", agentdienst weer
  starten, opnieuw proberen en door tot Klaar.
- **Fix in het server-image:** de runtime-laag had geen OpenSSL, waardoor Prisma bij elke start een
  andere schema-engine van internet probeerde te halen (zonder DNS startte de server niet). `openssl`
  staat nu in de runtime-laag; `migrate deploy` werkt offline met de engine uit het image.

### N4.12 — tablet: voorlezen

- Met voorlezen aan spreekt de tablet op elk nieuw scherm precies de schermtekst uit (de vraag, "Bedoel
  je: …?") en op Klaar de bevestigde boodschap, met "🔊 Nog eens". De stem komt uit het profiel
  (`speech.ts`: spraakdienst, met de apparaatstem als vangnet); een tik ontgrendelt het geluid.
- `TabletApp` accepteert een `speech`-poort voor tests.

### N4.11 — tablet: "Bedoel je …?" en Klaar

- Het voorstelscherm toont alle pictogrammen van de boodschap naast elkaar, "Bedoel je: …?" en JA/NEE
  op de vaste plekken, met ↩ Terug en ⏹ Stoppen.
- Klaar: de bevestigde boodschap groot in beeld (als kop), zonder JA/NEE of Terug, met "Nieuw gesprek"
  dat direct een nieuw gesprek start. Rooktest in de browser van start tot Klaar.

### N4.10 — bevestigde boodschap

- Migratie `communication_intent`: `CommunicationIntent` (bericht versleuteld, concepten, confidence,
  beurt, `confirmedAt`; één per gesprek).
- Alleen de backend maakt hem aan, alleen na een Observed JA op een `confirm_message`-scherm met
  precies de tekst "Bedoel je: {boodschap}?"; het gesprek wordt `confirmed`. NEE slaat niets op; een
  agent die zelf "bevestigd" meldt wordt genegeerd; "Klaar" zonder of met een andere bevestigde
  boodschap wordt verworpen (I2 in `invariants.ts`: `proposalText`, `checkCompletion`).
- Een gesprek loopt zolang `endedAt` leeg is; een bevestigd gesprek dat eindigt blijft `confirmed`.
- Nagekomen (na de securityronde van N4): twee gelijktijdige JA's op hetzelfde voorstel gaven bij de
  tweede een 500 (unieke sleutel); nu geldt de eerste en krijgt de tweede dezelfde boodschap terug
  (`intents.test.ts` reproduceert de race).

### N4.9 — tablet: start- en binary scherm

- `TabletConversation.tsx`: startscherm met één grote knop ("Ik wil iets zeggen"), binary scherm met
  pictogram (label volgens "tekst tonen"), vraag, ✔ JA links (groen) en ✖ NEE rechts (rood), en
  apart ↩ Terug en ⏹ Stoppen. Hervat een lopend gesprek na herladen; meet de reactietijd en stuurt die
  mee; bij een verouderd scherm (409) haalt hij het actuele scherm op.
- `DeviceApi`: `startConversation`, `currentConversation`, `answerConversation`, `goBack`,
  `stopConversation`. Een beurt heeft nu `canGoBack`, zodat Terug op het eerste scherm ontbreekt.
- Nieuwe taak N4.14: oude tablet-CSS opruimen.

### N4.8 — hervatten

- `GET /communication/sessions/current` (apparaatsessie): `{ current }` met het huidige scherm van het
  lopende gesprek, of `{ current: null }`. Geen agentaanroep; gestopte gesprekken worden niet hervat.

### N4.7 — Terug en Stoppen

- `POST /communication/sessions/:id/back` met `{ turn }`: zet de vorige momentopname exact terug als
  nieuwe beurt (append-only, `previousTurn` wijst verder terug), zonder agentaanroep, met Observed
  `back`. Niet op het eerste scherm of na een verzending (409 `CANNOT_GO_BACK`); een dubbele tik geeft
  409 `STALE_TURN`.
- `POST /communication/sessions/:id/stop`: Observed `stop`, gesprek `stopped`, `204`.

### N4.6 — antwoorden

- `POST /communication/sessions/:id/answer` met `{ turn, answer }`, `{ turn, optionRef }` of
  `{ turn, noneOfThese }` plus `responseTimeMs` (`answerRequestSchema` in shared). Het antwoord moet
  bij het scherm passen (JA/NEE vs. tegels; de ref moet op het scherm staan).
- Observed (type, ref, plek, reactietijd) wordt vóór de agentaanroep vastgelegd, bij de beurt van het
  beantwoorde scherm. Een verouderde beurt of twee antwoorden tegelijk → 409 `STALE_TURN` (ook in de
  database: de unieke beurt wint één keer). JA op "Wil je stoppen?" sluit het gesprek af.

### N4.5 — gesprek starten

- `POST /communication/sessions` (apparaatsessie): stopt een lopend gesprek, start een nieuw, legt
  Observed `start` vast, roept de agentdienst aan met instellingen en de beschikbare Vocabulary, toetst
  de invarianten en slaat momentopname, Presented, Inferred en beslissingen op. De tablet krijgt
  `{ sessionId, turn, presentation }` zonder concepten of ids, met ondertekende afbeeldings-URL's.
- Faalt de agent of schendt hij een invariant: `AgentDecision` `failed`/`invalid`, 503
  `AGENT_UNAVAILABLE`. Geen symbolen: 503 `VOCABULARY_EMPTY`.
- `buildApp({ agents })` om een `FakeAgentClient` in te zetten; `test/agent-helpers.ts` voert een
  eenvoudig nepgesprek. De client controleert nu ook dat de state bij hetzelfde gesprek en dezelfde
  beurt hoort.

### N4.4 — harde invarianten

- `server/src/agents/invariants.ts`: zuivere functie `checkTurnResponse(request, response)` (en
  `assertTurnResponse` met `InvariantViolationError`) voor I1, I4, I5, I6 en I7. Gebaseerd op wat de
  backend zelf verstuurde, niet op de state van de agent.
- I1 aangescherpt in het ontwerp: een `exact` symbool draagt een woord en concept van het item zelf
  (anders is het een stand-in); I4: refs uniek, posities 0…n-1.
- Tests: per invariant een geldig en ongeldig voorbeeld; de echte orchestrator doorloopt een volledig
  gesprek zonder schending.

### N4.3 — client voor de agentdienst

- `server/src/agents/client.ts`: `HttpAgentClient` (`POST /v1/turn`, API-key, time-out
  `AGENT_TIMEOUT_MS` (nieuw, standaard 30 s), antwoord max. 2 MB, zod-validatie, zelfde gesprek en
  beurt), `AgentUnavailableError` (503 `AGENT_UNAVAILABLE`) en `FakeAgentClient` voor tests.
- Tests tegen een lokale nep-HTTP-server: goed antwoord, time-out, ongeldige vorm, 401, 4xx/5xx, te
  groot, onbereikbaar. Gerookt tegen de echte agentdienst.

### N4.2 — provenance-tabellen

- Migratie `provenance`: `PresentationEvent` (Presented), `ObservedEvent` (Observed), `Inference`
  (Inferred) en `AgentDecision` (agentaanroepen), elk in een eigen tabel en nooit samengevoegd.
  Schermtekst, labels, voorgestelde boodschap en inference-payload staan versleuteld; de structuur van
  de opties (positie, representatie, concept) blijft leesbaar voor Experience.
- Repository `server/src/communication/provenance.ts` (`recordPresentation`, `recordObserved`,
  `recordInferences`, `recordDecisions` met `invalid`-markering, `readProvenance` per organisatie en
  gebruiker). Tests: gescheiden opslag, versleuteling, isolatie, cascade.

### N4.1 — sessietabellen

- Migratie `communication_sessions`: `CommunicationSession` (gebruiker, organisatie, status
  active/confirmed/stopped, start, einde, huidige beurt) en `SessionTurn` (versleutelde momentopname van
  state en presentatie per beurt; append-only met `previousTurn` voor een exacte ↩ Terug).
- Repository `server/src/communication/sessions.ts` met versleuteling (bestaande AES-256-GCM) en zod bij
  het lezen. Tests: opslaan/lezen ontsleutelt correct, geen leesbare state in de database, isolatie.

### N3.4 — begeleider: gekoppelde gebruikers en hun instellingen

- `GET /caregiver/users`: de gebruikers waaraan het ingelogde account als begeleider gekoppeld is
  (tenant- en koppelingsgebonden).
- Menu-item "Mijn gebruikers" voor de begeleider (zijn startscherm), met per gebruiker het
  instellingenformulier. Ontdekt bij N0.3: met de vraagmodus verdween het enige scherm waarop een
  begeleider zijn gebruikers zag.
- Tests: een begeleider ziet alleen gekoppelde gebruikers; componenttest; browserrooktest als
  begeleider.

### N3.3 — bewaartermijn per organisatie

- Migratie `organization_retention`: `Organization.retentionDays` (7–365; leeg = de standaard uit de nieuwe
  env-variabele `RETENTION_DEFAULT_DAYS`, 90). `GET/PUT /organization/settings` (alleen de beheerder,
  altijd de eigen organisatie, geaudit).
- Pagina "Organisatie" in de beheeromgeving met de bewaartermijn ("Standaard gebruiken" of een eigen
  aantal dagen). Het opruimen zelf volgt in N14.2.
- Tests: grenzen, rol, isolatie; component- en browserrooktest.

### N3.2 — beheer: instellingenformulier

- Het instellingenformulier toont de nieuwe velden, elk met uitleg in gewone taal: vorm (ja/nee,
  meerdere pictogrammen, laat Intento kiezen), pictogrammen per scherm (alleen bij meerdere
  pictogrammen), manier van vragen (de drie strategieën), maximum aantal vragen en "Leren van eerdere
  gesprekken". Getallen blijven binnen de grenzen.
- De dialoog "Gebruiker toevoegen" toont Experience zichtbaar aan, met uitleg, zodat de beheerder
  bewust kiest (V2).
- Componenttests; rooktest in de browser (aanmaken, instellen, opslaan, herladen).

### N3.1 — nieuwe communicatie-instellingen

- Migratie `communication_settings`: `interactionMode` (`binary`/`multi`/`ai`, standaard `binary`),
  `optionsPerScreen` (2–8, standaard 4), `questionStrategy` (standaard `general_to_specific`),
  `experienceEnabled` (standaard aan) en `maxQuestions` (5–30, standaard 15). `showText`, `speechEnabled`
  en `speechVoice` blijven.
- API + zod: de strategiesleutels en hun uitleg (`QUESTION_STRATEGY_CATALOG`) staan in `shared/`; bij het
  aanmaken van een gebruiker kan `experienceEnabled` meegegeven worden. Een ongeldige opgeslagen waarde
  valt bij het lezen terug op de standaard; ongeldige invoer wordt geweigerd.
- Tests: grenzen, onbekende strategie → 400, begeleider alleen voor gekoppelde gebruikers, sleutels gelijk
  aan het agentcontract.

### N2.14 — bronvermelding

- `GET /vocabulary/attributions` voor iedereen binnen de organisatie (account óf tablet): per bron de
  licentie, maker en symbolen. `auth/account-or-device.ts` bepaalt daarvoor de organisatie van wie belt.
- Pagina "Bronnen" in de beheeromgeving (ook voor de begeleider) en een link "Bronnen" op het startscherm
  van de tablet. Bij Mulberry staan beide licenties (CC BY-SA 4.0 via Global Symbols, CC BY-SA 2.0 UK
  van het project zelf).
- Test: elk CC BY-item staat in de lijst met auteur en bron, ook voor de tablet, niets van een andere
  organisatie; component- en browserrooktest.

### N2.13 — een item intrekken

- `POST /vocabulary/:id/retire` en `/restore`: status `retired`/`approved`; nooit verwijderen. Een
  ingetrokken item valt uit `listAvailableVocabulary` (dus niet meer naar de agentdienst) en wordt niet
  meer geserveerd. Zelfde rechten als bewerken; audit-log.
- In het detailscherm: "Intrekken…" met bevestiging, en "Weer gebruiken"; het overzicht kan
  ingetrokken items tonen (keuze "Toon").
- Tests: ingetrokken item valt uit de beschikbare Vocabulary, rol, isolatie, platformitem; component-
  en browserrooktest (intrekken, terugvinden, terugzetten).

### N2.12 — beheer: item-detailscherm

- Een tegel opent het detailscherm (overzicht → detail): pictogram, licentie, maker en bron met links,
  vertaalstatus, en voor de beheerder het formulier van N2.11 (labels, concepten, contexten als vaste
  keuzes, startconcept, volgorde), met validatie vóór het versturen en de melding van de server bij een
  weigering. Een begeleider ziet het item alleen-lezen.
- Componenttests; rooktest in de browser: tegel openen, synoniem toevoegen, opslaan, terugzoeken.

### N2.11 — een item bewerken

- `PATCH /vocabulary/:id`: labels, concepten, contexten, startconcept en volgorde; een gewijzigd label
  wordt `reviewed`. Alleen de beheerder; alleen items van de eigen organisatie; platformitems alleen de
  platformbeheerder (`403 PLATFORM_ITEM`). Audit-log `vocabulary.update`.
- De vaste contextlijst en de conceptsleutel staan nu in `shared/`.
- Tests: validatie, rol, isolatie, platformitem door een organisatiebeheerder → 403.

### N2.10 — beheer: Vocabulary-overzicht

- Nieuwe pagina "Vocabulary" (menu-item, ook voor de begeleider om te lezen): tegels met pictogram, label,
  licentiebadge en bron, een zoekveld en paginering (24 per pagina). Een machinevertaling is gemarkeerd.
- Componenttest (lege lijst, lijst, zoeken, volgende pagina); rooktest in de browser (Chromium via
  Playwright): 99 symbolen, alle pictogrammen geladen, zoeken op "pijn" geeft 5 treffers.

### N2.9 — `GET /vocabulary`

- Lijst voor de beheeromgeving (beheerder en begeleider, alleen lezen): platform + eigen organisatie,
  gepagineerd, doorzoekbaar op labels/synoniemen/concepten, met licentie en ondertekende afbeeldings-URL's;
  ingetrokken items alleen met `status=retired`. Response gevalideerd met zod
  (`vocabularyListResponseSchema` in `shared/`).
- Tests: rollen (tablet en anoniem → 401), isolatie, paginering, zoeken, het filter `retired`.

### N2.8 — de startset in Docker

- Compose-klus `vocabulary-import` (zelfde image als de server): migreert, downloadt de afbeeldingen naar
  het volume `intento-storage` en seedt de startset (`dist/scripts/vocabulary-import.js`). De server
  start pas als de klus klaar is. Het server-image bevat daarvoor `vocabulary/`; het entrypoint voert een
  meegegeven commando uit na de migratie.
- Gecontroleerd: een verse `docker:up` levert 99 platformitems met afbeeldingen (een ondertekende
  afbeeldings-URL geeft 200); een tweede `up` downloadt niets.

### N2.7 — seed van de startset

- `server/src/vocabulary/seed.ts`: platformitems uit manifest + vertaling + afbeelding, alleen met een
  Nederlandse vertaling én een geaccepteerde afbeelding; licentie (`CC-BY-SA-4.0`), uitgever en bron per
  item; `labelStatus` uit de vertaling; startconcepten in vaste volgorde. Plus het eigen item "geen
  afbeelding" (eenvoudige eigen SVG, licentie `own`).
- Idempotent; bij herseeden blijven in de app nagekeken labels en de status staan. Opgenomen in
  `npm run db:seed`: 99 platformitems (57 Mulberry, 41 zorgsymbolen, "geen afbeelding").

### N2.6 — afbeeldingen downloaden

- `npm run vocabulary:images -- <slug>` downloadt de afbeeldingen uit het manifest naar `STORAGE_DIR`
  (`seed/<slug>/…` plus een `index.json` met type, sha256 en grootte). Alleen https van
  `globalsymbols.com`, zonder redirects, met groottelimiet (ook tijdens het lezen) en time-out; elke
  afbeelding gaat door de afbeeldingscontrole; bestaande bestanden worden overgeslagen; aan het eind een
  overzicht van geweigerde afbeeldingen.
- De afbeeldingscontrole is op drie punten versoepeld na de echte import, zonder externe inhoud toe te
  laten: een kale DOCTYPE zonder interne subset, een ingebedde rasterafbeelding (`data:image/png;…`) in
  `<image>`, en `url(data:…)` in stijlen (ingebedde lettertypen). De SVG-CSP staat `font-src data:` toe.
- Handmatige run: Mulberry 3.438/3.439, Plus Collection 41/42 (de bron weigert er twee met 403); een
  tweede run downloadt niets.

### N2.5 — kernvertaling met de hand

- `vocabulary/translations/mulberry.nl.json` (57 woorden) en `corona-symbols.nl.json` (alle 42
  zorgsymbolen): Nederlands label, synoniemen, concept, context uit de vaste lijst, startconcept en
  status `reviewed`. Startconcepten: pijn, eten, drinken, toilet, moe, blij, verdrietig, hulp.
- Zod-schema voor het vertaalbestand (`server/src/vocabulary/translation.ts`); de test eist dat elk id
  in het manifest bestaat, dat elk concept uniek is (over beide bestanden) en dat precies de acht
  startconcepten gemarkeerd zijn.

### N2.4 — manifest van de Global Symbols-sets

- `npm run vocabulary:manifest -- <slug>` haalt via de openbare API van Global Symbols alle pictos van
  een set op (zod op elke pagina, 300 ms pauze, time-out, alleen https-afbeeldingen) en schrijft
  `vocabulary/sources/<slug>.manifest.json`: id, woordsoort, afbeeldings-URL, formaat, labels in eng/deu/fra,
  plus naam, uitgever en licentie van de set.
- De manifesten van `mulberry` (3.439 pictos) en `corona-symbols` (42) staan in de repo.

### N2.3 — afbeeldingscontrole

- `server/src/vocabulary/image-check.ts`: één controle voor alle binnenkomende afbeeldingen. SVG:
  geldige XML (via `fast-xml-parser`, zonder entiteiten), `<svg>`-root met geldige `viewBox`, geen
  `<script>`/`<foreignObject>`/animatie-elementen/`<image>`, geen `on…`-attributen, geen externe
  `href`/`src`/`url(…)`/`@import`, geen `javascript:`, maximale grootte. PNG/JPEG/WebP op magic bytes.
  Bij weigeren een leesbare reden.
- Unittests per regel met goede en kwade voorbeelden, en een echte Mulberry-SVG als fixture.

### N2.2 — afbeeldingen opslaan en veilig serveren

- Bestandsopslag in `STORAGE_DIR` (in compose het volume `intento-storage`), met atomair schrijven en
  een controle tegen padmanipulatie bij elk gebruik.
- `GET /assets/:id` alleen met een ondertekende, vervallende URL (HMAC met `ASSET_URL_SECRET`, `exp`);
  helper `signedAssetUrl(item)`. Headers: juist content-type, `nosniff`, CORP `cross-origin` (zodat de
  web-app hem mag laden) en voor SVG een CSP zonder scripts en externe resources.
- Env: `STORAGE_DIR`, `ASSET_URL_SECRET` (prod-guard tegen de dev-default), `ASSET_URL_TTL_SECONDS`.

### N2.1 — model `VocabularyItem`

- Migratie `vocabulary_item`: de eigen Vocabulary met labels, concepten en contexten (JSON), woordsoort,
  startconcept, volgorde, status (`approved`/`retired`), labelstatus (`reviewed`/`machine`), bron
  (`seed`/`external`/`own`), licentie- en herkomstvelden en assetvelden. Uniek op
  `(sourceName, sourceRef)`, zodat een import nooit dubbelt.
- `server/src/vocabulary/repository.ts`: `listAvailableVocabulary(orgId)` (platform + eigen organisatie,
  alleen approved), zod-validatie van de JSON-lijsten, een portabele `searchText` en de omzetting naar
  het agentcontract. Isolatietest: organisatie A ziet nooit items van organisatie B.

### N1.7 — de agentdienst in Docker

- `agent-service/Dockerfile` (Python 3.12-slim + pydantic, niet-root, healthcheck op `/health`) en de
  compose-service `agents`: geen `ports:`, `SERVICE_TOKEN` verplicht uit `AGENT_SERVICE_TOKEN`.
- Backend-env: `AGENT_SERVICE_URL`, `AGENT_SERVICE_TOKEN` (verplicht zodra de URL gezet is) en
  `AGENT_ALLOW_INSECURE_HTTP` (https in productie, tenzij op een gesloten netwerk). In `env.ts`,
  `.env.example` en `.env.docker.example`, met tests.
- Gecontroleerd: na `npm run docker:up` wordt `agents` healthy en geeft `/health` vanuit de
  servercontainer 200.

### N1.6 — `POST /v1/turn`

- Het endpoint van de agentdienst: achter de API-key, body gevalideerd met pydantic, `step()` aanroepen,
  `TurnResponse` terug. Fouten in de vorm `{ "error": { "code", "message" } }` (401, 400, 409, 500); een
  validatiefout noemt alleen veldnamen, nooit waarden. Het log bevat alleen gebeurtenis, fase,
  presentatie en duur.

### N1.5 — orchestrator-skelet met regelgebaseerde agents

- `orchestrator.py`: `step(request) -> TurnResponse` als zuivere functie met de fasen `clarify`,
  `confirm_message`, `done` en `stopped`. JA → "Bedoel je: {Label}?"; JA daarop → `done`; NEE op het
  voorstel → die hypothese telt als afgewezen, terug naar `clarify`. Zijn alle startconcepten
  afgewezen, dan "Wil je stoppen?" — nooit een leeg scherm.
- Regelgebaseerde agents (`agents/rules.py`): de terugval van de latere LLM-agents. Elke beurt levert
  agentbeslissingen en een `intent_hypotheses`-inference op.
- Unittests per overgang, plus een herbruikbare testopbouw (`tests/builders.py`).

### N1.4 — dezelfde contracten in zod

- `shared/src/agent-contract.ts`: de contracten v1 in zod (strict objects, snake_case-sleutels),
  geëxporteerd via `@intento/shared`.
- `shared` heeft nu een eigen vitest-suite: de test leest dezelfde `contracts/fixtures/` als pydantic
  en eist hetzelfde oordeel. Daarnaast vergelijken beide kanten hun veldpaden met
  `contracts/fields.json`, zodat ook een optioneel veld aan maar één kant een test laat falen
  (handmatig gecontroleerd).

### N1.3 — contracten v1 in pydantic

- `agent_service/contracts.py`: `TurnRequest`, `TurnResponse`, `SessionState`, `Event` (start, answer_yes,
  answer_no, select_option, none_of_these), `Settings`, `VocabularyEntry`, `ContactEntry`,
  `ExperienceSummary`, `Presentation` + `Option` (`representation: exact|stand_in`), `Inference`,
  `AgentDecision`, `Gap`; allemaal met `contract_version: 1` aan de buitenkant.
- Onbekende velden zijn een fout (`extra="forbid"`): zo heeft het contract geen plek voor schrijfacties
  op de Vocabulary of contacten (invariant I8), en een contact heeft nooit een e-mailveld (V6).
- Voorbeeldbestanden in `contracts/fixtures/valid` en `invalid`; unittests eisen dat elk geldig
  voorbeeld geaccepteerd wordt (en een rondgang overleeft) en elk ongeldig voorbeeld geweigerd.

### N1.2 — Python-kwaliteit in de Definition of Done

- `pydantic` (2.13.5) is een dependency van de agentdienst; mypy draait in strict-modus over
  `agent_service` en de tests (met de pydantic-plugin).
- Nieuwe root-scripts: `npm run check:python` (ruff + opmaak, mypy strict, unittest voor agent-service en
  speech-service) en `npm run audit:python` (pip-audit, beide diensten op 0). Ze draaien via
  `scripts/python.sh` in `agent-service/.venv`; de spraakdienst-afhankelijkheden worden apart in
  `speech-service/.audit-deps` gezet, zodat de audit ook werkt op een systeem zonder `ensurepip`.
- De spraakdienst voldoet aan ruff 0.16 (overbodige `noqa`'s weg, opmaak).

### N1.1 — skelet van de agentdienst

- Nieuwe map `agent-service/` (package `agent_service`) in de stijl van de spraakdienst: stdlib-HTTP-server,
  `config.py` met gevalideerde env (`HOST`, `PORT`, verplicht `SERVICE_TOKEN` van minstens 16 tekens),
  `GET /health` zonder token en een API-keycontrole met constante-tijdvergelijking. README en
  `.env.example` erbij; unittests voor config, auth en `/health`.
- `.venv` van de Python-diensten valt buiten Prettier en ESLint.

### N0.7 — verwijzingen in de blijvende code

- Comments en testnamen in `server/src`, `web/src` en `shared/src` verwijzen niet meer naar het
  verwijderde `DESIGN.md`: waar er een tegenhanger is, staat er nu `INTENTO-NEW-DESIGN §…`; FR-nummers
  en T-nummers in verwijzingshaakjes zijn weg (de oude T-nummers blijven in deze CHANGELOG terug te
  vinden). Ook de laatste resten van de AI-wachtrij (`aiWaitingErrorSchema`, wachtrijvelden op
  `ApiRequestError`, audit-labels van verdwenen acties) zijn weg. Geen gedragswijziging.

### N0.6 — de ai-worker eruit

- `ai-worker/` is verwijderd, met de compose-service `ai-worker` en het profiel `ai`; `docker:down` en
  `docker:logs` hebben `--profile ai` niet meer nodig. `.env.docker.example`, README,
  `docs/architecture.md`, de lint-/format-uitzonderingen en `scripts/stop.sh` zijn bijgewerkt.
- De twee open punten van de oude worker (wisselvallige wachtrijtests; JSON in code-fences) vervallen;
  de les over code-fences komt terug in de OllamaProvider (N5.2).

### N0.5 — database: oude tabellen en velden eruit

- Migratie `drop_old_ai_layer`: de tabellen van de oude AI-laag (`AacSymbol`, `AacConceptRelation`,
  `ConversationSession`, `ConversationStep`, `GeneratedMessage`, `MessageAcknowledgement`,
  `CorrectionEvent`, `ConceptProposal`, `Preference`, `PersonalContext`, `AiJob`, `WorkerToken`) en de
  profielvelden `iconsPerScreen`, `aiLearningEnabled`, `supportMode`, `contextIndicator`,
  `conversationStrategy` en `speechHints` zijn weg. Geen datamigratie (ontwerp §55).
- Het communicatieprofiel bestaat nu uit `showText`, `speechEnabled` en `speechVoice`; de
  gespreksstrategieën verdwijnen uit `shared/`. Een oud profielexportbestand blijft importeerbaar
  (onbekende velden worden genegeerd).

### N0.4 — server: de oude gespreks- en AI-code eruit

- Weg: `server/src/conversation/`, `server/src/ai/`, `server/src/aac/`, de routes voor gesprekken,
  vraagmodus, berichten, conceptvoorstellen, voorkeuren, persoonlijke context, AI-worker,
  worker-tokens, AI-status, gespreksgeschiedenis en de AAC-bibliotheek, plus de meldingsmail aan
  begeleiders, het worker-token-script en de bijbehorende zod-schema's in `shared/`.
- De OpenSymbols-client verhuist naar `server/src/vocabulary/opensymbols.ts`, met eigen unittests
  (ook tegen een lokale nep-server: token, 401-vernieuwing, fout van de zoekdienst).
- Env: alle `AI_*`-variabelen, `NOTIFY_CAREGIVERS_BY_EMAIL` en `AAC_IMAGE_MAX_BYTES` zijn weg;
  `UPLOAD_MAX_BYTES` (standaard 1 MB) is de nieuwe groottegrens voor binnenkomende afbeeldingen.
- Het dashboard telt alleen nog gebruikers en begeleiders; de profielexport bevat alleen nog de
  instellingen. De database zelf blijft in deze taak ongemoeid (N0.5).

### N0.3 — beheer-UI: de oude AI-schermen eruit

- Weg: Begeleiden (vraagmodus + berichtenlijst met afhandelen), Gesprekken, AI-activiteit,
  Conceptvoorstellen, Voorkeuren, Persoonlijke context, Worker-tokens, AAC-bibliotheek en de
  AI-statusbadge, met hun menu-items en API-methodes in de web-client.
- Het instellingenformulier toont alleen nog tekst tonen, voorlezen en stem; de overige velden gaan
  ongewijzigd mee tot ze in N0.5 uit het profiel verdwijnen.
- Het menu toont per rol alleen bestaande pagina's (getest). Een begeleider heeft voorlopig alleen
  "Mijn account"; zijn gebruikersscherm komt terug in de nieuwe taak N3.4.

## [Unreleased] — vóór de herbouw

### Toegevoegd — een verse installatie zonder seed in gebruik nemen

- **`BOOTSTRAP_FIRST_ADMIN_AS_OPERATOR` (standaard uit).** Staat hij aan, dan krijgt de allereerste
  zelfaanmelding op een **lege** database niet alleen zijn eigen organisatie maar ook de
  platform-operatorrol: `isOperator` op het account én `isPlatform` op de organisatie, want los van
  elkaar geven die niets (de dubbele voorwaarde in `auth/operator.ts`). Aanleiding: het seed-script
  draait niet in het productie-image — `prisma db seed` gaat via `tsx`, een dev-dependency die
  `npm prune --omit=dev` eruit haalt — dus zonder dit is er op een gedeployde node geen weg naar de
  operatorconsole behalve met de hand in de database.
- **Waarom standaard uit.** Zelfaanmelding is publiek. Met de vlag aan is de zwaarste rol van de
  installatie voor wie zich als eerste aanmeldt, en op een verse, bereikbare omgeving hoeft dat jij
  niet te zijn. Bedoeld gebruik: aanzetten, jezelf aanmelden, klaar — de vlag ontwapent zichzelf
  zodra er één account bestaat, dus hem daarna laten staan is onschadelijk.
- **Het tellen en het claimen zitten in dezelfde transactie** als het aanmaken van organisatie en
  account. Op SQLite is dat sluitend (één schrijver tegelijk); op PostgreSQL zouden twee
  gelijktijdige áállereerste registraties allebei nul kunnen tellen, en dan hoort er SERIALIZABLE
  bij. Dat staat zo in de code, in plaats van gesuggereerd dat het overal waterdicht is.
- **Het is terug te vinden.** De toekenning gaat naar het audit-log (`auth.register` met
  `grantedOperator`) en levert een `warn`-regel op, juist omdat er geen menselijke handeling achter
  zit. De belofte die overeind blijft: **geen bestaand account kan de rol uitdelen** — er is nog
  steeds geen endpoint, beheerscherm of rol waarmee iemand zichzelf of een ander promoveert. De
  docblock in `auth/operator.ts`, `docs/security.md` en de schema-commentaren zeggen nu precies dat,
  in plaats van "alleen de seed".

### Gerepareerd — de logo's onder een pad-prefix

- **De huisstijlplaatjes werden bij de site-root opgehaald.** `BRAND_ASSETS` in `Brand.tsx` bevatte
  paden als `/brand/intento-logo.png`. Vite herschrijft zulke verwijzingen in `index.html` wel met
  `base`, maar niet in de code — daar is het een gewone string. Onder `https://host/intento/` vroeg
  de app zijn logo's dus op bij `https://host/brand/…`, en dat is precies het soort fout dat niets
  laat merken: de pagina laadt, alleen de plaatjes zijn stuk. De paden hangen nu aan
  `import.meta.env.BASE_URL`.
- **En een test die de hele foutklasse afvangt**, niet alleen deze vijf paden: hij scant de bron op
  string-literals die met `/` beginnen en op een bestandsextensie eindigen. Een assertie op de
  wáárden zou niets waard zijn — onder vitest is `BASE_URL` gewoon `/`, dus daar ziet een fout er
  goed uit.

### Toegevoegd — de spraakdienst achter een reverse proxy te draaien

- **`SPEECH_ALLOW_INSECURE_HTTP` (standaard uit).** De prod-guard eiste `https` voor
  `SPEECH_SERVICE_URL`, wat de dienst onmogelijk maakte in de vorm waarvoor hij gebouwd is: backend
  en spraakdienst als containers op één gesloten netwerk, waar de dienst geen poort publiceert en er
  geen verkeer is dat de machine verlaat. TLS tussen twee processen op dezelfde host is daar een
  certificaat om uit te geven, te roteren en te bewaken zonder dat iemand onderweg meekijkt. De vlag
  zet die eis af voor precies die opstelling — en maakt in ruil `SPEECH_SERVICE_TOKEN` **verplicht**:
  zonder TLS is dat gedeelde geheim het enige dat de dienst nog afschermt.
- **De spraakdienst leest het token ook onder de backend-naam.** Naast `SERVICE_TOKEN` accepteert
  `speech-service` nu `SPEECH_SERVICE_TOKEN`, zodat backend en dienst in een deployment één regel
  in hetzelfde env-bestand delen. Dat is geen kosmetiek: met twee namen voor dezelfde waarde levert
  het vergeten van de ene een dienst **zonder tokencontrole** op, terwijl de backend keurig een
  Bearer blijft meesturen — het soort verschil dat werkt en niets zegt.

### Beveiliging — `npm audit` terug naar 0, en `TRUST_PROXY` op adres in plaats van hop-telling

- **Vijf openstaande advisories opgeruimd.** `fastify` 5.10.0 → 5.12.1, `prisma`/`@prisma/client`/
  `@prisma/adapter-better-sqlite3` 7.8.0 → 7.10.0, en `fast-uri` (3.1.5 → 3.1.7 en 4.1.4) volgt mee
  uit fastify's ajv-keten. Voor `mysql2` is er geen prisma-release die het oplost — ook 7.10.0 pint
  nog `3.15.3` — dus staat er nu een `overrides`-regel naar `^3.24.3`. `npm audit fix --force`
  stelde `prisma@6.19.3` voor: een **major downgrade**, en dus niet gedaan. Prisma 8 is nog een
  release candidate en valt daarmee buiten kernprincipe 3 (nieuwste **stabiele** versie).
- **De `overrides` in de root deden niets, en nu wel.** `@prisma/dev` en `deepmerge-ts` stonden er
  al in, maar de lockfile was ooit vanuit een bestaande `node_modules` opgebouwd en npm heeft de
  overrides toen niet toegepast — `deepmerge-ts` stond nog op de kwetsbare 7.1.5. De lockfile is
  daarom schoon opnieuw opgelost (`rm -rf node_modules package-lock.json && npm install`). Wie een
  override toevoegt en het effect niet terugziet: dát is de reden.
- **`TRUST_PROXY` is geen aantal hops meer.** Dit is geen opruimwerk maar de kern van
  GHSA-3m5p-2c4r-xxw2: een client kan zelf `X-Forwarded-For`-waarden meesturen, en bij een
  hop-telling neemt de app er dan één van de client als "de proxy" — het adres in de rate limiter
  en het audit-log is dan door de bezoeker gekozen. Fastify 5.12.1 heeft de vorm daarom verwijderd
  en de variabele wijst proxy's nu op **adres** aan: `false` (standaard), `true`, `loopback`,
  `uniquelocal` of een IP/CIDR. Een oude numerieke waarde wordt **geweigerd** met de vervanging
  erbij, want fastify zou "1" stil als een adres lezen dat nergens op slaat en dan staat de proxy
  in plaats van de bezoeker in elke logregel. Achter een reverse proxy in hetzelfde container- of
  privénetwerk is `uniquelocal` de juiste waarde.

### Toegevoegd — de mailserver los invulbaar, en de app onder een pad

- **De SMTP-gegevens mogen nu los, zoals een hostingpakket ze opgeeft.** Naast `SMTP_URL` kent de env
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` en `SMTP_TIMEOUT_SECONDS`.
  Aanleiding: een URL onderwerpt het wachtwoord aan percent-codering, en een `/`, `?` of `#` erin is
  een stille misconfiguratie die pas opvalt als er geen mail aankomt. In de losse vorm gaat het
  wachtwoord er letterlijk in. `SMTP_SECURE` is de keuze die een hoster noemt — `tls` (STARTTLS,
  587), `ssl` (implicit TLS, 465) of `none` (25) — en `smtpSettingsFromEnv()` vertaalt hem naar de
  twee nodemailer-vlaggen die er samen over gaan; `SMTP_PORT` leeglaten laat de poort eruit volgen.
  De TLS-garantie is ongewijzigd en geldt voor beide vormen: `requireTLS` staat aan, en een test
  langs de nieuwe route bewijst dat een server zonder STARTTLS geen inloggegevens te zien krijgt.
  `SMTP_SECURE=none` mag daarom alleen zónder `SMTP_USER` — anders weigert de app te starten, net
  als bij beide schrijfwijzen tegelijk of een half ingevulde inlog. Zie
  [ADR-0007](docs/adr/0007-email-verification-and-mail-transport.md).
- **De web-app kan onder een pad draaien in plaats van op de site-root.** `VITE_BASE` (build-time,
  ook als build-arg in `web/Dockerfile`) zet Vite's `base`, zodat `index.html` zijn assets onder dat
  pad opvraagt. De twee plekken die een root-absoluut pad hardcodeerden — de link naar de
  operatorconsole en het tabletadres bij een koppelcode — gebruiken nu `import.meta.env.BASE_URL`,
  en `site.webmanifest` heeft relatieve paden gekregen zodat `start_url`, `scope` en de iconen
  meebewegen. Zonder dit serveert een installatie achter een reverse proxy een blanco pagina met
  404's op `/assets/…`. De routedispatch kon blijven zoals hij was: die matcht al op het eind van
  het pad.

### Toegevoegd — fase 18: de tablet spreekt

- **T18.1 Een eigen spraakdienst naast de AI-worker.** Nieuw: [`speech-service/`](speech-service/README.md),
  een losstaande Python-dienst die met Piper tekst in spraak omzet — **lokaal**, op de CPU, zonder cloud
  en zonder kosten per zin. Gemeten op een i7-6700 zonder GPU: 64–153 ms per zin (real-time factor 0,05),
  ± 120 ms voor een volledige HTTP-ronde. De backend kreeg er een provider-agnostische spraaklaag bij
  (`server/src/speech/`) met een **geheugencache** op `hash(tekst + stem)`: herhaalde zinnen — de vaste
  schermteksten en de AAC-labels — kosten na één keer niets meer (7 ms in de rookproef). De tablet praat
  nooit rechtstreeks met de spraakdienst; dat is geen formaliteit maar autorisatie, want de tekst is
  precies wat de gebruiker wil zeggen. Waarom lokaal, en wat de GPL-3.0-licentie van Piper betekent:
  [ADR-0015](docs/adr/0015-speech-synthesis-piper.md).
- **T18.2 De stem staat in het communicatieprofiel — en de begeleider hoort hem eerst.** Drie velden erbij
  (migratie `speech_output`): spraak aan/uit, de stem, en of er af en toe een gesproken zetje klinkt.
  Standaard staat spraak **uit**, zodat een bestaande tablet niet onaangekondigd begint te praten. In de
  instellingen kiest de begeleider de stem uit een lijst met een **luisterknop** per stem: een stem kies
  je op gehoor, niet op een naam. Beluisteren slaat niets op. De spraakinstellingen verhuizen mee bij
  profielexport (T8.1) — hoe iemand klinkt hoort bij zijn profiel, niet bij deze omgeving.
- **Geen Nederlandse vrouwenstem, en dat staat er ook zo bij.** Piper heeft formeel tien Nederlandse en
  Vlaamse stemmen, maar `nl_NL-mls-medium` (52 sprekers, waaronder álle Nederlandse vrouwenstemmen) en de
  twee `mls_*-low`-modellen komen uit ruwe luisterboekdata: bij het beluisteren sprak geen van die
  stemmen een zin verstaanbaar uit. Ze zijn daarom uit de catalogus gelaten — een onverstaanbare stem is
  voor deze doelgroep erger dan geen stem. De catalogus bevat vier servermodellen (Pim, Alex, Ronnie en
  het Vlaamse Nathalie) plus **"Stem van het apparaat"**: dan spreekt de tablet zelf, wat op Android en
  iPadOS meestal een goede Nederlandse (vaak vrouwelijke) stem oplevert. Zoeken naar een echte
  Nederlandse vrouwenstem staat als T18.5 in `TASKS.md`.
- **T18.3 De tablet leest voor wat er op het scherm staat.** De vraag zodra het keuzescherm verschijnt,
  de voorgestelde zin op het voorstelscherm, de bevestigde boodschap daarna — letterlijk en ongewijzigd,
  met overal een knop **🔊 Nog eens**, want één keer horen is vaak te weinig. Na `↩ Terug` klinkt de vraag
  opnieuw (het is een nieuw scherm), maar een tweede render van hetzelfde scherm blijft stil. Elke tik
  ontgrendelt het geluid, omdat Safari op iOS het pas ná een aanraking toestaat, en een nieuw scherm
  breekt de vorige zin af in plaats van eroverheen te stapelen. Is de spraakdienst onbereikbaar, dan
  neemt de stem van het apparaat het over — beter een minder mooie stem dan stilte.
- **T18.4 Af en toe een gesproken zetje bij de bediening.** Uit de gebruikerstests bleek dat de knoppen
  naast de pictogrammen over het hoofd gezien worden. De tablet zegt daarom af en toe — één keer per vier
  keuzeschermen, nooit twee keer hetzelfde achter elkaar, alleen over knoppen die er op dat moment ook
  echt staan — iets als "Staat het er niet bij? Tik op Staat er niet bij." De keuze is deterministisch
  (een teller, geen toeval), dus in een test na te rekenen en voor de gebruiker een herkenbaar ritme.
  Harde grens: een zetje gaat **alleen over de bediening, nooit over de inhoud** — geen "misschien bedoel
  je drinken?", want dan zou de app namens de gebruiker gaan praten (DESIGN §7.8).

### Toegevoegd — fase 19: alles in Docker (op SQLite)

- **`docker compose up` en de hele applicatie staat er.** Vier images — backend, web-app, spraakdienst
  en AI-worker — met één `compose.yaml` eromheen, een `.dockerignore`, een `.env.docker.example` en
  `npm run docker:build|up|down|logs`. De backend **migreert bij elke start** (`prisma migrate deploy`
  in het entrypoint), zodat een leeg volume vanzelf een werkende database wordt, en draait als
  niet-root. De web-app is een nginx met SPA-fallback: een harde refresh op `/tablet` geeft nu geen 404
  meer. De spraakdienst luistert alleen op het compose-netwerk en krijgt zijn stemmen uit een volume
  dat een eenmalige init-dienst vult; de AI-worker staat achter het profiel `ai`, omdat die eerst een
  token van de backend nodig heeft. Zie [ADR-0016](docs/adr/0016-containers-en-compose.md) voor de
  afwegingen (waarom vier images, waarom Debian en geen Alpine, waarom de stemmen in een volume, en
  waarom de API een eigen poort krijgt).
- **Bewust op SQLite.** DESIGN §9.3 noemt PostgreSQL voor productie, maar schema, migratielijn én
  runtime-adapter zijn nu SQLite; die overstap hoort een eigen zichtbare taak te zijn en staat op de
  "na de MVP"-lijst. De database is dus een bestand op een named volume — en overleeft
  `docker compose down` (nagemeten).
- **Twee valkuilen die het bouwen opleverden**, allebei vastgelegd in commentaar zodat ze niet
  terugkomen: `npm ci --ignore-scripts` (nodig om `prisma generate` uit de dependency-laag te houden)
  zet óók de install-scripts van `argon2` en `better-sqlite3` stil — zonder een expliciete
  `npm rebuild` geeft `/health` vrolijk 200 terwijl de eerste databasequery omvalt. En Compose leest
  zijn eigen variabelen alleen uit het bestand dat je met `--env-file` meegeeft; `env_file:` vult
  alleen de container. Vandaar de npm-scripts.
- **`prisma` is verhuisd van `devDependencies` naar `dependencies`** in `server/package.json`: in een
  container draait de CLI bij élke start (`migrate deploy`), dus daar is het runtime-gereedschap. Dat
  maakt `npm prune --omit=dev` in het image mogelijk — scheelt ± 400 MB.

### Toegevoegd — `npm run stop`

- **Eén commando dat alle processen van het project stopt** (backend, web-app, spraakdienst en
  AI-worker) en de rest met rust laat — Ollama blijft dus draaien. Aanleiding: na een dag ontwikkelen
  bleek er een `tsx watch` van 32 uur oud rond te lopen die zijn poort allang kwijt was, en de
  AI-worker (`python3 ./run.py`) is met geen enkel voor de hand liggend patroon te vinden. Het script
  (`scripts/stop.sh`) eist twee dingen tegelijk voordat het iets stopt: het proces draait **in deze
  repo** én zijn commandoregel is herkenbaar een van ónze processen. Die tweede voorwaarde is er niet
  voor niets — je editor, je terminals en je AI-assistent hebben de projectmap óók als werkmap, en een
  patroon als `tsx` zou een terminal treffen waarin iemand een `.tsx`-bestand bewerkt. Het script slaat
  bovendien zichzelf en al zijn voorouders over, en gebruikt SIGTERM met SIGKILL als laatste redmiddel.

### Gerepareerd — de tablet bleef op het profiel van het moment van laden

- **T18.6 Een gewijzigde stem kwam niet aan op een tablet die al openstond.** In de beheeromgeving stond
  Nathalie geselecteerd, maar de tablet bleef de stem van het apparaat gebruiken. De keten erachter bleek
  gezond: de spraakdienst leverde Nathalie, en `POST /device/speech` gaf voor deze gebruiker een echte
  WAV — ook in een echte Firefox met de apparaatcookie, waar het afspelen gewoon lukte. De tablet haalde
  de apparaatsessie alleen bij het **opstarten** op en werkte dus tot een herlaad met het profiel van dat
  moment. Hij ververst het profiel nu bij "Opnieuw beginnen" en zodra hij weer op de voorgrond komt; lukt
  dat even niet, dan blijft het huidige profiel staan in plaats van het gesprek te onderbreken. Een
  wijziging tijdens een lópend gesprek geldt vanaf het volgende gesprek — een gesprek dat halverwege van
  stem of schermindeling wisselt is verwarrender dan een gesprek dat afmaakt waar het aan begon.
- **De terugval op de apparaatstem was volledig stil.** Mislukt de serverstem (spraak staat uit, backend
  onbereikbaar, of de browser laat het geluid nog niet toe), dan neemt de stem van het apparaat het over —
  goed gedrag, maar zonder enig spoor. De tablet logt nu waaróm hij terugvalt, zodat "hij pakt mijn stem
  niet" te onderscheiden is van een spraakdienst die niet draait.

### Gerepareerd — spraakuitvoer, direct na de eerste echte opstelling

- **Een afgebroken download van een stemmodel liet de verbinding wegvallen.** Bij de eerste opstelling
  bleek `nl_NL-pim-medium.onnx` half gedownload (39 van 63 MB) — net de standaardstem. Piper gooide bij
  het laden een `onnxruntime`-fout die ongefilterd uit de handler kwam: de dienst verbrak de verbinding,
  de backend zag dat als een **time-out** en de begeleider las "Beluisteren lukte niet. Draait de
  spraakdienst?" — terwijl die gewoon draaide. Drie dingen aangepast: de dienst vangt een onlaadbaar
  model af als een gewone fout en zegt erbij dat de download waarschijnlijk is afgebroken (mét het
  commando om hem opnieuw op te halen); de backend houdt een echte time-out (504) apart van een
  onbereikbare of onverwacht antwoordende dienst (502 mét reden); en de beheer-UI toont die reden in
  plaats van alleen "lukte niet". Wie een fout leest, hoort te weten waar hij moet zoeken.
- **`speech-service/README.md`** heeft er een sectie "Als het niet werkt" bij, met een controle die alle
  stemmodellen in één keer probeert te laden.

### Toegevoegd — fase 17: ontwerp van de web-applicatie

- **T17.1 Eén huisstijl, en een menu in plaats van tien tabs.** De beheeromgeving zette al haar
  bestemmingen als één rij gelijkwaardige tabs onder de paginatitel: "Worker-tokens"
  (platformonderhoud) stond even groot en even dichtbij als "Gebruikers" (dagelijks werk), en op een
  tablet in staande stand liep die rij over meerdere regels door. Er is nu één schil om elke ingelogde
  pagina (`AppShell`): een **zijbalk** met het menu gegroepeerd naar wat iemand komt doen (Overzicht,
  Communicatie, Organisatie, Platform, Account) en een kopbalk met de paginatitel, één regel uitleg en
  rechts wie je bent. Op een smal scherm schuift de zijbalk weg achter een menuknop — de knoppen
  blijven in de DOM, zodat toetsenbord en schermlezer hetzelfde menu houden. Elke pagina bepaalt
  daardoor nog maar twee dingen: hoe hij heet en wat erin staat; de twintig regels herhaalde kop-JSX
  per pagina zijn weg (en daarmee het uiteenlopen ervan).
- **Het logo is nu bruikbaar op het web.** Het bronlogo was 1254×1254 px en 925 kB met een **witte**
  achtergrond — een wit blok op elk gekleurd vlak, geen favicon, geen liggende variant voor een
  kopbalk. `web/brand/generate-assets.py` leidt daar reproduceerbaar de bestanden uit af die de app
  wél kan gebruiken: transparant beeldmerk (met de witte waas van de randpixels weggehaald, zodat het
  ook op een donkere ondergrond schoon staat), een liggende variant, het volledige logo, een witte
  tegel voor donkere ondergronden, favicons en app-iconen plus `site.webmanifest`. De kleuren van de
  interface komen nu uit het logo; het belverloop keert alleen terug als dunne accentlijn.
- **De tablet zegt wie hij is en voor wie.** De gebruikersapp heeft een vaste kopbalk: linksboven het
  beeldmerk met "Intento", rechtsboven de naam van de gebruiker en de AI-indicator. Op een gedeeld
  apparaat was geen van beide te zien. Bewust klein en grijs, en zonder kop-element — de vraag op het
  scherm blijft de enige `<h1>`.
- **T17.2 Gebruikersbeheer werkt nu als overzicht → detail.** Het scherm stond in twee smalle
  kolommen: links de gebruikerslijst mét de formulieren voor aanmaken, importeren en
  begeleider-accounts, rechts de zeven detailpanelen van wie je geselecteerd had. Zolang er niemand
  geselecteerd was stond de halve pagina leeg te wachten, en zodra dat wél zo was moest je een wizard
  van vijf stappen in een kolom van een halve pagina invullen. Nu: een **lijst over de volle breedte**
  waarin elke regel al zegt hoe het profiel staat (pictogrammen per scherm, gespreksstrategie), en één
  gebruiker openen geeft hem een **eigen scherm** met alle panelen naast elkaar. Aanmaken en
  importeren zitten achter een knop met een **dialoog**, de organisatielogins achter een tabblad, en
  verwijderen staat apart onderaan het detailscherm met uitleg over wat er weggaat.
- **T17.4 Het scherm van één gebruiker staat nu in onderdelen.** T17.2 zette de panelen naast elkaar
  in twee kolommen; daarmee bleef elk paneel een halve pagina breed, terwijl juist hier de
  instellingen met uitleg per keuze, de contextwizard van vijf stappen en de begeleiderslijst staan.
  Bovenaan staat nu een keuzebalk — Instellingen · Begeleiders · Persoonlijke context · Voorkeuren ·
  Tablet · Profiel & verwijderen — en er is één onderdeel tegelijk in beeld, op een breedte waarop de
  tekst te lezen en het formulier in te vullen is. De balk is dezelfde component als op het
  gebruikersoverzicht (Gebruikers/Logins) en vouwt op smalle schermen om in plaats van onderdelen
  buiten beeld te schuiven.
- **Het begeleiderspaneel zegt nu wat koppelen betekent.** Het was een rijtje kale aanvinkvakjes; er
  staat nu bij dat een gekoppelde begeleider de bevestigde boodschappen van deze gebruiker ziet en
  hem vragen kan stellen, met de teller "x van y gekoppeld" en een aanklikbare regel per begeleider
  in plaats van een vakje van een paar pixels. De verwijzing naar het aanmaakpaneel wees nog naar de
  plek van vóór T17.2.
- **T17.3 De AAC-bibliotheek toont pictogrammen als tegels.** Dezelfde herindeling, maar met een
  tegelraster: een bibliotheek van pictogrammen scan je op beeld, niet op een lijstje tekst. Het label
  staat altijd bij het pictogram — beeld is nooit de enige aanduiding (DESIGN §5.1). Eén symbool
  openen geeft bewerken, pictogram, OpenSymbols-zoeken en relaties op één scherm; "Nieuw symbool" zit
  achter dezelfde dialoog.
- **Dialoogvensters zijn met toetsenbord en schakelbediening te bedienen.** Nieuwe `Modal`: de focus
  gaat naar de dialoog, Tab loopt erbinnen rond, Escape sluit, en bij het sluiten gaat de focus terug
  naar de knop die de dialoog opende — anders staat een schakelgebruiker daarna weer boven aan de
  pagina.
- **Een begeleider kan bij zijn eigen account.** De vraagmodus was zijn énige weergave, waardoor
  "Mijn account" — en dus het wisselen van zijn tijdelijke wachtwoord — alleen bereikbaar was via een
  paneel onder aan diezelfde pagina. Hij krijgt nu een kort menu: Begeleiden en Mijn account. Het menu
  is geen beveiliging: de server weigert onveranderd elke call buiten zijn rol.

### Gerepareerd — fase 17

- **T17.5 In de dialoog "Gebruiker toevoegen" was niet te typen.** Na elke letter sprong de focus uit
  het naamveld. Het focus-effect van `Modal` hing aan `onClose` — bij elke hertekening een nieuwe
  functie — en de waarde van het veld staat in de paginastate, dus hertekende de pagina bij elke
  aanslag. Het effect ruimde zichzelf dan op (focus terug naar de openende knop) en draaide opnieuw
  (focus naar de dialoog). De focusafhandeling draait nu eenmalig.
- **De focus kwam na het sluiten van een dialoog op `body` terecht.** Zichtbaar in Firefox, niet in de
  tests: onder `<StrictMode>` draait React elk effect twee keer, en bij de tweede ronde stond de focus
  al ín de dialoog — die werd zo zelf onthouden als "de knop die de dialoog opende". De opener wordt nu
  tijdens het hertekenen vastgelegd, vóór de focus verplaatst wordt, en teruggezet nadat de dialoog uit
  de DOM is (de browser zet de focus daarbij zelf op `body`). Een schakel- of toetsenbordgebruiker
  staat na het sluiten dus weer op de knop waar hij vandaan kwam, niet boven aan de pagina.

### Gerepareerd — vierde gebruikerstest

- **Koppelen weigerde de attributie van OpenSymbols: "licenseUrl: Alleen https-URL’s zijn
  toegestaan."** Licentie- en auteurspagina's van pictogrambibliotheken staan nog volop op plain
  `http` (bv. `http://creativecommons.org/licenses/…`), terwijl `attachOpenSymbolsRequestSchema` voor
  álle URL's `https` eiste. Die eis hoort bij de **afbeeldings**-URL, die de server zelf ophaalt
  (SSRF); attributie-URL's worden alleen als link getoond. Nieuw `webLinkUrlSchema` (`http(s)`-only)
  voor `licenseUrl`/`authorUrl`/`sourceUrl`; `imageUrl` blijft `https`-only mét SSRF-guard.
  Tegelijk het gat aan de andere kant gedicht: de zoekproxy en het uitlezen uit de db gaven deze
  URL's ongefilterd door terwijl de beheer-UI ze als `href` toont — een `javascript:`-waarde van de
  externe dienst had zo een XSS kunnen worden (o.a. via een AI-aangedragen concept, dat de attributie
  buiten het koppelverzoek om opslaat). Niet-`http(s)` valt nu weg naar `null` bij zoeken én lezen.

- **Zoeken in OpenSymbols mislukte met "OpenSymbols is niet bereikbaar".** De API laat ontbrekende
  attributie niet weg maar stuurt expliciet `null` (o.a. `source_url`); het rauwe zod-schema stond
  alleen `string | undefined` toe, dus één `null` liet de hele zoekopdracht falen (502). Alle rauwe
  velden zijn nu `.nullish()` — `null` wordt net als een ontbrekend veld gesaneerd naar `null` in het
  interne resultaat. De `https`-only sanering blijft ongewijzigd.

- **T10.10 Het voorstel kwam te vroeg en ❌ Nee gooide de keuzes van de gebruiker weg.** Gemeld: het
  gesprek kwam uit op "Ik wil iets warms eten." — niet concreet — en ❌ Nee leidde daarna naar "Wat wil je
  drinken?" terwijl de gebruiker juist iets over het eten wilde zeggen. Nagespeeld met een draaiende
  server; het bleken drie losse defecten:
  - **De voorsteldrempel keek alleen naar een getal.** Voorstellen mag nu pas als de laatste keuze géén
    onverkende verfijningen meer heeft. Zeker weten dát iemand wil eten is niet hetzelfde als weten wát;
    de zinsgenerator behandelde `eat`/`drink`/`do-activity` al als structurele tussenstappen die uit de
    zin wegvallen. Een eindconcept levert onveranderd een voorstel op.
  - **❌ Nee beschuldigde systematisch de eerste keuze.** Regressie uit T10.3: `ConversationStep.
    confidence` werd daar de zekerheid waarmee de vraag werd *aangeboden*, en die stijgt gaandeweg — dus
    was de eerste stap vrijwel altijd de "laagste". Gereproduceerd: route `want > eat`, ❌ → beide keuzes
    weg en `want` permanent uitgesloten. ❌ rolt nu precies één stap terug; nogmaals ❌ rolt de volgende
    terug. De heranalyse-op-zekerheid en het kantelpunt uit T10.8 vervallen daarmee: elke poging de
    foutstap te *bepalen* wees de keuze aan die de gebruiker juist het bewustst had gemaakt (DESIGN §3.4).
  - **Retrieval matchte midden in een woord.** Bij "Wat wil je eten?" stond er een **voet** tussen de
    opties, want "eten" zit in "voeten" — en "warm", via het synoniem "zweten". Retrieval matcht nu op een
    woordbegin, zodat "hand" nog steeds "handen" vindt maar "eten" geen "voeten" meer.
  - **De safety-laag miste een buigingsvorm.** `hot` draagt label "Warm" en synoniem `warm`, maar de
    check matchte op hele woorden — dus glipte "warms" erdoor en kwam een concept dat de gebruiker nooit
    koos tóch in zijn boodschap (§7.8). De scan herkent nu ook korte Nederlandse uitgangen.

- **T12.3 Een verfijnronde was onzichtbaar in de terugblik.** Ontdekt bij T12.1: het gemelde
  brood/beleg-gesprek kwam er netjes uit, maar de ❌ die de wending veroorzaakte stond er niet in —
  `corrections` was leeg. Dat klopte met T10.12 (de eerste ❌ rolt bewust niets terug, zodat de gebruiker
  niets kwijtraakt), maar het maakte de terugblik onvolledig op precies het punt waar een begeleider wil
  weten waarom het gesprek een andere kant op ging: tussen "Brood" en "Wil je er iets op?" leek de AI
  spontaan van vraag te veranderen. De verfijnronde wordt nu vastgelegd als **gebeurtenis zonder
  gevolg**: een `CorrectionEvent` met `type: 'refine_round'` en `rejectedConcept: null`.
  - **Waarom vastleggen en niet afleiden.** `ConversationSession.refinedAtStep` leek de goedkopere weg,
    maar die vlag is zelf-invaliderend: `clearPendingOffer` zet hem op `null` zodra de gebruiker verder
    kiest. In precies het gemelde geval — de gebruiker koos ná de verfijnronde gewoon door — zou er dus
    niets meer te herleiden zijn. Dit is de goedkoopste vorm die de gebeurtenis écht bewaart: geen nieuw
    soort opslag, één rij in een tabel die er al is.
  - **Het `null` is de waarborg, niet alleen de inhoud.** `CorrectionEvent.rejectedConcept` is nullable
    geworden en `loadRejections` haalt alleen rijen **mét** een concept op. Een verfijnronde kan daarmee
    per constructie niets uitsluiten — T10.12 blijft gelden omdat de query het afdwingt, niet omdat een
    comment het belooft. `refine_round` is bovendien niet postbaar door een client: de request-enum blijft
    `wrong_guess`/`no_fitting_option`, alleen de terugblik kent het derde type.
  - De beheerpagina toont het als "❌ Nee — de AI ging eerst verfijnen; niets teruggerold of uitgesloten",
    en `correctionCount` telt de verfijnronde mee: ook dát was een druk op ❌.

- **T16.3 De gok als tegel — er een spel van maken.** Bij `guess` is de zekerste aandraging van de AI
  per definitie een gok. Die verschijnt nu als **gemarkeerde tegel tussen de gewone pictogrammen**
  ("🎯 Ik denk: …") in plaats van als vroeg boodschapvoorstel. Dat verschil is niet cosmetisch: een
  voorstel dat de route overslaat legt de onzekerheid van de AI bij de gebruiker — hij moet "klopt dit?"
  beantwoorden over iets wat hij nooit koos (DESIGN §2). Als tegel is het een aanbod dat hij zelf
  aantikt; daarna is het een gewone keuze en geldt de voorsteldrempel ongewijzigd. De regel van T15.1
  wordt er bewust **niet** voor versoepeld: die komt uit de zevende gebruikerstest.
  De markering is een verwijzing naar één van de aangeboden opties (`question.guess`), geen tweede
  kanaal — een nieuwe invariant over álle strategieën bewaakt dat een gemarkeerde gok altijd ook echt
  tussen de opties staat. Ze reist mee in het vastgelegde aanbod en op de stap
  (`ConversationStep.guessConcept`, migratie), zodat `↩ Terug` hetzelfde scherm teruggeeft in plaats van
  de tegel stilletjes in een gewone optie te veranderen.

- **T16.2 Strategie `guess`: de AI draagt alles aan.** De vraag was of Intento een aanpak aankan waarin
  de AI *raadt* wat de gebruiker wil zeggen. Dat vroeg geen nieuwe architectuur: die modus bestaat al als
  **vrije ronde** (T10.13) — geen optielijst, wél het pad en de negatieve context, en de opdracht om zelf
  begrippen aan te dragen. Ze was alleen een noodgreep in plaats van een werkwijze. De nieuwe strategie
  heeft precies één onderscheidende parameter: **geen enkele kandidatenbron**, waardoor elke beurt na de
  eerste keuze een vrije ronde is, plus een promptdoel dat om een **gok** vraagt in plaats van om een
  vraag. Geen nieuw codepad, dus de invariant-suite draait er automatisch overheen — inclusief het
  startscherm, dat zijn intentiecategorieën houdt (de richting kiest de gebruiker, §3.1).
  Daarvoor moest één uitzondering weg: de **tijdsbepalingen** (T14.4) werden buiten de strategie om aan de
  kandidaten toegevoegd op een afgeronde vraagroute. Daardoor was `available` daar niet leeg en viel de
  vrije ronde juist stil op de route waar hij het hardst nodig is. `time` is nu een gewone
  strategiebron die in de vier bestaande strategieën vooraan staat — dezelfde volgorde als voorheen, maar
  nu leesbaar in de strategie in plaats van als regel in `candidates.ts`. De invariant "een strategie kan
  het scherm niet leegmaken" toetst niet langer of er bronnen zíjn (dat is bij `guess` juist de bedoeling)
  maar wordt per strategie echt gedraaid.

- **T16.1 Deduplicatie zoekt semantisch, niet alleen op naam.** Retrieval was tot nu toe een
  **voorfilter**: het model kreeg bestaande concepten voorgelegd en koos daaruit. Zodra het er zelf één
  mag aandragen — de vrije ronde (T10.13) — bereikte het de bibliotheek nog maar via naamcollisie op
  sleutel, label of synoniem. Zegt het model "boterhammen" waar de bibliotheek "brood" (synoniem
  "boterham") kent, dan ontstond er een tweede broodbegrip: precies het bijna-duplicaat dat §7.6 trap 1/2
  moet voorkomen. De zoekindex staat nu aan **beide** kanten van het model: nieuwe module
  `aac/search.ts` (dezelfde index als de kandidatenselectie) en een extra trap 2½ in de validatielaag —
  geen exacte treffer? dan eerst semantisch zoeken, en pas daarna een nieuw concept. De drempel waarboven
  "lijkt op" als treffer geldt is een benoemde constante met onderbouwing: verbuigingen vallen samen
  ("boterhammen" → brood), maar een term die een bestaand begrip alleen *bevat* ("warme soep") niet — dan
  zou de gebruiker een woord kwijtraken dat hij net aangeboden kreeg. Raakt geen enkele strategie in zijn
  parameters; een woord dat écht nieuw is loopt onveranderd naar trap 3.

- **T15.1 "Kinderen hebben" is niet hetzelfde als "te vaag".** Zevende gebruikerstest: de route
  🎯 Iets willen → 🚶 Iets doen → 🌳 Buiten → 🚶‍♀️ Wandelen leverde geen voorstel maar de vraag *"Wat wil je
  eten?"*. Nagemeten: de zin stond er al ("Ik wil buiten wandelen.") en de kandidaten klopten ook (hond,
  park, mama, papa, begeleider). Wat er misging zat in de voorsteldrempel van T10.10, die keek naar
  *"heeft dit concept kinderen?"*. Die regel is gemaakt voor "Ik wil eten." — waar `eten` een verzamelnaam
  is die in de zin wégvalt — maar `wandelen` is geen categorie: dat het toevallig kinderen heeft, maakt de
  boodschap niet vaag. De drempel eist nu alleen verfijning als de route eindigt op een **categorie**:
  een intentie, een vraagwoord of een verzamelnaam. Eén bron van waarheid, want dat is exact dezelfde
  verzameling als "valt weg in de zin" — een concept dat de zin niet haalt, kan de boodschap ook niet
  dragen. Verfijnen blijft mogelijk (de zekerheidsdrempel beslist), maar is geen voorwaarde meer.
  Daarnaast een promptregel: de gestelde vraag moet over de laatste keuze en de aangeboden opties gaan —
  "Wat wil je eten?" bij de opties mama/papa/hond/park is een vraag die nergens op slaat.

- **T14.1/T14.2/T14.4 Een vraag is geen wens.** Zesde gebruikerstest: met ❓ Een vraag stellen → ❔ Wat? →
  🍽️ Eten wilde de gebruiker *"Wat eten we vandaag?"* vragen. Dat liep op drie plekken vast, en alle drie
  kwamen ze uit dezelfde aanname — élke route is een wens.
  - **De zin was stuk.** De route leverde letterlijk `"Ik wil iets vragen over wat? eten."`: het
    vraagwoord werd als lijdend voorwerp aan het wens-frame geplakt. Er is nu een **vraagframe per
    vraagwoord** dat het onderwerp ín de zin opneemt — "Wat eten we?", "Waar is het toilet?", "Mag ik
    televisie kijken?" — met een tijdsbepaling die vloeiend meeloopt ("Wat eten we vandaag?") en een
    tweede inhoudelijk begrip dat er telegrafisch achter komt in plaats van er onzin van te maken.
  - **De AI mócht de goede zin niet maken.** `MESSAGE_GOAL` schreef de **ik-vorm** voor. Een vraagroute
    krijgt nu een eigen doel dat om een vraagzin vraagt; de wens-route houdt de ik-vorm.
  - **Het gesprek kwam er nooit uit.** "Eten" heeft zes kinderen, dus de voorsteldrempel (T10.10) eiste
    verfijning en de gebruiker kreeg "wat wil je eten?". Een vraag mét onderwerp geldt nu als **af**;
    verfijnen mag, maar hoeft niet. Een wens blijft wél doorvragen.
  - **"Vandaag" bestond niet.** Nieuwe categorie `time` met vandaag/vanavond/morgen/straks/nu. Bewust
    **zonder** boomrelaties: onder een vraagwoord zouden ze naast het onderwerp komen te staan ("Wat is
    vandaag?"), onder een onderwerp zouden ze ook in een wens opduiken ("Ik wil vandaag."). Ze verschijnen
    als kandidaat zodra een vraag een onderwerp heeft — chronologisch geordend en vóór de boomkinderen,
    want wie "Wat eten we?" preciezer wil maken bedoelt "vandaag", niet "brood".

- **T14.3 De prompt sprak zichzelf tegen.** Gemeld in de zesde gebruikerstest: op de route "Een vraag
  stellen → Wat? → Eten" leverde 🤷 "Staat er niet bij" opties als **nagel** op. Geen modelfout — de prompt
  bevatte drie instructies die elkaar uitsloten: de vrije-ronde-opdracht (T10.13) zei *"blijf bij het
  onderwerp van het pad"*, de `calm`-strategie *"maak geen onverwachte sprong naar een ander onderwerp"*,
  en de AAC-regel bij `no_fitting_option` zei *"je zocht in de verkeerde richting: verleg de invalshoek"*.
  Welke het model volgde, was een gok. Die regel is nu: een afwijzing betekent dat het **woord** er niet
  bij stond, niet dat het **onderwerp** fout is — blijf in dezelfde gesprekslijn en draag daarbinnen
  andere concepten aan; van onderwerp wisselen mag pas na herhaalde afwijzing op hetzelfde punt. Ook het
  doel (`GOAL`) is bijgesteld. Nieuw is een invariant-test per strategie die de tegenspraak niet meer
  terug laat komen, plus een end-to-end test die bewijst dat de juiste opdracht in de échte flow bij het
  model aankomt. De uitsluiting zelf blijft ongewijzigd: opties die de gebruiker heeft gezien en afgewezen
  opnieuw aanbieden zou erger zijn dan een lege lijst met een duidelijke opdracht.

- **T13.3 Afhandelen: wat is er al opgepakt?** De berichtenlijst uit T13.1 groeide alleen maar: na een dag
  wist een begeleider niet meer wat nieuw was en wat al was opgepakt, en een lijst die je niet kunt
  afwerken lees je op den duur niet meer. Nieuw zijn `POST` en `DELETE
  /caregiver/messages/{id}/acknowledge` plus een knop **Opgepakt** (en **Toch niet**) in de lijst, met een
  filter *"alleen nog niet opgepakt"*. De afweging expliciet, want dit is begeleiders-administratie en
  geen uitspraak van de gebruiker: het aftekenen staat in een **eigen tabel** (`MessageAcknowledgement`)
  naast `GeneratedMessage` in plaats van als kolommen erin, zodat de boodschap na het bevestigen per
  constructie nooit meer beschreven wordt (DESIGN §2). De stand is **gedeeld** (één aftekening per
  boodschap, wie het eerst tekent blijft staan): de vraag is "is hier al iets mee gedaan", niet "heb ík
  het gezien" — twee begeleiders die allebei denken dat de ander het oppakt was het echte risico, en een
  "nieuw sinds je vorige bezoek"-markering per account zou dat niet oplossen én wissen wat je nog moest
  doen precies op het moment dat je even keek. Aftekenen **verbergt niets**: de API blijft alles
  teruggeven en het filter is een hulpmiddel van de kijker. Terugdraaien mag ook een collega (misklik), de
  grens is dezelfde als bij de lijst (tenant + koppeling; daarbuiten `404`, geen `403`). Zie ADR-0014.

- **T13.2 Een seintje per e-mail.** De berichtenlijst helpt alleen als de begeleider kijkt; bij het
  bevestigen gaat er nu een mail naar elke **gekoppelde** begeleider dat er iets nieuws is. Drie bewuste
  keuzes: de **boodschap staat niet in de mail** (e-mail is een extern kanaal — andermans servers,
  postvakken, indexering — en de zin hoort achter authenticatie, §9.4; er staat alleen wie er iets zei en
  wanneer), de verzending is **nooit blokkerend** (faalt de mailserver, dan slaagt het bevestigen gewoon
  en wordt de fout gelogd — de gebruiker heeft zijn boodschap al gegeven), en het is **uit te zetten** met
  `NOTIFY_CAREGIVERS_BY_EMAIL=false`. Een beheerder zonder koppeling krijgt niets. Nieuwe env
  `APP_BASE_URL` voor de link in de mail (https verplicht in productie).

- **T13.1 De begeleider ziet wat de gebruiker zei.** Een gebruiker kwam tot een zin, bevestigde hem — en
  dan gebeurde er niets: de boodschap bleef staan in de database en op zijn eigen tablet, en wie hem
  moest horen, moest toevallig meekijken. Daarmee stopte de communicatie precies op het punt waar ze zou
  moeten beginnen. Nieuw `GET /caregiver/messages` plus een berichtenlijst op de pagina **Begeleiden**
  (het enige scherm dat een gewone begeleider heeft): elke bevestigde boodschap, nieuwste eerst, met het
  tijdstip, de naam van de gebruiker en — bij een antwoord in vraagmodus — de vraag waarop geantwoord is.
  Geen nieuwe opslag: `GeneratedMessage` bewaarde dit al. Een afgewezen voorstel wordt nooit opgeslagen en
  bereikt dus ook nooit een begeleider (§3.6). Een CAREGIVER ziet uitsluitend gekoppelde gebruikers, en de
  filtering zit in de query zelf zodat er per constructie niets langs de koppeling kan glippen.

- **T12.2 AI-activiteit per gesprek.** Het activiteitscherm toonde losse jobs; wat ontbrak was de draad.
  `AiJob` krijgt een `sessionId` (nullable, bewust **geen** foreign key — de wachtrij is
  platform-infrastructuur en mag niet aan de tenant-boom hangen), gezet bij het inschakelen naast de al
  meereizende strategie. Nieuw zijn `GET /admin/ai/conversations` en `/admin/ai/conversations/{id}`: kies
  een gesprek en zie de opeenvolgende beslissingen — vraag, voorgestelde opties, zekerheid, strategie,
  duur en fouten — met daarnaast de route die de gebruiker liep. De prompt komt er nog steeds nooit uit,
  en de geformuleerde boodschap ook niet: die is communicatie-inhoud en blijft bij T12.1, binnen de
  organisatie.

- **T12.1 Een gesprek van begin tot eind terugzien.** Na elke gebruikerstest is de vraag dezelfde: wat
  gebeurde er nou eigenlijk? Dat was alleen te reconstrueren uit losse brokken — het AI-activiteitscherm
  toont losse jobs zonder te weten bij welk gesprek ze horen, de tablet toont alleen het hier-en-nu, en de
  rest zit in de server-logs. Nieuwe tab **Gesprekken** in de beheeromgeving: kies een gebruiker, kies een
  gesprek, en lees per stap de gestelde vraag, de aangeboden pictogrammen in de getoonde volgorde en de
  keuze van de gebruiker — met de correcties op hun plek en de bevestigde boodschap eronder.
  Er wordt **niets extra's opgeslagen** om dit mogelijk te maken: `ConversationStep` bewaart de vraag, het
  aanbod (T10.3) en de keuze al. Nieuw zijn `GET /admin/users/{id}/conversations` en
  `GET /admin/conversations/{id}`. Dit is de eerste beheerweergave met communicatie-inhoud en heeft daarom
  de strengste grens: ADMIN én CAREGIVER, tenant-gefilterd en voor een begeleider beperkt tot gekoppelde
  gebruikers; een onbekend gesprek en een gesprek uit een andere organisatie geven dezelfde `403`, zodat
  het bestaan van een gesprek niet uit de statuscode te lezen is.

- **T10.13 De vrije ronde is weer echt vrij.** Vervolg op T10.12, gemeld in de vijfde gebruikerstest.
  Op het pad "Iets willen → Eten → Brood" leverde ❌ Nee terecht "beleg" op, maar daarnaast stonden
  "pijn", "nagel" en "er is iets aan de hand" op het scherm, en na de keuze "beleg" sloeg de vraag om
  naar "Wat wil je drinken?" — terwijl elk model bij dat pad moeiteloos kaas of chocopasta bedenkt.
  De oorzaak zat niet in het model maar in wat wij het gaven: T10.12 vulde een leeg kandidatenpunt met
  een greep uit de bibliotheek, verdeeld over alle categorieën, en de AAC-regels zeggen "kies bij
  voorkeur uit de aangeboden opties". Zo werd van "verzin een verfijning" ongemerkt "kies iets uit deze
  lijst" — en werd het scherm daarna ook nog tot `minOffered` aangevuld uit diezelfde greep.
  Nu krijgt de AI op zo'n punt **géén optielijst** en wél een expliciete opdracht: draag zelf twee tot
  vijf concrete begrippen aan die de laatste keuze preciezer maken, en blijf bij het onderwerp van het
  pad. Het scherm toont dan uitsluitend wat de AI aandroeg. De bibliotheek blijft bereikbaar zonder die
  lijst: noemt het model "mama", dan zet de validatielaag dat om naar het bestaande symbool (§7.6 trap
  1/2), dus er ontstaat geen tweede, bijna-identiek woord.

- **T10.12 Vastlopen op een AI-begrip, en ❌ Nee dat te vroeg terugrolde.** Drie meldingen die op
  hetzelfde neerkomen — de gebruiker kan niet verder:
  - **Een vers AI-concept was meteen het einde.** "Compliment" was een goede vondst van de AI, maar zo'n
    concept heeft per definitie geen kinderen in de relatieboom; dat las de beslissingslaag als eindconcept
    en sprong naar het voorstelscherm, waarna de gebruiker niet meer kon zeggen wíe hij lief vindt.
    "Geen kinderen" telt nu alleen als beslissing wanneer een beheerder ernaar heeft gekeken. Bij een leeg
    kandidatenpunt valt de laag bovendien terug op de **bibliotheek** in plaats van op niets, zodat de AI
    echte concepten ziet om uit te kiezen.
  - **❌ Nee rolde te vroeg terug.** Op "Ik wil brood eten." leverde ❌ appel en banaan op — de bróértjes
    van brood — terwijl de gebruiker juist chocopasta erop wilde. ❌ zegt twee dingen met één knop; de
    goedkoopste verklaring gaat nu voor: eerst een **verfijnronde** op dezelfde route, waarin de AI
    expliciet om preciezere concepten wordt gevraagd en desnoods nieuwe aandraagt. Pas bij een tweede ❌
    rolt de laatste stap terug.
  - **Geen "opnieuw beginnen" tijdens het gesprek.** Die knop stond alleen op het bevestigd-scherm, dus
    wie vastliep moest eerst een boodschap bevestigen die hij niet bedoelde. Nu staat hij in de balk van
    elk keuzescherm.

- **T10.11 "✅ Dit is genoeg".** Direct gevolg van T10.10: dat stelt pas een boodschap voor als er niets
  meer te verfijnen valt, waardoor "Ik wil eten." — in AAC een volwaardige boodschap — onbereikbaar werd.
  Nieuw `POST /conversation/{id}/enough` plus een knop in de balk van het keuzescherm (naast "↩ Terug" en
  "🤷 Staat er niet bij" — geen extra pictogram in het raster, want dat bevat alleen concepten die de
  boodschap vormen). De server bepaalt met `canFinish` wanneer de knop mag verschijnen: pas ná een eigen
  keuze van de gebruiker, want een boodschap uit alleen het anker van de begeleider is niet van hem. Het
  oordeel vervalt zodra de route verandert. Daarbij telt een structureel tussenconcept (`eat`, `drink`,
  `do-activity`) nu wél mee als het de route **afsluit**: "Ik wil eten." in plaats van het nietszeggende
  "Ik wil iets duidelijk maken."; middenin een route valt het nog steeds weg ("Ik wil soep.").

### Toegevoegd — Fase 11: meerdere gespreksstrategieën

- **T11.1 Ontwerp: gespreksstrategieën als expliciet begrip** (DESIGN §5.3, §7.3, §7.4, nieuwe §7.10 +
  [ADR-0013](docs/adr/0013-conversation-strategies.md)). De manier waarop de AI achterhaalt wat de
  gebruiker bedoelt lag als vijf losse constanten verspreid over evenzoveel modules — en die waarden zijn
  niet neutraal: ze veronderstellen iemand die categorieën begrijpt en stapsgewijs verfijnt. Het ontwerp
  kent nu het begrip **gespreksstrategie**: een parameterset met een sleutel, een label en een uitleg voor
  de begeleider, te kiezen per gebruiker of per gesprek (selectie: gesprek → gebruiker → standaard). De
  domeinregels vallen er expliciet buiten — een strategie verandert de **zoekwijze**, nooit de
  **garanties**. Geen code in deze taak.

- **T11.2 De huidige aanpak is een expliciete strategie geworden** (`conversation/strategy.ts`). De
  parameters die de zoekwijze bepalen komen nu uit één `ConversationStrategy` in plaats van uit losse
  constanten in `candidates.ts`, `decision.ts`, `ai/thresholds.ts`, `hypothesis.ts` en `ai/prompt.ts`. De
  bestaande waarden vormen de strategie **`refine`** ("Stap voor stap verfijnen"), de standaard uit de
  registry; het gedrag verandert niet — alle bestaande gespreks- en beslissingstests blijven ongewijzigd
  groen, en `strategy.test.ts` pint de waarden vast zodat een wijziging een zichtbare keuze is. De
  env-grenzen (`AI_MAX_CANDIDATES`, `AI_ALLOW_NEW_CONCEPTS`) blijven als **plafond** gelden: een strategie
  kan ze aanscherpen, nooit oprekken. Nieuw is de gedeelde **invariant-testsuite**
  (`strategy.invariants.test.ts`) die over élke geregistreerde strategie de domeinregels afdwingt: nooit
  een leeg scherm, geen voorstel zonder gebruikerskeuze, afgewezen concepten komen niet terug,
  deduplicatie eerst, gesloten promptsleutelset.

- **T11.3 Drie strategieën die aantoonbaar ander gedrag geven.** Een abstractie met één implementatie
  bewijst niets, dus staan er nu vier aanpakken in de registry: **`explore`** ("Breed verkennen":
  kleinkinderen vóór kinderen, groter aanbod, lagere voorsteldrempel — voor wie concrete dingen herkent
  maar moeilijk categoriseert), **`calm`** ("Rustig en bevestigend": klein aanbod, hoge voorsteldrempel,
  sterke demping, één duidelijke vraag per keer — voor wie snel overprikkeld raakt) en
  **`context-first`** ("Context eerst": voorkeuren en toegestane persoonlijke context vóór de
  boomkinderen — voor wie een sterk vast dagritme heeft). Elke strategie draagt een uitleg in
  begrijpelijke taal, want de begeleider kiest hem. Per strategie legt een test het **onderscheidende**
  gedrag vast op dezelfde gesprekstoestand, en alle vier halen de invariant-suite uit T11.2.

- **T11.4 Strategie kiezen per gebruiker** (`UserCommunicationProfile.conversationStrategy`, migratie
  `user_conversation_strategy`). De aanpak hoort bij de persoon, dus staat ze als communicatie-instelling
  naast `iconsPerScreen` en `showText`: in de profiel-API, in `SettingsForm` (radiokeuze mét de uitleg per
  aanpak zichtbaar, zodat de begeleider een geïnformeerde keuze maakt) en in profielexport/-import — een
  strategie die een overdracht niet overleeft, zou het profiel na verhuizing stil anders laten werken. Een
  onbekende sleutel geeft `400` en raakt de database niet; een **opgeslagen** sleutel die de registry niet
  meer kent valt bij het lezen terug op de standaard (een verdwenen strategie mag nooit een profiel
  onleesbaar maken — de gebruiker zou zijn tablet niet meer kunnen koppelen). Bestaande gebruikers houden
  `refine` en daarmee exact het gedrag van vóór deze instelling.
- **Startscherm laat zich niet inkorten door een strategie.** Ontdekt bij T11.4: met een klein aanbod
  (`calm`, vier opties) viel er een intentiecategorie van het startscherm, waarmee "Iets willen" in dat
  hele gesprek onbereikbaar werd. Het startscherm biedt nu altijd de volledige set intentiecategorieën
  (DESIGN §3.1); hoeveel er tegelijk op het scherm passen regelt de tablet met `iconsPerScreen`. De
  invariant-suite bewaakt dit voor élke strategie.

- **T11.5 Strategie kiezen per gesprek** (`ConversationSession.strategy`, migratie
  `conversation_strategy`). Eén persoon kan per situatie een andere aanpak nodig hebben: een vraag over
  pijn vraagt om een andere benadering dan "wat wil je doen vanmiddag". De begeleider kan bij
  `POST /question/start` optioneel een strategie meegeven; de resolutieorde **gesprek → gebruiker →
  standaard** staat op één plek (`resolveStrategy`). De gekozen aanpak wordt bij het starten van elk
  gesprek **vastgelegd** — ook bij een vrij gesprek vanaf de tablet — en ligt daarmee vast voor de duur
  van het gesprek: halverwege wisselen zou het vastgelegde aanbod (T10.3) en de lopende hypothese (T10.8)
  inconsistent maken. Een onbekende sleutel geeft `400` en er wordt geen sessie aangemaakt.

- **T11.6 Zichtbaar maken wélke aanpak draaide** (`AiJob.strategy`, migratie `ai_job_strategy`). Met
  meerdere strategieën is "waarom deed de AI dit?" — de vraag die de gebruikerstests opriepen — niet meer
  te beantwoorden zonder te weten welke aanpak actief was. De sleutel staat nu in de
  AI-beslissingslogregel en in het beheerscherm **AI-activiteit**, en de meekijkende begeleider ziet het
  **label** in de gesprekstoestand. De strategie reist daarvoor **buiten de prompt om** mee (`AiCallMeta`
  op de provider-interface): de gesloten promptsleutelset blijft ongemoeid en het model ziet er niets van.
  Alleen sleutel en label — geen promptinhoud, geen parameters, geen persoonlijke context (DESIGN §9.4).

### Gewijzigd — Fase 10: de AI stuurt het gesprek

- **T10.1 Ontwerp bijgesteld (DESIGN §7.3/§7.5/§7.6/§7.8 + [ADR-0012](docs/adr/0012-ai-generated-concepts.md)).**
  De harde regel "de AI mag tijdens communicatie geen vrije concepten verzinnen" is losgelaten: stond het
  woord van de gebruiker niet in de bibliotheek, dan was er géén uitweg — hij zat vast in een woordenschat
  die iemand anders voor hem had bepaald. Het eigenaarschap blijft geborgd doordat een nieuw concept nooit
  méér is dan een **aanbod**: de gebruiker kiest en bevestigt zelf, en de beheerder houdt het laatste
  woord over wat blijvend in de bibliotheek komt.
- **T10.2 Kandidaten uit retrieval in plaats van uit één boomknoop** (`conversation/candidates.ts`).
  De kandidatenset was letterlijk `loadChildSymbols(laatste keuze)`; dat was de hele wereld die het model
  per beurt zag. `want` heeft drie kinderen, dus na "Iets willen" kón geen enkel model iets anders
  voorstellen — de overige ~70 bibliotheekconcepten bestonden op dat moment niet. Nu komt de set uit vier
  bronnen (boomkinderen → kleinkinderen → retrieval over de héle bibliotheek → geleerde voorkeuren),
  begrensd op `AI_MAX_CANDIDATES`. Het startscherm blijft bewust de intentiecategorieën (DESIGN §3.1).
- **T10.3 Het vraagaanbod wordt vastgelegd** (`ConversationSession.pendingOffer`,
  `ConversationStep.offeredConcepts`). Sinds de kandidaten uit retrieval komen is de beslissing géén pure
  functie van de stappen meer: een tweede aanroep kan andere opties kiezen. Zonder vastlegging zou
  `↩ Terug` een ánder scherm tonen dan de gebruiker net zag, en zou een geldige keuze buiten de boom als
  `INVALID_CHOICE` geweigerd worden. De keuzevalidatie loopt nu tegen wat er werkelijk is aangeboden.
- **T10.4 De AI hoort nu wat de gebruiker níet wil.** Afgewezen concepten werden alleen lokaal
  weggefilterd; het model kreeg simpelweg een kortere lijst en wist niet dát er iets was afgewezen, laat
  staan wát. De prompt draagt nu `rejectedConcepts` (met soort `wrong_guess` / `no_fitting_option`) en
  `askedQuestions`, plus regels die bij `no_fitting_option` om een **andere invalshoek** vragen. De
  sleutelset blijft gesloten: het zijn AAC-concepten en door het systeem gestelde vragen, geen
  chatgeschiedenis.
- **T10.5 "Geen van deze past" is een echte uitweg geworden.** Het sloot het hele niveau uit, waarna de
  beslissingslaag omhoog liep en bij de intentiecategorieën eindigde — de gebruiker die aangaf het beter
  te weten, kreeg het startscherm terug (gereproduceerd in de derde gebruikerstest). Nu blijven zijn
  keuzes staan en volgt een nieuwe ronde uit de resterende kandidaten, met de afwijzing als signaal. Het
  aanbod heeft daarvoor een bovengrens gekregen (12 opties), zodat één afwijzing niet de hele
  kandidatenset wegvaagt. Loopt een punt écht leeg, dan volgt eerst een **vrije ronde** (de AI mag zelf
  begrippen aandragen), daarna de intentiecategorieën, en pas dán een boodschapvoorstel.
- **T10.6 De AI mag een nieuw woord aandragen** (`aac/new-concept.ts`, env `AI_ALLOW_NEW_CONCEPTS`).
  Een onbekend begrip werd stilzwijgend weggegooid. Nu: eerst **deduplicatie** tegen concept, label en
  synoniem (anders loopt de bibliotheek vol met bijna-duplicaten), en is het echt nieuw, dan wordt er een
  `AacSymbol` aangemaakt met herkomst `ai`, meteen een pictogram gezocht via OpenSymbols (met de bestaande
  `https`/SSRF-guard, placeholder als terugval), en het geheel als voorstel vastgelegd. In de tablet is
  zo'n woord zichtbaar gemarkeerd (✨, ook in het `aria-label`). Met `AI_ALLOW_NEW_CONCEPTS=false` blijft
  de bibliotheek hard begrenzend.
- **T10.7 Beheer: "Nieuwe woorden"** (`GET/POST/DELETE /admin/aac/new-concepts…`). De beheerder ziet de
  door de AI aangedragen begrippen met hun pictogram, de motivering van de AI en hoe vaak ze al gekozen
  zijn, en kan ze **behouden**, **samenvoegen** met een bestaand pictogram (het begrip wordt dan een
  synoniem) of **verwijderen**. Het beoordeelpad weigert gewone bibliotheeksymbolen met `404`, zodat het
  geen sluipweg is.
- **T10.9 De boodschapzin loopt mee met de vrijere route** (`conversation/message.ts`,
  `conversation/generate.ts`). Sinds de AI ook op het startscherm een concept mag aandragen kan een route
  beginnen zónder intentie — en dan leverde de sjabloon één los woord op ("Nagelknipper.") omdat er alleen
  zinsframes per intentie waren. Er is nu een neutraal **onderwerp-frame** ("Ik wil iets zeggen over …")
  waarin álle gekozen concepten inhoud zijn; de categorie van het eerste symbool bepaalt welke van de twee
  het wordt. Daarnaast keek de safety-laag naar élk label en synoniem, waardoor "Ik wil de nagelknipper."
  werd afgekeurd op "wil" — een synoniem van het niet-gekozen `want`, maar bovenal gewone Nederlandse
  zinsbouw. De scan telt nu alleen **betekenisdragende** termen: functiewoorden (lidwoorden,
  voornaamwoorden, voorzetsels, hulp-/modale werkwoorden) zijn geen bewijs van een concept. Bewust een
  gesloten woordklasse en geen lengteregel, zodat korte contentwoorden ("sap", "mam") blijven meetellen en
  de harde regel — geen concept in de zin dat de gebruiker niet koos — overeind blijft.
- **T10.8 Hypothese per gesprek** (`conversation/hypothesis.ts`). Er was nergens vastgelegd wát de AI
  dacht dat de gebruiker bedoelde — alleen een losse `confidence` per stap, rauw uit één modelantwoord,
  waardoor de voorsteldrempel (>85%) op één uitschieter kon vuren. De hypothese houdt concepten, een over
  beurten heen **gedempte** zekerheid en de geschiedenis bij; de correctieflow wijst de misstap nu aan op
  het **kantelpunt** (de sterkste daling) in plaats van op de laagste per-stap-zekerheid als proxy. De
  hypothese is vluchtig: bij `/confirm` wordt ze gewist (DESIGN §3.6).

### Toegevoegd
- **T9.11 De AAC-bibliotheek loopt niet meer dood.** "Een vraag stellen" en "Iets zeggen" hadden geen
  enkele verfijning, dus wie ze koos kreeg meteen een voorstel ("Ik wil een vraag stellen.") in plaats
  van een AI die uitzoekt waaróver de vraag gaat; "Er is iets aan de hand" kende alleen "Pijn" en pijn
  maar drie lichaamsdelen. Toegevoegd: vraagwoorden (wat/wie/waar/wanneer/mag ik) met vervolgtakken,
  sociale uitingen (ja, nee, dank je, hallo, dag, stop, nog een keer), meer problemen (jeuk, bang, ziek,
  koud, warm, hulp, kapot) en een echte set lichaamsdelen (hand, vinger, **nagel**, tand, oor, rug, arm,
  voet, oog, keel) — plus meer te eten, drinken en doen. Twee nieuwe categorieën (`question`,
  `expression`) omdat vraagwoorden en uitingen geen intentie, gevoel of voorwerp zijn. Een test dwingt af
  dat **elke** intentie minstens één verfijning heeft, zodat een nieuwe intentie nooit stilletjes
  doodloopt. Seeden blijft idempotent (en gebeurt nu in twee transacties i.p.v. ~160 losse writes, wat de
  testsuite ook merkbaar sneller maakte).
- **T9.12 "🤷 Staat er niet bij".** Stond het juiste pictogram niet tussen de opties, dan kon de gebruiker
  alleen een keuze maken die hij niet bedoelde. `POST /conversation/{id}/correction` kent nu naast
  `wrong_guess` het type `no_fitting_option`: de concepten van dít punt worden uitgesloten en het gesprek
  gaat een niveau hoger verder, **zonder** een gemaakte keuze terug te rollen. De tablet heeft er een knop
  voor naast "↩ Terug" — bewust een bedieningsknop en geen extra pictogram in het keuzeraster, want dat
  raster bevat alleen concepten die samen de boodschap vormen.
- **T9.15 AI-activiteit zichtbaar.** Nieuw `GET /admin/ai/jobs` (platformbeheer) plus een beheertab
  **AI-activiteit**: per AI-aanvraag de taak, status, doorlooptijd, de worker, en van het resultaat de
  vraag, de aangedragen concepten met zekerheid en de motivering van de AI. De **prompt** verlaat de
  server nooit (daar zit persoonlijke context in). Daarnaast logt de backend per beslissing één regel met
  aantal kandidaten, aantal AI-opties, wat er wordt aangeboden en waarom.
- **T9.1 Een beheerder mag ook begeleider zijn.** De beheeromgeving heeft een tab **"Begeleiden"** die
  dezelfde vraagmodus-pagina toont als een begeleider ziet (vraag stellen + meekijken). De server liet
  ADMIN op `/question/*` altijd al toe; alleen de weergave ontbrak, zodat een beheerder een tweede
  account nodig had om een vraag te stellen. Daarnaast kan een ADMIN-account nu ook als **begeleider aan
  een gebruiker gekoppeld** worden: `GET/POST /admin/users/{id}/caregivers` accepteert CAREGIVER én ADMIN
  en draagt per account de `role`, zodat zichtbaar blijft wie beheerder is. Een `USER`-account blijft
  geweigerd (`400 NOT_A_CAREGIVER`). Dit verruimt geen toegang: binnen de eigen organisatie zag een ADMIN
  alles al.
- **T9.4 Zichtbaar of er een AI-worker actief is.** Nieuw `GET /ai/status` (ingelogd account **of**
  gekoppelde tablet) met de draaiende modus, het aantal worker-tokens met activiteit in de laatste 60 s en
  het laatste activiteitsmoment — uitsluitend infrastructuurmetadata, nooit prompts of gespreksinhoud.
  Beide interfaces tonen het als een klein lampje (`AiStatusBadge`): "AI denkt mee", "Geen AI-worker
  actief" of "Zonder AI". Bewust geen live region: het lampje mag de gespreksflow niet onderbreken.
- **T9.7 Onderwerpkeuze in de vraagmodus.** Nieuw `GET /aac/topics` levert precies de symbolen die
  antwoordopties hebben (minstens één kind in de relatieboom) — dezelfde ankers die `POST /question/start`
  accepteert. De begeleiderinterface kiest het onderwerp daaruit in plaats van het te moeten opzoeken, en
  onder de verstuurknop staat nu wat er nog ontbreekt zolang hij uitstaat.
- **T9.9 `OLLAMA_TOKEN` voor een afgeschermd Ollama-endpoint.** De worker stuurt `Authorization: Bearer …`
  mee zodra de variabele gevuld is (nodig voor een gehost endpoint, o.a. de `…:cloud`-modellen); leeg =
  geen header, zoals bij een lokale Ollama. Het token staat alleen in de env — nooit in code of logs.

### Gerepareerd
- **T9.13 "Opnieuw beginnen" gaf "Dit gesprek is al afgerond".** Na het bevestigen van een boodschap gaf
  de knop een 409-fout. Oorzaak: `run()` wiste eerst het bevestigd-scherm en wachtte daarna pas op het
  nieuwe gesprek; in dat tussenmoment stond de oude toestand (`done: true`) er nog, mountte het
  voorstelscherm opnieuw op de zojuist **bevestigde** sessie en riep het `/generate` aan. De fout bleef
  bovendien staan omdat het voorstelscherm zijn foutmelding niet wiste. Nu wordt de oude toestand eerst
  gewist (laadscherm) en start het nieuwe gesprek schoon.
- **T9.10 De AI snoeide de keuze weg.** Met een echte AI gaf het startscherm één optie ("Iets willen")
  in plaats van de intentiecategorieën, en bij "waar heb je pijn?" drie lichaamsdelen waar het juiste niet
  bij zat — de rest van de bibliotheek was onbereikbaar. De AI **ordent** nu binnen de kandidaten (haar
  keuzes staan vooraan), maar alle overige kandidaten van datzelfde punt volgen erachter en blijven via
  "Meer keuzes" (T9.6) bereikbaar.
- **T9.14 Na ❌ Nee kon het gesprek doodlopen op een voorstel uit het niets.** In vraagmodus hield een
  correctie alleen het begeleiders-anker over, waarna de app een "boodschap" voorstelde die de gebruiker
  nooit had gekozen. Voorstellen mag nu alleen na een echte keuze van de **gebruiker** (het anker van de
  begeleider telt niet mee, en een correctie rolt dat anker ook niet meer terug), en houdt een punt geen
  kandidaten meer over, dan zoekt de beslissingslaag een niveau hoger verder. Een echt eindconcept levert
  onveranderd een voorstel op.
- **T9.16 De AI stelde haar vraag in het Engels.** Bij het naspelen van de test met een echte
  Ollama-worker verscheen "Is the pain related to being sick?" op de tablet: de promptregels schreven de
  AAC-begrenzing en de ik-vorm van de bóódschap voor, maar niets over de taal van de **vraag**. Het doel
  in de prompt vraagt nu expliciet om een korte, eenvoudige **Nederlandse** vraag, rechtstreeks gericht
  tot de gebruiker.
- **T9.17 De AI-worker stierf bij elke herstart van de backend.** Valt de verbinding tijdens de long-poll
  weg, dan komt dat als `http.client.RemoteDisconnected` binnen — een `OSError`, geen `URLError`, dus de
  claim-lus ving hem niet en het worker-proces viel stil om (met daarna eindeloos `AI_WORKER_UNAVAILABLE`
  voor de gebruiker). `TimeoutError` en `OSError` worden nu vertaald naar `BackendError`, zodat de lus het
  gewoon opnieuw probeert.
- **T9.5 Bevestigen faalde op de tablet bij een ingelogde beheerder in dezelfde browser.** `✅ Ja` gaf
  "Alleen de gebruiker kan zelf een boodschap bevestigen…" (`403 CONFIRM_REQUIRES_USER`) zodra er in
  dezelfde browser een beheer- of begeleiderssessie liep. Oorzaak: cookies zijn per **origin**, niet per
  tab, dus `/tablet` stuurde beide cookies mee en `forbidAccountSession` weigerde elke request met een
  account-cookie. Het **apparaat-token wint** nu: een geldig apparaat-token is de tablet van de gebruiker
  en gaat door; zonder apparaat-token maar mét account-sessie blijft het `403`. De waarborg blijft hard —
  bevestigen vereist een gekoppeld apparaat, dat de beheer-UI niet heeft.
- **T9.3 Meekijken ververst zichzelf.** Het meekijkpaneel haalde de gesprekcontext alleen op na een klik
  (T7.2, om geen ongevraagd verkeer te maken), waardoor je een gesprek niet kon volgen. Het paneel laadt
  nu bij openen en ververst elke 4 s (lichte snapshot, geen AI-aanroep); de knop blijft als directe
  verversing. Bij een fout blijft de laatste stand staan met een melding — het pollen loopt door.
- **T9.6 De laatste intentiecategorie viel weg op het startscherm.** De tablet kapte de opties af op
  `iconsPerScreen`, dus bij vijf intenties en de standaard van vier was "Iets zeggen" onzichtbaar én
  onbereikbaar. De schermen blijven even rustig, maar de resterende opties zijn nu bereikbaar via
  **"➕ Meer keuzes"** (met "↺ Eerste keuzes" terug); elke nieuwe vraag begint weer op de eerste pagina.
- **T9.2 Koppelcode toont het tablet-adres.** Bij de code staat nu het volledige adres (`<origin>/tablet`)
  waar hij ingevoerd moet worden.
- **T9.8 "Geen AI" is niet langer onzichtbaar.** In de gebruikerstest leek de AI niets te doen; de backend
  draaide op de standaard `AI_PROVIDER=mock` (deterministische mock-provider). De server logt nu bij het
  opstarten welke modus draait — met een expliciete waarschuwing bij `mock` — en `.env.example`/`README.md`
  benoemen de stap naar `queue` + worker. Zichtbaar in de UI via T9.4.

### Gewijzigd
- **T8.6 Opmaak weer groen en afgedwongen.** `npm run format:check` stond al langere tijd rood
  (34 bestanden) zonder dat iemand het merkte: het hoorde niet bij de Definition of Done — die
  noemde alleen `typecheck`, `lint`, `test` en `audit` — en niets dwong het af, dus de opmaak
  dreef per taak verder af. Opgelost in twee stappen, bewust gescheiden. Eerst één losse,
  gedragsvrije commit met alleen `prettier --write .`: regels boven `printWidth: 100` afgebroken,
  union-types opnieuw gewrapt en vier CRLF-bestanden naar LF geschreven. Die diff raakt bijna de
  hele codebase, dus hij staat apart zodat de diff van latere taken leesbaar blijft; dat het echt
  om opmaak ging is geverifieerd door per bestand de tokenstroom (zonder witruimte en komma's) te
  vergelijken — het enige verschil zijn weggevallen leidende `|`-tekens in union-types, en tests
  bleven exact op 45/353 (server) en 15/83 (web). Daarna pas de borging. Regeleindes liggen nu
  dubbel vast: `.gitattributes` met `* text=auto eol=lf` plus een expliciete `endOfLine: "lf"` in
  `.prettierrc.json`, zodat CRLF niet via een andere editor of een checkout op Windows terugkomt —
  precies hoe die vier bestanden ooit rood werden. Aangeleverd naslagmateriaal (`INTENTO-DESIGN/`,
  `PROJECT-NODEJS/`, `LICENSE`) is expliciet uitgezonderd met `-text`: dat onderhouden we niet zelf,
  Prettier negeert het al, en renormaliseren zou alleen ruis opleveren. Tegen terugvallen: een
  pre-commit hook in `.githooks/` die Prettier alleen over de *staged* bestanden draait, zichzelf
  installeert via het `prepare`-script (`git config core.hooksPath .githooks`, dus zonder nieuwe
  dependency zoals husky of lint-staged) en beide kanten op getest is — een verkeerd opgemaakt
  bestand blokkeert de commit, een correct bestand gaat door. `format:check` staat nu ook in de
  Definition of Done in `CLAUDE.md`.

### Gerepareerd
- **Verificatielink toonde "ongeldig of verlopen" terwijl het adres wél bevestigd werd.** Dezelfde
  StrictMode-klasse als T8.5: React mount onder `<StrictMode>` (dev) elk component dubbel, dus
  draaide het effect in `VerifyEmailPage` twee keer en verstuurde het hetzelfde **eenmalige** token
  twee keer. De eerste POST slaagde (token op `usedAt`, account op `emailVerifiedAt`), de tweede
  kreeg terecht de neutrale fout — en juist die tweede bepaalde wat het scherm toonde. De
  `active`-vlag in de cleanup hielp niet, integendeel: die onderdrukte alleen het *resultaat* van de
  geslaagde eerste POST, niet de tweede POST zelf. Opgelost met een ref die onthoudt welk token al
  is ingewisseld, zodat de tweede effect-uitvoering niets meer verstuurt; verandert het token echt
  (andere link in hetzelfde tabblad), dan wisselt de pagina dat nieuwe token wel in. De opruimvlag
  is weg: een setState na unmount is in React 18+ een no-op. De server blijft ongewijzigd — tokens
  blijven strikt eenmalig. Voor het geval iemand een al gebruikte link nog eens opent, staat er nu
  onder de foutmelding een hint dat het adres waarschijnlijk al bevestigd is en inloggen gewoon kan.
  Getest in `web/src/VerifyEmailPage.test.tsx`, inclusief een StrictMode-test die tegen de oude code
  aantoonbaar faalt.
- **Verificatiemails faalden met `wrong version number`; SMTP dwingt nu TLS af.** `SMTP_URL` stond
  op `smtps://…:587`: het schema `smtps://` zet `secure: true`, dus nodemailer begon meteen een
  TLS-handshake, terwijl poort 587 een STARTTLS-poort is die eerst in platte tekst antwoordt
  (`220 …`). OpenSSL las dat antwoord als een TLS-record en meldde `wrong version number` — een
  fout die naar TLS-versies wijst maar in werkelijkheid een schema/poort-mismatch is. De env staat
  nu op `smtp://…:587` (STARTTLS), zoals gewenst. Omdat een kale `smtp://`-URL TLS alleen
  *opportunistisch* gebruikt — een server die geen STARTTLS aanbiedt krijgt de SMTP-inloggegevens
  dan gewoon in platte tekst — zet `SmtpMailTransport` nu `requireTLS`, waarmee de upgrade
  verplicht is en een mislukte upgrade de verzending laat falen. Bij `smtps://` (465) is de vlag
  een no-op. De vlag gaat als **query-parameter** in de URL mee en niet als optie-object: geef je
  `createTransport()` een object met een `url`-property, dan gebruikt nodemailer alléén die URL en
  gooit het de rest van het object weg, dus `{ url, requireTLS: true }` compileert en draait maar
  doet niets — dat is tijdens deze fix eerst mis gegaan en daarna geverifieerd. Tests draaien tegen
  een neptestserver die STARTTLS weigert en controleren dat er geen `AUTH` en geen wachtwoord over
  de lijn gaat, met een contra-test die aantoont dat diezelfde server zonder `requireTLS` de
  inloggegevens wél ontvangt. Documentatie (`.env.example`, README, `docs/security.md`, ADR 0007)
  waarschuwt nu expliciet voor de schema/poort-combinatie.
- **T8.7 Pictogrammen laadden niet cross-origin door helmets `Cross-Origin-Resource-Policy`.**
  `@fastify/helmet` zet op élk antwoord `Cross-Origin-Resource-Policy: same-origin`. De web-client
  draait op een andere origin dan de API (Vite op `:5173` vs. API op `:3000`) en laadt pictogrammen
  via `apiUrl()` als `<img src>` — een **no-cors** resource-load, waar CORS-headers niets aan
  veranderen en CORP wél: de browser haalt het plaatje op en gooit het daarna weg, zodat het
  gespreksscherm lege vakjes toonde (met labels en de rest van de UI gewoon zichtbaar). Fix:
  `GET /aac/images/:file` zet zelf `Cross-Origin-Resource-Policy: cross-origin`, ná de
  bestaat-check, zodat alleen een echt geserveerd pictogram versoepeld is en een 404 net als elke
  andere route `same-origin` houdt. Bewust route-scoped in plaats van helmet globaal verruimen:
  pictogrammen zijn publieke, niet-persoonlijke presentatiedata, de rest van de API blijft
  afgeschermd tegen cross-origin inladen. Geverifieerd in een echte Firefox tegen de draaiende
  dev-servers: vanaf `:5173` levert een `<img>` van `:3000` nu `naturalWidth 256` in plaats van een
  `error`-event, en de volledige tabletflow (koppelcode → gespreksscherm) toont alle vier de
  pictogrammen — met de regel er tijdelijk uit is precies het omgekeerde gemeten, dus de causaliteit
  is aangetoond. Tests in `routes/aac.test.ts` dekken beide takken van de route (SVG-placeholder én
  geüploade afbeelding) plus het behoud van `same-origin` op `/health` en op een onbekend pictogram.
  Anders dan bij T8.4 zagen de tests dit wél kunnen zien — `app.inject()` geeft helmets headers
  gewoon terug — er was simpelweg nooit een test op deze header. `docs/security.md` beschrijft de
  afweging, inclusief het aandachtspunt dat helmets CSP (`img-src 'self' data:`) alleen geldt voor
  documenten die de API zelf serveert; zet de web-host straks een eigen CSP, dan moet de API-origin
  daar in `img-src` staan.
- **T8.5 Tablet-gespreksscherm bleef hangen op "Laden…" onder React StrictMode.** `ConversationScreen`
  in `TabletApp.tsx` bewaakt met een `mountedRef` dat er geen state meer wordt gezet nadat het scherm
  is verdwenen (de AI-wachtlus uit T5.7 kan seconden doorlopen). Die vlag ging alleen in de
  effect-cleanup op `false` en stond nergens weer op `true`. In `<StrictMode>` — dat in `main.tsx`
  om de hele app staat en dus in élke dev-sessie meedraait — mount React ieder component bewust
  dubbel (mount → unmount → remount). Na de gesimuleerde unmount bleef de vlag `false`, waarna het
  laad-effect de eerste vraag wél ophaalde maar de guard elke `setState` oversloeg: `state` bleef
  `null` en de tablet toonde eindeloos "Laden…". De backend was onschuldig — link → device-cookie →
  `/conversation/pending` → `/conversation/start` levert de eerste vraag in ~50 ms. Fix: de vlag ook
  aan het begin van de effectbody op `true` zetten, zodat een remount hem herstelt. Bewust geen
  overstap op het `let active`-per-effect-patroon: `run()` wordt óók vanuit event-handlers
  aangeroepen en deelt de guard, dus een ref is hier de juiste vorm. De andere schermen (`App.tsx`,
  `OperatorConsole.tsx`, `QuestionModePage.tsx`, `VerifyEmailPage.tsx` en `ProposalScreen`) zijn
  nagelopen: die gebruiken al het StrictMode-veilige `let active`-patroon per effect. Verificatie in
  twee lagen, omdat dit precies een gat is dat de bestaande tests niet zagen (geen enkele test
  renderde onder StrictMode): twee nieuwe tests in `TabletApp.test.tsx` renderen de app in
  `<StrictMode>` (eerste vraag verschijnt; een keuze werkt daarna nog), en dezelfde flow is met een
  echte Firefox tegen de draaiende dev-servers gerookt — zónder fix blijft het scherm op "Laden…",
  mét fix verschijnt "Wat wil je duidelijk maken?" met de pictogramopties.
- **T8.4 CORS-methoden hersteld (DELETE/PUT/PATCH).** `@fastify/cors` v11 heeft de default `methods`
  versmald naar `GET,HEAD,POST`; onze registratie in `app.ts` gaf geen expliciete lijst mee. Gevolg in
  de browser: de preflight voor élke cross-origin DELETE/PUT/PATCH kreeg een
  `access-control-allow-methods` zónder die methode, dus het echte verzoek werd nooit verstuurd —
  gebruiker/context/pictogram verwijderen en `PUT /users/{id}/settings` faalden met "Kan de server niet
  bereiken". De server-tests bleven ondertussen groen: `app.inject()` doet geen preflight, dus geen
  enkele test raakte het pad dat stukging. Fix: expliciet
  `methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']`. De origin-restrictie blijft
  ongewijzigd (één `CORS_ORIGIN`, geen wildcard) — meer methoden toestaan verruimt de toegang niet,
  want authenticatie en autorisatie per route veranderen niet. Nieuwe regressietests in `app.test.ts`
  doen een echte OPTIONS-preflight per methode en bewaken dat het antwoord nooit `*` of de vreemde
  origin echoot. Verificatie liep verder via een draaiende server: preflight + echte `PUT .../settings`
  (200) en `DELETE /users/{id}` (204), telkens met `Origin` en `access-control-allow-origin` in het
  antwoord. De andere `@fastify/*`-plugins zijn nagelopen op stilzwijgende default-drift: cookie-,
  rate-limit- en multipart-opties worden bij ons expliciet meegegeven, en helmet levert nog de volledige
  headerset. Eén ding kwam daarbij wél boven water (genoteerd als T8.7, niet hier gefixt): helmets
  default `Cross-Origin-Resource-Policy: same-origin` blokkeert de AAC-pictogrammen die de web-client
  cross-origin als `<img src>` laadt.

### Toegevoegd
- **T8.3 Platform-operatorconsole: cross-tenant organisatie- en gebruikersbeheer.** Intento kende geen
  rol bóven de tenants: elke ADMIN zit vast in zijn eigen organisatie (T1.2) en `Organization.isPlatform`
  ontgrendelde alléén worker-tokenbeheer (T5.8). Er was dus niemand die een omgeving kon neerzetten en —
  belangrijker — een **misbruikte omgeving kon stoppen**; die bleef gewoon draaien. Nieuw:
  `Account.isOperator` en `Organization.active` (migratie `operator_console_and_org_active`, veilige
  defaults) plus de routetak **`/operator/*`**: lijst, detail, aanmaken en (de)activeren van organisaties,
  en inzage in accounts/gebruikers over tenants heen. **Gekozen: een aparte bevoegdheid, geen vierde rol.**
  `role` beantwoordt "wat mag je binnen je organisatie?" en wordt overal met tenant-filtering gecombineerd;
  een `PLATFORM_ADMIN` in dat enum zou door elke bestaande rolcontrole rimpelen en suggereren dat operator
  een plek op dezelfde as is. De vlag telt bovendien alléén in een organisatie met `isPlatform=true` (twee
  onafhankelijke voorwaarden) en wordt **uitsluitend door de bootstrap-seed** gezet — er is geen API om
  iemand tot operator te promoveren. Security is hier het hart: eigen guard (`operatorAuthorize`, níét
  `authorize()`), eigen routetak, en — de kern — de guard zet **`request.operator` en laat
  `request.account` leeg**, zodat `requireAccount`/`tenantScope`/`assertSameTenant` op een operator-route
  hard falen in plaats van stilletjes op de organisatie van de operator te filteren: een vergissing wordt
  een crash, geen datalek. Elk ander account (ook een platform-ADMIN zonder vlag) krijgt op élk
  operator-endpoint `403 NOT_OPERATOR`; de tijdelijk-wachtwoord- en verificatiegate gelden hier óók. De
  responses dragen alleen **beheermetadata** — geen communicatie-inhoud, geen persoonlijke context, en
  gebruikers **zonder naam**; expliciete `select` zodat een later Account-veld niet meelekt. Bewust géén
  "inloggen als", géén wachtwoord-reset in andermans tenant en géén eerste-admin bij een nieuwe omgeving.
  **Deactiveren doet echt iets en meteen:** `active=false` wordt afgedwongen op login, bestaande
  accountsessies én gekoppelde tablets (`403 ORGANIZATION_SUSPENDED`) — geen verwijdering (gegevens
  blijven, hervatten is één klik), en de platformorganisatie is beschermd (`400
  PLATFORM_ORGANIZATION_PROTECTED`) zodat een operator zichzelf niet buitensluit. Alle acties geaudit met
  de operator als actor en `organizationId: null` (als bij worker-tokens), zodat ze niet opduiken in het
  audit-overzicht van een organisatie die er niets aan kon doen. UI: aparte route **`/operator`**
  (`OperatorConsole.tsx`, route-dispatch verhuisd naar `routes.tsx` en getest) met één expliciete link op
  "Mijn account" — geen tab tussen het tenant-beheer. Docs: ADR-0011, `docs/security.md`, `docs/api.md`,
  `docs/data-model.md`, README. Tests: `routes/operator.test.ts` (401/403-matrix incl. de hele routetak
  dicht voor een gewone ADMIN, cross-tenant lijst, geen gebruikersnaam of hash in de respons, deactivatie
  die sessie/login/tablet sluit, platform-org beschermd, en dat een operator op de **gewone** endpoints nog
  steeds niets van een andere tenant ziet), `web/src/OperatorConsole.test.tsx` en `web/src/routes.test.tsx`.
- **T2.7 Nieuw tijdelijk wachtwoord uitgeven voor een vastgelopen account.** Meerwerk uit T2.6: door
  de harde gate kon een begeleider die zijn tijdelijke wachtwoord kwijtraakte (of op de lockout
  strandde) helemaal niets meer — inloggen lukte niet en zonder sessie is `POST /auth/password`
  onbereikbaar; er was geen enkele weg terug. Nieuw endpoint
  **`POST /admin/accounts/{id}/password`** (ADMIN + geverifieerd, rate-limited via
  `PASSWORD_RESET_RATE_LIMIT_MAX`): de **server** genereert een nieuw tijdelijk wachtwoord (256 bit,
  één keer getoond, argon2id at-rest), zet `mustChangePassword` weer op `true`, veegt de
  lockout-boekhouding schoon en trekt **alle** sessies van dat account in. De beheerder kiest dus nog
  steeds nooit het wachtwoord van een ander (T2.5 blijft de enige plek waar een wachtwoord blijvend
  wordt gezet, mét her-authenticatie). Nooit op het eigen account
  (`403 CANNOT_RESET_OWN_PASSWORD`) en nooit cross-tenant: `assertSameTenant` geeft dezelfde
  `403 FORBIDDEN` voor "andere organisatie" en "bestaat niet". Geaudit als `account.password_reset`
  (rol + aantal ingetrokken sessies, nooit het wachtwoord). **Gekozen boven een publieke "wachtwoord
  vergeten"-flow per e-mail**: Intento moet zonder mailserver bruikbaar blijven en een tweede,
  publiek bereikbare weg naar een account vergroot het aanvalsoppervlak (blijft mogelijk als latere
  aanvulling, met de tokeneigenschappen van T1.4). UI: knop per login in het paneel "Logins" met een
  bevestigingsstap en het wachtwoord één keer in beeld; het eigen account krijgt geen knop. Geen
  migratie nodig (`mustChangePassword` bestaat sinds T2.6). Tests: `routes/accounts.test.ts` (oud
  wachtwoord en sessies dood, markering + gate terug, lockout opgeheven, eigen account 403, andere
  organisatie 403 en onaangeroerd, CAREGIVER 403 / anoniem 401, audit zonder wachtwoord) en
  `web/src/AccountsPanel.test.tsx`.
- **T2.6 "Tijdelijk wachtwoord"-markering op accounts.** Meerwerk uit T2.5: een begeleider die het
  tijdelijke wachtwoord uit T2.4 nooit verving, bleef draaien op een wachtwoord dat zijn beheerder
  kent — een login die feitelijk van twee mensen is, zonder dat iemand dat kon zien. `Account` heeft
  nu **`mustChangePassword`** (migratie `account_must_change_password`, default `false`): gezet bij
  het aanmaken van een begeleider-account (T2.4), gewist door een geslaagde `POST /auth/password`
  (T2.5). **Gekozen gate: hard.** Zolang de markering staat laat `authorize(...)` alléén
  `GET /auth/me` en `POST /auth/password` toe (en `POST /auth/logout`, dat geen `authorize` gebruikt);
  elke andere route geeft **`403 PASSWORD_CHANGE_REQUIRED`**. Dat is bewust strenger dan de
  verificatie-gate van T1.4 — een onbevestigd adres is *onbewezen*, een tijdelijk wachtwoord is
  *levend en gedeeld* — en zit als **default-deny** in `authorize(...)` zelf, met een expliciete
  opt-out (`allowPendingPasswordChange`) op precies die twee routes; zo staat een nieuwe route
  automatisch achter de gate in plaats van hem per ongeluk te missen. `accountPublicSchema` geeft
  `mustChangePassword` mee, zodat de client weet waaróm de rest dichtzit. UI: de web-app toont zo'n
  account één **blokkerend scherm** ("Kies eerst een eigen wachtwoord") met het bestaande
  wachtwoordpaneel erin, dat na de wissel meteen doorloopt naar de gewone weergave; de beheerder
  krijgt een nieuw paneel **"Logins"** (`web/src/AccountsPanel.tsx`) in het gebruikersbeheer met per
  account de markeringen "tijdelijk wachtwoord" en "e-mail niet bevestigd" — bewust zonder
  reset-knop, want een beheerder zet nooit het wachtwoord van een ander. Bestaande accounts krijgen
  bij de migratie `false`: of hun tijdelijke wachtwoord al vervangen is, valt achteraf niet vast te
  stellen, en iedereen alsnog markeren zou werkende begeleiders buitensluiten. Tests:
  `server/src/auth/temporary-password.test.ts` (markering bij aanmaken, zichtbaar in de accountlijst
  van de beheerder, `403` op een route die de rol normaal wél mag, `/auth/me` en `/auth/password`
  toegestaan, markering én gate weg na de wissel, zelf gekozen wachtwoorden nooit gemarkeerd) plus
  web-tests in `App.test.tsx`. Gedocumenteerd in `docs/api.md`, `docs/security.md` en
  `docs/data-model.md`.
- **T2.5 Eigen wachtwoord wijzigen.** Meerwerk uit T2.4: een begeleider logde in met een tijdelijk,
  door de beheerder gegenereerd wachtwoord en kon dat niet vervangen — het bleef dus onbeperkt geldig
  én bekend bij iemand anders. Nieuw endpoint **`POST /auth/password`** (elke ingelogde rol,
  `auth/change-password.ts`) wisselt het **eigen** wachtwoord: het account komt uit de sessie en het
  verzoekschema kent geen account-id, dus er is geen pad naar dat van een ander. Het **huidige**
  wachtwoord moet mee (her-authenticatie tegen een gekaapte sessie of een onbeheerd ingelogd scherm),
  het nieuwe gaat door `strongPasswordSchema` (≥12 tekens) en mag niet gelijk zijn aan het huidige;
  opslag blijft argon2id. Na een geslaagde wijziging worden **alle overige sessies van dat account
  ingetrokken** — het antwoord meldt hoeveel (`{ revokedSessions }`) — terwijl de huidige sessie
  geldig blijft. Bewust **geen** lockout-boekhouding zoals bij login (een gekaapte sessie zou de
  eigenaar anders kunnen buitensluiten); in plaats daarvan eigen rate limiting via
  `PASSWORD_CHANGE_RATE_LIMIT_MAX`/`_WINDOW_MINUTES` (standaard 5 per 15 min). Fout huidig wachtwoord
  → `401 INVALID_CURRENT_PASSWORD` — hier mág de melding concreet zijn, want de aanroeper is al als
  dít account geauthenticeerd. Geaudit als `auth.password_change` (success én failure), zonder ooit
  een wachtwoord of hash te loggen. UI: paneel **"Wachtwoord wijzigen"**
  (`web/src/ChangePasswordPanel.tsx`) in een nieuwe beheertab **"Mijn account"**
  (`web/src/AccountPage.tsx`) en onderaan de vraagmodus, zodat ook een begeleider — die alleen die
  weergave heeft — erbij kan. Tests: `server/src/auth/change-password.test.ts` (nieuw wachtwoord werkt
  en het oude niet meer, fout huidig wachtwoord laat alles ongemoeid, 401 zonder sessie, 400 op zwak
  of ongewijzigd wachtwoord, andere sessies dood en de eigen sessie levend, sessies van een ánder
  account ongemoeid, rate limiting, geen wachtwoord in db of audit-log) en
  `web/src/ChangePasswordPanel.test.tsx`. Gedocumenteerd in `docs/api.md`, `docs/security.md`,
  `README.md` en `.env.example`. Openstaand meerwerk: accounts die nog op hun tijdelijke wachtwoord
  zitten worden niet als zodanig gemarkeerd (nieuwe taak **T2.6**).
- **T2.4 Begeleider-accounts aanmaken.** Tot nu toe ontstonden er alleen ADMIN-accounts (seed +
  zelfaanmelding T1.3), waardoor de koppelweergave van T2.2 een doodlopend spoor was: de lege staat
  zei "maak eerst een begeleider aan", maar er was nergens een plek om dat te doen. Nieuw endpoint
  **`POST /admin/accounts`** (ADMIN-only, e-mail geverifieerd) maakt een `Account` met rol
  **CAREGIVER** in de eigen organisatie. **Gekozen flow:** direct aanmaken met een
  **server-gegenereerd tijdelijk wachtwoord** (256 bit, `auth/caregiver-account.ts`) in plaats van
  een uitnodigingsmail met wachtwoord-instellink — zo blijft het inrichten van een organisatie
  werken **zonder mailserver** (zelfde uitgangspunt als T1.3/T1.4) en kiest een beheerder nooit zélf
  een wachtwoord voor iemand anders. Het rauwe wachtwoord verlaat de server **één keer**; at-rest
  staat alleen de argon2id-hash (zoals bij koppelcodes T2.3 en worker-tokens T5.8). Rol en
  organisatie komen uitsluitend van de server — het aanmaakschema kent geen `role`/`organizationId`,
  dus meegestuurde waarden kunnen niet tot privilege-escalatie of een account in een andere tenant
  leiden. Een bestaand e-mailadres (ook in een andere organisatie) geeft een **neutrale** `409
  ACCOUNT_CREATE_FAILED` (geen enumeratie; uniciteit via de db-constraint, dus geen race en geen
  timing-verschil). Het account start ongeverifieerd en krijgt best-effort een verificatiemail;
  aanmaken wordt geaudit als `account.create` (alleen de rol als context, nooit het wachtwoord).
  UI: nieuw paneel **"Begeleider aanmaken"** in de beheeromgeving (`web/src/CaregiverAccountsPanel.tsx`)
  dat het tijdelijke wachtwoord één keer toont; de koppelweergave (T2.2) laadt daarna opnieuw zodat
  het nieuwe account meteen aan te vinken is, en haar lege staat verwijst nu naar dat paneel.
  `AccountPublic` kreeg een `name`-veld (nullable) zodat de beheer-UI de begeleider bij naam toont.
  Tests: `server/src/routes/accounts.test.ts` (aanmaken + inloggen met het tijdelijke wachtwoord,
  rol/tenant vast ongeacht invoer, 401/403, verificatie-gate, neutrale 409, 400 op ongeldige invoer,
  audit-regel zonder wachtwoord, isolatie in de accountlijst), `web/src/CaregiverAccountsPanel.test.tsx`
  en een end-to-end flow in `web/src/App.test.tsx` (aanmaken → verschijnt in de koppelweergave →
  koppelen). Gedocumenteerd in `docs/api.md`, `docs/security.md` en `README.md`. Meerwerk dat hieruit voortkwam: de begeleider kon zijn
  tijdelijke wachtwoord niet zelf wijzigen — opgelost in **T2.5** (hierboven).

### Gewijzigd
- **T1.5 Seed maakt de bootstrap-admin idempotent geverifieerd.** De upsert in `server/prisma/seed.ts`
  liet bij een **bestaand** account alles ongemoeid (`update: {}`), waardoor een admin die vóór de
  T1.4-migratie was aangemaakt na herseeden `emailVerifiedAt = null` hield en op de verificatie-gate
  (`403 EMAIL_NOT_VERIFIED`) bleef hangen — precies wat er met `admin@intento.local` in de dev-db gebeurde.
  De seedlogica verhuisde naar [`server/src/db/bootstrap-seed.ts`](server/src/db/bootstrap-seed.ts)
  (`seedBootstrapOrgAndAdmin`), zodat script én tests dezelfde code draaien; `prisma/seed.ts` is nu een dunne
  runner. Na de upsert zet een **gerichte** `updateMany` op `emailVerifiedAt: null` de verificatie alsnog —
  dus alléén voor een nog ongeverifieerd account: een al gezette verificatiedatum verschuift niet en het
  **wachtwoord blijft ongemoeid** (een later gewijzigd wachtwoord blijft geldig). De seed meldt het expliciet
  wanneer hij een bestaande admin alsnog verifieert. Tests: `server/src/db/bootstrap-seed.test.ts` (verse db,
  herstel van een ongeverifieerde admin, wachtwoord/verificatiedatum ongemoeid, idempotentie zonder dubbele
  rijen, lowercase-normalisatie van de e-mail). Gedocumenteerd in `docs/data-model.md`, `docs/security.md`
  en `README.md`.

### Beveiliging
- **Afhankelijkheden bijgewerkt naar 0 kwetsbaarheden.** `npm audit` meldde 13 nieuwe advisories
  (brace-expansion, fast-uri, find-my-way, nanoid, postcss, shell-quote, undici, valibot e.a.);
  `npm audit fix` loste er 10 op. De resterende keten (`prisma` → `@prisma/config` → `deepmerge-ts < 8`,
  stack-exhaustion) is opgelost met een root-`override` op `deepmerge-ts@^8.0.2` in plaats van de door npm
  voorgestelde **downgrade naar prisma 6** (breaking). Prisma CLI (`generate`, `migrate deploy`, `db seed`)
  en de volledige testsuite geverifieerd met die override; `npm audit` = 0.

### Toegevoegd
- **T8.2 Audit-logging, security review en MVP-check.** Sluitstuk van de MVP (DESIGN §9.4, §10.3). Een
  herbruikbare `recordAudit(...)` (`server/src/audit/audit.ts` + centrale actiesleutels in
  `audit/actions.ts`) schrijft een **append-only** spoor van **gevoelige acties**: login (geslaagd én
  mislukt), logout, registratie, e-mailverificatie, gebruikersbeheer + instellingen, begeleider-koppelingen,
  koppelcodes, persoonlijke context (create/update/delete), profielexport/-import, worker-tokens en
  conceptvoorstellen. Nieuw model `AuditLog` (migratie `20260712122032_audit_logging`) met indexen op
  `(organizationId, createdAt)`, `accountId` en `action`; **bewust zonder FK's** zodat het spoor een
  verwijderde actor/tenant overleeft. Ontwerp: **best-effort en nooit blokkerend** (een hapering in de
  audit-tabel laat de hoofdactie niet mislukken), **nooit communicatie-inhoud of vrije-tekst-PII** (alleen
  `action`, `outcome`, objectverwijzing en kleine niet-gevoelige `metadata`) en een mislukte login logt
  **geen e-mailadres** (voorkomt enumeratie in het log). Inzage via `GET /admin/audit-logs`
  (`server/src/routes/audit.ts`, `auditLogListResponseSchema`) is **ADMIN-only** en **tenant-gefilterd** op
  `organizationId`; het `ip`-veld blijft server-side. Web: `AuditLogPage` in de beheeromgeving (menselijke
  actie-labels, uitkomstbadge, doelverwijzing, tijdstip) + `api.listAuditLogs()` en een nav-item. Tests:
  server (`routes/audit.test.ts` — login-succes/-failure, instellingen, context zonder PII, export, ADMIN-
  only + tenant-isolatie, CAREGIVER → 403) en web (`AuditLogPage.test.tsx`). Gedocumenteerd in `docs/api.md`,
  `docs/data-model.md` en `docs/security.md`. `/security-review` gedraaid over de fase; MVP-Definition-of-Done
  (DESIGN §10.3) nagelopen — zie README.
- **T8.1 Profielexport en -import.** Gegevenseigenaarschap (DESIGN §6.4, §8.2, FR-019): een beheerder kan
  het volledige communicatieprofiel van een gebruiker exporteren en elders weer importeren. Twee nieuwe
  **ADMIN-only** endpoints (`server/src/routes/profile-transfer.ts`). `GET /users/{id}/export` bundelt het
  communicatieprofiel/de instellingen, de persoonlijke context en de geleerde voorkeuren — **niet** account-
  of organisatiegegevens, id's of tokens — en levert ze als één **versleutelde** payload
  (`profileExportResponseSchema`: `{ data, filename }`). De payload wordt in zijn geheel met de
  omgevingssleutel (`ENCRYPTION_KEY`, dezelfde AES-256-GCM-`Encryptor` als T6.1) versleuteld, dus het
  exportbestand is **onleesbaar zonder die sleutel**. `POST /users/import` (ADMIN + geverifieerd e-mailadres,
  zoals `POST /users`) ontsleutelt en valideert de payload en maakt er een **nieuwe** gebruiker mee aan in de
  eigen organisatie (context opnieuw versleuteld at-rest); `name` overschrijft optioneel de weergavenaam.
  Ongeldige/beschadigde of met een andere sleutel gemaakte invoer → `400 IMPORT_INVALID` (nooit een 500).
  De bouw/versleuteling en het inlezen leven HTTP-vrij in `server/src/users/profile-transfer.ts`. Gedeelde
  schema's (`profileExportSchema`, `profileExportResponseSchema`, `profileImportRequestSchema` +
  `PROFILE_EXPORT_VERSION`, met een versieveld voor latere migratie). Web: `ProfileExportPanel` (downloadknop
  per gebruiker) en `ProfileImportPanel` (bestand kiezen → nieuwe gebruiker) in de beheeromgeving; API-
  methoden `exportProfile`/`importProfile`. Tests: server (`profile-transfer.test.ts` — roundtrip levert een
  identiek profiel in een andere organisatie, onleesbaar zonder sleutel, ADMIN-only/tenant-isolatie,
  verificatie-gate, ongeldige invoer) en web (`ProfileTransferPanel.test.tsx`). Gedocumenteerd in
  `docs/api.md` en `docs/security.md`. **Beperking:** import in een andere deployment vereist dezelfde
  `ENCRYPTION_KEY`; een wachtwoordgebaseerde exportsleutel is toekomstig werk.
- **T7.3 Beheerdashboard en conceptvoorstellen.** Twee nieuwe ADMIN-endpoints en beheerpagina's
  (DESIGN §5.2, §6.2, §7.6, FR-016). **Dashboard** (`server/src/routes/dashboard.ts`,
  `GET /admin/dashboard`): een tenant-gefilterd overzicht van de eigen organisatie — aantal gebruikers
  (totaal/actief), begeleiders en recente gespreksactiviteit — plus het platformbrede aantal openstaande
  AI-conceptvoorstellen. De recente activiteit bevat **geen communicatie-inhoud** (privacy by design,
  DESIGN §6.4): alleen wie/wanneer/status en het aantal bevestigde boodschappen. **Conceptvoorstellen**
  (`server/src/routes/concept-proposals.ts`): reviewlijst (`GET /admin/concept-proposals`, openstaande
  eerst) van begrippen die de validatielaag (T5.2) vastlegde toen de AI een concept aandroeg dat niet in de
  bibliotheek bestaat (de optie bereikte de gebruiker nooit). `POST …/{id}/approve` (`{ symbolId }`)
  koppelt het begrip aan een bestaand pictogram **én voegt het als synoniem toe**, zodat de validatielaag
  het voortaan naar dat pictogram resolvet en de AI het mag aanbieden (FR-016: "pas na goedkeuring
  beschikbaar voor de AI"); `POST …/{id}/reject` laat het buiten de AAC-begrenzing. Net als het AAC-beheer
  zijn voorstellen **platformbreed gedeeld** (niet tenant-gefilterd); rolcontrole (ADMIN) volstaat. Web:
  `DashboardPage` (stat-tegels + activiteitenlijst, tegel navigeert naar de reviewlijst) en
  `ConceptProposalsPage` (per voorstel een pictogram zoeken → koppelen/goedkeuren of afwijzen), met nieuwe
  tabs "Dashboard" en "Conceptvoorstellen" in `AdminNav`. Gedeelde schema's (`dashboardResponseSchema`,
  `conceptProposalSchema` + lijst/approve); API-methoden `getDashboard`, `listConceptProposals`,
  `approveConceptProposal`, `rejectConceptProposal`. `buildSearchText` neemt nu een `Pick`-subset zodat de
  approve-flow de zoekindex kan herbouwen. Tests: server (`dashboard.test.ts` — tenant-filtering, pending-
  telling, geen inhoud, 401/403; `concept-proposals.test.ts` — reviewlijst, goedkeuren → begrip bereikt de
  gebruiker via de validatielaag, afwijzen → blijft buiten, 401/403/404) en web (`DashboardPage.test.tsx`,
  `ConceptProposalsPage.test.tsx`). Gedocumenteerd in `docs/api.md`.
- **T7.2 Ondersteuningsmodus en begeleiderweergave.** De tablet toont nu een
  **ondersteuningsmodus-indicator** ("🤝 Ondersteuningsmodus actief") op het keuze- en voorstelscherm
  wanneer `supportMode` in het communicatieprofiel aanstaat (DESIGN §3.3, FR-011): de begeleider tikt aan
  namens de gebruiker, maar de betekenis blijft van de gebruiker. Een begeleider/beheerder kan **read-only
  meekijken** met het lopende gesprek van een gekoppelde gebruiker via het nieuwe
  `GET /question/users/:id/conversation` (account-auth ADMIN/gekoppelde CAREGIVER, `assertSameTenant` +
  `assertCaregiverAccess`): een snapshot uit de **opgeslagen** stappen (géén AI-aanroep) met
  `supportMode`, een eventuele `caregiverQuestion` en het afgelegde pad (broodkruimel), of `session=null`
  als er geen gesprek loopt — kiezen/bevestigen kan hier niet. **Server-side afdwinging**: bevestigen kan
  nooit vanuit een begeleiderssessie. Nieuw preHandler `forbidAccountSession` (`auth/authorize.ts`) hangt
  vóór `deviceAuthorize` op `POST /conversation/:id/confirm` en weigert elke geldige account-sessie met
  `403 CONFIRM_REQUIRES_USER` — alleen de tablet (device-auth) mag bevestigen (DESIGN §2, §3.3). Web:
  `SupportModeBanner` in `web/src/TabletApp.tsx` en een **meekijk-paneel** in `web/src/QuestionModePage.tsx`
  (knop "Meekijken/Verversen", geen ongevraagd polling). Gedeeld schema `caregiverConversationView`; nieuwe
  API-methode `viewUserConversation`. Tests: server (`conversation.test.ts` — caregiver-cookie op `/confirm`
  → `403`, gebruiker bevestigt daarna wél; `question.test.ts` — meekijken met context, `session=null`,
  niet-gekoppeld en cross-tenant `403`) en web (`TabletApp.test.tsx` — indicator aan/uit;
  `QuestionModePage.test.tsx` — meekijken read-only + "geen gesprek"). Gedocumenteerd in `docs/api.md` en
  `docs/security.md`.
- **T7.1 Vraagmodus.** Een begeleider stelt een gekoppelde gebruiker een vraag ("Wat wil je drinken?");
  de AI beperkt de antwoorden en de gebruiker stelt zijn antwoord zelf samen en bevestigt (DESIGN §3.2,
  §8.2, FR-012). `ConversationSession` uitgebreid met **`mode`** (`free`/`question`),
  **`caregiverQuestion`** en **`startedByAccountId`** (migratie `question_mode`, draait schoon op een lege
  db). Nieuwe route (`server/src/routes/question.ts`): `POST /question/start`
  (`{ userId, question, anchorConcept }` → maakt in één transactie een vraagmodus-sessie met een vast
  **topic-anker** als eerste stap, waarvan de kinderen de antwoordopties vormen — de AAC-bibliotheek
  begrenst de antwoorden, §7.6) en `GET /question/users` (de gebruikers waaraan het account een vraag mag
  stellen). Toegang: **ADMIN of gekoppelde CAREGIVER**, met tenant-isolatie (`assertSameTenant`) én
  begeleider-koppeling (`assertCaregiverAccess`) — een niet-gekoppelde begeleider krijgt `403`; onbekend of
  optie-loos anker → `400`. De tablet pakt de vraag op via het nieuwe `GET /conversation/pending`
  (device-auth): de nieuwste openstaande vraagmodus-sessie van de eigen gebruiker als volledige
  gesprekstoestand, of `null` → vrij gesprek. De begeleidersvraag reist als **context**
  (`questionContext`) mee in de beperkte AI-prompt (`aiPromptSchema`/`buildAiPrompt`/`decideNextQuestion`)
  en komt als `caregiverQuestion` terug in de gesprekstoestand; de gebruiker kan het topic-anker niet
  ongedaan maken (`/back` op alléén het anker → `400`, zodat het gesprek binnen de vraag blijft). Web:
  nieuwe **begeleiderinterface** (`web/src/QuestionModePage.tsx`, getoond voor de rol CAREGIVER) om een
  gebruiker te kiezen, de vraag te typen en een onderwerp te zoeken/kiezen; de tablet
  (`web/src/TabletApp.tsx`) toont de begeleidersvraag als context boven het keuzescherm en pakt bij het
  openen/"opnieuw beginnen" eerst een klaarstaande vraag op. Gedeelde schema's:
  `questionStartRequest/Response`, `pendingQuestionResponse`, `caregiverQuestion` op
  `conversationStateResponse`. Tests: server (`question.test.ts`) — de "Wat wil je drinken?"-flow
  end-to-end (vraag → dranken als opties → keuze → eigen bevestiging → alleen bevestigde boodschap
  opgeslagen), niet-gekoppelde begeleider `403`, tenant-isolatie, anker-validatie, back-guard en
  `GET /question/users`-koppelfilter; web (`QuestionModePage.test.tsx` + `TabletApp.test.tsx`) — vraag
  versturen, geen-koppeling-melding, foutafhandeling, en de tablet die een klaarstaande vraag oppakt en als
  context toont. Gedocumenteerd in `docs/api.md` en `docs/data-model.md`.
- **T6.3 Leermechanisme (voorkeuren).** Nieuw model **`Preference`** (`userId`, `concept`, `confidence`,
  `count`, `source`, `suggestionStatus`, `createdAt`, `updatedAt`; unieke `(userId, concept)`, index op
  `userId`, cascade delete met `User`; migratie `preferences`, draait schoon op een lege db) plus de
  **Learning Engine** (`server/src/users/preferences.ts`, DESIGN §3.8, §6.2, §7.1 taak 5, FR-014). Leren
  gebeurt uitsluitend bij een **bevestigde** boodschap (`POST /conversation/{id}/confirm`): elk bevestigd
  concept verhoogt `count` en de afgeleide `confidence` (count × 0,2, geklemd op 1) — maar **alléén** als
  `UserCommunicationProfile.aiLearningEnabled=true`, en **nooit** uit afwijzingen/correcties (§3.4 punt 4)
  of onzekere aannames. De voorkeuren reizen als extra **AI-context** (`kind: 'preference'`) mee in de
  beperkte prompt (samen met de toegestane persoonlijke context), eveneens gated op de leer-schakelaar.
  **Begeleider-suggestie (§3.8):** zodra een concept ≥ 3× bevestigd is gaat `suggestionStatus` `none` →
  `pending`; in de beheer-UI verschijnt dan een voorstel om het als persoonlijke context toe te voegen, met
  **accepteren / aanpassen / weigeren**. Nieuwe endpoints (`server/src/routes/preferences.ts`):
  `GET /users/{id}/preferences` (`preferenceListResponseSchema`, met opgezocht `label` en `suggested`-vlag) en
  `POST /users/{id}/preferences/{prefId}/suggestion` (`{ action: 'accept'|'adjust'|'reject', category?, name? }`
  — accept/adjust maken een **versleutelde** `PersonalContext`-rij met `aiUsageAllowed=true`, reject weigert;
  onbekende voorkeur → `404`, geen openstaande suggestie → `409`). Zelfde rol/tenant/koppel-guards als de
  persoonlijke context (ADMIN of gekoppelde CAREGIVER). Web: nieuwe **`PreferencesPanel`**
  (`web/src/PreferencesPanel.tsx`, in de gebruikersdetailkolom) toont geleerde voorkeuren met zekerheid en
  handelt suggesties af; API-client uitgebreid met `listPreferences`/`resolveSuggestion`. Tests: server
  (`preferences.test.ts`) — bevestiging verhoogt de voorkeur en een correctie **niet**, de leer-schakelaar uit
  = geen mutaties, voorkeuren bereiken aantoonbaar de AI-prompt, tenant-/CAREGIVER-isolatie, en de volledige
  suggestieflow (drempel → pending → accept/adjust/reject, versleutelde context, `409` bij dubbel afhandelen);
  web (`PreferencesPanel.test.tsx`) — voorkeuren tonen en accepteren/aanpassen/weigeren van een suggestie.
- **T6.2 Persoonlijke-contextwizard.** Stapsgewijze, pictogram-ondersteunde wizard in de beheeromgeving
  (`web/src/PersonalContextPanel.tsx`, in de gebruikersdetailkolom) waarmee een begeleider/beheerder de
  context van een **gekoppelde** gebruiker vastlegt (DESIGN §3.7 stap 3, §5.2, FR-013): vijf stappen
  (belangrijke personen → dagelijkse plekken → favoriet eten/drinken → favoriete activiteiten → vaste
  routines), elk met eigen glyph en begeleidende tekst. Per item een naam (+ optionele relatie bij
  personen/huisdieren) en een expliciete **"AI mag deze context gebruiken"**-schakelaar (in de wizard
  standaard aan; de server-default blijft opt-in `false`). Na de wizard een **beheeroverzicht** dat alle
  context toont (op categorie gesorteerd) en per rij **bewerken** en **verwijderen** biedt; een lege
  gebruiker start automatisch in de wizard, een gevulde in het overzicht. Nieuwe server-endpoints
  (`server/src/routes/personal-context.ts`): `PUT /users/{id}/context/{contextId}` en
  `DELETE /users/{id}/context/{contextId}` — zelfde rol/tenant/koppel-guards als T6.1, plus een
  eigenaarscontrole (de rij moet bij `{id}` horen, anders `404 CONTEXT_NOT_FOUND` zodat een vreemd id niet
  lekt). API-client uitgebreid met `listPersonalContext`/`createPersonalContext`/`updatePersonalContext`/
  `deletePersonalContext`. Tests: server (`personal-context.test.ts`) bewerken/verwijderen door een
  gekoppelde CAREGIVER, `404` bij een rij van een andere gebruiker, `403` voor een niet-gekoppelde
  CAREGIVER, en **acceptatie**: context die via het endpoint (zoals de wizard) met `aiUsageAllowed=true`
  wordt ingevoerd, bereikt aantoonbaar de beperkte AI-prompt; web (`PersonalContextPanel.test.tsx`) de
  volledige wizard-doorloop, afronden, en bewerken/verwijderen in het beheeroverzicht.
- **T6.1 Persoonlijke context (versleuteld).** Nieuw model **`PersonalContext`** (`userId`, `category`,
  `nameEncrypted`, `relationshipEncrypted?`, `aiUsageAllowed`, `createdAt`, `updatedAt`; index op `userId`,
  cascade delete met `User`; migratie `personal_context`, draait schoon op een lege db) waarin een begeleider/
  beheerder belangrijke personen, huisdieren, plekken, favorieten en routines vastlegt (DESIGN §3.7 stap 3,
  §6.2, §6.3, FR-013/020). **Privacy by design:** de gevoelige vrij-tekst-PII (`name`, `relationship`) staat
  **versleuteld at-rest** — nieuwe module `server/src/crypto/encryption.ts` (`createEncryptor`) met
  **AES-256-GCM** (sleutel uit `ENCRYPTION_KEY` via SHA-256, random IV per veld, versieprefix `v1:`,
  auth-tag tegen geknoei); plaintext verlaat de db nooit en wordt pas op de API-grens ontsleuteld. Endpoints
  (`server/src/routes/personal-context.ts`): `POST /users/{id}/context` (`personalContextInputSchema`:
  `{ category, name, relationship?, aiUsageAllowed? }` — categorie is een gesloten enum, ongeldig → `400`;
  `aiUsageAllowed` **opt-in**, standaard `false`) en `GET /users/{id}/context`
  (`personalContextListResponseSchema`, ontsleuteld). Toegang: **ADMIN + CAREGIVER** (begeleider mag context
  beheren, DESIGN §2), tenant-gebonden (`assertSameTenant`) en voor een CAREGIVER beperkt tot **gekoppelde**
  gebruikers (`assertCaregiverAccess`) — anders `403`. **AI-toestemmingsfilter (DESIGN §6.3):** de gespreks-
  flow laadt via `loadAllowedUserContext` (`server/src/users/personal-context.ts`) **alléén** context met
  `aiUsageAllowed=true`, ontsleutelt die en geeft haar als `userContext` (`{ kind, value }`) mee in de
  beperkte AI-prompt; `decideNextQuestion`/`composeMessage`/`buildState` en de orchestrator-aanroepen zijn
  hierop doorgetrokken. Context zonder expliciete toestemming bereikt de AI dus nooit. Gedeelde schema's:
  `personalContextCategorySchema`, `personalContextInputSchema`, `personalContextPublicSchema`,
  `personalContextListResponseSchema`; server-serializer `personalContextToPublic` (ontsleutelt). Tests:
  `crypto/encryption.test.ts` (roundtrip, unicode, unieke IV, tamper/verkeerde sleutel geweigerd) en
  `routes/personal-context.test.ts` (aanmaken/lezen, **rauwe-db-test**: geen plaintext in de db, standaard geen
  AI-toestemming, ongeldige categorie → `400`, tenant-/niet-gekoppelde-CAREGIVER-`403`, en het **§6.3-filter**:
  alleen `aiUsageAllowed=true` in de prompt, niet-toegestane context nergens zichtbaar). Bewerken/verwijderen en
  de invulwizard volgen in T6.2. Docs: `docs/api.md`, `docs/data-model.md`, `docs/security.md`.
- **T5.8 Beheer-UI voor worker-tokens.** Worker-tokens (T5.5, ADR-0010) waren tot nu toe alleen via de
  CLI (`worker-token:create`) te munten; ze zijn nu ook via de beheeromgeving te **maken**, te **lijsten**
  en in te **trekken**. **Wie mag dat?** Een worker-token is **platform-infrastructuur** (niet
  tenant-gebonden): het beheer is voorbehouden aan een **ADMIN van de platformorganisatie**. Nieuw veld
  **`Organization.isPlatform`** (`Boolean`, default `false`, migratie `organization_is_platform`, draait
  schoon op een lege db) markeert die org; de bootstrap-seed zet het op `true`, publieke zelfaanmelding
  (T1.3) **nooit**. Zo kan een zelf-aangemelde familie/zorg-ADMIN geen infra-credential munten dat jobs van
  álle tenants zou verwerken (privilege-escalatie dichtgezet, DESIGN §9.4). Nieuwe guard
  **`requirePlatformOrg`** (`server/src/auth/authorize.ts`, `403 NOT_PLATFORM_ADMIN`) naast
  `authorize({ roles: ['ADMIN'] })`. Endpoints (`server/src/routes/worker-tokens.ts`): `GET
  /admin/worker-tokens` (lijst met naam, scopes, status `active`/`revoked`/`expired`, `lastSeenAt`,
  `expiresAt` — nooit de hash of het rauwe token), `POST /admin/worker-tokens` (`{ name, scopes?, ttlDays? }`
  → `201` + het **rauwe** token, hier één keer zichtbaar) en `POST /admin/worker-tokens/:id/revoke`
  (idempotent; onbekend id → `404`; daarna weigert `workerAuthorize` het token → `403`). Gedeelde schema's:
  `workerScopeSchema`, `workerTokenStatusSchema`, `workerTokenPublicSchema`, `workerTokenListResponseSchema`,
  `createWorkerTokenRequestSchema`, `createWorkerTokenResponseSchema`; server-serializer `workerTokenToPublic`
  (status afgeleid uit `revokedAt`/`expiresAt`, nooit hash/rauw token). Web: nieuw tabblad **Worker-tokens**
  (`web/src/WorkerTokensPage.tsx`, `AdminNav`) met aanmaakformulier (naam + optionele TTL), eenmalige
  token-onthulling, en een lijst met status-badges en intrek-knop; een niet-platform-ADMIN ziet een uitleg
  i.p.v. de lijst (403 opgevangen). Server-tests (`routes/worker-tokens.test.ts`): platform-ADMIN
  maakt/lijst/trekt in, rauw token één keer + nergens plaintext opgeslagen, niet-platform-ADMIN → `403
  NOT_PLATFORM_ADMIN`, CAREGIVER in platform-org → `403 FORBIDDEN`, ingetrokken token door `workerAuthorize`
  geweigerd, lege naam → `400`, onbekend id → `404`. Web-tests (`App.test.tsx`): aanmaken → rauw token →
  lijst → intrekken, en de uitleg voor een niet-platformbeheerder. Gedocumenteerd in ADR-0010 (addendum),
  `docs/api.md`, `docs/data-model.md`, `docs/security.md` en `README.md`.
- **T5.7 Tablet-UX voor WAITING (wachten op een AI-worker).** De backend antwoordt bij een volle
  wachtrij met `503 AI_WORKER_BUSY` (`waiting: true`, `position`, `Retry-After`) of tijdelijk
  `AI_WORKER_UNAVAILABLE` (T5.5, ADR-0010); de gebruikersapp toonde dit nog niet. De web-client
  ([`api.ts`](web/src/api.ts)) leest nu de extra velden (`retryAfterMs`, `position`) op
  `ApiRequestError` en biedt `isAiWaitingError`; het gedeelde `aiWaitingErrorSchema`
  ([`shared`](shared/src/index.ts)) valideert de responsvorm. De tablet-UI
  ([`TabletApp.tsx`](web/src/TabletApp.tsx)) vangt deze 503's op met een rustige, foutvrije
  wachtstand (`role="status"`, "Even geduld…", optioneel de plek in de rij) en **polt** de laatste
  gespreks-actie (`/next`, `/correction`, `/generate`) automatisch opnieuw na de voorgestelde
  wachttijd, tot er een vraag/voorstel terugkomt — zowel in het keuze- als het voorstelscherm, met
  een unmount-guard tegen state-updates na weg-navigeren. Dezelfde afhandeling voor
  `AI_WORKER_UNAVAILABLE`. Web-tests dekken de wacht- en herstel-flow bij zowel `/next` als
  `/generate` (rustige wachtstand → automatisch herstel, geen harde fout).
- **T5.6 Standalone Ollama-worker (Python).** Nieuwe, losstaande deploybare applicatie
  [`ai-worker/`](ai-worker/) (Python ≥ 3.11, **stdlib-only** — geen third-party-dependencies) die met een
  worker-token (T5.5, ADR-0010) verbinding maakt met de backend, AI-jobs van de wachtrij claimt
  (**worker-initiated** long-poll, robuust achter NAT) en ze verwerkt tegen een **Ollama**-endpoint op
  (mogelijk) een andere machine. Gestructureerde uitvoer wordt afgedwongen via Ollama's `format`-JSON-schema
  (`/api/generate`) en teruggeleverd via `…/jobs/:id/result`; de backend **hervalideert** die vorm met zod
  én tegen de AAC-bibliotheek (T5.1/T5.2), dus een onbekend concept van een worker bereikt de gebruiker
  nooit. **Concurrency-limiet:** een semaphore van `MAX_THREADS` gates zowel het claimen als het verwerken
  (`ThreadPoolExecutor`), zodat er nooit meer dan `MAX_THREADS` gelijktijdige Ollama-aanroepen zijn — de
  worker (en daarmee de site) overvraagt Ollama niet. **Heartbeats** verlengen de lease tijdens lange
  inferentie; een Ollama-fout/time-out of onbruikbaar antwoord leidt tot een nette `…/jobs/:id/fail`
  (job terug in de wachtrij of afgeschreven) zonder crash. Config via env met fail-loud-validatie
  (`BACKEND_URL`, `WORKER_TOKEN`, `OLLAMA_URL`, `OLLAMA_MODEL`, `MAX_THREADS`, time-outs/intervallen);
  eigen [README](ai-worker/README.md) en [`.env.example`](ai-worker/.env.example). Tests (stdlib
  `unittest`, volledig offline): job-lus (claim→Ollama→resultaat/fout, onbekend concept gefilterd,
  onbekende taak/Ollama-fout → fail zonder crash), **concurrency-limiet** (meer jobs dan `MAX_THREADS`
  overschrijden de limiet niet), **echte HTTP-round-trip** tegen lokale stub-servers (bearer-auth, fout
  token → 401, 204 bij lege claim), config- en promptbouw. **Robuuste gestructureerde uitvoer:** de worker
  dwingt JSON af via zowel Ollama's `format`-schema (lokale modellen) als een **expliciete beschrijving van
  de JSON-velden in de prompt** (cloud-/reasoning-modellen honoreren het schema niet hard) en zet
  `think:false` (anders lekt de uitvoer naar het `thinking`-veld en blijft `response` leeg). **Live rooktest
  uitgevoerd** (2026-07-11): de volledige worker-lus (claim → Ollama → resultaat, met heartbeats) draaide
  end-to-end tegen **`gpt-oss:120b-cloud`** via Ollama; beide taken leverden geldige, AAC-begrensde uitvoer
  (`select_next_question` → "Wat wil je eten?" met opties appel/brood/melk; `generate_message` → "Ik wil
  een appel."). De geautomatiseerde tests draaien los hiervan volledig offline.
- **T5.5 Externe AI-workers: wachtrij en worker-protocol (backend).** Een gedistribueerd worker-model
  naast de lokale mock (DESIGN §7.2, §7.7, §9.2, §9.3, §9.4; **ADR-0010**). Nieuwe env-waarde
  **`AI_PROVIDER=queue`** met een **`QueueAiProvider`** (`server/src/ai/queue-provider.ts`) die aanvragen
  op een **DB-wachtrij** zet i.p.v. synchroon uit te voeren, achter dezelfde `AiProvider`-interface — de
  orchestrator en validatielaag (T5.1/T5.2) blijven ongewijzigd, dus **worker-uitvoer doorloopt exact
  dezelfde zod-parse én AAC-validatie** (een onbekend concept van een worker bereikt de gebruiker nooit).
  Twee nieuwe modellen + migratie (`ai_worker_queue`): **`AiJob`** (wachtrij: `payloadJson`, `status`
  WAITING_FOR_WORKER/QUEUED/CLAIMED/SUCCEEDED/FAILED/EXPIRED, `attempts`, lease- en TTL-velden) en
  **`WorkerToken`** (infrastructuur-credential, **gehasht at-rest** met SHA-256, scope `ai:process`,
  intrekbaar/verlopend). **Worker-initiated protocol** (`server/src/routes/ai-worker.ts`, alle onder
  `workerAuthorize`, bearer-token, per-IP rate-limited, robuust achter NAT): `POST /ai/worker/claim`
  (long-poll), `…/jobs/:id/heartbeat`, `…/jobs/:id/result` (op de grens tegen de zod-schema's gevalideerd)
  en `…/jobs/:id/fail`. **Backpressure** via `AI_WORKER_MAX_CONCURRENT_JOBS`: boven het maximum krijgt de
  aanvrager **`WAITING_FOR_WORKER`** met positie → 503 `AI_WORKER_BUSY` + `Retry-After` i.p.v. te
  blokkeren. **Crash-herstel zonder achtergrond-timer:** een opportunistische sweep (bij elke
  enqueue/claim/poll) legt een verlopen lease terug (na `AI_WORKER_MAX_ATTEMPTS` → FAILED) en laat
  nooit-opgepakte jobs verlopen (EXPIRED). Worker-tokens worden gemunt via een CLI
  (`npm run worker-token:create --workspace=server -- --name <label>`); het rauwe token wordt één keer
  getoond. Nieuwe env: `AI_WORKER_MAX_CONCURRENT_JOBS`, `AI_WORKER_LEASE_MS`, `AI_WORKER_MAX_ATTEMPTS`,
  `AI_WORKER_QUEUE_TTL_MS`, `AI_WORKER_CLAIM_LONGPOLL_MS`, `AI_WORKER_POLL_INTERVAL_MS`,
  `AI_WORKER_RATE_LIMIT_MAX/_WINDOW_MINUTES`. Tests: wachtrij-service (queue→claim→resultaat, backpressure
  met positie, promotie, crash-requeue, maxAttempts→FAILED, heartbeat, EXPIRED, `waitForJobResult`),
  `QueueAiProvider` (resolve via gesimuleerde worker, busy, time-out), worker-endpoints (auth 401/403,
  claim/resultaat/heartbeat, verkeerd gevormd resultaat → 400), en **end-to-end** op de gespreksflow
  (onbekend worker-concept afgevangen als `ConceptProposal`; volle wachtrij → 503 met positie).
  Gedocumenteerd in `docs/adr/0010`, `docs/architecture.md`, `docs/api.md`, `docs/data-model.md`,
  `docs/security.md`, `README.md` en `.env.example`. **Buiten scope (nieuwe vervolgtaken in TASKS.md):**
  de tablet-UX voor WAITING (spinner + polling) en een beheer-UI voor worker-tokens; de standalone
  Python/Ollama-worker is T5.6.
- **T5.4 Correctieflow.** Nieuw endpoint **`POST /conversation/{id}/correction`** (`type: "wrong_guess"`,
  standaard) voor het afwijzen van een voorstel (❌), DESIGN §3.4, §6.2 (CorrectionEvent), §7.6, FR-009.
  De flow gaat **niet** terug naar het begin: de **heranalyse** (`server/src/conversation/correction.ts`,
  `analyzeCorrection`) bepaalt puur uit de opgeslagen stappen de vermoedelijke foutstap — de stap met de
  **laagste interpretatie-zekerheid** (`ConversationStep.confidence`, §7.4; tie-break: vroegste stap,
  terugval op de laatste stap als geen zekerheid bekend is). Die stap en alles erna worden **teruggerold**
  en het afgewezen concept wordt vastgelegd als **`CorrectionEvent`** (nieuw model + migratie). Daarna
  volgt een **gerichtere hervraag** op het teruggerolde punt. De afgewezen concepten van een sessie worden
  bij élke volgende beslissing uitgesloten (`buildState` → `decideNextQuestion(excludeConcepts)`), zodat
  dezelfde foutieve route **nooit opnieuw** wordt aangeboden (§7.5) — ook na `/back` of `/next`.
  **Geen leerdata:** correcties raken nooit voorkeuren (de `Preference`-laag komt in T6.3); bij een
  correctie wordt niets opgeslagen als boodschap en blijft de sessie `ACTIVE`. De tablet-UI koppelt ❌ nu
  aan `/correction` i.p.v. `/back`: het voorstelscherm start de correctieflow en toont de gerichte
  hervraag als gewoon keuzescherm (geen apart component; `conversationStateResponseSchema` blijft de vorm).
  Tests: unit voor `analyzeCorrection` (laagste zekerheid, tie-break, null-terugval), **end-to-end via
  HTTP** (gerichte hervraag op de foutstap, afgewezen route niet opnieuw aangeboden — ook bij vervolgkeuze
  en `/back`, `CorrectionEvent` vastgelegd, niets geleerd/opgeslagen, 400 zonder keuzes, 400 bij onbekend
  type) en web (❌ → correctieflow toont hervraag zonder de afgewezen route). Gedocumenteerd in
  `docs/api.md`, `docs/data-model.md` en `docs/architecture.md`.
- **T5.3 AI-boodschapgeneratie.** De boodschap achter `POST /conversation/{id}/generate` en `/confirm`
  wordt nu door de **AI-orchestrator** geformuleerd i.p.v. puur sjabloon-gebaseerd (DESIGN §3.1, §7.1
  taak 4, §7.4, §7.8, FR-007/008). Nieuwe AI-taak **`generate_message`**: de `AiProvider`-interface krijgt
  een **optionele** `generateMessage(prompt)`-methode (`{message, confidence?}`, zod-gevalideerd); een
  provider die het niet kan (zoals de deterministische mock) laat de methode weg. `buildMessagePrompt`
  (`server/src/ai/prompt.ts`) stelt dezelfde **beperkte, verse context** samen (`systeemregels + doel +
  AAC-regels + gebruikerscontext + bevestigde concepten`; **geen** chatgeschiedenis, gesloten sleutelset),
  en `AiOrchestrator.generateMessage` valideert de vorm opnieuw. **Safety-laag (§7.8,
  `server/src/conversation/generate.ts`):** `composeMessage` laat de orchestrator de zin formuleren en
  toetst die tegen de **hele AAC-bibliotheek** — bevat de zin het label of een synoniem van een **niet in
  de sessie gekozen** concept, dan is hij onveilig en valt de flow terug op de deterministische
  **sjabloon-zin** (`message.ts`), die per constructie binnen de gekozen concepten blijft. Óók een lege
  AI-zin of een provider zonder capability → sjabloon-terugval. Een concept buiten de sessie bereikt de
  gebruiker (en de db) dus **nooit**. `/confirm` hervormt de zin **server-side** langs dezelfde laag
  (nooit vrije clienttekst). De confidence komt van het model (`>85%`-band; neutrale terugval als de
  provider er geen levert). Tests: `composeMessage` (sjabloon-terugval zonder capability, AI-zin gebruikt
  wanneer veilig, buiten-de-sessie concept tegengehouden, lege zin, doorgegeven concepten, terugval-
  zekerheid), de boodschap-prompt (gesloten sleutelset, geen chatgeschiedenis), `orchestrator.generateMessage`
  (null zonder capability, vormvalidatie), en **end-to-end via HTTP** (voorstelscherm toont de AI-zin en
  slaat die bij bevestigen op; een rogue AI-zin met "mama" — synoniem van het niet-gekozen `mom` — wordt
  tegengehouden en valt terug op de sjabloon, ook in de opgeslagen boodschap). De web-`ProposalScreen`
  (T4.2/T4.3) toont de zin ongewijzigd — de vorm van `conversationGenerateResponseSchema` blijft gelijk.
  Gedocumenteerd in `docs/architecture.md` en `docs/api.md`.
- **T5.2 Validatielaag en confidence-gestuurde vraagselectie.** De **AI-orchestrator vervangt de gescripte
  engine** achter `POST /conversation/{id}/next` (DESIGN §7.3–7.6, §7.8, FR-002/004/009). Nieuwe
  AI-beslissingslaag (`server/src/conversation/decision.ts`) die per beurt: (1) de **AAC-begrensde
  kandidaten** uit de relatieboom laadt (intentie-categorieën → verfijning), (2) **herhaling vermijdt**
  door reeds gekozen (en optioneel expliciet uitgesloten) concepten weg te filteren — vóór én na de
  AI-aanroep, stateloos zodat de terug-functie **exact** blijft, (3) de orchestrator laat kiezen/ordenen,
  (4) de uitvoer door de **validatielaag** (`server/src/ai/validation.ts`) haalt en (5) op zekerheid
  ordent en de fase bepaalt. **Validatielaag (§7.6, §7.8):** elk voorgesteld symbool moet in de
  AAC-bibliotheek bestaan — bestaand concept → houden, synoniem/label → omzetten naar het echte concept,
  anders → een **`ConceptProposal`** (`status: PENDING`) aanmaken en de optie **weglaten**. Een onbekend/
  verzonnen concept bereikt de gebruiker dus **nooit** (ook niet van een onbetrouwbare provider of latere
  externe worker), maar belandt in de reviewlijst voor de beheerder (T7.3). **Confidence (§7.4):** de AI
  levert een optionele **interpretatie-zekerheid**; de drempels (`server/src/ai/thresholds.ts`) bepalen de
  fase — `select` (<60%), `refine` (60–85%), `propose` (>85% of een eindconcept). Bij `propose` is er geen
  vraag meer (`question: null`, `done: true`, klaar voor een voorstel — T4.3/T5.3). `confidence`/`phase`
  reizen mee in `conversationStateResponseSchema` (optioneel) en de interpretatie-zekerheid wordt op de
  `ConversationStep` vastgelegd (was `null` in de gescripte engine). Nieuw model **`ConceptProposal`**
  (migratie `concept_proposals`, draait schoon op een lege db; `concept` uniek → idempotente voorstellen,
  index op `status`). De orchestrator is via `buildApp` injecteerbaar (mock in tests, echte provider via
  `AI_PROVIDER`). Tests: validatielaag (bestaand/synoniem/onbekend, idempotent, ontdubbeling), de
  beslissingslaag (herhaling uitsluiten, onbekend concept nooit getoond, fasen select/refine/propose,
  ordening op zekerheid, vroegtijdig voorstel bij >85%), de confidence-banden, en end-to-end via HTTP een
  provider die een verzonnen concept teruggeeft (tegengehouden + als voorstel vastgelegd). Beslissing en
  begrenzing vastgelegd in **ADR-0009**; gedocumenteerd in `docs/architecture.md`, `docs/api.md` en
  `docs/data-model.md`. *(Live rooktest uitgevoerd tegen een lokale Ollama — `qwen3:30b` en `gemma3:4b`
  — via een tijdelijke, directe provider: de beslissings-/validatielaag en confidence werken end-to-end
  met een echt model (natuurlijke Nederlandse vragen, AAC-begrensde opties, 0 onbekende concepten, de
  fasen select/refine/propose live waargenomen). De **productie**-provider — wachtrij + externe worker —
  volgt in T5.5/T5.6; in de gecommite code is `AI_PROVIDER=ollama` nog niet aangesloten en draaien tests
  op de deterministische mock.)*
- **T5.1 Provider-interface en promptfundament.** Het **fundament onder de AI-fase** (DESIGN §7.2, §7.7,
  §9.2) — nog zonder de gescripte engine te vervangen (dat is T5.2). Nieuwe module `server/src/ai/`:
  een provider-agnostische **`AiProvider`**-interface (`selectNextQuestion(prompt) → {question,
  options[{symbol, confidence}], reason}`, zod-gevalideerd), een **`AiOrchestrator`** die per aanroep de
  **beperkte, verse context** samenstelt (`systeemregels + doel + AAC-regels + gebruikerscontext +
  gesprekscontext + laatste keuze + toegestane opties`; **geen** chatgeschiedenis, DESIGN §7.7/§7.8) via
  `buildAiPrompt` en de provider-uitvoer **opnieuw valideert** (een provider/worker wordt nooit
  vertrouwd), en een **deterministische `MockAiProvider`** voor dev en alle tests (geen netwerk, geen
  key; stelt uitsluitend aangeboden, AAC-begrensde opties voor met aflopende, geklemde confidence). De
  AI werkt in **concept-ruimte** (conceptsleutels, niet symbool-id's of vrije tekst), zodat de uitvoer
  koppelbaar blijft aan de AAC-bibliotheek. De AI-schema's staan bewust **server-intern** (niet in
  `@intento/shared`): de client praat nooit met de AI (DESIGN §8.1). Providerkeuze via env
  (`AI_PROVIDER` = `mock`|`ollama`, plus `AI_API_URL`/`AI_API_KEY`/`AI_MODEL`/`AI_REQUEST_TIMEOUT_MS`);
  `createAiProvider` bouwt in T5.1 alleen de mock — `AI_PROVIDER=ollama` weigert bewust te starten tot
  T5.5/T5.6 (fail-loud i.p.v. stil "geen AI"). Env-validatie eist bij een echte provider een URL + model
  (https in productie). Tests: de prompt heeft aantoonbaar een **gesloten sleutelset** (geen
  chatgeschiedenis/vrije velden), de mock is deterministisch en AAC-begrensd, en de orchestrator gooit op
  ongeldige provider-uitvoer. Providerkeuze en begrenzing vastgelegd in **ADR-0008**; gedocumenteerd in
  `docs/architecture.md`, `docs/api.md`, `docs/security.md` en `.env.example`.
- **T4.3 Boodschap voorstellen en bevestigen (gescript).** De gespreksflow (DESIGN §3.1, §3.6, FR-007)
  eindigt nu in een **voorstel- en bevestigingsstap**. Twee nieuwe endpoints op device-auth:
  `POST /conversation/{id}/generate` vormt uit de gekozen concepten een **sjabloon-gebaseerde** zin
  (bv. "Ik wil buiten wandelen met mijn hond.") met `confidence` en de pictogramreeks, en is bewust
  **vluchtig** — het slaat niets op (DESIGN §3.6, geen afgewezen voorstellen in de db);
  `POST /conversation/{id}/confirm` rondt de sessie af (`status COMPLETED`) en slaat de boodschap op
  (`GeneratedMessage`, `confirmed: true`). De server **hergenereert** de zin deterministisch uit de
  opgeslagen keuzes, zodat de bewaarde boodschap binnen de gekozen concepten blijft (DESIGN §7.8) en
  nooit vrije clienttekst wordt vertrouwd. De zinbouw leeft in een aparte, goed gedocumenteerde module
  (`server/src/conversation/message.ts`) achter een smalle interface — de AI-orchestrator (T5.3) neemt
  dit later over zonder de route-laag te raken. Nieuw model **`GeneratedMessage`** (migratie
  `generated_messages`, draait schoon op een lege db; cascade delete met de sessie). Web: de tablet-UI
  (`TabletApp`) toont bij een eindconcept een **voorstelscherm** (pictogramreeks + zin + ✅ Ja / ❌ Nee);
  ✅ bevestigt en toont de opgeslagen boodschap ("Opnieuw beginnen"), ❌ gaat terug naar de laatste vraag
  (via `/back`, er wordt niets opgeslagen). Nieuwe `DeviceApi`-methodes `conversationGenerate`/
  `conversationConfirm`. Server- en web-tests uitgebreid: de volledige DESIGN §3.1-route → voorstel →
  bevestiging, sjabloon-zinnen per intentie, "alleen bevestigde boodschappen in de db", `409` op een
  tweede bevestiging, `400 NO_STEPS_TO_GENERATE` zonder keuzes, en gebruiker-isolatie (`404`).
  Gedocumenteerd in `docs/api.md` en `docs/data-model.md`.
- **T2.4 Contextindicator-instelling (per-user aan/uit).** De contextindicator (broodkruimel van
  het gekozen pad) in de tablet-UI (T4.2) is nu **per gebruiker** in of uit te schakelen (DESIGN
  §5.2–5.3). Nieuw veld `UserCommunicationProfile.contextIndicator` (`Boolean`, standaard aan,
  migratie `contextindicator_setting`) — draait schoon op een lege db. Meegenomen in het gedeelde
  `communicationProfileSchema` (en daarmee `updateSettingsRequestSchema`/`userPublicSchema`), zodat
  `PUT /users/{id}/settings` de waarde zod-gevalideerd zet en de tablet 'm via `GET /device/me`
  meekrijgt. Web: extra schakelaar in het instellingenformulier (`SettingsForm`) en de tablet-UI
  (`TabletApp`) toont de broodkruimel (`nav[aria-label="Gekozen pad"]`) alleen nog als
  `contextIndicator` aanstaat. Server- en web-tests uitgebreid (roundtrip van de instelling; tablet
  verbergt de contextindicator bij uit). Gedocumenteerd in `docs/api.md`, `docs/data-model.md` en
  `docs/architecture.md`.
- **T4.2 Tablet-UI: startscherm en keuzescherm.** De **gebruikersapp op de tablet** (DESIGN §5.1–5.3,
  FR-001/003) — de derde interface naast de beheeromgeving en de latere begeleiderinterface. Nieuwe
  component `web/src/TabletApp.tsx`, geopend op de `/tablet`-URL (routing in `main.tsx`), draaiend op
  **device-auth** (aparte cookie, T2.3): het apparaat is aan één gebruiker gebonden en start direct in
  de gespreksflow zonder dagelijkse login. Bij het openen wordt `GET /device/me` opgehaald; ontbreekt
  de koppeling, dan verschijnt een **koppelscherm** dat een koppelcode inwisselt (`POST /devices/link`).
  De flow draait op de gescripte engine (T4.1): **startscherm** met de intentievraag + categorieën en
  **keuzescherm** met de vraag + grote pictogramopties, één keuze per scherm. Het communicatieprofiel
  stuurt de UI: opties begrensd tot `iconsPerScreen` (2/4/6/8) en tekstlabels alleen bij `showText`
  (de afbeelding houdt altijd een `alt` voor toegankelijkheid). Altijd een `↩ Terug`-knop (maakt de
  laatste keuze ongedaan, herstelt de vorige opties exact) en een **contextindicator** (broodkruimel van
  het afgelegde pad). Bij een eindconcept (`done`) een tussenscherm "Klaar met kiezen" + "Opnieuw
  beginnen" — het voorstellen/bevestigen van de boodschap volgt in T4.3. Nieuwe, van de beheer-`Api`
  losgekoppelde `DeviceApi`-client (`deviceMe`, `linkDevice`, `startConversation`, `conversationNext`,
  `conversationBack`) zodat de tablet alléén eigen-gebruiker-endpoints kent. Web-tests
  (`TabletApp.test.tsx`) dekken de acceptatie: koppelen → startscherm → keuzescherm → terug herstelt de
  vorige opties, het eindscherm, en dat `iconsPerScreen`/`showText` zichtbaar effect hebben. Geen
  backend- of datamodelwijziging (leunt op T4.1 en T2.3). Gedocumenteerd in `README.md` en
  `docs/architecture.md`.
- **T4.1 Gespreksflow: sessies en stappen.** Backend-fundament voor het communicatieproces
  (DESIGN §3.1, FR-001/005/006/010). Nieuwe modellen `ConversationSession` (gebonden aan één
  `User`) en `ConversationStep` (`order`, `question`, `selectedConcept`, `selectedSymbolId`,
  `confidence?`), migratie `conversation_sessions_and_steps`. **Gescripte engine**
  (`conversation/engine.ts`) over de AAC-relatieboom: de startvraag toont de intentie-categorieën,
  elke volgende vraag de kinderen van het laatst gekozen concept — de "huidige vraag" is een
  **pure functie** van de stappen, zodat de terug-functie de vorige opties exact herstelt. De engine
  zit achter een smalle interface (`currentQuestion`/`resolveOption`) die de AI-orchestrator later
  overneemt (fase 5). Endpoints op **apparaat-auth** (elke sessie automatisch gebruiker-geïsoleerd):
  `POST /conversation/start` (eerste vraag), `POST /conversation/{id}/next` (kern-call: keuze in →
  volgende vraag + opties uit; eindconcept → `done: true`), `POST /conversation/{id}/choice`
  (save-only), `POST /conversation/{id}/back` (laatste keuze ongedaan, vorige context hersteld).
  Randen: keuze buiten de opties → `400 INVALID_CHOICE`, afgeronde sessie → `409 SESSION_NOT_ACTIVE`,
  andere gebruiker → `404 SESSION_NOT_FOUND`, niets om terug te doen → `400 NO_STEPS_TO_UNDO`. Gedeelde
  schema's: `conversationStatusSchema`, `conversationQuestionSchema`, `conversationStepSchema`,
  `conversationChoiceRequestSchema`, `conversationStateResponseSchema`, `conversationChoiceResponseSchema`.
  Server-tests dekken de acceptatie: de volledige voorbeeldroute uit DESIGN §3.1
  (willen → doen → buiten → wandelen → hond), terug herstelt de vorige opties exact, en
  gebruiker-isolatie. Live happy path over HTTP gerookt. De tablet-UI erop volgt in T4.2, het
  voorstellen/bevestigen van de boodschap in T4.3. Gedocumenteerd in `docs/api.md` en
  `docs/data-model.md`.
- **T1.4 E-mailverificatie.** Verificatie van het bij zelfaanmelding (T1.3) aangemaakte
  admin-account. Nieuw veld `Account.emailVerifiedAt` (nullable) en nieuwe tabel
  `EmailVerificationToken` (migratie `email_verification`): het token staat **gehasht at-rest**
  (SHA-256, alleen de hash in de db), is **eenmalig** (`usedAt`) en **verloopt**
  (`EMAIL_VERIFICATION_TTL_HOURS`); een resend maakt het vorige ongebruikte token ongeldig.
  Endpoints: `POST`/`GET /auth/verify-email` wisselt het token in (`200 { verified, account }`;
  ongeldig/verlopen/gebruikt → neutrale `400 INVALID_VERIFICATION_TOKEN`) en
  `POST /auth/verify-email/resend` (publiek, streng rate-limited, **altijd** neutrale respons —
  geen account-enumeratie). Registratie verstuurt voortaan een verificatiemail (best-effort — een
  falende mailserver blokkeert de registratie niet). **Provider-agnostische mail-service**
  (`mail/transport.ts`): SMTP via nodemailer in productie (verplicht via prod-guard),
  log-transport in dev, geheugen-transport in tests (injecteerbaar via `buildApp({ mail })`).
  **Verificatie-gate:** onbevestigde accounts mogen inloggen en hun eigen gegevens bekijken, maar
  gebruikers aanmaken (`POST /users`) is geblokkeerd → `403 EMAIL_NOT_VERIFIED`
  (`requireVerifiedEmail`); de bootstrap-seed-admin is meteen geverifieerd. Publiek veld
  `account.emailVerified`. Web: **verificatiebanner** met "opnieuw versturen"-knop voor een
  onbevestigd account, en een **verificatiepagina** die het token uit de e-maillink (`?token=`)
  inwisselt. Gedeelde schema's: `verifyEmailRequestSchema`, `resendVerificationRequestSchema`,
  `verifyEmailResponseSchema`, `resendVerificationResponseSchema`. Env: `MAIL_FROM`, `SMTP_URL`,
  `EMAIL_VERIFICATION_URL_BASE`, `EMAIL_VERIFICATION_TTL_HOURS`, `RESEND_RATE_LIMIT_*`. ADR-0007.
  Server-, unit- en web-tests dekken de acceptatie (mail verstuurd bij registratie, geldig token →
  geverifieerd, verlopen/gebruikt/ongeldig geweigerd, resend rate-limited en enumeratie-veilig,
  token nergens plaintext, gate → 403). Gedocumenteerd in `docs/api.md`, `docs/data-model.md`,
  `docs/security.md`, `docs/adr/0007-*`, `.env.example`.
- **T1.3 Zelfaanmelding van een organisatie/familie.** Publiek registratie-endpoint
  `POST /auth/register`: maakt in **één transactie** een nieuwe `Organization` (`name` +
  `type` ∈ family/care/personal) plus het eerste `Account` met rol ADMIN (argon2id) en logt
  daarna meteen in (zelfde sessiemechanisme als T1.1: gehasht sessietoken in een ondertekende
  httpOnly+Secure cookie), respons `201` + `{ account }`. Security: de uniciteit van de e-mail
  leunt op de db-constraint (`Account.email @unique`) i.p.v. een losse "bestaat al?"-check —
  dat sluit een race tussen gelijktijdige registraties uit en verraadt niet via responstijd of
  een adres bestaat; een botsing → generieke `409 REGISTRATION_FAILED` (**geen account-enumeratie**,
  volledige non-enumeratie volgt met de e-mailverificatie in T1.4). Wachtwoordsterkte-eis op de
  grens (`strongPasswordSchema`, ≥12 tekens, niet één herhaald teken), streng per-IP rate limit
  (`REGISTER_RATE_LIMIT_*`), alle input zod-gevalideerd; de nieuwe org start leeg en volledig
  tenant-geïsoleerd (T1.2 blijft gelden). Nieuw (nullable) veld `Account.name` voor de
  weergavenaam van de admin (migratie `account_name`). Gedeelde schema's: `organizationTypeSchema`,
  `strongPasswordSchema`, `registerRequestSchema`. Web: **zelfaanmeldscherm** (`RegisterForm`,
  organisatienaam + type + adminnaam + e-mail + wachtwoord) met heen-en-weer-link vanaf het
  loginscherm; bij succes meteen in de beheeromgeving. Env: `REGISTER_RATE_LIMIT_MAX`,
  `REGISTER_RATE_LIMIT_WINDOW_MINUTES`. Server- en web-tests dekken de acceptatie (registreren →
  meteen ingelogd, generieke weigering bij dubbele e-mail zonder te lekken, tenant-isolatie,
  zwak wachtwoord/ongeldig type → 400, rate limit → 429). E-mailverificatie is als aparte taak
  T1.4 genoteerd. Gedocumenteerd in `docs/api.md`, `docs/data-model.md`, `docs/security.md`,
  `.env.example`.

- **T3.3 OpenSymbols-integratie.** In het AAC-beheer kan een beheerder nu een bestaand, vrij te
  gebruiken pictogram bij [OpenSymbols](https://www.opensymbols.org/) opzoeken en koppelen i.p.v.
  zelf te uploaden. De backend **proxyt** de externe dienst (de client praat nooit rechtstreeks,
  DESIGN §8.1): `GET /admin/aac/opensymbols/search?q=…` (ADMIN; gesaneerde resultaten — alleen
  resultaten met een `https`-afbeeldings-URL passeren) en `POST /admin/aac/symbols/:id/opensymbols`
  (haalt de gekozen afbeelding **server-side** op en slaat 'm lokaal op via de bestaande
  `AacSymbol.imageData`-opslag, T3.1/T3.2). Veiligheid: `imageUrl` moet `https` zijn (zod
  `httpsUrlSchema`) én mag geen interne/loopback-host zijn (SSRF-guard `assertSafeImageUrl` — weigert
  `localhost`, `*.local`/`*.internal` en private/loopback-IP-bereiken); het opgehaalde content-type
  moet in de mime-allowlist (PNG/JPEG/WebP → anders `415`) en de bytes binnen `AAC_IMAGE_MAX_BYTES`
  (→ `413`); een externe fout/lege respons → nette `502`, ontbrekende configuratie → `503`. De
  **bron/licentie** reist mee met het pictogram: nieuwe (nullable) velden `imageLicense`,
  `imageLicenseUrl`, `imageAuthor`, `imageAuthorUrl`, `imageSourceUrl` op `AacSymbol` (migratie
  `aac_opensymbols_attribution`), en een `attribution`-object op `aacSymbolSchema`; bij een
  zelf-geüploade afbeelding wordt oude attributie gewist. Gedeelde schema's: `aacAttributionSchema`,
  `httpsUrlSchema`, `openSymbolsSearchQuerySchema`, `openSymbolsResultSchema`,
  `openSymbolsSearchResponseSchema`, `attachOpenSymbolsRequestSchema`. De OpenSymbols-client is
  provider-agnostisch en injecteerbaar (mock in tests; echte `fetch`-implementatie met
  token-uitwisseling + time-out). Env: `OPENSYMBOLS_API_URL`, `OPENSYMBOLS_SECRET` (leeg =
  uitgeschakeld), `OPENSYMBOLS_TIMEOUT_MS`. Web: OpenSymbols-zoekpaneel in het symbooldetail
  (zoeken, resultaten met bronvermelding, koppelen) en attributieweergave onder het pictogram.
  Server- en web-tests dekken de acceptatie (zoeken → koppelen → lokaal opgeslagen met licentie/bron)
  en de fout-/veiligheidspaden (niet-`https`, SSRF, `415`/`413`/`502`/`503`, leeg resultaat). Zie
  ADR-0006. Gedocumenteerd in `docs/api.md`, `docs/data-model.md`, `docs/security.md`.

- **T3.2 AAC-beheer-UI.** Beheeromgeving om de gedeelde pictogrambibliotheek te onderhouden
  (ADMIN; de bibliotheek is platformbreed, dus rolcontrole i.p.v. tenant-filtering). Nieuwe
  admin-endpoints: `GET /admin/aac/symbols` (alle symbolen met relaties, optioneel gefilterd op
  `q`/`category`), `POST`/`PUT /admin/aac/symbols[/:id]` (aanmaken/bewerken; uniek `concept`,
  botsing → `409`; `concept` streng gevalideerd op `^[a-z0-9-]+$`), `DELETE /admin/aac/symbols/:id`
  (relaties casceren mee), `POST /admin/aac/symbols/:id/image` (multipart-upload; mime-allowlist
  PNG/JPEG/WebP → `415`, groottelimiet uit env → `413`), `POST /admin/aac/relations` (relatie
  ouder→kind; geen zelfrelatie → `400`, dubbel → `409`) en `DELETE /admin/aac/relations/:id`.
  Geüploade pictogrammen worden **in de db** bewaard (`AacSymbol.imageData`/`imageMimeType`/
  `imageVersion`, migratie `aac_admin_images`) en hebben voorrang bij het serveren; zonder upload
  valt `GET /aac/images/:id` terug op de SVG-glyph-placeholder. De afbeeldings-URL is nu
  `/aac/images/:id` met cache-buster `?v=<imageVersion>` na een upload (was `/aac/images/:id.svg`).
  Gedeelde schema's: `aacSymbolInputSchema` (met `aacConceptKeySchema`/`aacSynonymsSchema`),
  `aacSymbolAdminSchema` (+ `hasImage`, `children`/`parents` als `aacRelationEdgeSchema`),
  `aacSymbolListResponseSchema`, `aacRelationInputSchema`. Web: nieuwe **AAC-bibliotheekpagina**
  (zoeken/filteren, symbool toevoegen/bewerken/verwijderen, afbeelding uploaden, relaties leggen)
  en tabnavigatie (`AdminNav`) tussen Gebruikers- en AAC-beheer. Env: `AAC_IMAGE_MAX_BYTES`
  (standaard 512 KiB). Plugin `@fastify/multipart` (`throwFileSizeLimit: false` → afkappen +
  eigen `413`). Server- en web-tests dekken de acceptatie (symbool + relatie toevoegen en
  terugvinden via zoeken) en de upload-validatie (type/grootte). Gedocumenteerd in `docs/api.md`,
  `docs/data-model.md`, `docs/security.md`.

- **T3.1 AAC-model, seed en zoek-API.** Prisma-modellen `AacSymbol` (gedeelde, niet-tenant-gebonden
  pictogrammen: unieke `concept`-sleutel, `label`, `category`, `glyph`, `synonyms` als JSON en een
  afgeleide genormaliseerde `searchText`-zoekindex) en `AacConceptRelation` (begripsboom
  parent→child, samengestelde unieke `(parentId, childId, relation)`, beide `onDelete: Cascade`),
  migratie `aac_library`. Endpoints `GET /aac/search?q=…` (hoofdletterongevoelig zoeken op concept,
  label én synoniemen; toegankelijk voor een ingelogd **account óf** een gekoppeld **apparaat**,
  anders `401`) en `GET /aac/images/{id}.svg` (publiek, server-gerenderde SVG-placeholder uit de
  emoji `glyph` — echte uploads volgen in T3.2). Portabiliteitskeuze: één `contains` op de vooraf
  lowercased `searchText` + genormaliseerde zoekterm werkt identiek op SQLite en PostgreSQL, zonder
  DB-specifieke `mode: 'insensitive'`. Idempotente bibliotheek-seed (`server/src/aac/library.ts` +
  dataset `server/src/aac/data.ts`, ~31 symbolen + relaties voor de voorbeeldflows uit DESIGN §3),
  meegenomen in `npm run db:seed`. Gedeelde schema's (`aacCategorySchema`, `aacSymbolSchema`,
  `aacSearchQuerySchema`, `aacSearchResponseSchema`). Server-tests dekken schone/ idempotente seed,
  zoeken-op-synoniem, hoofdletterongevoeligheid, lege query (`400`), auth (account én device, `401`
  zonder), en het serveren/404 van pictogrammen. Gedocumenteerd in `docs/api.md`,
  `docs/data-model.md`.

- **T2.3 Tabletkoppeling (device).** Prisma-modellen `Device` (gekoppelde tablet aan één
  gebruiker; `tokenHash` uniek, `lastActive`) en `DeviceLinkCode` (koppelcode; `codeHash`
  uniek, `usedAt`, `expiresAt`), beide `onDelete: Cascade`, migratie `devices_and_link_codes`.
  Endpoints: `POST /admin/users/{id}/device-code` (ADMIN, tenant-gebonden, genereert een
  eenmalige verlopende koppelcode — plaintext eenmalig terug, oude ongebruikte code vervalt),
  `POST /devices/link` (publiek, streng rate-limited, wisselt code in voor een langlevend
  apparaat-token in een ondertekende httpOnly+Secure `intento_device`-cookie) en `GET /device/me`
  (device-auth, eigen gebruiker + apparaat). Nieuwe **aparte auth-pijler** `deviceAuthorize`
  (`server/src/auth/device.ts`): code én token **gehasht at-rest** (SHA-256), eenmalig gebruik
  race-veilig geclaimd; een device-token geeft alléén toegang tot eigen-gebruiker-endpoints,
  nooit tot beheer-/accountroutes. Gedeelde schema's (`deviceCodeResponseSchema`,
  `linkDeviceRequestSchema`, `devicePublicSchema`, `deviceSessionResponseSchema`). Env:
  `DEVICE_CODE_TTL_MINUTES`, `DEVICE_TOKEN_TTL_DAYS`, `DEVICE_LINK_RATE_LIMIT_*`. Gebruiker-
  serializer verplaatst naar `server/src/users/serialize.ts` (hergebruikt door device-routes).
  Beheer-UI: `DevicePanel` genereert en toont een koppelcode per gebruiker (via `Api.generateDeviceCode`).
  Server-tests dekken de end-to-end koppelflow, geweigerde verlopen/gebruikte/onbekende codes,
  scheiding van de auth-pijlers en tenant-isolatie; web-test dekt het genereren. Gedocumenteerd
  in `docs/api.md`, `docs/data-model.md`, `docs/security.md`, `.env.example`.

- **T2.2 Begeleiders koppelen.** Prisma-model `CaregiverAssignment` (many-to-many
  begeleider↔gebruiker, samengestelde PK `userId`+`accountId`, beide `onDelete: Cascade`),
  migratie `caregiver_assignments`. Endpoints `GET /admin/users/{id}/caregivers` (ADMIN,
  begeleiderlijst met `linked`-vlag) en `POST /admin/users/{id}/caregivers` (ADMIN, idempotent
  koppelen/ontkoppelen via `{ accountId, linked }`); beide tenant-gebonden (gebruiker én
  begeleider in de eigen organisatie, anders `403`; niet-CAREGIVER-account → `400 NOT_A_CAREGIVER`).
  Nieuwe toegangsregel: een CAREGIVER ziet/beheert alléén gekoppelde gebruikers —
  `assertCaregiverAccess` (`server/src/auth/caregivers.ts`) op `GET /users/{id}` en
  `PUT /users/{id}/settings` geeft `403` bij een niet-gekoppelde begeleider (ADMIN onverkort
  alle gebruikers van de eigen organisatie). Gedeelde schema's (`caregiverLinkSchema`,
  `caregiverListResponseSchema`, `linkCaregiverRequestSchema`). Beheer-UI: `CaregiversPanel`
  toont per geselecteerde gebruiker de begeleiders met aan/uit-schakelaars (via `Api`-methoden
  `listCaregivers`/`linkCaregiver`). Server- en web-tests dekken koppelen/ontkoppelen,
  idempotentie, rolcontrole en tenant-isolatie (niet-gekoppelde caregiver → 403). Gedocumenteerd
  in `docs/api.md`, `docs/data-model.md`, `docs/security.md`.

- **T2.1 Gebruikersbeheer en communicatieprofiel.** Prisma-modellen `User` (los van
  `Account`, tenant-gebonden, `active`-vlag) en `UserCommunicationProfile` (1-op-1:
  `iconsPerScreen` 2/4/6/8 standaard 4, `showText`, `aiLearningEnabled`, `supportMode`),
  migratie `users_and_communication_profile`. CRUD-endpoints `POST /users` (ADMIN),
  `GET /admin/users` (ADMIN), `GET /users/{id}` (ADMIN/CAREGIVER), `PUT /users/{id}/settings`
  (ADMIN/CAREGIVER, zod dwingt 2/4/6/8 af) en `DELETE /users/{id}` (ADMIN) — alle queries
  tenant-gefilterd, id-toegang via `assertSameTenant` (403 bij andere organisatie).
  Gedeelde schema's (`iconsPerScreenSchema`, `communicationProfileSchema`, `userPublicSchema`,
  `createUserRequestSchema`, `updateSettingsRequestSchema`, `userListResponseSchema`).
  Beheer-UI in de web-app: login-scherm, gebruikerslijst met aanmaken/verwijderen en een
  instellingenformulier (radioknoppen 2/4/6/8 + schakelaars), via een gevalideerde,
  injecteerbare `Api`-client (`web/src/api.ts`). Server- en web-tests dekken CRUD, validatie,
  rolcontrole (caregiver mag niet verwijderen) en tenant-isolatie. Gedocumenteerd in
  `docs/api.md`, `docs/data-model.md`.

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
