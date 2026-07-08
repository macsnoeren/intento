# Beveiliging

> Welke maatregelen genomen zijn en welke afwegingen gemaakt. Werk bij per fase.
> Draai `npm audit` (0 kwetsbaarheden) en `/security-review` bij grotere fases.

## Genomen maatregelen (OWASP-checklist)
- [ ] **Injectie** — alleen geparametriseerde queries (Prisma); input via zod.
- [ ] **XSS** — framework escapet; gebruikers-URL's `http(s)`-only gevalideerd.
- [ ] **Auth** — argon2id; sessie-tokens gehasht at-rest; httpOnly + Secure cookies.
- [ ] **Account-lockout** — na <n> mislukte logins tijdelijk blokkeren.
- [ ] **Access control / IDOR** — elke query op eigenaar/tenant gefilterd + getest.
- [ ] **Rate limiting** — globaal + streng op login/register.
- [ ] **Security headers** — helmet.
- [ ] **Secrets** — via env; gevoelige velden versleuteld; prod-guard op defaults.
- [ ] **Uploads** — groottelimiet, content-type-check, opslag buiten webroot,
      ondertekende vervallende download-URL's.
- [ ] **Transport** — HTTPS/WSS in productie; `trustProxy` correct (hop-count).
- [ ] **Audit-logging** — security-relevante acties gelogd.

## Bekende afwegingen / restrisico's
- <bijv. "deploy breekt bestaande sessies bij sleutelrotatie — her-enroll nodig">

## Reviewgeschiedenis
- `<YYYY-MM-DD>` — `/security-review` gedraaid; bevindingen: <...>; status: gefixt.
