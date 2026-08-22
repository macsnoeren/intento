# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## [Unreleased]

### Gerepareerd — vierde gebruikerstest

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
