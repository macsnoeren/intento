# Datamodel

> Bron van waarheid is `prisma/schema.prisma` (of je ORM-schema). Hier leg je de
> **relaties en keuzes** uit die niet uit het schema alleen blijken.

## Entiteiten (overzicht)
<Simpele opsomming of diagram van de belangrijkste modellen en hun relaties.>

- **User** — <rol/velden die uitleg vragen; bijv. passwordHash, rollen, tenant-veld>
- **<Model>** — <...>

## Belangrijke keuzes
- **Tenant-/eigenaar-isolatie:** elk model met tenant-veld (bijv. `schoolId`);
  elke query filtert erop. Wordt expliciet getest.
- **Migraties:** alle wijzigingen via `prisma migrate dev`; nooit ad-hoc.
- **Gevoelige velden:** <bijv. tokens gehasht, TOTP-secret versleuteld at-rest>.

## Migratiegeschiedenis (kort)
- `<timestamp>_init` — <wat>
- `<timestamp>_<naam>` — <wat>
