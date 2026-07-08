# <Projectnaam>

<Eén zin: wat doet dit project en voor wie.>

## Project-template

Deze map is een **startsjabloon** voor een nieuw Node.js/TypeScript-project.
Kopieer de inhoud naar een lege projectmap en vul de `<...>`-plekken in.

Inhoud:

- `README.md` — dit bestand (vervang deze uitleg door je echte project-README).
- `CLAUDE.md` — werkregels die Claude Code automatisch laadt (uit `CLAUDE.template.md`).
- `NODEJS-PROJECT-ARCHITECTURE.md` — volledige architectuur & werkwijze (naslag).
- `CHANGELOG.md` — bijhouden per fase/release.
- `.env.example` — gedocumenteerde env-variabelen.
- `docs/` — architecture, api, data-model, security + `docs/adr/` beslissingsrecords.

### Zo begin je
1. Kopieer deze map naar je nieuwe project en hernoem `CLAUDE.template.md` → `CLAUDE.md`.
2. Vul in dit README de projectnaam en beschrijving in (verwijder deze template-sectie).
3. Start Claude Code en vraag om een **gefaseerd plan** vóór het bouwen.

---

## Aan de slag (vul in tijdens fase 0)

### Vereisten
- Node.js ≥ 22 LTS
- <database, bijv. SQLite (geen installatie) of PostgreSQL>

### Installeren
```bash
npm install
cp .env.example .env   # vul de waarden in
npm run <migratie-commando>   # bijv. prisma migrate dev
```

### Draaien
```bash
npm run dev        # ontwikkelserver
npm run build      # productiebuild
npm start          # gebouwde app
```

### Kwaliteit (moet groen zijn — zie Definition of Done in CLAUDE.md)
```bash
npm run typecheck
npm run lint
npm test
npm audit
```

## Structuur
<Korte beschrijving van de mappen; verwijs naar docs/architecture.md voor het waarom.>

## Documentatie
- Architectuur: [docs/architecture.md](docs/architecture.md)
- API: [docs/api.md](docs/api.md)
- Datamodel: [docs/data-model.md](docs/data-model.md)
- Beveiliging: [docs/security.md](docs/security.md)
- Beslissingen: [docs/adr/](docs/adr/)
- Wijzigingen: [CHANGELOG.md](CHANGELOG.md)
