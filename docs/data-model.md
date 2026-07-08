# Datamodel

> Bron van waarheid wordt `server/prisma/schema.prisma` (vanaf T0.2). Hier leggen we
> de **relaties en keuzes** uit die niet uit het schema alleen blijken. Ontwerpbron:
> [../DESIGN.md](../DESIGN.md) §6.

## Status

Nog geen database in T0.1. Het relationele model (Organization, Account, User,
UserCommunicationProfile, PersonalContext, Preference, AacSymbol, AacConceptRelation,
ConversationSession, ConversationStep, GeneratedMessage, CorrectionEvent, Device,
ConceptProposal) volgt vanaf **T0.2** via Prisma-migraties.

## Belangrijke keuzes (vooruitblik uit DESIGN §6)

- **Tenant-/eigenaar-isolatie:** elke query wordt gefilterd op `organizationId` en/of
  `userId` en daarop getest (DESIGN §9.4).
- **Migraties:** alle DB-wijzigingen via `prisma migrate dev`; nooit ad-hoc.
- **Gevoelige velden:** persoonlijke context versleuteld at-rest; sessietokens gehasht.
- **Minimale opslag:** nooit AI-aannames, afgewezen boodschappen of onzekere
  voorspellingen opslaan (DESIGN §6.4).

## Migratiegeschiedenis (kort)

- _(nog geen migraties; eerste komt in T0.2)_
