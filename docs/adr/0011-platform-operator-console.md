# 0011. Platform-operatorconsole: een bewuste doorbreking van de tenant-isolatie

- **Status:** geaccepteerd
- **Datum:** 2026-08-21

## Context

Intento is strikt multi-tenant: elke query wordt gefilterd op `organizationId` en elke ADMIN zit
vast in zijn eigen organisatie (ADR-0005, T1.2). Dat is precies goed voor de mensen in de app — een
zorginstelling hoort niets van een familie te zien — maar het laat één rol onvervuld: **wie beheert
het platform zelf?** Wie zet een nieuwe omgeving neer voor een organisatie die belt, en vooral: wie
kan een omgeving *stoppen* die misbruikt wordt?

Tot nu toe kon niemand dat. `Organization.isPlatform` bestond wel (T5.8), maar ontgrendelde alléén
worker-tokenbeheer — infrastructuur, geen tenant-beheer. Er was dus geen enkele weg om over
organisaties heen te kijken, en ook geen weg om er één te stoppen: een misbruikte omgeving bleef
gewoon draaien.

De oplossing vraagt per definitie om endpoints die **niet** op `organizationId` filteren. Dat staat
lijnrecht tegenover het isolatieprincipe, dus de vraag is niet óf we de grens doorbreken maar hoe we
die doorbreking zo klein, zo zichtbaar en zo moeilijk-per-ongeluk-uit-te-breiden mogelijk maken.

## Beslissing

**Een aparte bevoegdheid, geen vierde rol.** We voegen `Account.isOperator` toe in plaats van een rol
`PLATFORM_ADMIN`. Reden: `role` beantwoordt de vraag "wat mag je binnen je organisatie?" en wordt
overal gecombineerd met tenant-filtering. Een vierde waarde in dat enum zou door elke bestaande
rolcontrole, elk formulier en elke serialisatie rimpelen, en zou de suggestie wekken dat operator een
plek op dezelfde as is. Dat is het niet: het is een tweede, orthogonale as. De vlag telt bovendien
alléén binnen een organisatie met `isPlatform=true` — twee onafhankelijke voorwaarden, zodat een
verkeerd gezette of geïmporteerde vlag in een gewone tenant nog steeds niets ontgrendelt.

**De vlag wordt nooit via een API uitgedeeld.** Alleen `db/bootstrap-seed.ts` zet `isOperator`. Er is
geen endpoint om iemand tot operator te promoveren, dus er is geen pad waarlangs een tenant-ADMIN
zichzelf of een ander naar de console kan tillen.

**Eigen guard, eigen routetak, eigen request-veld.** Alles onder `/operator/*` hangt achter
`operatorAuthorize(...)` (`auth/operator.ts`) — niet achter `authorize()`. De guard zet
`request.operator` en laat `request.account` **bewust leeg**. Dat laatste is de kern: de
tenant-helpers (`requireAccount`, en daarmee `tenantScope`/`assertSameTenant`) lezen `request.account`
en falen dus hard (500) op een operator-route, in plaats van stilletjes op de organisatie van de
operator te filteren. Een vergissing wordt zo een crash in plaats van een datalek — en omgekeerd kan
een handler die `requireOperator` gebruikt nooit onder `authorize()` terechtkomen.

**Beheermetadata, geen inhoud.** De console levert naam, soort, status en aantallen; in het detail
accounts (e-mail, rol, status) en gebruikers **zonder naam**. Geen boodschappen, geen gesprekken,
geen persoonlijke context, geen voorkeuren. Een operator beheert het platform; hij leest niet mee met
de mensen erin (DESIGN §2, §9.4).

**Beperkte werkwoorden.** Organisaties: lijst, detail, aanmaken, (de)activeren. Accounts en
gebruikers: alleen inzien. Er is bewust géén "inloggen als", geen wachtwoord-reset in andermans
tenant en geen eerste-admin-aanmaak bij een nieuwe omgeving — elk daarvan zou een operator
stilzwijgend toegang tot communicatie geven. Een nieuwe omgeving krijgt haar beheerder via
zelfaanmelding (T1.3).

**Deactiveren doet echt iets.** `Organization.active=false` wordt afgedwongen op alle drie de
toegangswegen: login, bestaande accountsessies (`authorize()`) en gekoppelde tablets
(`deviceAuthorize()`) — telkens 403 `ORGANIZATION_SUSPENDED`. Deactiveren is dus onmiddellijk, niet
pas als sessies verlopen. Het is nadrukkelijk geen verwijdering: de gegevens blijven staan en
hervatten is één klik. De platformorganisatie zelf kan niet gedeactiveerd worden (400
`PLATFORM_ORGANIZATION_PROTECTED`), zodat een operator zichzelf niet buitensluit.

**Alles geaudit, zonder tenant.** Elke muterende operator-actie schrijft een audit-regel met de
operator als actor en `organizationId: null` — net als bij worker-tokens (T5.8). Dit zijn
platform-acties; ze horen niet op te duiken in de audit-lijst van een organisatie die er zelf niets
aan kon doen. De betrokken organisatie staat in `targetId`/`metadata`.

**Aparte UI-tak.** De console draait op `/operator` met een eigen scherm, niet als tab tussen het
tenant-beheer. Cross-tenant beheer hoort geen klik naast "Gebruikers" te zijn. Wie de vlag heeft
vindt de console via één expliciete link op "Mijn account".

## Alternatieven

- **Rol `PLATFORM_ADMIN`.** Geeft sterkere scheiding (zo'n account is dan géén ADMIN en komt nergens
  in een tenant-route), maar raakt het rol-enum en daarmee elke bestaande rolcontrole, inclusief het
  worker-tokenbeheer dat juist `ADMIN` + `isPlatform` eist. Afgewogen tegen de winst van een aparte
  guard + apart request-veld — die scheiding krijgen we ook zonder het enum te breken.
- **`isPlatform` hergebruiken zonder accountvlag.** Dan zou elke ADMIN van de platformorganisatie
  automatisch cross-tenant beheer krijgen, terwijl die organisatie ook gewoon een werkomgeving met
  eigen begeleiders kan zijn. Te grof.
- **Tenant-filter conditioneel maken** (`tenantScope` die bij een operator "alles" teruggeeft). Dit
  is precies wat we niet willen: één vergeten conditie in een gedeelde helper zou dan cross-tenant
  lekken op *bestaande* endpoints. De doorbreking hoort in aparte code te staan, niet in een `if` in
  het hart van de isolatie.

## Gevolgen

- Er bestaat nu code die bewust niet tenant-filtert. Die staat op precies één plek
  (`routes/operator.ts`), achter precies één guard, en is als zodanig gedocumenteerd en getest —
  inclusief een test die aantoont dat een operator op de *gewone* endpoints nog steeds niets van een
  andere tenant ziet.
- Elke geauthenticeerde request kost één extra PK-lookup (organisatiestatus). Bewust geaccepteerd:
  de check moet op elk pad hetzelfde doen en op één plek leesbaar zijn.
- De bootstrap-admin is nu ook operator. Wie die inloggegevens heeft, kan omgevingen stoppen — dat
  maakt het beschermen van dat account (sterk `SEED_ADMIN_PASSWORD`, e-mailverificatie, geen
  tijdelijk wachtwoord) belangrijker dan voorheen.
- Toekomstige operator-functionaliteit (bv. quota, facturatie, platformstatistiek) hoort in dezelfde
  routetak achter dezelfde guard, niet als extra bevoegdheid op bestaande tenant-endpoints.
