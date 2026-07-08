# 0001. Belangrijke beslissingen vastleggen als ADR

- **Status:** geaccepteerd
- **Datum:** <YYYY-MM-DD>

## Context
Architectuurkeuzes (stack, database, auth-aanpak, uitrolmodel) worden gaandeweg
gemaakt. Zonder vastlegging raakt het *waarom* kwijt en worden keuzes later
onnodig heropend of per ongeluk teruggedraaid.

## Beslissing
We leggen elke noemenswaardige beslissing vast als een kort Architecture Decision
Record in `docs/adr/`, oplopend genummerd (`0001-...`, `0002-...`), volgens
`template.md`. Een ADR wordt niet herschreven als hij achterhaald is; we voegen een
nieuwe toe en zetten de oude op *vervangen door*.

## Gevolgen
- Het *waarom* achter keuzes blijft bewaard, ook als de code verandert.
- Kleine overhead per beslissing (een paar minuten schrijven).
- Nieuwe teamleden (en Claude Code) kunnen de context snel teruglezen.

## Alternatieven overwogen
- **Alles in één architectuurdocument** — vervaagt de historie; keuzes en hun
  onderbouwing raken vermengd met de huidige stand.
- **Niets vastleggen** — snelst op de korte termijn, duurst op de lange.
