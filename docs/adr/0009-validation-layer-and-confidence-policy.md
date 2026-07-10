# 0009. Validatielaag, herhaling-vermijding en confidence-beleid

- **Status:** geaccepteerd
- **Datum:** 2026-07-10

## Context

T5.2 vervangt de gescripte vraagselectie achter `POST /conversation/{id}/next` door de AI-orchestrator
(ADR-0008) en voegt de harde waarborgen uit DESIGN §7 toe. De krachten:

1. **AAC-begrenzing (DESIGN §7.6, §7.8).** De AI mag tijdens communicatie **geen vrije concepten**
   verzinnen; elk voorgesteld symbool moet in de beheerde bibliotheek bestaan. Een verzonnen concept mag
   de gebruiker nooit bereiken — ook niet als de provider (of straks een externe worker, T5.5) zich
   misdraagt.
2. **Nieuwe begrippen niet automatisch actief (DESIGN §7.6, FR-016).** Ontbreekt een begrip, dan is dat
   een **voorstel** ter beoordeling door een beheerder, geen live uitbreiding.
3. **Herhaling vermijden (DESIGN §7.5).** Nooit dezelfde vraag/optie opnieuw, nooit dezelfde foutieve
   route.
4. **Confidence-gestuurde vraagselectie (DESIGN §7.4).** De zekerheid stuurt of we een nieuwe vraag
   stellen, verder verfijnen of een boodschap voorstellen.
5. **Terug-functie blijft exact (T4.1).** De vorige opties moeten na `↩ Terug` identiek terugkomen.
6. **Determinisme.** De hele flow moet zonder netwerk, deterministisch te testen zijn.

## Beslissing

**We plaatsen een validatielaag + confidence-beslissingslaag tussen de orchestrator en de gebruiker, met
de AAC-relatieboom als bron van begrensde kandidaten en de beslissing als pure functie van de opgeslagen
stappen.**

- **Kandidaten uit de AAC-boom, niet vrij door de AI.** De beslissingslaag (`conversation/decision.ts`)
  laadt de mogelijke opties uit de relatieboom (intentie-categorieën bij de start, anders de kinderen van
  het laatst gekozen concept) en geeft **alleen** die als `availableSymbols` aan de AI. De AI kiest/ordent
  daarbinnen; de keuzevalidatie op `/next` blijft tegen de boom lopen (een keuze moet een geldige
  AAC-zet zijn).
- **Validatielaag (`ai/validation.ts`).** Elke door de AI voorgestelde optie wordt tegen de bibliotheek
  getoetst in de prioriteitsvolgorde uit §7.6: (1) bestaand concept → houden; (2) synoniem/label van een
  bestaand concept → omzetten naar dat concept; (3) anders → een `ConceptProposal` (`status: PENDING`)
  aanmaken en de optie **weglaten**. Idempotent op `concept` (uniek) → herhaalde voorstellen vormen één
  openstaand item. Zo bereikt een onbekend concept de gebruiker nooit, en belandt het begrip in de
  reviewlijst voor de beheerder (T7.3).
- **Herhaling vermijden — stateloos, pad-gebaseerd.** De reeds gekozen concepten (het pad) worden
  uitgesloten, vóór de AI-aanroep én na validatie. De laag accepteert bovendien een extra
  `excludeConcepts`-set (leeg in T5.2) voor bv. afgewezen keuzes bij een correctie (T5.4). Bewust géén
  groeiende, gepersisteerde "getoonde opties"-set: dat zou de exacte terug-functie breken. `↩ Terug`
  toont eerder gepasseerde siblings juist opnieuw — dat is het doel van terug, geen ongewenste herhaling.
- **Confidence-beleid (`ai/thresholds.ts`).** De AI levert een optionele **interpretatie-zekerheid**
  (los van de per-optie-zekerheid). De banden uit §7.4: `select` (<60%), `refine` (60–85%),
  `propose` (>85%). Een eindconcept (geen opties meer) is altijd `propose`. `propose` betekent: geen vraag
  meer (`question: null`, `done: true`) — klaar om een boodschap voor te stellen (T4.3/T5.3). Aan de start
  (nog niets gekozen) stellen we nooit voor. Overgebleven opties worden op zekerheid geordend.
- **Pure functie van de stappen.** De beslissing hangt alleen van de opgeslagen `ConversationStep`s af
  (met de deterministische mock), zodat `/start`, `/next` en `/back` reproduceerbaar zijn en de
  terug-functie exact herstelt.

## Gevolgen

- **Makkelijker/veiliger:** een verzonnen concept van welke provider dan ook wordt hard tegengehouden en
  netjes als voorstel vastgelegd; herhaling-vermijding en terug blijven consistent; de confidence-banden
  zijn testbaar zonder echt model. De architectuur is klaar voor de onbetrouwbare externe worker (T5.5):
  worker-uitvoer loopt door dezelfde validatielaag.
- **Afweging:** de per-optie-selectie/capping op `iconsPerScreen` blijft een UI-taak (T4.2); de server
  **ordent** op zekerheid maar cap niet server-side, zodat o.a. het intentie-startscherm (5 categorieën)
  volledig blijft. De `ConversationStep.confidence` legt de interpretatie-zekerheid van de nieuwe toestand
  vast (was `null` in de gescripte engine).
- **Later heroverwegen:** of "getoonde-maar-niet-gekozen" opties over meerdere routes explicieter
  uitgesloten moeten worden; hoe de correctieflow (T5.4) `excludeConcepts` voedt; of de mock een rijkere
  interpretatie-zekerheid moet simuleren.

## Alternatieven overwogen

- **AI vrij laten kiezen uit de hele bibliotheek (zonder boom-kandidaten)** — vergroot het risico op
  irrelevante/onbegrensde opties en maakt determinisme/terug lastiger. Afgewezen: de boom levert de
  begrenzing, de AI de selectie/ordening.
- **Onbekende concepten stil laten vallen (geen voorstel)** — verliest signaal voor
  bibliotheekuitbreiding (FR-016). We leggen ze vast als `ConceptProposal`.
- **Gepersisteerde "getoonde opties"-set voor herhaling-vermijding** — breekt de exacte terug-functie en
  voegt state toe. Pad-gebaseerde, stateloze uitsluiting is voldoende en consistent.
- **`propose` forceren op hoge per-optie-zekerheid** — dat gaat over de *volgende* keuze, niet over
  begrip van de intentie. We gebruiken een aparte interpretatie-zekerheid voor de fase.
