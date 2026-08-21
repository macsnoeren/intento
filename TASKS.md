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

- [x] **T1.5 Seed maakt bootstrap-admin idempotent geverifieerd**
  *DESIGN: §2, §6.2 (Account), §9.4.* De upsert in `seed.ts` laat bij een bestaand account `emailVerifiedAt` ongemoeid (`update: {}`), waardoor een admin die is aangemaakt vóór de T1.4-migratie (die de nullable kolom toevoegde) ná herseeden ongeverifieerd blijft — precies wat er in de dev-db gebeurde (`admin@intento.local` heeft `emailVerifiedAt = null`). Fix: in het `update`-blok `emailVerifiedAt` alsnog zetten wanneer die `null` is (read-before-upsert of een gerichte `updateMany`), zodat een bootstrap-/operator-admin na elke seed gegarandeerd geverifieerd is. Het wachtwoord blijft ongemoeid (respecteert een later gewijzigd wachtwoord). Documenteer de keuze kort in de seed-toelichting en `docs/security.md`.
  *Acceptatie:* seed uitgevoerd op een db met een bestaande ongeverifieerde bootstrap-admin → admin is daarna geverifieerd; wachtwoord ongewijzigd; herseeden blijft idempotent (geen dubbele rijen); verse `db:reset` + seed levert nog steeds een geverifieerde admin.

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

- [x] **T2.4 Begeleider-accounts aanmaken/uitnodigen**
  *DESIGN: §2, §5.2, §6.2 (Account), §8.2, FR-017.* Op dit moment ontstaan er alleen ADMIN-accounts (seed + zelfaanmelding T1.3); er is geen endpoint of UI om een `Account` met rol CAREGIVER te maken. Daardoor is de koppelweergave van T2.2 een doodlopend spoor: de lege staat zegt "Maak eerst een begeleider aan", maar er is nergens een plek om dat te doen. Voeg een ADMIN-only flow toe die een CAREGIVER-account binnen de eigen organisatie aanmaakt (uitnodiging via e-mail met verificatie/wachtwoord-instellen, óf direct aanmaken met tijdelijk wachtwoord — kies en documenteer). Security: tenant-isolatie (nieuw account krijgt de org van de ADMIN), rol vast op CAREGIVER (geen privilege-escalatie naar ADMIN via input), zod-validatie, geen account-enumeratie, audit-log op aanmaken. UI: knop/scherm in beheer + duidelijke koppeling naar de bestaande CaregiversPanel. Overweeg dezelfde flow later voor USER-login-accounts (buiten scope hier).
  *Acceptatie:* ADMIN maakt in de UI een begeleider aan; het account verschijnt direct in de koppelweergave (T2.2) en kan aan een gebruiker gekoppeld worden; een CAREGIVER/niet-ingelogde krijgt 403/401; aangemaakt account zit in de juiste org (isolatietest) en heeft rol CAREGIVER ongeacht meegestuurde rol-input; aanmaken wordt geaudit.
  *Gekozen (T2.4):* direct aanmaken met een **server-gegenereerd tijdelijk wachtwoord** (één keer getoond), zodat het inrichten van een organisatie zonder mailserver werkt; zie `docs/security.md`.

- [x] **T2.5 Eigen wachtwoord wijzigen** *(meerwerk uit T2.4)*
  *DESIGN: §2, §6.2 (Account), §9.4.* Een begeleider die met het tijdelijke wachtwoord uit T2.4 inlogt, kan dat nu niet zelf vervangen — het blijft dus onbeperkt geldig en is bekend bij de beheerder. Voeg `POST /auth/password` toe: elk ingelogd account wisselt zijn eigen wachtwoord (huidig wachtwoord verplicht meesturen, nieuw wachtwoord via `strongPasswordSchema`, argon2id-rehash). Security: alleen het **eigen** account (nooit dat van een ander), rate limiting, alle **overige sessies van dat account intrekken** na een wijziging (de huidige sessie blijft), audit-log (`auth.password_change`, nooit het wachtwoord zelf). UI: formulier in de eigen accountweergave; overweeg een "wachtwoord verlopen"-markering op accounts die nog op hun tijdelijke wachtwoord zitten (of noteer dat als aparte taak).
  *Acceptatie:* begeleider wijzigt zijn tijdelijke wachtwoord en logt met het nieuwe in; het oude wachtwoord wordt geweigerd; verkeerd huidig wachtwoord → 401/400 zonder te lekken; andere sessies van hetzelfde account zijn na de wijziging ongeldig; wijziging staat in het audit-log.
  *Gekozen (T2.5):* `POST /auth/password` voor **elk** ingelogd account (het account komt uit de sessie, niet uit de body); huidig wachtwoord verplicht; overige sessies ingetrokken, de huidige blijft; geen lockout maar aparte rate limiting (`PASSWORD_CHANGE_RATE_LIMIT_MAX`) zodat een gekaapte sessie de eigenaar niet kan buitensluiten. Fout huidig wachtwoord geeft bewust een **concrete** melding (`401 INVALID_CURRENT_PASSWORD`): de aanroeper is al als dít account geauthenticeerd, dus er valt niets te enumereren. UI: paneel "Wachtwoord wijzigen" in de nieuwe beheertab "Mijn account" én onderaan de vraagmodus (de enige weergave van een begeleider). Zie `docs/security.md`.

- [x] **T2.6 "Tijdelijk wachtwoord"-markering op accounts** *(meerwerk uit T2.5)*
  *DESIGN: §2, §6.2 (Account), §9.4.* Een begeleider die het tijdelijke wachtwoord uit T2.4 nooit vervangt, blijft draaien op een wachtwoord dat zijn beheerder kent — nu niet zichtbaar voor wie dan ook. Markeer een account dat nog op zijn server-gegenereerde wachtwoord zit (bv. `passwordSetAt`/`mustChangePassword` op `Account`, gezet bij aanmaken en gewist bij `POST /auth/password`), toon dat in de accountlijst van de beheerder en dwing/adviseer wijzigen bij de eerstvolgende login. Beslis en documenteer hoe hard de gate is (zachte banner vs. alleen `/auth/password` en `/auth/me` toegestaan) en houd 'm consistent met de verificatie-gate van T1.4.
  *Acceptatie:* nieuw begeleider-account is gemarkeerd; na het zelf wijzigen van het wachtwoord verdwijnt de markering; de beheerder ziet de markering in de accountlijst; de gekozen gate is getest (inclusief dat het wijzigen zelf altijd mag).
  *Gekozen (T2.6):* `Account.mustChangePassword` (boolean, gezet bij `POST /admin/accounts`, gewist door `POST /auth/password`) en een **harde** gate: zolang de markering staat mag het account alléén `GET /auth/me` en `POST /auth/password` (plus logout, die geen `authorize` gebruikt); al het overige geeft `403 PASSWORD_CHANGE_REQUIRED`. Bewust strenger dan de verificatie-gate van T1.4 — een onbevestigd adres is *onbewezen*, een tijdelijk wachtwoord is *levend en gedeeld* — en als **default-deny in `authorize(...)`** met opt-out per route (`allowPendingPasswordChange`) in plaats van T1.4's opt-in guard, zodat een nieuwe route de gate niet per ongeluk kan missen. UI: één blokkerend scherm voor de houder, paneel "Logins" met de markering voor de beheerder (zonder reset-knop: een beheerder zet nooit het wachtwoord van een ander). Bestaande accounts zijn **niet** met terugwerkende kracht gemarkeerd. Zie `docs/security.md`.

- [x] **T2.7 Nieuw tijdelijk wachtwoord uitgeven voor een vastgelopen account** *(meerwerk uit T2.6)*
  *DESIGN: §2, §6.2 (Account), §9.4.* Sinds T2.6 kan een begeleider die zijn tijdelijke wachtwoord kwijtraakt (of het nooit ontving) niets meer: inloggen lukt niet, en zonder sessie is `POST /auth/password` onbereikbaar. Er is vandaag geen enkele weg terug — geen "wachtwoord vergeten"-flow en geen manier voor de beheerder om opnieuw uit te geven. Voeg een ADMIN-only actie toe die voor een account **binnen de eigen organisatie** een nieuw server-gegenereerd tijdelijk wachtwoord zet (zelfde eigenschappen als T2.4: één keer getoond, argon2id at-rest, `mustChangePassword` weer op `true`) en **alle bestaande sessies van dat account intrekt**. Security: nooit cross-tenant, nooit op het eigen account (dat loopt via T2.5), rol/organisatie van de server, audit-log (`account.password_reset`, nooit het wachtwoord), rate limiting. Overweeg als alternatief/aanvulling een publieke "wachtwoord vergeten"-flow per e-mail (zelfde token-eigenschappen als T1.4: gehasht, eenmalig, verlopend, neutrale respons) — kies en documenteer, met dezelfde eis dat Intento zonder mailserver bruikbaar blijft.
  *Acceptatie:* beheerder geeft in de UI een nieuw tijdelijk wachtwoord uit; het oude werkt niet meer en lopende sessies van dat account zijn dood; het account staat daarna weer als "tijdelijk wachtwoord" gemarkeerd en komt bij inloggen op het blokkerende wachtwoordscherm; een CAREGIVER of een ADMIN van een andere organisatie krijgt 403 (isolatietest); de actie staat in het audit-log zonder wachtwoord.
  *Gekozen (T2.7):* `POST /admin/accounts/{id}/password` (ADMIN + geverifieerd, rate-limited via `PASSWORD_RESET_RATE_LIMIT_MAX`), **geen** publieke "wachtwoord vergeten"-flow per e-mail: Intento moet zonder mailserver bruikbaar blijven en een tweede, publiek bereikbare weg naar een account vergroot het aanvalsoppervlak (blijft mogelijk als latere aanvulling met de tokeneigenschappen van T1.4). De server genereert het wachtwoord (de beheerder kiest nooit dat van een ander), zet `mustChangePassword` terug op `true`, veegt de lockout-boekhouding schoon en trekt **alle** sessies van het doelaccount in. Nooit het eigen account (`403 CANNOT_RESET_OWN_PASSWORD` — dat loopt via T2.5) en nooit cross-tenant (`assertSameTenant`: dezelfde `403 FORBIDDEN` voor "andere organisatie" en "bestaat niet"). Binnen de organisatie mag het voor **elk** account, ook een andere ADMIN, anders loopt een organisatie met één beheerder onherstelbaar vast. UI: knop per login in het paneel "Logins" met bevestigingsstap; het eigen account krijgt er geen. Zie `docs/security.md`.

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

- [x] **T7.2 Ondersteuningsmodus en begeleiderweergave**
  *DESIGN: §3.3, §5.2, FR-011.* Ondersteuningsmodus-indicator in de gebruikersapp (volgens profielinstelling); begeleider kan gesprekcontext meekijken. Afdwingen (server-side): bevestigen van een boodschap kan nooit vanuit een begeleiderssessie.
  *Acceptatie:* indicator zichtbaar bij supportMode; API-test: caregiver-token op `/confirm` → 403.

- [x] **T7.3 Beheerdashboard en conceptvoorstellen**
  *DESIGN: §5.2, §6.2 (ConceptProposal), §7.6, FR-016.* Dashboard (gebruikers, begeleiders, recente activiteit). Reviewlijst van AI-conceptvoorstellen: beoordelen, koppelen aan (nieuw) pictogram, goedkeuren/afwijzen; pas na goedkeuring beschikbaar voor de AI.
  *Acceptatie:* voorstel uit T5.2 verschijnt in de lijst; na goedkeuring bruikbaar in een gesprek, na afwijzing niet (test).

## Fase 8 — Eigenaarschap en MVP-afronding

- [x] **T8.1 Profielexport en -import**
  *DESIGN: §6.4, §8.2, FR-019.* `GET /users/{id}/export`: versleuteld bestand met communicatieprofiel, persoonlijke context, voorkeuren en instellingen (géén account-/organisatiegegevens). `POST /users/import` zet het profiel in een (andere) omgeving. UI-knoppen in beheer.
  *Acceptatie:* export → import in tweede seed-organisatie geeft identiek profiel (roundtrip-test); exportbestand onleesbaar zonder sleutel.

- [x] **T8.2 Audit-logging, security review en MVP-check**
  *DESIGN: §9.4, §10.3.* Audit-logging op gevoelige acties (login, instellingen, context, export/import, beheer) zonder communicatie-inhoud. Draai `/security-review` over de codebase en fix alle bevindingen. Loop de MVP-Definition-of-Done uit DESIGN §10.3 na en documenteer het resultaat in README/CHANGELOG.
  *Acceptatie:* audit-events aantoonbaar gelogd; security review zonder open bevindingen; alle zes MVP-criteria afgevinkt met bewijs.

- [x] **T8.3 Platform-operatorconsole: cross-tenant organisatie- en gebruikersbeheer**
  *DESIGN: §9.1 (multi-tenant-isolatie), §9.4, §10.4 (schaalvisie).* Vandaag is er geen rol die over organisaties heen kijkt: elke ADMIN is gebonden aan de eigen tenant (alle queries gefilterd op `organizationId`, T1.2) en `Organization.isPlatform` ontgrendelt alléén worker-tokenbeheer (T5.8), geen tenant-beheer. Voeg een expliciete **platform-operatorrol** toe (bijv. `PLATFORM_ADMIN`, of een `isOperator`-account binnen de `isPlatform`-org) met een aparte console om organisaties en gebruikers **over tenants heen** te bekijken en te beheren (lijst/aanmaken/deactiveren van organisaties; gebruikers/accounts inzien; misbruik afhandelen). Security is hier het hart van de taak: de niet-tenant-gefilterde endpoints staan lijnrecht tegenover het isolatieprincipe, dus ze moeten (a) uitsluitend voor de operatorrol bereikbaar zijn via een eigen guard (niet via de gewone `authorize`/`tenantScope`-paden), (b) volledig los staan van de reguliere tenant-endpoints zodat een gewone ADMIN nooit per ongeluk cross-tenant kan lezen, (c) elke actie audit-loggen met de operator als actor, en (d) geen communicatie-inhoud of persoonlijke context blootleggen (alleen beheermetadata). Overweeg de operatorconsole als aparte UI/route-tak. Documenteer de rol en de bewuste doorbreking van tenant-isolatie in `docs/security.md` en een ADR.
  *Acceptatie:* een operator-account logt in en ziet/beheert organisaties en gebruikers over tenants heen; een gewone ADMIN of CAREGIVER krijgt op elk operator-endpoint 403 (isolatietest); operatoracties worden geaudit; reguliere tenant-endpoints blijven strikt gefilterd (bestaande isolatietests blijven groen); geen communicatie-inhoud zichtbaar in de console.

- [x] **T8.4 CORS-methoden herstellen (DELETE/PUT/PATCH) + preflight-regressietest**
  *DESIGN: §9.4; CLAUDE.md security-checklist (HTTPS/WSS, headers).* `@fastify/cors` v11 heeft de default `methods` versmald naar `GET,HEAD,POST`; de registratie in `app.ts` geeft geen expliciete `methods` mee, waardoor de browser-preflight elke DELETE/PUT/PATCH cross-origin blokkeert. Gevolg (echt gereproduceerd via OPTIONS-preflight): gebruiker/context/AAC verwijderen én `PUT /users/{id}/settings` falen in de web-UI met "Kan de server niet bereiken", terwijl de server-tests groen blijven omdat `app.inject()` CORS omzeilt. Fix: expliciet `methods: ['GET','HEAD','POST','PUT','PATCH','DELETE']` (en `OPTIONS` waar nodig) in de cors-registratie; controleer meteen of geen andere @fastify/@-plugin-major stilzwijgend defaults heeft gewijzigd. Voeg een regressietest toe die een OPTIONS-preflight met `Origin` + `Access-Control-Request-Method: DELETE` doet en verifieert dat `access-control-allow-methods` DELETE/PUT/PATCH bevat.
  *Acceptatie:* preflight-test groen (DELETE/PUT/PATCH toegestaan voor de geconfigureerde origin); een gebruiker verwijderen en instellingen opslaan werken end-to-end in de browser; ongewijzigde origin-restrictie (geen wildcard); bestaande tests blijven groen.

- [x] **T8.5 Tablet-gespreksscherm blijft hangen op "Laden…" onder React StrictMode**
  *DESIGN: §5.1 (gebruikersapp), FR-001.* `ConversationScreen` in `TabletApp.tsx` gebruikt een `mountedRef` die alléén in de effect-cleanup op `false` wordt gezet en in de body **nooit terug op `true`**. In `<StrictMode>` (main.tsx, alleen dev) mount→unmount→remount React elk component dubbel: na de gesimuleerde unmount blijft `mountedRef.current === false`, waarna het laad-effect de eerste vraag ophaalt maar de guard `if (!mountedRef.current) return;` de `setState` overslaat → `state` blijft `null` → eeuwig "Laden…". Backend is uitgesloten: de volledige flow (link → device-cookie → `/conversation/pending` → `/conversation/start`) is via echte HTTP-inject gereproduceerd en levert de eerste vraag in ~50 ms. Empirisch bevestigd met een StrictMode-render (vraag verschijnt zónder StrictMode, blijft weg mét). Fix: `mountedRef.current = true` aan het begin van de mount-effectbody zetten (idiomatische StrictMode-veilige variant), of overstappen op de `let active = true`-per-effect-pattern die `ProposalScreen` al correct gebruikt. Controleer meteen `App.tsx` en andere schermen op hetzelfde anti-patroon.
  *Acceptatie:* nieuwe web-test die `TabletApp` (linked) in `<StrictMode>` rendert en verifieert dat de eerste vraag verschijnt (geen permanente "Laden…"); handmatige rook op `/tablet` in dev toont na koppelen direct het startscherm; bestaande TabletApp-tests blijven groen.

- [ ] **T8.6 `npm run format:check` weer groen krijgen en tegen terugvallen beschermen** *(ontdekt bij T8.3)*
  *CLAUDE.md (Definition of Done, tooling).* `npm run format:check` is al langere tijd rood en niemand merkte het: het staat niet in de Definition of Done (die noemt `typecheck`, `lint`, `test`, `audit`) en niets dwingt het af, dus de opmaak is per taak verder afgedreven. Stand bij T8.3: **35 bestanden**, waarvan **34 met echte formatverschillen** (regels boven `printWidth: 100` die Prettier wil afbreken, union-types die anders wrappen — bv. `server/src/errors.ts`, `web/src/AdminNav.tsx`) en **1 met alleen CRLF-regeleindes** (`web/src/AacLibraryPage.test.tsx`; Prettier's default `endOfLine: "lf"` markeert zo'n bestand volledig). Let op de volgorde: `npx prettier --write .` in één klap raakt ~35 bestanden en maakt een enorme ruis-diff over vrijwel de hele codebase — doe dit daarom als **eigen commit zonder gedragswijziging**, zodat de diff van latere taken leesbaar blijft. Regeleindes apart aanpakken (`.gitattributes` met `* text=auto eol=lf` of expliciet `endOfLine` in `.prettierrc.json`), anders komt CRLF via een andere editor gewoon terug. Voeg daarna `format:check` toe aan de Definition of Done in CLAUDE.md (en overweeg lint-staged of een pre-commit hook) zodat dit niet stilletjes opnieuw wegzakt.
  *Acceptatie:* `npm run format:check` groen; de formatteer-commit bevat **uitsluitend** opmaakwijzigingen (geen gedragswijziging — `npm test`, `npm run typecheck` en `npm run lint` blijven groen met exact dezelfde testaantallen); regeleindes vastgelegd zodat een tweede `format:check` na een verse clone óók groen is; `format:check` opgenomen in de Definition of Done.

- [ ] **T8.7 Pictogrammen laden cross-origin niet: helmets `Cross-Origin-Resource-Policy: same-origin`** *(ontdekt bij T8.4)*
  *DESIGN: §5.1, §9.4; CLAUDE.md security-checklist (headers).* Bij het nalopen van plugin-defaults voor T8.4 bleek `@fastify/helmet` op **elk** antwoord `Cross-Origin-Resource-Policy: same-origin` te zetten (echt waargenomen op `GET /aac/images/:file` van een draaiende server). De web-client draait op een andere origin dan de API (`VITE_API_URL`, default `http://localhost:3000` vs. Vite op `:5173`) en laadt pictogrammen via `apiUrl()` als `<img src>` — een no-cors resource-load, waar CORS-headers niets aan veranderen en CORP wél. De browser weigert zo'n plaatje dus. Dit is dezelfde blinde vlek als T8.4: `app.inject()` kent geen CORP, dus alle 45 testbestanden blijven groen terwijl de gebruiker lege vakjes ziet. Eerst **reproduceren in een echte browser** (of met een headless check op de CORP-header + een cross-origin `<img>`), want mogelijk is de weergave al op een andere manier opgelost. Fix-richting: `crossOriginResourcePolicy: { policy: 'cross-origin' }` alléén voor de afbeeldingsroute (route-scoped helmet of een `onSend`-hook) in plaats van globaal versoepelen — pictogrammen zijn publieke, niet-persoonlijke plaatjes, de rest van de API moet `same-origin` houden. Overweeg meteen of de CSP `img-src 'self' data:` de web-client niet ook in de weg zit zodra die van een echte host geserveerd wordt.
  **Gereproduceerd bij T8.5 (21-08-2026):** met een echte Firefox 153 tegen de draaiende dev-servers
  (web op `:5173`, API op `:3000`) toont het gespreksscherm de pictogramvakken **leeg** — de labels en
  de rest van de UI staan er wel. De weergave is dus niet op een andere manier al opgelost; de fix
  (route-scoped `cross-origin`-CORP op `/aac/images/:file`) is nog nodig.
  *Acceptatie:* pictogrammen zichtbaar in de web-UI vanaf een andere origin dan de API (handmatige rook + test op de headers van `/aac/images/:file`); alle overige routes houden aantoonbaar `Cross-Origin-Resource-Policy: same-origin` (test); bestaande tests blijven groen.

---

## Na de MVP (fase 4–5 uit DESIGN §10.1 — nog niet uitwerken)

Spraakuitvoer · communicatie op afstand (events/notificaties/queue) · offline-modus · oogbesturing · uitgebreide AAC-relaties · integraties met zorgsystemen.
