# TASKS.md — Intento implementatietaken

Gefaseerde takenlijst, afgeleid van `DESIGN.md` (§10 roadmap). Elke taak is een **verticaal plakje** (data → server → UI → test) dat in één schone Claude Code-sessie past.

## Werkwijze

1. Start een **schone chatsessie** per taak (`/clear` of nieuwe sessie).
2. Prompt: `Voer taak T<nr> uit TASKS.md uit.` — CLAUDE.md en de genoemde DESIGN.md-secties geven de context.
3. Taken worden **in volgorde** uitgevoerd; een taak is pas klaar als de Definition of Done uit `CLAUDE.md` volledig groen is.
4. Na afronding: taak afvinken (`[x]`), CHANGELOG bijwerken, committen.
5. Ontdekt meerwerk? **Niet bouwen** — voeg het hier toe als nieuwe taak op de juiste plek.

---

## Fase 0 — Fundament

- [x] **T0.1 Projectskelet en tooling**
  *DESIGN: §9.3.* Richt de repo-root in als npm-workspaces-monorepo (`server/`, `web/`, `shared/`; leg vast in ADR). Server: Fastify 5 met `buildApp()`-factory, zod-gevalideerde `env.ts` (met prod-guards), health-endpoint, centrale foutafhandeling (`ZodError → 400`), helmet/security headers. Web: React + Vite skelet (tablet-first, lege shell). Tooling: TypeScript strict, ESLint + Prettier, vitest, npm-scripts (`dev`, `build`, `typecheck`, `lint`, `test`). Instantieer `README.md`, `docs/` en `.env.example` op basis van `PROJECT-NODEJS/`-sjabloon, ingevuld voor Intento.
  *Acceptatie:* health-endpoint reageert via `inject()`-test én draaiende server; web-shell rendert; alle DoD-checks groen op lege codebase.

- [x] **T0.2 Database-fundament**
  *DESIGN: §6, §9.3.* Prisma met SQLite (dev) en PostgreSQL-compatibel schema, migratie-workflow (`migrate dev`), gescheiden testdatabase met reset per testrun, seed-script-skelet. Documenteer in `docs/data-model.md`.
  *Acceptatie:* migratie draait schoon op lege db; voorbeeldtest schrijft/leest via Prisma in testdatabase.

## Fase 1 — Auth en organisaties

- [x] **T1.1 Accounts, login en organisaties**
  *DESIGN: §2, §6.2 (Organization, Account), §8.2, §9.4.* Modellen Organization + Account (rollen ADMIN/CAREGIVER/USER). `POST /auth/login` met argon2id, sessietokens gehasht at-rest in httpOnly+Secure cookies, logout, strenge rate limiting op login, account-lockout. Seed: eerste organisatie + admin.
  *Acceptatie:* login/logout getest (goed/fout wachtwoord, lockout na herhaald falen, rate limit); sessietoken nergens plaintext opgeslagen.

- [x] **T1.2 Autorisatie en tenant-isolatie**
  *DESIGN: §2, §9.4.* Autorisatie-middleware: rolcontrole per route + verplichte filtering op `organizationId` in elke query. Herbruikbare testhelpers die isolatie aantonen (org A kan nooit data van org B zien).
  *Acceptatie:* isolatietests voor elk bestaand endpoint; ongeautoriseerde toegang geeft 403 met consistente foutstructuur.

- [x] **T1.3 Zelfaanmelding van een organisatie/familie**
  *DESIGN: §2, §3.7 (stap 1), §6.2 (Organization, Account), §8.2, §9.4.* Publiek registratie-endpoint `POST /auth/register`: maakt in één transactie een nieuwe `Organization` (naam + `type` family/care/personal) plus het eerste `Account` met rol ADMIN (argon2id), en logt daarna in (zelfde sessiemechanisme als T1.1). Aanmeldscherm/-formulier in de web-UI (organisatienaam, type, adminnaam, e-mail, wachtwoord). Security: strenge rate limiting op registratie, e-mail uniek (geen account-enumeratie via foutmeldingen), wachtwoordsterkte-eis, alle input zod-gevalideerd; de nieuwe org start leeg en volledig geïsoleerd (tenant-isolatie uit T1.2 blijft gelden). E-mailverificatie is optioneel/voorbereidend — noteer als aparte taak indien buiten scope.
  *Acceptatie:* nieuwe bezoeker registreert een organisatie + admin via de UI en is meteen ingelogd; tweede registratie met hetzelfde e-mailadres wordt geweigerd zonder te lekken of het adres bestaat; rate limit op `/auth/register` getest; de aangemaakte org ziet geen data van andere orgs (isolatietest); ongeldige `type` of zwak wachtwoord → 400.

- [x] **T1.4 E-mailverificatie**
  *DESIGN: §2, §3.7 (stap 1), §6.2 (Account), §9.4.* E-mailverificatie voor het bij zelfaanmelding (T1.3) aangemaakte admin-account: `verifiedAt`/`emailVerified` op `Account`, verificatietoken **gehasht at-rest** met vervaltijd, verstuurd via een provider-agnostische mail-service (SMTP-config via env; in tests/dev een mock/log-transport). `GET/POST /auth/verify-email` wisselt het token in; `POST /auth/verify-email/resend` (rate-limited) verstuurt opnieuw. Onbevestigde accounts blijven beperkt volgens beleid (bv. inloggen mag, maar gevoelige acties geblokkeerd tot verificatie — leg de gekozen grens vast). Security: eenmalige, verlopende tokens, geen account-enumeratie bij resend (altijd neutrale respons), rate limiting.
  *Acceptatie:* na registratie wordt een verificatiemail verstuurd (mock-transport in test); geldig token → account geverifieerd; verlopen/gebruikt/ongeldig token geweigerd; resend rate-limited en lekt niet of het adres bestaat; token nergens plaintext opgeslagen.
  *Opmerking:* T1.3 blijft functioneren zonder mailserver (verificatie is een aanvulling, geen harde blokkade op registratie) — kies en documenteer expliciet welke acties verificatie vereisen.

## Fase 2 — Gebruikers en profielen

- [x] **T2.1 Gebruikersbeheer en communicatieprofiel**
  *DESIGN: §2, §5.3, §6.2 (User, UserCommunicationProfile), §8.2, FR-017.* User CRUD voor admin (`POST /users`, `GET /users/{id}`, `GET /admin/users`, verwijderen) + UserCommunicationProfile (iconsPerScreen 2/4/6/8 standaard 4, showText, aiLearningEnabled, supportMode) via `PUT /users/{id}/settings`. Basis beheer-UI: gebruikerslijst + instellingenformulier.
  *Acceptatie:* admin beheert gebruikers in de UI; instellingen zod-gevalideerd (alleen 2/4/6/8); caregiver mag niet verwijderen.

- [x] **T2.2 Begeleiders koppelen**
  *DESIGN: §2, §8.2, FR-017.* `POST /admin/users/{id}/caregivers`: caregiver-accounts aan gebruikers koppelen/ontkoppelen; caregiver ziet alleen gekoppelde gebruikers. UI in beheeromgeving.
  *Acceptatie:* koppeling werkt in UI; isolatietest: niet-gekoppelde caregiver krijgt 403.

- [x] **T2.3 Tabletkoppeling (device)**
  *DESIGN: §6.2 (Device), §8.2, FR-018.* Koppelcode genereren in beheer, `POST /devices/link` wisselt code in voor langlevend gehasht apparaat-token gebonden aan één gebruiker; tablet start daarna direct in de gebruikersapp zonder dagelijkse login. Codes verlopen en zijn eenmalig.
  *Acceptatie:* koppelflow werkt end-to-end; verlopen/gebruikte code geweigerd; apparaat-token geeft alléén toegang tot eigen-gebruiker-endpoints.

## Fase 3 — AAC-bibliotheek

- [x] **T3.1 AAC-model, seed en zoek-API**
  *DESIGN: §6.2 (AacSymbol, AacConceptRelation), §8.2, FR-015.* Modellen voor symbolen (concept, image, categorie, synoniemen) en relaties (parent/child). Seed-set met voldoende concepten voor de voorbeeldflows uit DESIGN §3 (intenties, activiteiten, gevoelens, lichaamsdelen, eten/drinken, personen/plekken). `GET /aac/search?q=` zoekt op concept én synoniemen. Opslag/serving van pictogramafbeeldingen.
  *Acceptatie:* seed draait schoon; zoek-API vindt op synoniem; afbeeldingen bereikbaar vanuit web.

- [x] **T3.2 AAC-beheer-UI**
  *DESIGN: §5.2 (beheeromgeving), FR-015.* Beheeromgeving: symbolen bekijken/zoeken, categorieën beheren, symbool toevoegen/bewerken (incl. afbeelding-upload met groottelimiet), relaties leggen.
  *Acceptatie:* admin voegt via UI een symbool met relatie toe en vindt het terug via zoeken; upload gevalideerd.
  *Opmerking:* de categorieën vormen een **vaste, gesloten taxonomie** (zod-enum, DESIGN §3); "beheren" is hier filteren/toewijzen bij aanmaken/bewerken, geen dynamische categorie-CRUD.

- [x] **T3.3 OpenSymbols-integratie (bestaande symbolen opzoeken)**
  *DESIGN: §6.2 (AacSymbol), §8.2, FR-015.* Bij het toevoegen/bewerken van een symbool in de beheer-UI (T3.2) een zoekactie tegen [OpenSymbols](https://www.opensymbols.org/) om bestaande, vrij te gebruiken pictogrammen te vinden i.p.v. zelf te uploaden. Server-side proxy naar de OpenSymbols-API (client praat nooit rechtstreeks met externe diensten; API-key/credentials via env), zoekresultaten zod-gevalideerd, gekozen afbeelding wordt lokaal opgeslagen/geserveerd (T3.1) met bronvermelding en licentie op het `AacSymbol`. XSS/SSRF-veilig: alleen `https`-bron-URL's, groottelimiet, contenttype gecontroleerd.
  *Acceptatie:* beheerder zoekt in de UI op een concept, ziet OpenSymbols-resultaten en koppelt er één aan een symbool; de afbeelding wordt lokaal opgeslagen met licentie/bron; externe fout of leeg resultaat wordt netjes afgehandeld; geen niet-`https`-URL passeert de validatie (test).
  *Opmerking:* controleer de OpenSymbols-gebruiksvoorwaarden/licenties en respecteer per-symbool de licentie-attributie.

## Fase 4 — Gespreksflow (gescript, nog zonder AI)

- [x] **T4.1 Sessies en stappen**
  *DESIGN: §3.1, §6.2 (ConversationSession, ConversationStep), §8.2, FR-001/005/006/010.* `POST /conversation/start`, `/next` (keuze in → volgende vraag + opties uit), `/choice`, en terug-functie (laatste stap verwijderen, vorige context herstellen). Vraagselectie is in deze fase een **gescripte engine** op de AAC-relatieboom (intentiecategorieën → verfijning) achter dezelfde interface die later de AI-orchestrator krijgt.
  *Acceptatie:* volledige voorbeeldroute uit DESIGN §3.1 via API-tests; terug herstelt de vorige opties exact; sessies gebruiker-gebonden (isolatietest).

- [x] **T4.2 Tablet-UI: startscherm en keuzescherm**
  *DESIGN: §5.1–5.3, FR-001/003.* Gebruikersapp: startscherm met intentiecategorieën, keuzescherm (vraag + N grote pictogramopties volgens `iconsPerScreen`, tekst optioneel volgens `showText`, één keuze per scherm), `↩ Terug`-knop, optionele contextindicator. Tablet-first, grote klikvlakken, rustig ontwerp.
  *Acceptatie:* gebruiker doorloopt de gescripte flow op de tablet-UI; instellingen (2/4/6/8, tekst aan/uit) zichtbaar effectief.
  *Opmerking:* de `/tablet`-URL toont de gebruikersapp (device-auth). De contextindicator staat nu **altijd** aan; de per-user aan/uit-schakelaar uit DESIGN §5.3 vereist een nieuw veld op `UserCommunicationProfile` (migratie) → belegd als T2.4 hieronder.

- [x] **T2.4 Contextindicator-instelling (per-user aan/uit)**
  *DESIGN: §5.2, §5.3.* Voeg `contextIndicator` (boolean, standaard aan) toe aan `UserCommunicationProfile` (migratie + zod-schema + `PUT /users/{id}/settings`), toon het als schakelaar in het instellingenformulier (T2.1), en laat de tablet-UI (T4.2) de contextindicator (broodkruimel) tonen/verbergen volgens deze instelling.
  *Acceptatie:* schakelaar uit → de tablet toont geen contextindicator meer (web-test); waarde zod-gevalideerd; migratie draait schoon op lege db.

- [x] **T4.3 Boodschap voorstellen en bevestigen (gescript)**
  *DESIGN: §3.1, §3.6, §5.2, §6.2 (GeneratedMessage), §8.2, FR-007.* `/generate` (sjabloon-gebaseerde zin uit gekozen concepten) en `/confirm`. Voorstelscherm: pictogramreeks + zin + ✅/❌. Bij bevestiging: sessie afronden en boodschap opslaan; bij afwijzing nog simpel terug naar laatste vraag (echte correctieflow volgt in T5.4). Afgewezen voorstellen worden niet opgeslagen.
  *Acceptatie:* end-to-end van start tot bevestigde boodschap in de UI; alleen bevestigde boodschappen in de db.

## Fase 5 — AI-orchestrator

- [x] **T5.1 Provider-interface en promptfundament**
  *DESIGN: §7.2, §7.7, §9.2, §9.3.* ADR: keuze LLM-provider. Provider-agnostische `AiProvider`-interface + AI-Orchestrator-service die per aanroep de beperkte context samenstelt (systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze; géén chatgeschiedenis) en gestructureerde output afdwingt (`question`, `options[{symbol, confidence}]`, `reason`). Deterministische mock-provider voor alle tests; API-key via env.
  *Acceptatie:* orchestrator levert met mock-provider geldige, zod-gevalideerde output; prompt bevat aantoonbaar alléén toegestane context.

- [x] **T5.2 Validatielaag en confidence-gestuurde vraagselectie**
  *DESIGN: §7.3–7.6, §7.8, §8.2 (interne interface), FR-002/004/009 (herhaling).* Validatielaag: elk door AI voorgesteld symbool moet bestaan in de AAC-bibliotheek (anders: synoniem zoeken → ConceptProposal aanmaken → optie weglaten). Confidence-drempels (<60% nieuwe vraag, 60–85% verfijnen, >85% voorstel). Herhaling vermijden: eerdere vragen, getoonde opties en afgewezen keuzes bijhouden en uitsluiten. Vervang de gescripte engine achter `/next` door de orchestrator (mock in tests, echte provider via env).
  *Acceptatie:* AI-output met onbekend concept bereikt de gebruiker nooit (test); herhaalde vraag/optie uitgesloten (test); flow werkt live met echte provider (handmatige rooktest gerapporteerd).

- [x] **T5.3 AI-boodschapgeneratie**
  *DESIGN: §3.1, §7.1 (taak 4), §7.4, FR-007/008.* `/generate` via de orchestrator: natuurlijke zin uit bevestigde concepten, met confidence. Voorstel alleen bij >85%; JA/NEE uitsluitend als laatste controle. Zin blijft binnen de gekozen concepten (veiligheidsregels §7.8).
  *Acceptatie:* gegenereerde zin bevat geen concepten buiten de sessie (validatietest); voorstelscherm toont AI-zin end-to-end.

- [x] **T5.4 Correctieflow**
  *DESIGN: §3.4, §6.2 (CorrectionEvent), §7.6, FR-009.* `POST /conversation/{id}/correction` (`wrong_guess`): orchestrator heranalyseert de route, bepaalt de waarschijnlijk foute stap en stelt een gerichtere vraag; dezelfde route wordt niet herhaald. Correctiescherm in de UI (niet terug naar start). CorrectionEvents opgeslagen; er wordt **niet** van geleerd.
  *Acceptatie:* na ❌ volgt een gerichte hervraag over de vermoedelijke foutstap (test met mock); afgewezen route niet opnieuw aangeboden; geen Preference-mutaties door correcties.

- [x] **T5.5 Externe AI-workers: wachtrij en worker-protocol (backend)**
  *DESIGN: §7.2, §7.7, §9.2, §9.3, §9.4.* ADR: keuze voor een gedistribueerd worker-model naast de lokale provider. Nieuwe `AiProvider`-implementatie die aanvragen op een **wachtrij** zet i.p.v. synchroon uit te voeren; een pool van externe workers (bv. Ollama op een andere machine) haalt jobs op en levert gestructureerde output terug via dezelfde zod-schema's als T5.1. Worker-protocol: worker-**initiated** verbinding (long-poll of WS vanaf de worker, robuust achter NAT), authenticatie met een apart **worker-token** (gehasht at-rest, intrekbaar, met scope/rate limit), claim → resultaat/heartbeat → timeout-teruglegging bij crash. **Configureerbaar maximum** aan gelijktijdige jobs (backpressure): bij vol → aanvraag in wachtrij met status `WAITING_FOR_WORKER` en positie/schatting, zodat de website responsive blijft; verlopen wachtrij-items nette timeout. Alle worker-input opnieuw gevalideerd en door de validatielaag (T5.2) — een externe worker wordt nooit vertrouwd.
  *Acceptatie:* met een test-/mock-worker doorloopt een aanvraag queue → claim → resultaat; bij overschrijding van de max krijgt de client een `WAITING`-status i.p.v. te blokkeren (test); ongeldig/ontbrekend worker-token → 401/403; job van een gecrashte worker wordt na timeout opnieuw aangeboden (test); onbekend concept van een worker bereikt de gebruiker nooit (validatietest).
  *Opmerking:* het worker-token is een **infrastructuur**-credential, los van gebruiker/device-tokens; de externe worker is backend-infrastructuur — de client praat nog steeds nooit rechtstreeks met de AI.

- [x] **T5.6 Standalone Ollama-worker (Python)**
  *DESIGN: §7.2, §7.7, §9.2, §9.3.* Aparte, deploybare applicatie (`ai-worker/`, Python) die met een worker-token (T5.5) verbinding maakt met de backend, jobs ophaalt en tegen een **Ollama**-endpoint op een andere computer draait; gestructureerde output (question/options/reason) afgedwongen en teruggestuurd. **Multi-threading met een configureerbaar maximum** aan gelijktijdige Ollama-aanroepen, zodat de worker (en daarmee de site) niet wordt overvraagd; nette afhandeling van Ollama-fouten/timeouts en teruggave van de job bij falen. Config via env (backend-URL, worker-token, Ollama-URL/model, max threads). Eigen README met opzet/draaien/testen en `.env.example`; tests voor de job-loop en concurrency-limiet (Ollama gemockt).
  *Acceptatie:* worker verbindt met een geldig token, verwerkt een job end-to-end tegen een (gemockte) Ollama en levert geldige output; meer jobs dan `max_threads` overschrijden de limiet niet (test); Ollama-fout → job netjes teruggelegd, geen crash; met een echte Ollama op een tweede machine loopt de flow live (handmatige rooktest gerapporteerd).

- [x] **T5.7 Tablet-UX voor WAITING (wachten op een AI-worker)** *(meerwerk uit T5.5)*
  *DESIGN: §5.1–5.3, §9.4.* De backend levert bij een volle wachtrij `503 AI_WORKER_BUSY` met `waiting: true`, `position` en `Retry-After` (T5.5, ADR-0010), maar de gebruikersapp toont dit nog niet. Vang deze respons in de tablet-UI op: toon een rustige "even wachten"-indicator (evt. positie), en **poll** de laatste gespreks-actie automatisch opnieuw na `Retry-After` tot er een vraag/voorstel terugkomt, zonder de gebruiker een fout te tonen. Dezelfde afhandeling voor `AI_WORKER_UNAVAILABLE` (nette terugval/melding). Web-tests op de wacht- en herstel-flow.
  *Acceptatie:* bij `503 AI_WORKER_BUSY` blijft de app in een wachtstand en herstelt automatisch zodra een worker antwoordt; geen harde fout of vastloper in de UI.

- [x] **T5.8 Beheer-UI voor worker-tokens** *(meerwerk uit T5.5)*
  *DESIGN: §5.2, §9.4.* Worker-tokens worden nu alleen via de CLI (`worker-token:create`) gemunt. Voeg een beheerscherm (ADMIN) toe om worker-tokens te **maken** (naam, scope, optionele TTL — rauw token éénmalig tonen), te **lijsten** (naam, scopes, `lastSeenAt`, status) en in te **trekken** (`revokedAt`). Server-endpoints achter account-auth (ADMIN), input zod-gevalideerd; het rauwe token verlaat de server verder nooit. Let op: een worker-token is een **platform/infrastructuur**-credential, niet tenant-gebonden — bepaal en documenteer wie het mag beheren (platformbeheer vs. organisatie-ADMIN).
  *Acceptatie:* ADMIN maakt/lijst/trekt een worker-token in via de UI; ingetrokken token wordt door `workerAuthorize` geweigerd (403); rauw token alleen bij aanmaken zichtbaar.

## Fase 6 — Persoonlijke context en leren

- [x] **T6.1 Persoonlijke context (versleuteld)**
  *DESIGN: §3.8 n.v.t., §6.2 (PersonalContext), §6.3, §8.2, §9.4, FR-013/020.* `POST/GET /users/{id}/context` met categorieën (PERSON/PET/PLACE/ACTIVITY/FOOD/OBJECT/ROUTINE/OTHER) en `aiUsageAllowed`-vlag. Gevoelige velden versleuteld at-rest (`ENCRYPTION_KEY`). AI-inputfilter: alleen context met `aiUsageAllowed=true` komt in het AI-contextobject.
  *Acceptatie:* contextvelden versleuteld in de db (rauwe-db-test); context zonder toestemming komt aantoonbaar niet in de prompt (test).

- [x] **T6.2 Persoonlijke-contextwizard**
  *DESIGN: §3.7 (stap 3), §5.2, FR-013.* Wizard in de beheeromgeving voor begeleider/beheerder: belangrijke personen, favorieten, dagelijkse plekken — stap voor stap, pictogram-ondersteund. Context beheren (bewerken/verwijderen) na afloop.
  *Acceptatie:* begeleider vult wizard voor gekoppelde gebruiker; ingevoerde context beïnvloedt AI-opties (mock-test op contextinhoud).

- [x] **T6.3 Leermechanisme (voorkeuren)**
  *DESIGN: §3.8, §6.2 (Preference), §7.1 (taak 5), §8.2, FR-014.* Learning engine: bij bevestigde boodschap voorkeuren bijwerken (concept, confidence, source=confirmed_usage) — alléén als `aiLearningEnabled`. Voorkeuren in AI-context; `GET /users/{id}/preferences`; suggestie naar begeleider bij vaak gekozen concept (accepteren/aanpassen/weigeren). Nooit leren van fouten, afwijzingen of aannames.
  *Acceptatie:* bevestiging verhoogt voorkeur, afwijzing niet (test); toggle uit = geen mutaties; suggestieflow werkt in beheer-UI.

## Fase 7 — Begeleider en beheer

- [x] **T7.1 Vraagmodus**
  *DESIGN: §3.2, §8.2, FR-012.* `POST /question/start`: begeleidersvraag start een sessie met vraagcontext; AI beperkt de antwoordopties; gebruiker stelt het antwoord samen en bevestigt. Begeleiderinterface: vraag invoeren en versturen; vraag verschijnt in de gebruikersapp.
  *Acceptatie:* "Wat wil je drinken?"-flow uit DESIGN §3.2 end-to-end; alleen gekoppelde begeleiders kunnen vragen stellen (isolatietest).

- [ ] **T7.2 Ondersteuningsmodus en begeleiderweergave**
  *DESIGN: §3.3, §5.2, FR-011.* Ondersteuningsmodus-indicator in de gebruikersapp (volgens profielinstelling); begeleider kan gesprekcontext meekijken. Afdwingen (server-side): bevestigen van een boodschap kan nooit vanuit een begeleiderssessie.
  *Acceptatie:* indicator zichtbaar bij supportMode; API-test: caregiver-token op `/confirm` → 403.

- [ ] **T7.3 Beheerdashboard en conceptvoorstellen**
  *DESIGN: §5.2, §6.2 (ConceptProposal), §7.6, FR-016.* Dashboard (gebruikers, begeleiders, recente activiteit). Reviewlijst van AI-conceptvoorstellen: beoordelen, koppelen aan (nieuw) pictogram, goedkeuren/afwijzen; pas na goedkeuring beschikbaar voor de AI.
  *Acceptatie:* voorstel uit T5.2 verschijnt in de lijst; na goedkeuring bruikbaar in een gesprek, na afwijzing niet (test).

## Fase 8 — Eigenaarschap en MVP-afronding

- [ ] **T8.1 Profielexport en -import**
  *DESIGN: §6.4, §8.2, FR-019.* `GET /users/{id}/export`: versleuteld bestand met communicatieprofiel, persoonlijke context, voorkeuren en instellingen (géén account-/organisatiegegevens). `POST /users/import` zet het profiel in een (andere) omgeving. UI-knoppen in beheer.
  *Acceptatie:* export → import in tweede seed-organisatie geeft identiek profiel (roundtrip-test); exportbestand onleesbaar zonder sleutel.

- [ ] **T8.2 Audit-logging, security review en MVP-check**
  *DESIGN: §9.4, §10.3.* Audit-logging op gevoelige acties (login, instellingen, context, export/import, beheer) zonder communicatie-inhoud. Draai `/security-review` over de codebase en fix alle bevindingen. Loop de MVP-Definition-of-Done uit DESIGN §10.3 na en documenteer het resultaat in README/CHANGELOG.
  *Acceptatie:* audit-events aantoonbaar gelogd; security review zonder open bevindingen; alle zes MVP-criteria afgevinkt met bewijs.

---

## Na de MVP (fase 4–5 uit DESIGN §10.1 — nog niet uitwerken)

Spraakuitvoer · communicatie op afstand (events/notificaties/queue) · offline-modus · oogbesturing · uitgebreide AAC-relaties · integraties met zorgsystemen.
