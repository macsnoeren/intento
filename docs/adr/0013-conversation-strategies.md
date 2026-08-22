# 0013. Gespreksstrategieën: configuratie-gedreven, ingebouwd, per gebruiker of gesprek te kiezen

- **Status:** geaccepteerd
- **Datum:** 2026-08-22

## Context

Na Fase 10 stuurt de AI het gesprek: de kandidaten komen uit retrieval, de negatieve context reist mee
in de prompt en een hypothese draagt de zekerheid over beurten heen (ADR-0012). Er is daarmee precies
**één** manier waarop Intento probeert te achterhalen wat de gebruiker bedoelt — en die manier is
nergens als geheel zichtbaar. De knoppen liggen verspreid:

| Knop | Waar |
|---|---|
| Volgorde en gewicht van de kandidatenbronnen | `conversation/candidates.ts` |
| `MIN_OFFERED_OPTIONS` / `MAX_OFFERED_OPTIONS` | `conversation/decision.ts` |
| `CONFIDENCE_REFINE` / `CONFIDENCE_PROPOSE` | `ai/thresholds.ts` |
| `HYPOTHESIS_SMOOTHING` | `conversation/hypothesis.ts` |
| `GOAL` + `AAC_RULES` | `ai/prompt.ts` |

Wie de aanpak wil wijzigen, raakt vijf modules aan. Erger dan de spreiding is wat de waarden
*betekenen*: ze coderen een **aanname over de persoon**. De huidige set gaat uit van iemand die
categorieën begrijpt en stapsgewijs verfijnt. Voor iemand die snel overprikkeld raakt zijn twaalf
opties te veel; voor iemand die concrete dingen wél herkent maar niet kan categoriseren is "eerst
kiezen tussen eten/drinken/iets doen" een omweg; voor iemand met een sterk vast dagritme is de
persoonlijke context een beter startpunt dan de begrippenboom. Eén aanpak voor iedereen botst met
DESIGN §5.3 (instellingen per gebruiker) en met de belofte van §7.3 ("gepersonaliseerd op basis van
profiel en historie").

De krachten:

1. **De garanties mogen niet meebewegen.** Eigenaarschap, deduplicatie, "afgewezen komt niet terug",
   de gesloten promptsleutelset en "nooit een leeg scherm" zijn domeinregels (DESIGN §2, §7.5, §7.6,
   §7.8), geen instellingen. Elke vorm van variatie is een plek waar zo'n waarborg stil kan wegvallen.
2. **De begeleider moet kunnen kiezen.** De keuze hoort bij de persoon en wordt gemaakt door iemand
   zonder ontwikkelaarskennis — dus met een label en een uitleg in begrijpelijke taal.
3. **Testbaarheid.** De hele flow moet deterministisch met de mock-provider te toetsen blijven
   (ADR-0008), en het verschil tússen strategieën moet aantoonbaar zijn, niet alleen beweerd.
4. **Multi-tenant-isolatie is duur.** Alles wat per organisatie bewerkbaar is, vraagt om een
   tenant-gefilterde tabel, een beheer-UI en veiligheidsgrenzen per parameter (ADR-0005).
5. **Kwaliteit kan stil verslechteren.** Meer aanpakken betekent meer manieren waarop een gesprek
   slechter gaat zonder dat iemand het merkt.

## Beslissing

**We maken de gespreksstrategie een expliciet, benoemd begrip: een parameterset binnen één pijplijn,
ingebouwd in code, te kiezen per gebruiker of per gesprek — met de domeinregels er hard buiten.**

### 1. Configuratie-gedreven, niet vier implementaties

Een strategie is een waarde: sleutel, label, uitleg en de parameters uit DESIGN §7.10
(kandidatenbronnen + volgorde, maximum kandidatenset, onder-/bovengrens aanbod, verfijn- en
voorsteldrempel, demping, promptfragmenten, of nieuwe concepten mogen, minimum aantal
gebruikerskeuzes vóór een voorstel). `conversation/strategy.ts` bevat het type en een registry met een
expliciete standaard; `candidates.ts`, `decision.ts`, `hypothesis.ts` en `prompt.ts` lezen eruit.

Alle strategieën van de MVP zijn als parameterset uit te drukken. Dat is veiliger en testbaarder dan
vier losse implementaties: er is één pijplijn waar de waarborgen in zitten, dus er is ook maar één plek
waar ze kunnen sneuvelen. Het type laat ruimte voor een latere strategie met eigen kandidaat-logica
zonder dat de aanroepplekken veranderen — een naad, geen verplichting.

De bestaande waarden worden de strategie **`refine`**. De constanten blijven bestaan als *de waarden
van `refine`*, niet als verspreide waarheid; het gedrag verandert daarmee niet, wat de acceptatie van
die stap is.

### 2. De domeinregels vallen erbuiten, en dat wordt afgedwongen

De lijst uit DESIGN §7.10 ("wat een strategie nooit varieert") is geen belofte in proza maar een
**gedeelde invariant-testsuite** die over élke geregistreerde strategie draait: geen leeg scherm, geen
voorstel zonder gebruikerskeuze, afgewezen concepten komen niet terug, deduplicatie eerst, gesloten
promptsleutelset. Een nieuwe strategie toevoegen betekent automatisch die suite halen.

### 3. Ingebouwd, niet in de database

Strategieën staan in code met een stabiele sleutel. De gekozen sleutel wordt wél opgeslagen
(`UserCommunicationProfile.conversationStrategy` en `ConversationSession.strategy`) en op de grens met
zod tegen de registry gevalideerd: een onbekende sleutel geeft `400` en raakt de database niet — een
half toegepaste strategie is erger dan een geweigerde. Per organisatie bewerkbare strategieën staan
bewust bij de post-MVP: die vragen tenant-isolatie op een strategie-tabel plus veiligheidsgrenzen per
parameter, en dat is een eigen ontwerp.

### 4. Selectie: gesprek → gebruiker → standaard

Eén plek (`resolveStrategy`) lost de volgorde op. De strategie ligt vast voor de duur van het gesprek:
halverwege wisselen zou het vastgelegde aanbod (ADR-0012) en de lopende hypothese inconsistent maken.

### 5. Zichtbaar welke aanpak draaide

Sleutel en label staan in de AI-beslissingslogregel, in het beheerscherm AI-activiteit en in de
gesprekstoestand. Zonder dat is "waarom deed de AI dit?" niet meer te beantwoorden zodra er meer dan
één aanpak bestaat. Alleen sleutel en label — geen promptinhoud, geen persoonlijke context (DESIGN
§9.4).

## Gevolgen

**Positief**

- De aanpak is één benoemd ding geworden in plaats van vijf verspreide constanten.
- De aanpak kan passen bij de persoon, wat §5.3 en §7.3 al beloofden.
- De domeinregels staan aantoonbaar buiten de variatie: één suite, alle strategieën.
- Een nieuwe strategie is een parameterset plus een onderscheidende test — geen nieuwe codepad.

**Negatief / kosten**

- **Meer manieren waarop de kwaliteit stil kan verslechteren.** Vier aanpakken betekent vier keer zo
  veel gedrag dat je niet dagelijks ziet. De onderscheidende tests per strategie zijn het minimum;
  echte zekerheid komt pas uit gebruikerstests per strategie.
- **Een keuze die verkeerd gezet kan worden.** Een begeleider die `calm` kiest voor iemand die juist
  breed wil verkennen, maakt het gesprek trager. Vandaar de uitleg in begrijpelijke taal bij elke
  keuze — en vandaar dat de sleutel zichtbaar is in de logs en het AI-activiteitscherm.
- **Twee opslagplekken en twee migraties** (profiel en sessie), plus export/import die de instelling
  moet meenemen — anders valt ze stil terug op de standaard bij een profieloverdracht.
- **Testoppervlak groeit**: de invariant-suite draait per strategie, dus de testtijd schaalt mee met
  het aantal strategieën.

**Neutraal**

- Het providercontract (ADR-0008) en de wachtrij (ADR-0010) blijven ongewijzigd: een strategie vult de
  *inhoud* van bestaande promptvelden, nooit de vorm.
- De vastlegging van het aanbod en de hypothese (ADR-0012) blijven zoals ze zijn; de strategie bepaalt
  alleen met welke parameters ze tot stand komen.

## Alternatieven overwogen

- **Vier losse implementaties achter één interface** — expressiever, maar elke implementatie is dan een
  eigen plek waar een waarborg kan sneuvelen, en het verschil tussen strategieën wordt onvergelijkbaar.
  De MVP-strategieën vragen die vrijheid niet; het type houdt de deur open voor de eerste die het wél
  vraagt.
- **Strategieën in de database, beheerbaar per organisatie** — flexibeler, maar vraagt tenant-isolatie
  op een strategie-tabel, een beheer-UI en veiligheidsgrenzen per parameter (een organisatie die de
  voorsteldrempel op 0 zet, sloopt §7.8). Bewust post-MVP.
- **Eén strategie houden en de parameters per gebruiker instelbaar maken** — schuift de aanname naar de
  begeleider zonder hem iets begrijpelijks te geven om te kiezen: "demping 0,6" is geen keuze die
  iemand zonder ontwikkelaarskennis kan maken. Benoemde strategieën met uitleg wel.
- **Automatisch de strategie kiezen op basis van gedrag** — aantrekkelijk, maar dat is leren over de
  persoon zonder expliciete toestemming en zonder zichtbaarheid (DESIGN §3.8, §9.4). Eerst expliciet
  kiezen, pas daarna eventueel adviseren.
