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

- [x] **T8.6 `npm run format:check` weer groen krijgen en tegen terugvallen beschermen** *(ontdekt bij T8.3)*
  *CLAUDE.md (Definition of Done, tooling).* `npm run format:check` is al langere tijd rood en niemand merkte het: het staat niet in de Definition of Done (die noemt `typecheck`, `lint`, `test`, `audit`) en niets dwingt het af, dus de opmaak is per taak verder afgedreven. Stand bij T8.3: **35 bestanden**, waarvan **34 met echte formatverschillen** (regels boven `printWidth: 100` die Prettier wil afbreken, union-types die anders wrappen — bv. `server/src/errors.ts`, `web/src/AdminNav.tsx`) en **1 met alleen CRLF-regeleindes** (`web/src/AacLibraryPage.test.tsx`; Prettier's default `endOfLine: "lf"` markeert zo'n bestand volledig). Let op de volgorde: `npx prettier --write .` in één klap raakt ~35 bestanden en maakt een enorme ruis-diff over vrijwel de hele codebase — doe dit daarom als **eigen commit zonder gedragswijziging**, zodat de diff van latere taken leesbaar blijft. Regeleindes apart aanpakken (`.gitattributes` met `* text=auto eol=lf` of expliciet `endOfLine` in `.prettierrc.json`), anders komt CRLF via een andere editor gewoon terug. Voeg daarna `format:check` toe aan de Definition of Done in CLAUDE.md (en overweeg lint-staged of een pre-commit hook) zodat dit niet stilletjes opnieuw wegzakt.
  *Acceptatie:* `npm run format:check` groen; de formatteer-commit bevat **uitsluitend** opmaakwijzigingen (geen gedragswijziging — `npm test`, `npm run typecheck` en `npm run lint` blijven groen met exact dezelfde testaantallen); regeleindes vastgelegd zodat een tweede `format:check` na een verse clone óók groen is; `format:check` opgenomen in de Definition of Done.

- [x] **T8.7 Pictogrammen laden cross-origin niet: helmets `Cross-Origin-Resource-Policy: same-origin`** *(ontdekt bij T8.4)*
  *DESIGN: §5.1, §9.4; CLAUDE.md security-checklist (headers).* Bij het nalopen van plugin-defaults voor T8.4 bleek `@fastify/helmet` op **elk** antwoord `Cross-Origin-Resource-Policy: same-origin` te zetten (echt waargenomen op `GET /aac/images/:file` van een draaiende server). De web-client draait op een andere origin dan de API (`VITE_API_URL`, default `http://localhost:3000` vs. Vite op `:5173`) en laadt pictogrammen via `apiUrl()` als `<img src>` — een no-cors resource-load, waar CORS-headers niets aan veranderen en CORP wél. De browser weigert zo'n plaatje dus. Dit is dezelfde blinde vlek als T8.4: `app.inject()` kent geen CORP, dus alle 45 testbestanden blijven groen terwijl de gebruiker lege vakjes ziet. Eerst **reproduceren in een echte browser** (of met een headless check op de CORP-header + een cross-origin `<img>`), want mogelijk is de weergave al op een andere manier opgelost. Fix-richting: `crossOriginResourcePolicy: { policy: 'cross-origin' }` alléén voor de afbeeldingsroute (route-scoped helmet of een `onSend`-hook) in plaats van globaal versoepelen — pictogrammen zijn publieke, niet-persoonlijke plaatjes, de rest van de API moet `same-origin` houden. Overweeg meteen of de CSP `img-src 'self' data:` de web-client niet ook in de weg zit zodra die van een echte host geserveerd wordt.
  **Gereproduceerd bij T8.5 (21-08-2026):** met een echte Firefox 153 tegen de draaiende dev-servers
  (web op `:5173`, API op `:3000`) toont het gespreksscherm de pictogramvakken **leeg** — de labels en
  de rest van de UI staan er wel. De weergave is dus niet op een andere manier al opgelost; de fix
  (route-scoped `cross-origin`-CORP op `/aac/images/:file`) is nog nodig.
  *Acceptatie:* pictogrammen zichtbaar in de web-UI vanaf een andere origin dan de API (handmatige rook + test op de headers van `/aac/images/:file`); alle overige routes houden aantoonbaar `Cross-Origin-Resource-Policy: same-origin` (test); bestaande tests blijven groen.

## Fase 9 — Bevindingen uit de gebruikerstest (`TEST-FEEDBACK.md`)

- [x] **T9.1 Een beheerder mag ook begeleider zijn**
  *DESIGN: §2, §3.2, §5.2, FR-012/017.* De beheeromgeving toont de begeleiderinterface (vraagmodus + meekijken) alléén als `account.role === 'CAREGIVER'` (`App.tsx`), terwijl de server ADMIN op `/question/*` al toestaat. Een ADMIN kan dus geen vraag stellen of meekijken zonder een tweede account. Bovendien weigert `POST /admin/users/:id/caregivers` een ADMIN-account met 400 `NOT_A_CAREGIVER` en toont `GET .../caregivers` alleen CAREGIVER-accounts, zodat een beheerder zich ook niet als begeleider aan een gebruiker kan koppelen. Fix: tab "Begeleiden" in de beheernavigatie die de vraagmodus-pagina rendert, en ADMIN-accounts toestaan in de begeleiderkoppeling (met rol zichtbaar in de lijst, zodat duidelijk blijft wie beheerder is).
  *Acceptatie:* een ADMIN stelt via de beheeromgeving een vraag en kijkt mee; een ADMIN-account is als begeleider aan een gebruiker te koppelen (test); de bestaande CAREGIVER-flows en isolatietests blijven groen.

- [x] **T9.2 Koppelcode toont ook het tablet-adres**
  *DESIGN: §3.7 (stap 5), §5.2, FR-018.* `DevicePanel` toont alleen de koppelcode, niet wáár die ingevoerd moet worden. Wie de tablet klaarzet moet het pad `/tablet` weten. Fix: het volledige adres (`<origin>/tablet`) bij de code tonen.
  *Acceptatie:* na het genereren van een koppelcode staat het tablet-adres zichtbaar bij de code (test).

- [x] **T9.3 Meekijken ververst automatisch**
  *DESIGN: §3.3, §5.2, FR-011.* `ConversationWatch` haalt de gesprekcontext alleen op als de begeleider op "Meekijken"/"Verversen" klikt (bewuste keuze in T7.2: geen ongevraagd verkeer). In de praktijk is meekijken daarmee onbruikbaar — de begeleider ziet de keuzes van de gebruiker pas na een klik. Fix: automatisch pollen op een rustig interval zolang het paneel zichtbaar is, met de handmatige knop als terugval.
  *Acceptatie:* het meekijkpaneel toont een nieuwe keuze zonder klik (test met tijdsprong); pollen stopt bij unmount en bij een fout blijft de laatste stand staan met melding.

- [x] **T9.4 Zichtbaar of er een AI-worker actief is**
  *DESIGN: §7.2, §9.2, §9.4, ADR-0010.* Niets in de UI laat zien of er een AI achter zit: bij `AI_PROVIDER=mock` draait de deterministische mock (géén AI) en bij `queue` zonder draaiende worker loopt alles in een wachtstand/503. Fix: `GET /ai/status` (account óf apparaat) met de modus (`mock`/`queue`), het aantal recent geziene workers en de laatste worker-activiteit — uitsluitend infrastructuurmetadata, geen communicatie-inhoud. Indicator in de tablet-app én in de beheeromgeving.
  *Acceptatie:* met `AI_PROVIDER=mock` meldt de UI zichtbaar dat er geen AI actief is; met `queue` + een worker die net geclaimd heeft, meldt de UI dat de AI actief is (tests op endpoint en indicator).

- [x] **T9.5 Bevestigen op de tablet faalt als er in dezelfde browser een beheerder is ingelogd**
  *DESIGN: §2, §3.3, FR-011.* `forbidAccountSession` (T7.2) hangt vóór `deviceAuthorize` op `/conversation/:id/confirm` en weigert **elke** request met een geldige account-cookie. Cookies zijn per origin, niet per tab: wie in dezelfde browser is ingelogd in het beheer en daarna `/tablet` opent, stuurt beide cookies mee en krijgt op ✅ Ja de melding "Alleen de gebruiker kan zelf een boodschap bevestigen…" — precies wat er in de test gebeurde. Fix: een geldig **apparaat-token** wint (dat ís de tablet van de gebruiker); alleen een request zonder apparaat-token maar mét account-sessie blijft 403.
  *Acceptatie:* bevestigen vanaf een gekoppeld apparaat slaagt óók met een begeleider-/beheerderscookie op dezelfde request; een request met alléén een account-cookie krijgt onverminderd 403 (bestaande isolatietest blijft groen).

- [x] **T9.6 Startscherm laat een intentiecategorie wegvallen ("Iets zeggen")**
  *DESIGN: §3.1, §5.1, FR-003.* De tablet kapt de opties af op `iconsPerScreen` (`options.slice(0, …)`), dus met de standaard van 4 en vijf intenties valt de alfabetisch laatste (`say` — "Iets zeggen") stilzwijgend weg en is die nooit te kiezen. Fix: opties per scherm blijven begrensd, maar de resterende opties worden bereikbaar via een expliciete "Meer keuzes"-knop (met terug naar de eerste pagina), zodat het profiel gerespecteerd blijft en geen enkele optie onbereikbaar is.
  *Acceptatie:* met `iconsPerScreen=4` en vijf intenties is "Iets zeggen" via "Meer keuzes" bereikbaar en te kiezen (test); bij ≤ `iconsPerScreen` opties verschijnt de knop niet.

- [x] **T9.7 "Vraag versturen" blijft grijs**
  *DESIGN: §3.2, §5.2, FR-012.* De verstuurknop is uitgeschakeld tot er een **onderwerp** gekozen is, maar dat kan alleen via een zoekveld en nergens staat dat het verplicht is — de begeleider ziet een permanent grijze knop zonder uitleg. Fix: een keuzelijst met de onderwerpen die daadwerkelijk antwoordopties hebben (`GET /aac/topics`), plus een zichtbare uitleg waarom de knop nog uitstaat.
  *Acceptatie:* een begeleider kiest een onderwerp uit de lijst zonder te zoeken en verstuurt de vraag; zolang de knop uitstaat, staat er zichtbaar wat er nog ontbreekt (test).

- [x] **T9.8 Geen AI actief: `AI_PROVIDER=mock` valt niet op**
  *DESIGN: §7.2, §7.7, §9.2.* In de test leek de AI niets te doen; de oorzaak is dat de backend op de standaard `AI_PROVIDER=mock` draaide — de deterministische mock kiest simpelweg de bibliotheekvolgorde. Dat is nergens zichtbaar en het opstarten meldt het ook niet. Fix: bij het opstarten expliciet loggen welke AI-modus draait (met een waarschuwing bij `mock`), `.env.example` en `README.md` scherper maken over de stap naar `queue` + worker, en de indicator uit T9.4 gebruiken.
  *Acceptatie:* de server logt bij `mock` zichtbaar dat er geen echte AI draait; met `queue` + worker doorloopt een gesprek de echte AI (handmatige rook gerapporteerd).

- [x] **T9.9 Ollama-endpoint met token (`OLLAMA_TOKEN`)**
  *DESIGN: §7.2, §9.4.* De worker praat ongeauthenticeerd met Ollama; een gehost/afgeschermd endpoint (o.a. de cloud-modellen) vereist een `Authorization: Bearer`-token, dat nergens te configureren is. Fix: optionele `OLLAMA_TOKEN` in de worker-config die als bearer-header meegaat; leeg = geen header (lokale Ollama). Het token staat alleen in de env, nooit in code of logs.
  *Acceptatie:* met `OLLAMA_TOKEN` gezet draagt elke Ollama-aanroep de bearer-header (test), zonder token gaat er geen `Authorization`-header mee (test); README en `.env.example` documenteren de variabele.

- [x] **T9.10 Met een echte AI blijft er te weinig te kiezen over op het startscherm** *(ontdekt bij T9.8)*
  *DESIGN: §3.1, §7.4, §7.6, FR-003.* Bij de rooktest met `AI_PROVIDER=queue` + een draaiende Ollama-worker (gpt-oss:120b-cloud) gaf `POST /conversation/start` als eerste scherm de prompt "Wat wil je?" met **één** optie ("Iets willen") en `confidence: 0.7`: de AI mag binnen de kandidaten kiezen én ordenen, en snoeit de vijf intentiecategorieën terug tot één. Met de mock valt dat niet op (die geeft alle kandidaten terug). Dat botst met DESIGN §3.1: het startscherm biedt de gebruiker de intentiecategorieën aan; met één optie is er niets meer te kiezen en stuurt de AI in plaats van de gebruiker. Richting: een **ondergrens op het aantal aangeboden opties** (bv. minimaal `min(iconsPerScreen, kandidaten)`) in `decision.ts`, en/of het startscherm (geen stappen) altijd de volledige intentieset laten tonen en de AI daar alleen laten **ordenen**. Prompt aanscherpen hoort erbij (§7.6: kiezen/ordenen, niet weglaten). Let op de wisselwerking met de voorsteldrempel (§7.4) en met "Meer keuzes" (T9.6).
  *Acceptatie:* met een echte AI-worker toont het startscherm de intentiecategorieën (minimaal `iconsPerScreen` opties zolang er kandidaten zijn); een test met een provider-mock die één optie teruggeeft toont aan dat de ondergrens wordt afgedwongen; bestaande tests blijven groen.

- [x] **T9.11 Intenties lopen dood: "Een vraag stellen" is meteen een eindpunt** *(uit de gebruikerstest)*
  *DESIGN: §3.1, §3.2, §6.2, §7.6, FR-003/015.* In de seed-bibliotheek hebben `ask` en `say` **geen kinderen** en heeft `problem` er precies één (`pain`), dat op zijn beurt drie lichaamsdelen kent. Wie op het startscherm "Een vraag stellen" kiest, is dus meteen bij een eindconcept: de app springt naar het voorstelscherm met "Ik wil een vraag stellen." — terwijl de AI juist zou moeten uitzoeken **waar de vraag over gaat**. Hetzelfde bij "Er is iets aan de hand" → alleen "Pijn", en bij pijn ontbreken alledaagse lichaamsdelen (hand, vinger, **nagel**, tand, oor, rug), waardoor de echte testvraag ("waarom wil je je nagels niet knippen?") niet uit te drukken was. Werk: de bibliotheek uitbreiden zodat **elke intentie ergens heen leidt** (vragen: wie/wat/waar/wanneer/mag ik; zeggen: ja/nee/dank je/stop/nog een keer; problemen: pijn/moe/bang/jeuk/koud/warm/kapot/hulp) en de bestaande takken (pijn, gevoel, eten, drinken, activiteiten) tot een bruikbare woordenschat aanvullen. Seed blijft idempotent (upsert), dus een bestaande database vult netjes bij.
  *Acceptatie:* elk `intent`-symbool heeft minstens één kind (test die dat afdwingt, zodat een nieuwe intentie nooit doodloopt); "waar heb je pijn?" biedt onder meer hand/vinger/nagel; een gesprek vanaf "Een vraag stellen" komt via minstens één verfijnvraag bij een boodschap.

- [x] **T9.12 "Geen van deze past" — een uitweg op elk keuzescherm** *(uit de gebruikerstest)*
  *DESIGN: §3.4, §7.5, §7.6, FR-009.* Staat het juiste pictogram niet tussen de aangeboden opties, dan kan de gebruiker nu niets: alleen `↩ Terug` (die de vorige keuze ongedaan maakt) of een keuze die hij niet bedoelt. In de test liep dat vast bij "is er sprake van pijn?" met één pictogram, en bij "waar heb je pijn?" met drie lichaamsdelen waar het juiste niet bij zat. Voeg een expliciete uitweg toe: `POST /conversation/{id}/correction` krijgt naast `wrong_guess` het type **`no_fitting_option`** — de nu aangeboden concepten worden voor de rest van de sessie uitgesloten en er volgt een **andere** vraag op hetzelfde punt; is daar niets meer, dan gaat het gesprek automatisch een niveau omhoog (de laatste keuze wordt teruggerold en óók uitgesloten). In de tablet komt er een knop naast `↩ Terug`. Bewust géén extra pictogram in het keuzeraster: dat raster bevat uitsluitend AAC-concepten die de boodschap vormen; een bedieningsknop hoort in de balk.
  *Acceptatie:* met "Geen van deze" verdwijnen de getoonde opties en komen er andere terug (test); zijn er op dat niveau geen andere, dan staat de gebruiker een stap hoger met de eerdere keuze uitgesloten (test); de uitweg leidt nooit tot een leeg scherm of een voorstel uit het niets.

- [x] **T9.13 "Opnieuw beginnen" gaf "Dit gesprek is al afgerond"** *(uit de gebruikerstest)*
  *DESIGN: §5.1, §3.6.* Na het bevestigen van een boodschap gaf `Opnieuw beginnen` de fout "Dit gesprek is al afgerond." (`409 SESSION_NOT_ACTIVE`) — gereproduceerd. Oorzaak zit in `TabletApp`: `run()` zet **eerst** `confirmed` op `null` en wacht daarna pas op het nieuwe gesprek. In dat tussenmoment is `confirmed` weg maar staat de oude `state` (met `done: true`) er nog, dus mount `ProposalScreen` opnieuw — met het **zojuist bevestigde** sessie-id — en roept meteen `/generate` aan, dat op een `COMPLETED` sessie 409 geeft. De fout blijft daarna in beeld staan omdat `ProposalScreen` zijn `error` bij een nieuwe fetch niet wist. Fix: bij het (her)starten van een gesprek eerst de oude toestand wissen (laadscherm) en pas bij een geslaagd antwoord de nieuwe toestand zetten; `ProposalScreen` wist zijn fout bij elke nieuwe sessie.
  *Acceptatie:* bevestigen → "Opnieuw beginnen" levert een nieuw gesprek zonder foutmelding (web-test die de oude sessie hard op 409 laat lopen als hij toch wordt aangeroepen); geen zichtbare fout meer uit een vorige sessie.

- [x] **T9.14 Na ❌ Nee kon het gesprek doodlopen op een voorstel uit het niets** *(uit de gebruikerstest)*
  *DESIGN: §3.4, §7.4, §7.5.* In vraagmodus (anker `problem`, daarna `pain`) gaf ❌ Nee een teruggerolde sessie zónder kandidaten (het afgewezen `pain` was het enige kind), waarop `decideNextQuestion` `done: true` teruggaf: het voorstelscherm formuleerde een boodschap uit alleen het begeleiders-anker. De gebruiker had niets gekozen en kreeg toch een "zijn" boodschap voorgesteld — precies het tegenovergestelde van eigenaarschap (DESIGN §2). Fix: **voorstellen mag alleen na een echte keuze van de gebruiker** (in vraagmodus telt de ankerstap van de begeleider niet mee), en zijn er op het huidige punt geen kandidaten meer, dan valt de beslissing terug op een hoger niveau (kinderen van een eerdere stap, uiteindelijk de intentiecategorieën) in plaats van te voorstellen.
  *Acceptatie:* ❌ Nee op een vraagmodus-sessie met één kandidaat levert een nieuwe vraag i.p.v. een voorstel (test); een echt eindconcept blijft gewoon een voorstel geven (bestaande tests groen).

- [x] **T9.15 Zien wat de AI doet** *(uit de gebruikerstest)*
  *DESIGN: §7.2, §7.4, §7.6, §9.4.* "Doet de AI wel opties bedenken?" was niet te beantwoorden: de AI-aanroepen zijn onzichtbaar. De backend logt niets over een beslissing en de wachtrij (`AiJob`) is alleen in de database te zien. Werk: (a) per AI-beslissing een gestructureerde **logregel** (taak, provider, aantal kandidaten, gekozen concepten + zekerheid, `reason`, duur) — alleen concepten en metadata, nooit persoonlijke context; (b) een read-only **AI-activiteit**-scherm in het beheer met de recente jobs: taak, status, pogingen, duur, en van het resultaat de vraag, de gekozen opties en de reden van de AI. Bewust achter dezelfde grens als het worker-tokenbeheer (platformbeheer, `requirePlatformOrg`): `AiJob` is niet tenant-gebonden, dus dit mag geen gewone organisatie-ADMIN bereiken. De **prompt** (`payloadJson`) wordt nooit teruggegeven — daar kan persoonlijke context in zitten.
  *Acceptatie:* een gesprek levert zichtbare logregels met de AI-keuzes; het beheerscherm toont de recente AI-jobs met resultaatsamenvatting; een niet-platform-ADMIN krijgt 403; de prompt is nergens in de respons te vinden (test).

- [x] **T9.16 De AI stelde haar vraag in het Engels** *(ontdekt bij de rooktest van T9.12)*
  *DESIGN: §5.1, §7.1, §7.3.* Bij het naspelen van de gebruikerstest met een echte Ollama-worker verscheen op de tablet de vraag "Is the pain related to being sick?" — de promptregels (`SYSTEM_RULES`, `GOAL`) schreven wél de AAC-begrenzing en de ik-vorm van de bóódschap voor, maar niets over de taal van de **vraag**. Voor een Nederlandstalige gebruiker met een communicatiebeperking is een Engelse vraag onbruikbaar. Fix: het doel in de prompt schrijft expliciet een korte, eenvoudige **Nederlandse** vraag voor, rechtstreeks gericht tot de gebruiker.
  *Acceptatie:* de promptregel is aanwezig (test) en een rooktest met een echte AI levert een Nederlandse vraag op.

- [x] **T9.17 De AI-worker stierf bij elke herstart van de backend** *(ontdekt bij de rooktest van T9.16)*
  *DESIGN: §9.2, §9.3; ADR-0010.* De worker long-pollt op `/ai/worker/claim`; gaat de backend intussen omlaag (deploy, herstart, proxy die de verbinding dichtgooit), dan komt dat als `http.client.RemoteDisconnected` naar boven — een `OSError`, géén `urllib.error.URLError`. `BackendClient._post` ving alleen `HTTPError`/`URLError`, dus de uitzondering ontsnapte aan de `except BackendError` in de claim-lus en het proces viel stil om. Waargenomen tijdens de rooktest: elke herstart van de dev-server maakte de worker dood, met een stapeltrace in het log en een backend die daarna eindeloos `AI_WORKER_UNAVAILABLE` gaf. Fix: `TimeoutError` en `OSError` (waaronder `RemoteDisconnected`, `ConnectionResetError`) vertalen naar `BackendError`, zodat de lus het gewoon opnieuw probeert.
  *Acceptatie:* een afgebroken verbinding levert een `BackendError` op i.p.v. een crash (tests voor remote-disconnect, connection-reset en time-out); de worker overleeft een herstart van de backend (handmatige rook).

---

## Fase 10 — De AI gaat het gesprek écht sturen (`TEST-FEEDBACK.md`, derde ronde)

**Aanleiding.** In de derde gebruikerstest: "Iets willen" gekozen → drie opties (eten/drinken/iets doen) →
"staat er niet bij" → **weer de vijf startcategorieën**. De analyse legde een structureel probleem bloot dat
groter is dan die ene flow: Intento is nu een **boomwandelaar met een AI-herschikker**, niet een AI die
achterhaalt wat de gebruiker bedoelt.

De kandidatenset per beurt is `loadChildSymbols(laatste keuze)` (`decision.ts` → `engine.ts`): dat is de
**hele wereld** die het model per beurt ziet. `want` heeft in de seed exact drie kinderen, dus na "Iets
willen" kán geen enkel model iets anders voorstellen — de overige ~70 bibliotheekconcepten zijn op dat punt
onbereikbaar. Daarbovenop plakt `decideNextQuestion` (de T9.10-vangnetregel) ná de AI-keuze **alle overige
kandidaten** er alsnog achter in bibliotheekvolgorde, waardoor het scherm bij kleine sets identiek is of de
AI nu meedenkt of niet. En het model krijgt de **afgewezen** concepten nooit te zien: `aiPromptSchema` heeft
er geen veld voor, dus "geen van deze past" is voor de AI onzichtbaar — het is puur een lokaal negatief
filter, geen signaal. Zijn daarna alle kinderen uitgesloten, dan loopt `findAvailableCandidates` omhoog en
eindigt bij `loadIntentSymbols()`: het startscherm.

De fasetaken hieronder pakken dat in volgorde aan: eerst het ontwerp rechtzetten (T10.1), dan de
kandidatenset losmaken van de boom (T10.2), dan het geheugen van de AI (T10.3/T10.4), dan nieuwe concepten
met pictogram (T10.5/T10.6), en tot slot de hypothese-state die het confidence-model draagt (T10.7).

- [x] **T10.1 Ontwerp bijwerken: van boomwandeling naar AI-gestuurde vraagselectie**
  *DESIGN: §7.3, §7.5, §7.6, §7.8, ADR.* De harde regel "de AI mag tijdens communicatie geen vrije concepten verzinnen" (§7.6) en de impliciete aanname dat kandidaten uit de relatieboom komen (§7.3) staan de bedoelde werking in de weg. Besluit van de opdrachtgever (22-08-2026): de AI **mag** nieuwe concepten genereren, mits (a) eerst hard gecontroleerd wordt of het begrip al in de bibliotheek bestaat (concept, label of synoniem) zodat er geen bijna-duplicaten ontstaan, (b) er meteen een pictogram bij gezocht wordt, en (c) de beheerder ziet welke concepten nieuw zijn en er een beter pictogram voor kan kiezen. Werk: §7.3 herschrijven (kandidaten = retrieval over de héle bibliotheek + boomkinderen + voorkeuren, niet één boomknoop), §7.5 concreet maken (welke negatieve context de prompt in gaat), §7.6 herzien tot de nieuwe prioriteitsvolgorde met een vierde trap "nieuw concept, gemarkeerd, in beheer", §7.8 aanscherpen (de gebruiker blijft eigenaar: een nieuw concept is een *voorstel* dat de gebruiker zelf kiest en bevestigt) en een ADR met context → beslissing → gevolgen. Geen code in deze taak.
  *Acceptatie:* DESIGN §7.3/§7.5/§7.6/§7.8 beschrijven de nieuwe werking eenduidig; er is een ADR in `docs/adr/` die de versoepeling van de AAC-begrenzing motiveert en de waarborgen benoemt; `docs/architecture.md` verwijst ernaar.

- [x] **T10.2 Kandidatenset losmaken van de relatieboom (retrieval)**
  *DESIGN: §7.3, §7.6, FR-003.* De AI moet per beurt uit een betekenisvolle set kunnen kiezen in plaats van uit de kinderen van één knoop. Bouw een `candidates.ts` die de set samenstelt uit: (a) de kinderen van de laatste keuze (blijft de sterkste signaalbron), (b) een **retrieval-set uit de hele bibliotheek** op `searchText`/synoniemen, gevoed door de begeleidersvraag, de toegestane persoonlijke context en het gekozen pad, (c) de geleerde voorkeuren van deze gebruiker, en (d) de intentiecategorieën als bodem. Ontdubbeld, begrensd op een configureerbaar maximum (richtwaarde 30) zodat de prompt beheersbaar blijft. Dit vervangt `loadChildSymbols` als enige bron in `decideNextQuestion`; `engine.ts` houdt zijn rol voor de gescripte terugval en `resolveOption`. **Let op:** `resolveOption` valideert de ingestuurde keuze nu tegen `currentQuestion` (de boom) — die validatie moet meeverhuizen naar "was dit een van de daadwerkelijk aangeboden opties", anders wordt elke AI-keuze buiten de boom als `INVALID_CHOICE` geweigerd. Dat vraagt om het **vastleggen van de aangeboden opties per stap** (zie T10.3).
  *Acceptatie:* na "Iets willen" biedt de app aantoonbaar meer dan de drie boomkinderen aan (test met een echte bibliotheek); de retrieval betrekt de begeleidersvraag ("waarom wil je je nagels niet knippen" levert nagel/pijn/jeuk als kandidaten, test); de set is begrensd op het maximum (test); een keuze buiten de boom wordt geaccepteerd en correct als stap opgeslagen (test).

- [x] **T10.3 Aangeboden opties per stap vastleggen**
  *DESIGN: §7.5, §6.2.* §7.5 schrijft voor dat de AI bijhoudt welke opties al getoond zijn; nu bestaat dat nergens — de aangeboden set wordt elke beurt opnieuw afgeleid en is daarna weg. Zonder die vastlegging kan T10.2 geen keuzes valideren, kan T10.4 niet vertellen wát er is afgewezen, en is de terug-functie niet meer exact herstelbaar zodra de kandidaten niet langer puur uit de boom volgen. Werk: migratie met de aangeboden concepten + de gestelde vraag per beurt (op `ConversationStep`, en voor de nog onbeantwoorde huidige vraag op `ConversationSession`), en `resolveOption` daarop laten valideren in plaats van op de boom.
  *Acceptatie:* migratie draait schoon op een lege db; na `/next` staat vast welke opties er zijn aangeboden (test); `/back` herstelt de vorige vraag met **exact** dezelfde opties, ook als de AI ertussen anders zou kiezen (test); een keuze die niet is aangeboden geeft nog steeds `400 INVALID_CHOICE` (test).

- [x] **T10.4 De AI vertellen wat de gebruiker níet wil**
  *DESIGN: §7.5, §7.7, §3.4, FR-009.* Afgewezen concepten worden nu lokaal weggefilterd in `decision.ts` maar **nooit aan het model verteld** — de gesloten `aiPromptSchema` heeft er geen veld voor. Daardoor kan de AI niet van richting veranderen na "geen van deze past"; ze weet niet eens dát het gebeurd is. Werk: `aiPromptSchema` uitbreiden met `rejectedConcepts` (concept + label + type: `wrong_guess` of `no_fitting_option`) en `askedQuestions` (de eerder gestelde vragen uit T10.3), `buildAiPrompt`/`renderPromptText` en de worker-prompt (`prompts.py`) meenemen, plus een expliciete AAC-regel: *"de gebruiker gaf aan dat deze opties niet passen — zoek in een andere richting en herhaal ze niet."* De sleutelset blijft gesloten (geen chatgeschiedenis, geen vrije invoer): dit zijn AAC-concepten en eerder door het systeem gestelde vragen, geen gebruikersvrije tekst.
  *Acceptatie:* de prompt bevat de afgewezen concepten met hun type en de eerder gestelde vragen (test op `buildAiPrompt` én op de worker-prompt); het schema blijft gesloten (test dat onbekende sleutels worden geweigerd); rooktest met een echte worker toont dat de vraag na "geen van deze past" een andere richting op gaat.

- [x] **T10.5 "Geen van deze past" mag nooit naar het startscherm terugvallen**
  *DESIGN: §3.4, §7.5, FR-009.* Nu sluit `no_fitting_option` het hele niveau uit, waarna `findAvailableCandidates` omhoog loopt en bij `loadIntentSymbols()` eindigt — de gebruiker die aangeeft het beter te weten, krijgt het startscherm terug (gereproduceerd in de derde testronde). Met T10.2 en T10.4 op hun plek is dat niet meer nodig: de afwijzing wordt een **signaal voor een nieuwe retrieval-ronde** binnen dezelfde context, met het afgewezen niveau uitgesloten. Het pad van de gebruiker blijft staan. Pas als retrieval én nieuwe concepten (T10.6) echt niets nieuws opleveren, gaat het gesprek een niveau omhoog — en dan zichtbaar, met uitleg op het scherm in plaats van een stille sprong.
  *Acceptatie:* "Iets willen" → "geen van deze past" levert **andere, verwante** opties op en niet de intentiecategorieën (test die het hele scenario naspeelt); herhaald afwijzen blijft nieuwe opties opleveren tot de bibliotheek en de generatie op zijn zijn; een sprong omhoog is voor de gebruiker zichtbaar; geen leeg scherm en geen voorstel uit het niets (bestaande T9.14-tests blijven groen).

- [x] **T10.6 De AI mag een nieuw concept voorstellen — met pictogram en zichtbaar voor de beheerder**
  *DESIGN: §7.6, §7.8 (na T10.1), FR-015.* Staat het woord niet in de bibliotheek, dan gooit `validateAiOptions` het nu stilzwijgend weg (`ConceptProposal`, weggelaten) — de gebruiker ziet er nooit iets van, terwijl dit juist zijn uitweg zou moeten zijn. Nieuwe werking, in deze volgorde: (1) **dedupliceren** — bestaat het begrip al als concept, label of synoniem, dan resolvet het daarnaartoe (de bestaande stap, blijft hard); (2) is het echt nieuw, dan wordt er een `AacSymbol` aangemaakt met herkomst "AI-gegenereerd" en status "nog niet beoordeeld"; (3) er wordt **meteen een pictogram bij gezocht** via de bestaande OpenSymbols-client (`aac/opensymbols.ts`, inclusief de `https`/SSRF-guard), met een neutrale placeholder als er niets bruikbaars is; (4) het symbool wordt aan de gebruiker aangeboden, in de UI **zichtbaar gemarkeerd** als nieuw woord; (5) er komt een `ConceptProposal` voor de beheerder. Ook nieuwe concepten gaan door de bestaande boodschap-safety in `generate`: de zin blijft binnen de gekozen concepten. De gebruiker blijft eigenaar — hij kiest en bevestigt zelf.
  *Acceptatie:* een provider die een onbekend concept teruggeeft levert een aangeboden, gemarkeerd pictogram op in plaats van een weggelaten optie (test); een onbekend concept dat een synoniem is van een bestaand symbool levert géén nieuw symbool op (deduplicatietest); er is een pictogram opgehaald of een placeholder gezet (test met een gemockte OpenSymbols-client); de `https`/SSRF-guard blijft afgedwongen (test); een met een nieuw concept gevormde boodschap blijft binnen de gekozen concepten (test).

- [x] **T10.7 Beheer: nieuwe AI-concepten beoordelen en van een beter pictogram voorzien**
  *DESIGN: §7.6, §5.2, FR-015.* De beheerder moet zien wélke concepten door de AI zijn toegevoegd en er een beter pictogram voor kunnen kiezen. Het bestaande scherm voor conceptvoorstellen kent alleen "koppelen aan een bestaand pictogram" (approve met `symbolId`) of "afwijzen" — er is geen weg voor een concept dat terecht nieuw is. Werk: de lijst toont de AI-gegenereerde symbolen met hun herkomst, hoe vaak ze gekozen zijn en hun huidige (automatisch gevonden) pictogram; de beheerder kan het pictogram vervangen via de bestaande OpenSymbols-zoek/upload-route, het label bijwerken, het concept in de relatieboom hangen, of het samenvoegen met een bestaand symbool (dan wordt het een synoniem, zoals approve nu doet). Elke actie geauditeerd, achter dezelfde grens als het bestaande voorstelbeheer.
  *Acceptatie:* een door de AI aangemaakt concept verschijnt in het beheerscherm met herkomst en pictogram (test); het pictogram is te vervangen en het concept is samen te voegen met een bestaand symbool (tests); na samenvoegen biedt de AI het oude concept niet meer los aan (test); een niet-gerechtigd account krijgt 403 (test).

- [x] **T10.8 Hypothese-state: onthouden wat de AI denkt dat de gebruiker bedoelt**
  *DESIGN: §7.1 taak 3, §7.4, §3.4.* Er is geen plek waar staat wát de AI denkt dat de gebruiker wil. Er is alleen een pad van concepten en een losse `confidence` per stap, rauw uit één modelantwoord — waardoor de voorsteldrempel (>85%) grillig vuurt en de correctieflow de laagste `confidence` als *proxy* voor de misstap moet gebruiken (`correction.ts`). Werk: een hypothese per sessie (korte omschrijving in AAC-concepten + zekerheid + onderbouwing), bijgewerkt per beurt uit de AI-uitvoer, met de zekerheid gedempt over beurten heen in plaats van per antwoord overschreven. `analyzeCorrection` wijst de misstap daarna aan op de hypothesegeschiedenis in plaats van op de proxy, en de hypothese is zichtbaar in het AI-activiteitscherm (T9.15) zodat "wat doet de AI eigenlijk" beantwoordbaar blijft. Privacy: alleen AAC-concepten en getallen, nooit persoonlijke context, en vluchtig — de hypothese verdwijnt bij het afronden van het gesprek (§3.6: geen onzekere aannames opslaan).
  *Acceptatie:* de hypothese is per beurt zichtbaar in het AI-activiteitscherm (test); de zekerheid springt niet meer op één modelantwoord (test met een provider die wisselende waarden geeft); ❌ Nee rolt terug naar de stap waar de hypothese kantelde (test); na `/confirm` is de hypothese verwijderd (test).


- [x] **T10.9 De boodschapzin loopt achter op de vrijere route** *(ontdekt bij de rooktest van T10.6)*
  *DESIGN: §7.1 taak 4, §7.8.* Sinds de AI ook op het **startscherm** een concept mag aandragen (T10.6), kan een route beginnen met iets anders dan een intentie — en daar zijn zowel de sjabloon-zin als de safety-laag niet op gebouwd. Gereproduceerd met een echte worker: route `nagelknipper` (één concept, geen intentie) leverde de bevestigde boodschap **"Nagelknipper."** op. Twee oorzaken: (a) `generateMessage` (`conversation/message.ts`) kent alleen zinsframes per **intentie** en valt anders terug op `${intent.label}.`, wat bij een niet-intentie een los woord oplevert; (b) de AI-zin "Ik wil de nagelknipper." werd door de safety-laag (`conversation/generate.ts`) afgekeurd omdat "wil" een **synoniem van het niet-gekozen concept `want`** is — de fail-safe is hier te grof, want "ik wil" is gewone Nederlandse zinsbouw en geen smokkelroute voor een vreemd concept. Werk: een zinsframe voor een route zonder intentie, en de safety-laag laten kijken naar **betekenisdragende** concepten in plaats van naar elk label/synoniem (bv. functiewoorden en zeer korte synoniemen uitsluiten, of alleen matchen op het label van een concept en niet op zijn synoniemen). De harde regel blijft: geen concept in de zin dat de gebruiker niet koos.
  *Acceptatie:* een route die met een AI-aangedragen concept begint levert een lopende Nederlandse zin op (test); de safety-laag keurt "Ik wil de nagelknipper." goed bij route `nagelknipper` maar blijft een zin met een écht niet-gekozen begrip ("Ik wil buiten wandelen") weigeren (tests); bestaande T5.3-tests blijven groen.

---

## Fase 11 — Meerdere gespreksstrategieën, selecteerbaar per gebruiker of gesprek

**Aanleiding.** De manier waarop de AI probeert te achterhalen wat de gebruiker wil zeggen, is nu één
vaste aanpak. Ze is bovendien niet als aanpak *herkenbaar*: de knoppen liggen verspreid over
`candidates.ts` (bronvolgorde), `decision.ts` (`MIN_OFFERED_OPTIONS`/`MAX_OFFERED_OPTIONS`),
`ai/thresholds.ts` (`CONFIDENCE_REFINE`/`CONFIDENCE_PROPOSE`), `hypothesis.ts` (`HYPOTHESIS_SMOOTHING`)
en `ai/prompt.ts` (`GOAL` + `AAC_RULES`). Wie de aanpak wil wijzigen, moet vijf modules aanraken.

Die knoppen zijn niet neutraal: ze coderen een aanname over de persoon. De huidige set gaat uit van
iemand die categorieën begrijpt en stapsgewijs verfijnt. Voor iemand die snel overprikkeld raakt zijn
twaalf opties te veel; voor iemand die concrete dingen wél herkent maar niet kan categoriseren is "eerst
kiezen tussen eten/drinken/iets doen" een omweg; voor iemand met een sterk vast dagritme is de
persoonlijke context een beter startpunt dan de begrippenboom. Eén aanpak voor iedereen botst met DESIGN
§5.3 (instellingen per gebruiker) en §7.3 ("gepersonaliseerd op basis van profiel en historie").

**Wat een strategie mag variëren:** kandidatenbronnen en hun volgorde/gewicht · aanbodgrootte ·
confidence-drempels en demping · de promptformulering (`goal` + `aacRules`) · of nieuwe concepten mogen ·
hoeveel stappen er minimaal voor een voorstel nodig zijn.

**Wat een strategie NOOIT mag variëren** — dit zijn domeinregels, geen instellingen (DESIGN §2, §7.5,
§7.6, §7.8): de gebruiker is eigenaar en bevestigt zelf · deduplicatie tegen bestaande concepten gaat
altijd voor · afgewezen concepten komen nooit terug · geen boodschapvoorstel zonder een keuze van de
**gebruiker** · de gesloten promptsleutelset (een strategie vult de *inhoud* van `goal`/`aacRules`, nooit
de *vorm* van de prompt) · nooit een leeg scherm. Een strategie verandert de **zoekwijze**, niet de
**garanties**. Zonder die scheiding wordt elke nieuwe strategie een plek waar een waarborg stilletjes
wegvalt; T11.2 dwingt dat af met een gedeelde invariant-testsuite over álle geregistreerde strategieën.

**Aanpak: configuratie-gedreven, met een naad voor code.** Alle strategieën uit T11.3 zijn uit te drukken
als **parameterset** binnen dezelfde pijplijn — dat is veiliger en testbaarder dan vier losse
implementaties. Het type laat ruimte voor een latere strategie met eigen kandidaat-logica, zonder dat de
aanroepplekken veranderen. Strategieën zijn **ingebouwd** (in code, met een stabiele sleutel), niet in de
database: dat houdt multi-tenant-isolatie buiten beeld. Per organisatie bewerkbare strategieën staan
bewust bij "Na de MVP".

- [x] **T11.1 Ontwerp: gespreksstrategieën als expliciet begrip**
  *DESIGN: §5.3, §7.2, §7.3, §7.4, ADR.* Het ontwerp kent nu geen notie van "aanpak": §7.3 beschrijft één
  vraagselectie en §5.3 somt de instellingen per gebruiker op zonder deze. Werk: een nieuwe subsectie
  §7.10 "Gespreksstrategieën" die beschrijft wat een strategie is, welke parameters ze bevat, welke
  domeinregels er **buiten** vallen (de lijst hierboven) en hoe de selectie werkt (gesprek → gebruiker →
  standaard); §5.3 uitbreiden met de strategiekeuze als instelling per gebruiker; §7.3/§7.4 laten
  verwijzen naar de strategie in plaats van naar vaste waarden. Plus een ADR (context → beslissing →
  gevolgen) die motiveert waarom het configuratie-gedreven is en niet vier code-implementaties, en die
  het risico benoemt: meer strategieën = meer manieren waarop de kwaliteit stil kan verslechteren. Geen
  code in deze taak.
  *Acceptatie:* DESIGN §5.3 en §7.3/§7.4/§7.10 beschrijven strategieën eenduidig inclusief de harde
  scheiding tussen zoekwijze en garanties; er is een ADR in `docs/adr/`; `docs/architecture.md` verwijst
  ernaar.

- [x] **T11.2 De huidige aanpak wordt een expliciete, benoemde strategie**
  *DESIGN: §7.10 (na T11.1), §7.3.* Introduceer `conversation/strategy.ts` met een `ConversationStrategy`
  (sleutel, label, uitleg voor de begeleider, en de parameters: kandidatenbronnen + volgorde,
  `maxCandidates`, `minOffered`/`maxOffered`, `confidenceRefine`/`confidencePropose`,
  `hypothesisSmoothing`, `allowNewConcepts`, `minUserChoicesBeforePropose`, en de promptfragmenten `goal`
  + extra `aacRules`) plus een registry met opzoeken op sleutel en een expliciete standaard. De bestaande
  waarden worden de strategie **`refine`** ("Stap voor stap verfijnen"). `decision.ts`, `candidates.ts`,
  `hypothesis.ts` en `prompt.ts` lezen voortaan uit de strategie in plaats van uit module-constanten; de
  constanten blijven bestaan als de *waarden van `refine`*, niet als verspreide waarheid. Het gedrag
  verandert in deze taak **niet** — dat is precies de acceptatie. Bouw hier ook de gedeelde
  **invariant-testsuite** die over élke geregistreerde strategie draait en de domeinregels afdwingt.
  *Acceptatie:* alle bestaande gespreks- en beslissingstests blijven ongewijzigd groen (bewijs dat
  `refine` de huidige aanpak exact is); een test dwingt af dat de registry een geldige standaard heeft en
  dat elke strategie de invarianten haalt (geen leeg scherm, geen voorstel zonder gebruikerskeuze,
  afgewezen concepten komen niet terug, deduplicatie eerst, gesloten promptsleutelset); `npm run lint`
  meldt geen ongebruikte constanten.

- [x] **T11.3 Drie strategieën die aantoonbaar ander gedrag geven**
  *DESIGN: §7.3, §7.10, §5.3.* Een abstractie met één implementatie bewijst niets. Voeg toe:
  • **`explore` — "Breed verkennen"**: kleinkinderen vóór kinderen, groter aanbod, lagere
  voorsteldrempel. Voor wie concrete dingen herkent maar moeilijk categoriseert; slaat abstracte
  tussenstappen over.
  • **`calm` — "Rustig en bevestigend"**: klein aanbod (aansluitend op een lage `iconsPerScreen`), hoge
  voorsteldrempel, sterke demping, promptregels die om één duidelijke vraag per keer vragen. Voor wie snel
  overprikkeld raakt.
  • **`context-first` — "Context eerst"**: voorkeuren en toegestane persoonlijke context vóór de
  boomkinderen, promptregels die om het dagritme van deze persoon vragen. Voor wie een sterk vast patroon
  heeft.
  Elke strategie krijgt een korte uitleg in begrijpelijke taal (de begeleider kiest hem, niet een
  ontwikkelaar).
  *Acceptatie:* per strategie een test die het **onderscheidende** gedrag vastlegt op dezelfde
  gesprekstoestand (bv. `explore` biedt op hetzelfde punt concretere concepten aan dan `refine`; `calm`
  biedt er aantoonbaar minder aan en stelt later voor); alle strategieën halen de invariant-testsuite uit
  T11.2; de uitleg is niet leeg (test).

- [x] **T11.4 Strategie kiezen per gebruiker**
  *DESIGN: §5.3, §3.7, §7.10.* De strategie hoort bij de persoon: het is een communicatie-instelling, net
  als `iconsPerScreen` en `showText`. Werk: migratie met `UserCommunicationProfile.conversationStrategy`
  (`String`, default de registry-standaard, op de grens met zod tegen de registry gevalideerd — een
  onbekende sleutel mag nooit tot een halve strategie leiden), de instelling meenemen in de bestaande
  profiel-API en in `SettingsForm` in de beheeromgeving, met per keuze de uitleg uit T11.3 zichtbaar zodat
  de begeleider een geïnformeerde keuze maakt. Meenemen in profielexport/-import (T8.1), anders valt de
  instelling stilletijd terug op de standaard bij overdracht.
  *Acceptatie:* de gespreksflow van een gebruiker met `calm` gedraagt zich aantoonbaar anders dan die van
  een gebruiker met `refine` (test via HTTP, twee gebruikers naast elkaar); een onbekende sleutel geeft
  `400` en raakt de database niet; de instelling overleeft export → import (test); migratie draait schoon
  op een lege db en bestaande gebruikers houden het huidige gedrag.

- [ ] **T11.5 Strategie kiezen per gesprek**
  *DESIGN: §3.2, §7.10.* Eén persoon kan per situatie een andere aanpak nodig hebben: een vraag over pijn
  vraagt om een andere benadering dan "wat wil je doen vanmiddag". Werk: migratie met
  `ConversationSession.strategy` (nullable — `null` = volg de gebruikersinstelling), de resolutieorde
  **gesprek → gebruiker → standaard** op één plek (`resolveStrategy`), en de begeleider kan bij het
  stellen van een vraag (vraagmodus, `POST /question/start`) optioneel een strategie meegeven. De
  strategie ligt vast voor de duur van het gesprek: hem halverwege wisselen zou het vastgelegde aanbod
  (T10.3) en de hypothese (T10.8) inconsistent maken — dat is een expliciete keuze, geen omissie.
  *Acceptatie:* een vraagmodus-sessie met een expliciete strategie volgt die en niet de
  gebruikersinstelling (test); zonder keuze valt het gesprek terug op de gebruiker, en zonder
  gebruikersinstelling op de standaard (tests voor alle drie de niveaus); een onbekende sleutel geeft
  `400`; een lopend gesprek houdt zijn strategie.

- [ ] **T11.6 Zichtbaar maken wélke aanpak draaide**
  *DESIGN: §7.10, §9.4; sluit aan op T9.15.* Met meerdere strategieën is "waarom deed de AI dit?" niet te
  beantwoorden zonder te weten wélke aanpak actief was — en dat is precies de vraag die de vorige
  gebruikerstests opriepen. Werk: de strategiesleutel opnemen in de bestaande AI-beslissings-logregel en
  in het beheerscherm **AI-activiteit**, en in de gesprekstoestand meesturen zodat de begeleider die
  meekijkt ziet welke aanpak loopt. Alleen de sleutel en het label — geen promptinhoud, geen persoonlijke
  context (§9.4).
  *Acceptatie:* de logregel en het AI-activiteitscherm tonen de actieve strategie (tests); de
  meekijk-weergave van de begeleider toont het label; de prompt lekt nergens in een respons (bestaande
  T9.15-test blijft groen).

---

## Na de MVP (fase 4–5 uit DESIGN §10.1 — nog niet uitwerken)

Eigen gespreksstrategieën per organisatie (beheerbaar in de database i.p.v. ingebouwd — vraagt tenant-isolatie op de strategie-tabel en een beheer-UI met veiligheidsgrenzen per parameter) · spraakuitvoer · communicatie op afstand (events/notificaties/queue) · offline-modus · oogbesturing · uitgebreide AAC-relaties · integraties met zorgsystemen.
