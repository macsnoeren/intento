# Changelog

Alle noemenswaardige wijzigingen aan Intento. Format losjes gebaseerd op
[Keep a Changelog](https://keepachangelog.com/). Werk dit bij per afgeronde taak/fase.

## [Unreleased]

### Toegevoegd
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
