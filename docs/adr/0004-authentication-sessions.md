# 0004. Authenticatie: argon2id, gehashte sessietokens in cookies

- **Status:** geaccepteerd
- **Datum:** 2026-07-08

## Context

T1.1 vraagt om login voor personen (ADMIN/CAREGIVER/USER) met een sessiemechanisme dat
veilig is by default (DESIGN §2, §8.2, §9.4; CLAUDE.md security-checklist). We moeten
kiezen: hoe wachtwoorden op te slaan, hoe sessies vast te houden, hoe login te beschermen
tegen brute force, en hoe login op e-mail eenduidig te maken in een multi-tenant model
waarin een `Account` bij één `Organization` hoort.

## Beslissing

- **Wachtwoorden:** argon2id (`argon2`-library) met kosten binnen de OWASP-aanbevelingen.
  Alleen de PHC-hash (incl. per-hash salt) in `Account.passwordHash`; nooit plaintext.
- **Sessies:** bij login genereren we een 256-bit random token. In de db (`Session`) staat
  **alleen de SHA-256-hash** ervan (`tokenHash`, uniek). Het rauwe token gaat als
  **ondertekende httpOnly + Secure cookie** (`intento_session`, `SameSite=Lax`) naar de
  client. Bij elke request hashen we de cookie en zoeken op de hash; db-lekkage levert dus
  geen bruikbare tokens op. SHA-256 volstaat hier (token is al hoog-entropisch, geen zwak
  wachtwoord te beschermen). Sessies hebben een `expiresAt` (`SESSION_TTL_HOURS`).
- **Brute-force:** account-lockout (`LOGIN_MAX_ATTEMPTS` → `LOGIN_LOCKOUT_MINUTES`) plus
  strenge per-IP rate limiting op `/auth/login` (`@fastify/rate-limit`, `global: false`).
  Login-fouten zijn generiek (`INVALID_CREDENTIALS`) en constante-tijd (dummy-verify bij
  onbekende e-mail) zodat het bestaan van accounts niet via responscode/-tijd lekt.
- **Login-identiteit:** `Account.email` is **platformbreed uniek**, zodat login op alleen
  e-mail+wachtwoord het account eenduidig bepaalt (geen organisatiekeuze bij login).

## Gevolgen

- Een gelekte db bevat geen bruikbare wachtwoorden of sessietokens.
- `SIGNING_SECRET` ondertekent de cookie (extra integriteitslaag); de prod-guard weigert
  dev-default-secrets en `COOKIE_SECURE=false` in productie (bestaand, ADR-0003/env.ts).
- Eén persoon kan (voorlopig) niet met hetzelfde e-mailadres accounts in meerdere
  organisaties hebben. Voor de MVP is dat acceptabel; mocht dat later nodig zijn, dan wordt
  de uniciteit `@@unique([organizationId, email])` en krijgt login een organisatiecontext.
- Rate-limitgrenzen zijn env-configureerbaar zodat tests lockout en rate limiting los van
  elkaar kunnen aantonen.

## Alternatieven overwogen

- **bcrypt/scrypt i.p.v. argon2id** — prima opties, maar argon2id is de huidige OWASP-
  eerste-keus (memory-hard, side-channel-bestand) en er is geen legacy-hash te migreren.
- **JWT in plaats van server-side sessies** — stateless, maar intrekken (logout, lockout)
  is lastig en tokens zijn tot expiratie geldig. Server-side sessies laten zich direct
  intrekken en passen bij de privacy-by-design-lijn (minimale, controleerbare staat).
- **Token plaintext in de db** — eenvoudiger lookup, maar een db-lek zou dan directe
  sessieovername mogelijk maken; afgewezen.
