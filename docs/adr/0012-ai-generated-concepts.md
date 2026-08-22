# 0012. De AI stuurt het gesprek: retrieval-kandidaten, negatieve context en AI-gegenereerde concepten

- **Status:** geaccepteerd
- **Datum:** 2026-08-22

## Context

De derde gebruikerstest legde één samenhangend probleem bloot: Intento was in de praktijk een
**boomwandelaar met een AI-herschikker**, niet een AI die achterhaalt wat de gebruiker bedoelt.

Waargenomen scenario: de gebruiker koos "Iets willen", kreeg drie opties (eten / drinken / iets doen),
gaf aan dat het er niet bij stond — en kreeg de vijf startcategorieën terug.

Drie mechanismen versterkten elkaar tot dat gedrag:

1. **De kandidatenset was één boomknoop.** `availableSymbols` bevatte uitsluitend de kinderen van de
   laatste keuze (ADR-0009). `want` heeft in de seed exact drie kinderen, dus na "Iets willen" kón geen
   enkel model iets anders voorstellen; de overige ~70 bibliotheekconcepten bestonden op dat moment niet.
   De kwaliteit van het model deed er niet toe — de ruimte om te redeneren ontbrak.
2. **De afwijzing bereikte de AI nooit.** `CorrectionEvent` filterde afgewezen concepten lokaal weg,
   maar de gesloten `aiPromptSchema` had er geen veld voor. Voor het model was "geen van deze past"
   onzichtbaar: het kreeg simpelweg een kortere lijst en herhaalde zijn redenering.
3. **Een leeg niveau viel terug naar de wortel.** Waren alle kinderen uitgesloten, dan liep
   `findAvailableCandidates` omhoog door het pad en eindigde bij de intentiecategorieën — het
   startscherm. De gebruiker die aangaf het beter te weten, werd teruggezet naar het begin.

Daar bovenop maakte de T9.10-vangnetregel de AI vrijwel machteloos: ná de AI-keuze werden **alle**
overige kandidaten alsnog aangeplakt in bibliotheekvolgorde, waardoor het scherm bij kleine sets identiek
was of de AI nu meedacht of niet.

De krachten bij het oplossen:

1. **Eigenaarschap blijft bij de gebruiker (DESIGN §2, §7.8).** Wat de AI ook voorstelt, de gebruiker
   kiest en bevestigt zelf. Dit is niet-onderhandelbaar en begrenst elke oplossing hieronder.
2. **De gebruiker mag niet vastzitten in andermans woordenschat.** Staat zijn woord niet in de
   bibliotheek, dan was er geen uitweg — een AAC-hulpmiddel dat het woord van de gebruiker niet kent en
   het ook niet kán leren, faalt in zijn kerntaak.
3. **Geen bibliotheek vol bijna-duplicaten.** Een AI die vrij concepten aanmaakt, produceert binnen
   enkele gesprekken "wandelen", "een wandeling maken" en "buiten lopen" naast elkaar. Dat maakt kiezen
   voor de gebruiker juist moeilijker — het tegenovergestelde van het doel.
4. **De beheerder houdt het laatste woord** over wat blijvend in de beheerde bibliotheek staat
   (DESIGN §7.6, FR-016).
5. **Determinisme.** De hele flow moet zonder netwerk deterministisch te testen blijven (ADR-0008).
6. **De terug-functie blijft exact** (T4.1): `↩ Terug` herstelt de vorige vraag met dezelfde opties.

## Beslissing

**We maken de kandidatenset los van de relatieboom, laten de negatieve context expliciet meereizen in de
prompt, en staan AI-gegenereerde concepten toe — met deduplicatie vooraf en beheer achteraf.**

### 1. Kandidaten uit retrieval, niet uit één boomknoop

`conversation/candidates.ts` stelt de set per beurt samen uit vier bronnen, ontdubbeld en begrensd op
`AI_MAX_CANDIDATES` (standaard 30): boomkinderen van de laatste keuze · retrieval over de héle
bibliotheek (op `searchText`/synoniemen, gevoed door de begeleidersvraag, de toegestane persoonlijke
context en het gekozen pad) · geleerde voorkeuren · de intentiecategorieën als bodem.

De boom blijft het sterkste signaal (boomkinderen staan vooraan), maar is niet langer de grens. Daarmee
vervalt ook de T9.10-aanvulregel als krukje: er is nu een betekenisvolle set om uit te kiezen, dus de
AI-ordening telt weer. De ondergrens op het aantal aangeboden opties (T9.10) blijft: de AI mag ordenen,
niet zó ver snoeien dat er niets te kiezen valt.

### 2. Aangeboden opties worden vastgelegd

Zodra de kandidaten niet meer uit de boom volgen, kan `resolveOption` een keuze niet meer tegen de boom
valideren zonder elke AI-keuze buiten de boom als `INVALID_CHOICE` te weigeren. Daarom legt
`ConversationStep.offeredConcepts` vast wat er die beurt is aangeboden, en houdt
`ConversationSession.pendingOffer` de nog onbeantwoorde vraag vast. De keuzevalidatie loopt daarop.

Dit borgt meteen dat `↩ Terug` **exact** herstelt: de vorige opties komen uit de opslag, niet uit een
nieuwe AI-aanroep die anders zou kunnen kiezen.

### 3. Negatieve context reist mee in de prompt

`aiPromptSchema` krijgt twee velden: `askedQuestions` (de eerder gestelde vragen) en `rejectedConcepts`
(concept + label + soort: `wrong_guess` of `no_fitting_option`). De sleutelset blijft **gesloten**: dit
zijn AAC-concepten en door het systeem gestelde vragen, geen chatgeschiedenis en geen vrije invoer van
de gebruiker.

`no_fitting_option` wordt daarmee een **signaal voor een richtingverandering** in plaats van een stil
filter, en het gesprek valt niet meer terug naar het startscherm: de keuzes van de gebruiker blijven
staan en er volgt een nieuwe retrieval-ronde met het afgewezen niveau uitgesloten.

### 4. Nieuwe concepten mogen — na deduplicatie, met pictogram, onder beheer

De validatielaag (§7.6) loopt de trappen in volgorde af:

1. bestaand concept → gebruiken;
2. synoniem/label van een bestaand concept → omzetten;
3. **nieuw** → een `AacSymbol` aanmaken met `origin: 'ai'` en `reviewStatus: 'PENDING'`, meteen een
   pictogram zoeken via de bestaande OpenSymbols-client (inclusief de `https`/SSRF-guard uit ADR-0006),
   met een neutrale placeholder als terugval — en een `ConceptProposal` vastleggen voor de beheerder;
4. beheer: pictogram vervangen, label bijstellen, in de relatieboom hangen, of samenvoegen met een
   bestaand symbool (dan wordt het begrip een synoniem en verdwijnt het als los concept).

Trap 1 en 2 blijven hard en gaan altijd voor: dat is de deduplicatie die kracht 3 borgt.

Het nieuwe symbool is in de UI **zichtbaar gemarkeerd** als nieuw woord. De boodschapgeneratie blijft
strikt begrensd tot de door de gebruiker gekozen concepten (§7.8), dus een AI-gegenereerd concept komt
nooit in een boodschap zonder dat de gebruiker het zelf heeft aangetikt.

### 5. Hypothese-state per sessie

De AI legt per beurt vast wát ze denkt dat de gebruiker bedoelt (concepten + zekerheid + onderbouwing).
De zekerheid wordt over beurten heen gedempt in plaats van per antwoord overschreven, zodat de
voorsteldrempel (§7.4) niet op één modelantwoord vuurt. De correctieflow wijst de misstap aan op de
hypothesegeschiedenis in plaats van op de laagste per-stap-`confidence` als proxy.

Privacy: alleen AAC-concepten en getallen, nooit persoonlijke context, en **vluchtig** — de hypothese
wordt bij het afronden van het gesprek verwijderd (DESIGN §3.6: geen onzekere aannames opslaan).

## Gevolgen

**Positief**

- De AI kan daadwerkelijk achterhalen wat de gebruiker bedoelt: een smalle tak blokkeert het gesprek
  niet meer.
- "Geen van deze past" is een echte uitweg geworden in plaats van een reset naar het startscherm.
- De gebruiker zit niet langer vast in een vooraf bepaalde woordenschat.
- De bibliotheek groeit mee met de mensen die haar gebruiken, zonder vol te lopen met duplicaten.
- `↩ Terug` is aantoonbaar exact, omdat de aangeboden opties zijn opgeslagen in plaats van herleid.

**Negatief / kosten**

- **De AAC-begrenzing is verzacht.** Een verzonnen concept kán nu bij de gebruiker komen. Dat is bewust,
  maar het verplaatst een deel van de waarborg van "onmogelijk" naar "zichtbaar gemarkeerd + onder
  beheer". De beheerder krijgt daarmee echt werk: ongereviewde concepten stapelen op als niemand kijkt.
- **Grotere prompts.** Tot 30 kandidaten plus negatieve context per aanroep kost tokens en latency ten
  opzichte van de drie tot acht boomkinderen van voorheen.
- **Meer state.** `offeredConcepts`, `pendingOffer` en de hypothese zijn nieuwe gegevens per gesprek;
  migraties en opruimen bij `/confirm` horen erbij.
- **Retrieval-kwaliteit wordt een factor.** Levert de retrieval slechte kandidaten, dan is de AI-keuze
  ook slecht — een nieuwe faalmodus die er eerder niet was (de boom was dom maar voorspelbaar).
- ADR-0009 is op twee punten achterhaald: de kandidatenbron (boom → retrieval) en het weglaten van
  onbekende concepten. Die ADR blijft staan als historie; dit besluit gaat voor.

**Neutraal**

- De orchestrator-interface (ADR-0008) en de wachtrij (ADR-0010) blijven ongewijzigd: de wijzigingen
  zitten in de contextbouw en de beslissingslaag, niet in het providercontract.
