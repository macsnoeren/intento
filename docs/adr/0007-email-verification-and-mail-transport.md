# 0007. E-mailverificatie en provider-agnostisch mail-transport

- **Status:** geaccepteerd
- **Datum:** 2026-07-09

## Context

T1.4 voegt e-mailverificatie toe aan het bij zelfaanmelding (T1.3) aangemaakte admin-account.
Dat roept een aantal keuzes op:

1. **Hoe versturen we mail** zonder de app aan één provider te ketenen, en zonder dat tests of
   lokale ontwikkeling een echte mailserver nodig hebben?
2. **Hoe bewaren we het verificatietoken veilig?** Net als bij sessie- en apparaat-tokens mag een
   db-lek geen bruikbare tokens opleveren.
3. **Wat blokkeert onbevestigde toegang?** T1.3 moet blijven werken zonder mailserver (verificatie
   is een aanvulling, geen harde blokkade op registratie), maar er moet een zinvolle grens zijn.
4. **Hoe voorkomen we account-enumeratie** bij het opnieuw versturen?

## Beslissing

**Provider-agnostisch mail-transport achter een injecteerbare interface** (`server/src/mail/transport.ts`),
in dezelfde vorm als de OpenSymbols-client (ADR-0006) en de latere AI-provider:

- Een `MailTransport`-interface (`send(message)`) met drie implementaties: `SmtpMailTransport`
  (nodemailer, productie), `LogMailTransport` (dev — logt de mail incl. link) en
  `MemoryMailTransport` (tests — vangt de mail op zodat een test de link kan uitlezen).
  `createMailTransport(env)` kiest SMTP als `SMTP_URL` óf `SMTP_HOST` is gezet, anders het log-transport; via
  `buildApp({ mail })` injecteren tests het geheugen-transport.
- De verbinding is op **twee manieren** op te schrijven: `SMTP_URL` (één string) of de losse velden
  `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_TIMEOUT_SECONDS`. De
  losse vorm bestaat omdat een hostingpakket zijn gegevens zo opgeeft én omdat een URL het
  wachtwoord aan percent-codering onderwerpt — een `/` of `#` erin is een stille misconfiguratie
  die pas opvalt als er geen mail aankomt. `smtpSettingsFromEnv()` vertaalt de ene keuze
  `SMTP_SECURE` naar de twee nodemailer-vlaggen die er samen over gaan (`secure` en `requireTLS`),
  omdat `secure: false` "niet vanaf de eerste byte" betekent en niet "onversleuteld". Beide vormen
  tegelijk is een fout, niet een voorrangsregel.
- Een **prod-guard** dwingt af dat er in productie een mailserver staat (anders zou daar niemand een
  mail krijgen) en dat `EMAIL_VERIFICATION_URL_BASE` https is.
- **TLS is niet optioneel.** `SmtpMailTransport` zet `requireTLS`, zodat een `smtp://`-URL
  (STARTTLS, meestal poort 587) de upgrade naar TLS afdwingt en de verzending laat falen als die
  mislukt, in plaats van de SMTP-inloggegevens alsnog in platte tekst te versturen. Bij
  `smtps://` (implicit TLS, poort 465) is de vlag een no-op. De env kiest dus wélke TLS-variant,
  nooit óf er TLS is. Let op de nodemailer-valkuil: geef je `createTransport()` een object met een
  `url`-property, dan gebruikt het alléén die URL en gooit het de overige opties weg — de vlag
  gaat daarom als query-parameter mee (`withRequiredTls`).

**Gevolg voor de client:** omdat het token eenmalig is, mag de verificatiepagina het hooguit één
keer inwisselen. `VerifyEmailPage` dedupliceert daarom per token (ref, geen state): onder
`<StrictMode>` draait het effect twee keer, en een tweede POST met hetzelfde token levert per
definitie de neutrale fout op — met als zichtbaar gevolg een foutmelding op een geslaagde
verificatie. Zie `web/src/VerifyEmailPage.test.tsx`.

**Token gehasht at-rest, eenmalig en verlopend** (`server/src/auth/email-verification.ts`,
tabel `EmailVerificationToken`): alleen de SHA-256-hash staat in de db; het rauwe 256-bit token gaat
uitsluitend per mail. Inwisselen zet `usedAt` en `emailVerifiedAt` in één transactie; een resend
verwijdert eerst het vorige ongebruikte token (hooguit één geldig token per account).

**Verificatie-gate:** onbevestigde accounts mogen inloggen en hun eigen gegevens bekijken, maar het
aanmaken van gebruikers (`POST /users` — echte, privacygevoelige personen) is geblokkeerd met
`403 EMAIL_NOT_VERIFIED` (`requireVerifiedEmail`). Zo blijft registratie/login werken zonder
mailserver, terwijl de eerste gevoelige stap wél verificatie vereist. De bootstrap-seed-admin wordt
meteen als geverifieerd aangemaakt (door de operator ingericht, niet publiek aangemeld).

**Geen enumeratie:** inwisselen weigert onbekend/verlopen/gebruikt met dezelfde neutrale melding;
`resend` antwoordt **altijd** neutraal, of het adres nu bestaat, al geverifieerd is of onbekend, en
is streng per-IP rate-limited.

## Gevolgen

- **Makkelijker:** één testbaar patroon voor mail; de verificatieflow draait volledig zonder netwerk;
  een andere mailprovider is een kwestie van een nieuwe `MailTransport`-implementatie.
- **Afweging:** de gekozen gate is bewust smal (alleen `POST /users`). Latere gevoelige acties
  (persoonlijke context T6.1, export T8.1) kunnen dezelfde `requireVerifiedEmail`-preHandler krijgen;
  de grens staat gedocumenteerd in `docs/security.md` zodat uitbreiding expliciet gebeurt.
- **Nieuwe dependency:** `nodemailer` (alleen server, alleen voor het SMTP-transport).

## Alternatieven overwogen

- **Verificatie hard verplichten vóór login** — breekt de eis dat T1.3 zonder mailserver werkt en
  sluit een net-geregistreerde admin buiten als de mail niet aankomt. Afgewezen.
- **Resend op de ingelogde sessie i.p.v. op e-mailadres** — voorkomt enumeratie triviaal, maar dekt
  het geval "mail nooit ontvangen, sessie verlopen" niet. We kozen een publiek, neutraal, rate-limited
  endpoint dat óók enumeratie-veilig is.
- **Token plaintext in de db** — simpeler lookups, maar een db-lek zou alle accounts direct
  verifieerbaar maken. Afgewezen; consistent met sessie-/apparaat-tokens hashen we.
