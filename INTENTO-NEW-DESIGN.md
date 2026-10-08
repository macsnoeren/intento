# Intento – Agentic AI Design

**Versie:** 0.3 (2026-10-05) — verwerkt beide ontwerpronden van 2026-10-05 (§0).
**Status:** de enige ontwerpbron voor de herbouw. Het oude `DESIGN.md` en `INTENTO-DESIGN/` zijn verwijderd; de takenlijst is `TASKS-NEW_DESIGN.md`.
**Backward compatibiliteit:** geen. Wat uit de huidige applicatie verdwijnt en wat blijft staat in §55.

---

# 0. Besluiten

| # | Onderwerp | Besluit |
|---|---|---|
| 1 | Scope | Rollen, accounts, organisaties, zelfaanmelding, tablet koppelen, spraak, huisstijl en Docker **blijven**. Alle AI-logica, prompts, gespreksstrategieën, knoppen en AI-instellingen van de huidige applicatie **verdwijnen** en worden opnieuw ontworpen. |
| 2 | Vocabulary | Een **eigen** Vocabulary. Gevuld uit externe bronnen en aan te vullen met een **eigen afbeelding + woord**. Licentie en herkomst worden per symbool bewaard (§15). |
| 3 | Ontbrekend woord | Intento toont het woord (bv. "duizelig") met het **pictogram dat er het dichtst bij komt**; de beheerder krijgt een melding dat het woord ontbreekt (§17). |
| 4 | Binary mode | Eén pictogram met een vraag en twee knoppen: **JA** en **NEE** (§12). |
| 5 | Terug en Stoppen | Op elk scherm staan **↩ Terug** en **⏹ Stoppen** (§48). |
| 6 | Bevestiging | Een boodschap is pas de boodschap van de gebruiker als hij op "Bedoel je: …?" **JA** kiest. Daarvóór is het een inference (§31). |
| 7 | Volgorde | Wat het vaakst gekozen wordt, komt **eerst** — bij pictogrammen én bij contacten. Wat er werd getoond en op welke plek, wordt altijd vastgelegd (§25, §29). |
| 8 | Contacten | De **contacten van de gebruiker** (moeder, broer, …) (§28). |
| 9 | Versturen | Per **e-mail**. De beheerder ziet alle berichten en aan wie ze gingen, en kan desgewenst een kopie per e-mail krijgen (§32). |
| 10 | Begeleider | Vraagmodus, ondersteuningsmodus en meekijken **vervallen**. Het ontwerp gaat uit van de gebruiker zelf. |
| 11 | Experience | Per gebruiker **aan/uit** te zetten (§22). |
| 12 | Bewaartermijn | **Instelbaar**, standaard **90 dagen** (§53). |
| 13 | AI-provider | **Ollama**, lokaal of in de cloud (met API-key). Achter een provider-interface, zodat andere aanbieders later kunnen (§35). |
| 14 | Waar draaien de agents | Orchestrator en agents draaien in een **Python-agentdienst** die de huidige `ai-worker` vervangt. De TypeScript-backend roept hem aan met een API-key (§3.1). |
| 15 | Orchestrator | Een **eigen** orchestrator, geen agentframework (§4). |
| 16 | Zekerheid | De agents geven **zelf** hun confidence op; de Validation Agent toetst of die voldoende is (§9). |
| 17 | Strategie | De vraagstrategie is een **instructie die de Question Agent meekrijgt** (§7.1). |
| 18 | Vorm wisselen | Bij "AI kiest" mag de vorm wisselen met een goede reden, maar **niet te snel** (§14). |
| 19 | Na de MVP | Leren over gebruikers heen (system-wide experience) en symbolen genereren. |
| 20 | Startset | De eerste Vocabulary komt uit **Mulberry Symbols** en de **Mulberry Plus Collection** van Global Symbols, vertaald naar het Nederlands (§15.1). |

**Tweede ronde (bevestigd op 2026-10-05):**

| # | Onderwerp | Besluit |
|---|---|---|
| V1 | "Geen van deze" | In Multi-icon Mode staat naast de opties een tegel **"Geen van deze"**. In Binary Mode is **NEE** dat antwoord; daar komt geen extra knop bij (§12, §13). |
| V2 | Experience standaard | Standaard **aan**. Bij het aanmaken van een gebruiker staat de instelling zichtbaar aan met uitleg, zodat de beheerder bewust kiest; uitzetten en wissen kan altijd (§22). |
| V3 | Opslag | De backend is de enige eigenaar van alle data (Session State, provenance, Vocabulary, Experience). De agentdienst is **stateless** tussen beurten (§3.1). |
| V4 | Wachtrij | De huidige AI-wachtrij (worker haalt jobs op) vervalt; de backend roept de agentdienst rechtstreeks aan, net als de spraakdienst. |
| V5 | Contact-e-mail | Een contact bevestigt zijn e-mailadres eerst (opt-in). Een tikfout mag geen gezondheidsinformatie naar een vreemde sturen (§28). |
| V6 | Contactgegevens en de LLM | Namen en e-mailadressen van contacten gaan **nooit** naar een LLM. De Contact Agent werkt met regels (§28). |
| V7 | Begeleider | Een begeleider beheert instellingen en contacten van gekoppelde gebruikers. Berichten, Vocabulary en terugzien zijn voor de beheerder. |
| V8 | Uploads | Eigen afbeeldingen alleen als PNG, JPEG of WebP. SVG alleen uit de gecontroleerde import van de startset (§20). |

---

# 1. Doel

Intento is een AI-ondersteunde communicatieapp voor mensen die moeite hebben met spreken.

De gebruiker communiceert voornamelijk via pictogrammen/symbolen. Intento helpt de gebruiker om stap voor stap duidelijk te maken wat hij of zij bedoelt.

De kern van het nieuwe ontwerp is een **agentic AI-architectuur** waarbij meerdere gespecialiseerde agents samenwerken onder regie van een centrale orchestrator.

Intento moet:

- de bedoeling van de gebruiker zo betrouwbaar mogelijk achterhalen;
- bestaande pictogrammen uit een gecontroleerde Vocabulary gebruiken;
- zich kunnen aanpassen aan de gebruiker;
- onzekerheid expliciet herkennen;
- voorkomen dat AI te snel conclusies trekt;
- leren van interacties zonder aannames als feiten te behandelen;
- zelfstandig kunnen functioneren tijdens een gesprek;
- later kunnen uitbreiden met nieuwe symbolen en communicatiemogelijkheden;
- de gebruiker altijd controle geven over wat er daadwerkelijk wordt gecommuniceerd.

Intento is **geen chatbot**. "Agentic" betekent hier: gespecialiseerde onderdelen met een vast contract, onder regie van een orchestrator die voorspelbaar beslist welk onderdeel aan de beurt is. Geen zwerm agents die elkaar zelf aanroepen.

---

# 2. Kernprincipes

## 2.1 De gebruiker blijft altijd in controle

AI mag:

- interpreteren;
- voorstellen doen;
- vragen stellen;
- opties rangschikken;
- symbolen selecteren;
- onzekerheid aangeven.

AI mag niet zelfstandig:

- namens de gebruiker een betekenis vaststellen wanneer daar onvoldoende zekerheid voor is;
- een boodschap vaststellen zonder dat de gebruiker hem met JA bevestigt;
- een bericht versturen;
- een contactpersoon kiezen zonder gebruikerskeuze;
- de betekenis van een bestaand symbool stilzwijgend veranderen;
- nieuwe symbolen automatisch als onderdeel van de officiële Vocabulary publiceren.

## 2.2 Onzekerheid is een onderdeel van het ontwerp

Intento moet niet doen alsof een interpretatie zeker is wanneer deze dat niet is.

Agents geven daarom naast hun resultaat ook informatie over:

- confidence;
- gebruikte context;
- aannames;
- alternatieve interpretaties;
- eventuele onzekerheden.

Bij onvoldoende zekerheid moet Intento bijvoorbeeld een aanvullende vraag stellen.

## 2.3 Vocabulary is centraal

De Vocabulary is geen simpele verzameling afbeeldingen.

De Vocabulary is een centrale kennislaag waarin staat:

- welk symbool beschikbaar is;
- welke betekenis/concepten eraan gekoppeld zijn;
- welke synoniemen bestaan;
- in welke contexten het symbool gebruikt kan worden;
- waar het symbool vandaan komt;
- welke licentie/provenance geldt;
- of het symbool is goedgekeurd;
- eventuele semantische verrijking;
- eventuele gebruikerservaring met het symbool.

Tijdens een live gesprek gebruikt Intento **alleen** symbolen uit deze gecontroleerde Vocabulary. Ontbreekt een woord, dan toont Intento het woord met het pictogram dat er het dichtst bij komt (§17). Er wordt tijdens een gesprek nooit een nieuw pictogram gemaakt of verzonnen.

## 2.4 Experience is evidence, not truth

Ervaring uit eerdere gesprekken mag toekomstige interacties verbeteren.

Maar:

> Wat eerder werkte, is bewijs voor een voorkeur — geen absolute waarheid.

Een eerdere keuze mag bijvoorbeeld leiden tot een hogere ranking van een bepaald symbool of contactpersoon.

Het mag echter niet automatisch betekenen dat de gebruiker dit altijd wil. Ranking **ordent**, maar verbergt nooit een optie.

## 2.5 Wat gebeurde, wat werd getoond en wat werd geïnterpreteerd zijn verschillende dingen

Intento maakt expliciet onderscheid tussen:

1. **Observed** – wat de gebruiker daadwerkelijk deed.
2. **Presented** – wat Intento aan de gebruiker heeft aangeboden.
3. **Inferred** – wat Intento daaruit concludeert.

Deze drie mogen nooit ongemerkt tot één gegeven worden samengevoegd.

Wie wat vastlegt, is ook gescheiden: **Observed en Presented legt de backend vast** (die ziet wat er op het scherm stond en wat er werd aangetikt). **Inferred komt van de agents.** Zo kan een agent nooit een observatie verzinnen.

---

# 3. High-level architectuur

```text
                         ┌────────────────────┐
                         │       USER         │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │   ORCHESTRATOR     │
                         │                    │
                         │ Session State      │
                         │ Agent hand-off     │
                         │ Decision flow      │
                         └─────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
       │ Intent      │      │ Question    │      │ Vocabulary/ │
       │ Agent       │      │ Agent       │      │ Icon Agent  │
       └─────────────┘      └─────────────┘      └─────────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                         ┌────────────────────┐
                         │    VALIDATION      │
                         │                    │
                         │ Consistency        │
                         │ Question quality   │
                         │ Icon suitability   │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ SAFETY /           │
                         │ APPROPRIATENESS    │
                         └─────────┬──────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ INTERACTION        │
                         │ STRATEGY           │
                         │                    │
                         │ Binary             │
                         │ Multi-icon         │
                         │ Adaptive           │
                         └─────────┬──────────┘
                                   │
                                   ▼
                              USER RESPONSE
                                   │
                                   ▼
                              ORCHESTRATOR
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
                     ▼                           ▼
             More clarification             Intent ready
                                                 │
                                                 ▼
                                      ┌────────────────────┐
                                      │ "Bedoel je: …?"    │
                                      │  JA → Communication│
                                      │       Intent       │
                                      └─────────┬──────────┘
                                                │
                                                ▼
                                      Speak + optional sharing flow
```

Over de volledige architectuur heen loopt:

```text
┌─────────────────────────────────────────────────────────────┐
│               BIAS & UNCERTAINTY LAYER                      │
│                                                             │
│ Bias detection │ uncertainty │ assumptions │ feedback loops │
│ provenance │ presentation context │ auditability            │
└─────────────────────────────────────────────────────────────┘
```

## 3.1 Waar draait wat

```text
tablet / beheeromgeving (React)
        │  HTTPS, sessie- of apparaatcookie
        ▼
backend (TypeScript, Fastify)  ── enige eigenaar van alle data ──▶  database + bestandsopslag
        │  rollen, tenant-isolatie, opslag, Vocabulary, contacten,
        │  versturen (e-mail), spraak, harde invarianten (§52)
        │
        │  POST /v1/turn  (API-key, per beurt)
        ▼
agentdienst (Python)  ── stateless tussen beurten ──
        │  orchestrator + agents + Interaction Strategy
        │
        │  HTTP (lokaal, of cloud met API-key)
        ▼
Ollama (lokaal of cloud)

spraakdienst (Python, Piper) — ongewijzigd, alleen via de backend bereikbaar
```

- De **client praat nooit rechtstreeks met de AI**. Alles loopt via de backend.
- De **backend** is de enige die de database kent. Per beurt laadt hij de Session State, legt hij vast wat de gebruiker deed (Observed) en stuurt hij de agentdienst alles wat die beurt nodig is. Het antwoord van de agentdienst toetst hij opnieuw (zod + harde invarianten, §52) voordat er iets op het scherm komt of wordt opgeslagen.
- De **agentdienst** krijgt per beurt de Session State, de gebeurtenis, de instellingen, de beschikbare Vocabulary (compact, zonder afbeeldingen), de samenvatting van de Experience en de contacten (id + naam, nooit e-mail). Hij geeft terug: de nieuwe Session State, wat de tablet moet tonen, de inferences, de agentbeslissingen en de gevonden gaten in de Vocabulary.
- De agentdienst **wijzigt nooit** de Vocabulary of andere data. Hij kan alleen melden.
- De Vocabulary gaat compact mee (id, labels, concepten, contexten; geen afbeeldingen). Met de startset is dat ruim 3.400 regels per beurt; binnen het compose-netwerk is dat geen probleem. Blijkt het bij het meten (N6.13) toch te traag, dan komt er een cache op versie.
- De huidige wachtrij (`AiJob`, worker-tokens) vervalt. De backend roept de agentdienst direct aan, zoals de spraakdienst.

---

# 4. Orchestrator

De Orchestrator is het centrale besturingsmechanisme van Intento.

De Orchestrator:

- beheert de sessie;
- bepaalt welke agent aan de beurt is;
- geeft relevante context door;
- ontvangt gestructureerde resultaten;
- bepaalt welke vervolgstap nodig is;
- bewaakt de interactie;
- voorkomt onnodige herhaling;
- start opnieuw een analyse wanneer nieuwe informatie eerdere aannames ondermijnt.

De Orchestrator bevat dus expliciete agent hand-off logic.

Een agent beslist niet zelfstandig welke andere agent moet worden uitgevoerd. De Orchestrator bepaalt dit op basis van de toestand van de sessie.

De Orchestrator is **eigen code, geen agentframework** en zelf **geen LLM**: de regie moet voorspelbaar en testbaar zijn.

## 4.1 Fasen van een sessie

| Fase | Wat de gebruiker ziet | Volgende fase |
|---|---|---|
| `clarify` | Vragen (binary of multi-icon) om de intentie te vinden | `confirm_message` als de intentie klaar is |
| `confirm_message` | "Bedoel je: Ik heb hoofdpijn?" — JA/NEE | JA → `share_ask` of `done`; NEE → `clarify` |
| `share_ask` | "Wil je dit sturen?" — JA/NEE (alleen als er een bevestigd contact is) | JA → `share_contact`; NEE → `done` |
| `share_contact` | Binary: "Wil je dit naar moeder sturen?"; multi-icon: contacten als tegels | Binary JA → versturen; multi keuze → `confirm_send`; alle NEE → `done` |
| `confirm_send` | Alleen in multi-icon: "Naar moeder sturen?" — JA/NEE | JA → versturen → `done`; NEE → `share_contact` |
| `done` | De boodschap groot in beeld (en "Verstuurd naar moeder") | — |
| `stopped` | De gebruiker stopte; er is niets vastgesteld of verstuurd | — |

## 4.2 Hand-offs binnen `clarify` (één beurt)

```text
1. Intent Agent        → hypotheses + confidence
2. Intent klaar?       → ja: Intent Agent levert de zin → Validation → confirm_message
   (top-confidence ≥ voorsteldrempel, ≥ 1 antwoord van de gebruiker, validatie geldig)
3. Question Agent      → volgende vraag (met strategie-instructie, §7.1)
4. Icon Agent          → symbolen bij de vraag (+ eventuele gaten, §17)
5. Validation Agent ‖ Safety Agent   (tegelijk)
6. Ongeldig?           → terug naar stap 3 met de reden (max. 2 keer), daarna de regelgebaseerde terugval
7. Interaction Strategy → presentatie (binary/multi-icon, volgorde)
```

**Terugval.** Elke LLM-agent heeft een regelgebaseerde terugval. Valt een agent uit (time-out, ongeldige JSON, ongeldig antwoord), dan neemt de terugval het over en wordt dat vastgelegd. De gebruiker krijgt nooit een leeg scherm.

---

# 5. Session State

De Session State bevat de actuele toestand van het gesprek.

Voorbeeld:

```json
{
  "session_id": "123",
  "phase": "clarify",
  "turn": 4,
  "interaction_mode": "binary",
  "mode_since_turn": 0,
  "current_intent": {
    "concept": "pain",
    "label": "pijn",
    "confidence": 0.82
  },
  "intent_hypotheses": [],
  "questions_asked": [],
  "answers": [],
  "presented_options": [],
  "selected_options": [],
  "uncertainties": [],
  "assumptions": [],
  "interaction_history": [],
  "communication_intent": null,
  "share": {
    "contacts_asked": [],
    "selected_contact": null
  }
}
```

De Session State wordt persistent opgeslagen: **door de backend, versleuteld, per beurt als momentopname**. Daardoor is ↩ Terug exact: de backend zet de vorige momentopname terug zonder de agents opnieuw aan te roepen.

Agents krijgen alleen de context die zij nodig hebben. De orchestrator snijdt per agent het deel uit de Session State dat die agent nodig heeft.

---

# 6. Intent Agent

De Intent Agent probeert te bepalen wat de gebruiker bedoelt.

Input kan zijn:

- eerdere antwoorden;
- geselecteerde symbolen;
- context;
- huidige vraag;
- Session State;
- gebruikersspecifieke ervaring.

Output bevat bijvoorbeeld:

```json
{
  "intent": "pain",
  "label": "pijn",
  "confidence": 0.82,
  "alternatives": [
    {
      "intent": "discomfort",
      "label": "ongemak",
      "confidence": 0.13
    }
  ],
  "assumptions": [],
  "needs_clarification": true,
  "message": null
}
```

De Intent Agent mag onzekerheid expliciet aangeven.

Zodra de intentie klaar is, levert de Intent Agent ook de **zin** (`"message": "Ik heb hoofdpijn."`). Die zin is een voorstel: hij wordt pas de boodschap van de gebruiker na JA op "Bedoel je: …?" (§31).

**Start.** Zonder antwoorden zijn de hypotheses de **startconcepten** uit de Vocabulary (door de beheerder gemarkeerd, bv. pijn, eten, drinken, toilet, moe, blij, verdrietig). Staat Experience aan, dan staan de vaakst gekozen startconcepten vooraan.

**Implementatie:** LLM. **Terugval:** de startconcepten in volgorde aflopen.

---

# 7. Question Agent

De Question Agent bepaalt welke vraag het beste als volgende kan worden gesteld.

Het doel is niet: zoveel mogelijk vragen stellen.

Het doel is: met zo weinig mogelijk interactie voldoende zekerheid krijgen over de bedoeling van de gebruiker.

De Question Agent houdt rekening met:

- huidige onzekerheid;
- eerdere antwoorden;
- al gestelde vragen;
- beschikbare Vocabulary;
- interaction mode;
- gebruikerservaring;
- mogelijke ambiguïteit;
- de **vraagstrategie** van de gebruiker (§7.1).

Een goede vervolgvraag is een vraag die veel onzekerheid wegneemt en begrijpelijk is voor de gebruiker.

In **Binary Mode** gaat een vraag over precies één concept ("Heb je pijn?"). In **Multi-icon Mode** over één onderwerp met meerdere concepten ("Waar doet het pijn?" → hoofd, buik, rug, …).

**Implementatie:** LLM. **Terugval:** de vraag "{label}?" over het volgende concept uit de hypotheses.

## 7.1 Vraagstrategie

De vraagstrategie is een **instructie die de Question Agent meekrijgt**. De strategieën zijn ingebouwd (in code, met een vaste sleutel). De begeleider of beheerder kiest er per gebruiker één, en elke strategie heeft daarom een uitleg in begrijpelijke taal.

| Sleutel | Label | Instructie (kern) |
|---|---|---|
| `general_to_specific` (standaard) | Van algemeen naar specifiek | Vraag eerst naar het onderwerp, dan naar details. |
| `concrete_first` | Concreet eerst | Vraag meteen naar concrete dingen; sla abstracte tussenstappen over. |
| `short_and_calm` | Kort en rustig | Korte, eenvoudige vragen, één ding tegelijk; liever een vraag meer dan een moeilijke vraag. |

Een strategie verandert de **manier van vragen**, nooit de **garanties** (§52): geen strategie mag een invariant uitschakelen.

---

# 8. Vocabulary / Icon Agent

De Icon Agent zoekt geschikte symbolen in de Vocabulary.

De agent mag niet zomaar een willekeurig nieuw pictogram verzinnen tijdens een live gesprek.

De selectie houdt rekening met:

- semantische overeenkomst;
- context;
- gebruikerservaring;
- begrijpelijkheid;
- beschikbare alternatieven;
- interaction mode.

Bijvoorbeeld:

```text
Intent:
    "hoofdpijn"

Vocabulary:
    pain
    head
    headache
    medicine
    doctor

Possible representation:
    headache
```

De agent kan daarnaast aangeven:

```json
{
  "symbol_id": "symbol-headache-001",
  "confidence": 0.91,
  "semantic_match": "strong",
  "representation": "exact"
}
```

**Implementatie:**

1. **Exact** (regels): het concept, een label of een synoniem van een item komt overeen → `semantic_match: strong`, `representation: exact`.
2. **Dichtstbij** (LLM): geen exacte treffer → de LLM noemt eerst een paar verwante woorden (synoniemen, bredere begrippen: bij "duizelig" bv. *ziek*, *misselijk*, *draaierig*). Een tekstzoekopdracht op die woorden levert een korte lijst kandidaten op, en die gaat terug naar de LLM, die er één kiest. Het antwoordschema laat **alleen bestaande ids** toe, dus de LLM kan geen symbool verzinnen. Een gedeeltelijke of zwakke match wordt `representation: stand_in` en levert een gap op (§17). Die tussenstap is nodig omdat de startset ruim 3.400 symbolen telt (§15.1): die passen niet in een prompt, en "duizelig" en "ziek" lijken als tekst niet op elkaar.
3. Is er helemaal niets in de buurt, dan het neutrale pictogram "geen afbeelding" met het woord eronder, en ook dan een gap.

---

# 9. Validation Agent

De Validation Agent controleert de output van andere agents.

De agent controleert bijvoorbeeld:

- Is de vraag begrijpelijk?
- Past de vraag bij de huidige intent?
- Past het gekozen symbool bij de vraag?
- Is de combinatie vraag + symbool semantisch correct?
- Is er sprake van tegenstrijdige informatie?
- Is de confidence voldoende?
- Wordt een eerdere aanname ten onrechte als feit behandeld?
- Wordt de gebruiker richting een bepaalde conclusie gestuurd?

De Validation Agent kan aangeven:

```json
{
  "valid": false,
  "reason": "conflicting_answers",
  "action": "clarify"
}
```

De Orchestrator kan vervolgens een gerichte verduidelijkingsvraag laten stellen.

**Implementatie: eerst vaste regels, daarna (optioneel) een LLM.** Harde controles mogen niet van een model afhangen.

| Regel | Controle |
|---|---|
| V1 | Elk symbool bestaat in de meegegeven Vocabulary. |
| V2 | Vraagtekst: 3–80 tekens, eindigt op "?", geen URL's, geen namen van de gebruiker of contacten. |
| V3 | Het concept van de vraag zit in de concepten van het symbool — of de representatie is `stand_in` met een bijbehorende gap. |
| V4 | Dezelfde vraag is in deze sessie nog niet gesteld. |
| V5 | Tegenstrijdige antwoorden (JA en NEE op hetzelfde concept) → `conflicting_answers`, actie `clarify`. |
| V6 | Binary: precies één symbool. Multi-icon: 2 tot het ingestelde aantal, allemaal verschillend. |
| V7 | Voorstel ("Bedoel je …?"): zin van 3–120 tekens, confidence ≥ voorsteldrempel, minstens één antwoord van de gebruiker. |

Het **LLM-deel** (aan/uit per installatie) beoordeelt wat regels niet kunnen: is de vraag begrijpelijk voor deze gebruiker, past ze bij de intentie, en stuurt ze de gebruiker naar een conclusie?

---

# 10. Safety / Appropriateness Agent

De Safety / Appropriateness Agent bewaakt de interactie.

Deze is bewust gescheiden van de normale Validation Agent.

De agent controleert onder andere:

- of vragen passend zijn;
- of de interactie niet onnodig belastend wordt;
- of de communicatie binnen de ingestelde grenzen blijft;
- of een actie extra bevestiging vereist;
- of de AI niet te veel verantwoordelijkheid naar zichzelf trekt.

De Safety Agent kan een actie blokkeren of terugsturen naar de Orchestrator.

**Implementatie: vaste regels + (optioneel) een LLM.**

| Regel | Controle |
|---|---|
| S1 | **Maximum aantal vragen** per sessie (instelling, standaard 15). Bereikt: de beste hypothese wordt voorgelegd ("Bedoel je …?") — maar alleen als de gebruiker er JA op zei of de zekerheid minstens 0,5 is; een gok wordt nooit voorgelegd. Anders, en bij NEE op het voorstel, volgt "Wil je stoppen?". |
| S2 | Geen voorstel zonder minstens één antwoord van de gebruiker: de AI neemt het gesprek niet over. |
| S3 | Versturen vraagt altijd een JA van de gebruiker op dát contact. |

Het **LLM-deel** (aan/uit per installatie) beoordeelt of een vraag passend en niet onnodig belastend is.

Validation en Safety draaien **tegelijk**, zodat de wachttijd per beurt niet oploopt.

---

# 11. Interaction Strategy

Intento ondersteunt meerdere interactiestrategieën.

De strategie is een centrale capability en kan zowel worden gebruikt voor:

- het bepalen van intent;
- het kiezen van antwoorden;
- het selecteren van contactpersonen;
- andere toekomstige keuzes.

De gebruiker/admin kan de strategie instellen of AI toestaan deze te bepalen.

Mogelijke instellingen:

- **Binary**
- **Multi-icon** (2 t/m 8 opties)
- **AI kiest**

De Interaction Strategy is **code, geen LLM**. Ze bepaalt de vorm en de volgorde, niet de inhoud.

---

# 12. Binary mode

In Binary Mode krijgt de gebruiker één relevante keuze: een pictogram met een vraag, en twee knoppen.

```text
┌───────────────────────────────┐
│                               │
│          [PICTOGRAM]          │
│                               │
│         Heb je pijn?          │
│                               │
│    ┌─────────┐ ┌─────────┐    │
│    │  ✔ JA   │ │  ✖ NEE  │    │
│    └─────────┘ └─────────┘    │
│                               │
│  ↩ Terug            ⏹ Stoppen │
└───────────────────────────────┘
```

- JA en NEE hebben elk een **vast symbool en een vaste kleur**, en staan **altijd op dezelfde plek** (JA links, NEE rechts). Wie ze leert vinden, hoeft niet te lezen.
- ↩ Terug en ⏹ Stoppen zijn kleiner en staan apart: het zijn geen antwoorden maar bediening.

Dit is bijzonder geschikt voor gebruikers die goed met JA/NEE kunnen communiceren maar moeite hebben met meerdere opties tegelijk.

Voorbeeld:

```text
Heb je pijn?
    ↓
JA
    ↓
Heb je pijn aan je hoofd?
    ↓
JA
    ↓
...
```

**Wat NEE betekent.** NEE is in Binary Mode ook het antwoord "het is iets anders": er komt geen aparte knop "Geen van deze" bij. Observed is alleen: "NEE op de vraag 'Heb je pijn aan je hoofd?' met het pictogram hoofd". Wat dat betekent voor de hypotheses (geen pijn? of pijn ergens anders?) is een **inference** van de Intent Agent, geen feit.

Binary mode kan ook worden gebruikt voor contactselectie:

```text
Wil je dit naar moeder sturen?
JA / NEE

Bij NEE:

Wil je dit naar broer sturen?
JA / NEE
```

De volgorde wordt bepaald door Experience — wie het vaakst gekozen wordt, komt eerst — maar de gebruiker maakt altijd zelf de keuze.

---

# 13. Multi-icon mode

In Multi-icon Mode worden meerdere opties tegelijk aangeboden.

Het aantal opties is configureerbaar: **2 t/m 8**.

Bijvoorbeeld:

```text
Wat heb je nodig?

[ DRINKEN ] [ ETEN   ]
[ PIJN    ] [ TOILET ]

[ Geen van deze ]

↩ Terug              ⏹ Stoppen
```

De Icon Agent selecteert de beschikbare symbolen.

De Interaction Strategy bepaalt hoe deze worden gepresenteerd: in welke volgorde (vaakst gekozen eerst, als Experience aanstaat) en hoeveel.

**"Geen van deze"** (V1) betekent: "het staat er niet bij". Het is de tegenhanger van NEE in Binary Mode. Observed: alle getoonde opties zijn voor deze vraag niet gekozen. Wat dat betekent, is weer een inference.

Een **bevestiging** ("Bedoel je …?", "Naar moeder sturen?") is ook in Multi-icon Mode altijd binary.

---

# 14. AI-selected / adaptive mode

Wanneer de instelling **AI kiest** is gekozen, kan Intento zelf bepalen welke interactiestrategie waarschijnlijk het beste werkt.

Bijvoorbeeld:

```text
Multi-icon
      ↓
user lijkt moeite te hebben
      ↓
Binary
      ↓
betere antwoorden
      ↓
Binary behouden
```

De AI mag tijdens een sessie dus een strategie aanpassen.

Maar:

- een expliciet door de gebruiker/admin gekozen mode heeft voorrang en wisselt **nooit**;
- er wordt pas gewisseld na **minstens 3 beurten** in de huidige vorm — de gebruiker krijgt tijd om te wennen;
- AI moet kunnen uitleggen waarom een strategie is gewijzigd;
- wijzigingen worden geregistreerd in de provenance (inference `mode_change` met reden).

**Eerste regels (MVP, bij te stellen):**

| Van → naar | Wanneer |
|---|---|
| Start | De vorm die bij deze gebruiker het vaakst tot een bevestigde boodschap leidde (Experience); anders Binary. |
| Multi-icon → Binary | In de laatste 3 beurten minstens 2 keer ↩ Terug of "Geen van deze". |
| Binary → Multi-icon | 4 keer achter elkaar NEE. |

**Uitwerking (N13.1).** Een "beurt" is hier een handeling die de backend vastlegde: een antwoord op een vraag, of ↩ Terug. Terug ziet de agentdienst zelf nooit (de backend zet het vorige scherm terug), dus de backend stuurt de laatste handelingen met het scherm erbij mee in elke beurt (`TurnRequest.recent`, Observed). De regels draaien in de agentdienst (Interaction Strategy, regels, geen LLM); naar Multi-icon alleen als er minstens twee opties als tegels te tonen zijn. Ook de startkeuze bij "AI kiest" komt als inference `mode_change` (met `from: null`) in de provenance.

---

# 15. Vocabulary

De Vocabulary is een centrale repository van communicatieconcepten en symbolen. Het is een **eigen** Vocabulary van Intento.

Een Vocabulary-item kan bijvoorbeeld bevatten:

```json
{
  "symbol_id": "symbol-123",
  "asset": "headache.png",
  "labels": ["hoofdpijn", "pijn hoofd"],
  "concepts": ["pain", "head", "headache"],
  "contexts": ["health"],
  "is_start": false,
  "scope": "platform",
  "source": "external",
  "license": {
    "key": "CC-BY-SA-4.0",
    "url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "author": "…",
    "author_url": "…",
    "source_name": "Mulberry Symbols",
    "source_url": "…",
    "source_ref": "…",
    "imported_at": "2026-10-05"
  },
  "status": "approved",
  "semantic_enrichment": [],
  "experience": []
}
```

**Waar items vandaan komen:**

| Bron | Hoe | Licentie |
|---|---|---|
| Startset | Mulberry Symbols + Mulberry Plus Collection, geïmporteerd via de API van Global Symbols en vertaald naar het Nederlands (§15.1) | CC BY-SA 4.0, met bronvermelding |
| Externe bron | De beheerder zoekt en importeert (via OpenSymbols); de afbeelding wordt **naar de eigen opslag gekopieerd** | Overgenomen van de bron; alleen licenties uit de toegestane lijst |
| Eigen afbeelding + woord | De beheerder uploadt een afbeelding en geeft het woord | `own`: de uploader verklaart dat de organisatie de afbeelding mag gebruiken; uploader en datum worden bewaard |

**Scope.** Een item hoort bij het hele platform (startset, beheerd door de platformbeheerder) of bij één organisatie (eigen afbeeldingen en imports). Een gebruiker ziet de platformitems plus die van zijn eigen organisatie, nooit die van een andere.

**Toegestane licenties** staan in een instelbare lijst. Of niet-commerciële sets (zoals ARASAAC en Sclera, CC BY-NC) mogen, is daarmee een instelling en geen codewijziging.

**Bronvermelding.** Licenties als CC BY vragen om naamsvermelding. Er is een pagina **"Bronnen"** in de beheeromgeving, ook bereikbaar vanaf de tablet.

**Status.** `approved` (bruikbaar) of `retired` (ingetrokken: niet meer aangeboden, maar bewaard zolang de provenance ernaar verwijst). Een item dat een beheerder toevoegt, is daarmee beoordeeld en direct `approved`.

## 15.1 Startset: Mulberry, vertaald naar het Nederlands

| Set | Global Symbols-slug | Omvang | Formaat | Licentie (volgens Global Symbols) | Bronvermelding |
|---|---|---|---|---|---|
| Mulberry Symbols | `mulberry` | 3.439 | SVG | CC BY-SA 4.0 | Mulberry Symbols © Steve Lee |
| Mulberry Plus Collection | `corona-symbols` | 42 (zorg: pijn, borstpijn, hoest, kan niet ademen, …) | 30 PNG, 12 SVG | CC BY-SA 4.0 | Mulberry en Global Symbols |

Het Mulberry-project zelf noemt CC BY-SA 2.0 UK. Intento legt de licentie vast zoals de bron waaruit geïmporteerd wordt (Global Symbols) hem publiceert, en noemt op de pagina "Bronnen" beide. Beide licenties staan commercieel gebruik toe, met naamsvermelding. *Share-alike* geldt voor afgeleide **afbeeldingen**: wie een pictogram bewerkt (bv. andere kleuren), deelt die bewerking onder dezelfde licentie. Vertaalde labels veranderen de afbeelding niet.

**Importeren.** De zip-downloads op de website weigeren scripts (HTTP 403). De openbare API (`GET https://globalsymbols.com/api/v1/pictos?symbolset=<slug>&page=…&per_page=…`, zonder API-key) levert dezelfde symbolen met id, woordsoort, labels en afbeeldings-URL; de afbeeldingen zelf zijn gewoon te downloaden. Daarom verloopt de import in drie gescheiden stappen:

1. **Manifest.** Een script haalt per set alle pictos op en schrijft een manifest in de repo (`vocabulary/sources/<slug>.manifest.json`): Global Symbols-id, woordsoort, afbeeldings-URL en formaat, en de Engelse, Duitse en Franse labels. Het manifest is klein en maakt de import herhaalbaar, ook als de bron verandert.
2. **Afbeeldingen.** Een tweede script downloadt de afbeeldingen naar de eigen opslag: alleen https van `globalsymbols.com`, met groottelimiet, en elke afbeelding door de afbeeldingscontrole (§20). Een afbeelding die niet door de controle komt, wordt niet geïmporteerd.
3. **Vertaling.** Global Symbols heeft voor Mulberry geen Nederlandse labels. De vertalingen staan in de repo (`vocabulary/translations/<slug>.nl.json`), per Global Symbols-id: Nederlands label, synoniemen, concept, context, startconcept ja/nee en status `reviewed` of `machine`.
   - Een **kernset** van ±80 woorden (startconcepten, behoeften, gevoelens, lichaam, de zorgsymbolen) wordt met de hand vertaald en is meteen `reviewed`.
   - De rest vertaalt een script met Ollama (status `machine`). Het krijgt de Engelse, Duitse en Franse labels plus de woordsoort mee, zodat bv. *"paint, to"* het werkwoord *schilderen* wordt en niet het zelfstandig naamwoord *verf*. De context kiest het uit een vaste lijst (gezondheid, eten en drinken, gevoelens, lichaam, mensen, plaatsen, activiteiten, dingen, tijd, overig).
   - In de beheeromgeving kan de beheerder machinevertalingen nakijken en verbeteren. Elke wijziging maakt het label `reviewed`.

De **seed** maakt van manifest + vertaling platformitems. Alleen symbolen met een Nederlandse vertaling komen in de Vocabulary: een Engels label op de tablet zou de gebruiker meer in de war brengen dan een ontbrekend woord. Het concept is een taalneutrale sleutel, afgeleid van het Engelse label (*chest pain* → `chest_pain`). Het concept is uniek over de hele startset: heeft de bron meerdere pictos met hetzelfde Engelse label (Mulberry heeft vier keer *drink*), dan krijgen de latere `drink_2`, `drink_3`, …; de exacte match van de iconagent (§16) rekent op één item per concept.

In Docker draait de import eenmalig als aparte klus die de afbeeldingen in een volume zet, net als het ophalen van de stemmen voor de spraakdienst.

---

# 16. Semantic enrichment

Symbolen kunnen semantisch worden verrijkt.

Bijvoorbeeld:

```text
Symbool:
    drink

Concepten:
    drinken
    dorst
    vloeistof
    drinken willen
```

Ook contextuele informatie kan worden toegevoegd.

Bijvoorbeeld:

```text
Context:
    health

Mogelijke interpretaties:
    "ik wil drinken"
    "ik heb dorst"
```

Deze verrijking kan ook tijdens gesprekken ontstaan.

Een agent kan bijvoorbeeld vaststellen:

```text
Het symbool "water" werd in meerdere contexten
gebruikt wanneer de gebruiker "drinken" bedoelde.
```

Dit kan als ervaring/context worden opgeslagen.

De canonieke betekenis van het symbool wordt echter niet automatisch gewijzigd. In de MVP verrijkt alleen de beheerder (labels, concepten en contexten van een item bewerken).

---

# 17. Vocabulary gaps

Tijdens een gesprek kan Intento ontdekken dat de benodigde betekenis niet goed door de huidige Vocabulary wordt ondersteund.

Bijvoorbeeld:

```text
Gebruiker probeert:
    "ik voel me duizelig"

Vocabulary:
    feeling
    sick
    pain

Geen goed symbool voor:
    dizziness
```

Intento mag dan niet zomaar doen alsof *sick* hetzelfde betekent als *dizziness*.

Er ontstaat een **Semantic Gap**:

```json
{
  "type": "vocabulary_gap",
  "concept": "dizziness",
  "label": "duizelig",
  "context": "health",
  "best_available_symbol": "symbol-sick-001",
  "confidence": 0.31
}
```

De live interactie moet gewoon kunnen doorgaan.

De gebruiker hoeft niet te wachten op menselijke tussenkomst.

**Wat de gebruiker ziet (besluit 3).** Intento toont **het woord** met **het pictogram dat er het dichtst bij komt**:

```text
┌───────────────────────────────┐
│        [picto: ziek]          │
│          duizelig             │
│                               │
│       Ben je duizelig?        │
│                               │
│     ✔ JA         ✖ NEE        │
└───────────────────────────────┘
```

- Het label is het woord van de gebruiker ("duizelig"), niet dat van het pictogram ("ziek").
- In de provenance staat deze optie als `representation: stand_in`. Het blijft dus altijd terug te vinden dat het pictogram een benadering was.
- Komt er geen enkel pictogram in de buurt, dan verschijnt het neutrale pictogram "geen afbeelding" met het woord.
- Voor wie niet leest, toont het pictogram alleen de benadering. Daarom is elk ontbrekend woord meteen een **melding voor de beheerder**: in de beheeromgeving ("Ontbrekende woorden", met een teller) en, als de beheerder dat wil, per e-mail.
- Een gap wordt per organisatie opgeslagen: concept, woord, context, beste beschikbare pictogram, hoe vaak en wanneer het laatst. **Zonder** gebruiker of gesprek eraan gekoppeld.
- "Hoe vaak" telt de beurten waarin het woord getoond werd: zonder gesprek erbij kan de backend niet zien of het in hetzelfde gesprek al eerder voorkwam. Een opgelost woord dat toch weer voorkomt, staat weer open; een genegeerd woord blijft genegeerd (de teller loopt door).

---

# 18. Vocabulary evolution

Vocabulary-uitbreiding verloopt als volgt:

```text
Live conversation
       ↓
Semantic gap
       ↓
Melding aan de beheerder ("Ontbrekende woorden")
       ↓
Beheerder voegt het woord toe (import of eigen afbeelding + woord)
       ↓
Approved Vocabulary
```

Later (na de MVP):

```text
Semantic gap → Vocabulary proposal → Optional symbol proposal/generation → Validation → Human review → Approved Vocabulary
```

De AI kan dus zelf ontdekken:

> Dit concept komt regelmatig voor, maar wordt onvoldoende ondersteund door de huidige Vocabulary.

Een menselijke beheerder bepaalt vervolgens of het nieuwe concept/symbool daadwerkelijk wordt toegevoegd.

---

# 19. Symbol Generation (na de MVP)

Nieuwe symbolen kunnen in de toekomst door AI worden voorgesteld.

Architectuur:

```text
Symbol Proposal Agent
        ↓
Symbol Generation Service
        ↓
 ┌───────────────┬─────────────────┐
 │               │                 │
 ▼               ▼                 ▼
LLM → SVG      Image Model      Other Provider
 │               │                 │
 └───────────────┴─────────────────┘
                 ↓
             Validator
                 ↓
           Human Review
                 ↓
       Approved Vocabulary
```

De Symbol Generation Service is provider-onafhankelijk.

Mogelijke providers kunnen in de toekomst bijvoorbeeld zijn:

- lokaal model;
- Ollama;
- OpenAI;
- Gemini;
- andere image-generation providers.

Intento mag hierdoor niet afhankelijk worden van één AI-provider.

---

# 20. SVG als symboolformaat

Voor eenvoudige pictogrammen kan SVG interessant zijn.

Voordelen:

- schaalbaar;
- klein;
- transparante achtergrond;
- eenvoudig te verwerken;
- geschikt voor eenvoudige geometrische pictogrammen;
- lokaal te genereren.

Een gegenereerde SVG moet worden gevalideerd.

Controleer bijvoorbeeld:

- geldige SVG;
- toegestaan elementgebruik;
- geen scripts;
- geen externe resources;
- geen externe links;
- redelijke complexiteit;
- correcte viewBox;
- geen ongewenste tekst;
- visuele geschiktheid.

Een gegenereerde SVG wordt nooit automatisch een canoniek Vocabulary-item.

**In de MVP:** SVG komt alleen uit de import van de startset (§15.1). Die SVG's gaan bij het importeren door een **afbeeldingscontrole**: geldige SVG met viewBox, geen `<script>`, `<foreignObject>` of event-handlers (`on…`), geen externe `href`/`src`, en een maximale grootte; PNG's worden gecontroleerd op de werkelijke inhoud en de grootte. Wat niet door de controle komt, wordt niet geïmporteerd. Eigen uploads zijn PNG, JPEG of WebP. SVG-uploads door beheerders komen pas na de MVP, met de volledige validator hierboven. SVG wordt altijd geserveerd met een Content-Security-Policy die scripts en externe resources blokkeert.

---

# 21. Experience Agent

Na een interactie kan de Experience Agent analyseren wat er goed en minder goed werkte.

Voorbeelden:

- Binary mode werkte goed.
- Multi-icon leidde tot meerdere foutieve keuzes.
- Symbool "pain" werd goed begrepen.
- Vraag "waar doet het pijn?" was te complex.
- Moeder werd vaak gekozen als contact.

De Experience Agent zet dit om in bruikbare ervaring.

**Implementatie, in twee lagen:**

1. **Tellingen (regels, MVP).** Na afloop van een sessie berekent de backend uit Presented en Observed: per symbool hoe vaak getoond, gekozen en gekozen op de eerste plek; hetzelfde per contact; per vorm hoe vaak die tot een bevestigde boodschap leidde. Dit voedt de ranking (§29).
   Precies: een **symbool** telt per vraagscherm (gekozen = de tegel, of JA op de binary vraag; in binary staat elk symbool op de eerste plek, zodat het ja-zeggen zichtbaar blijft, §25). Een **contact** telt één keer per gesprek: aangeboden, gekozen = JA op het versturen naar dát contact (een tegel kiezen alleen is nog geen keuze), eerste plek = het eerst aangeboden contact. Een **vorm** telt als er vragen in gesteld werden, en als gekozen voor de vorm van de laatste vraag vóór de bevestiging. Elk gesprek telt hooguit één keer; een gesprek van toen Experience uit stond, telt ook later nooit mee.
2. **Observaties (LLM, na afloop).** De agentdienst bekijkt de sessie en noteert observaties ("de vraag 'waar doet het pijn?' leek te moeilijk"). Die worden als inference bewaard en in de beheeromgeving getoond als **observatie, geen waarheid**. In de MVP sturen ze niets automatisch bij.
   De schermen over contacten gaan niet mee (daar staan namen op, V6), en de backend gooit een observatie met een contactnaam of een URL weg. Alleen met Experience aan; "Ervaring wissen" wist ook de observaties.

De Experience Agent draait **na** de sessie: de gebruiker wacht er nooit op.

---

# 22. User-specific Experience

Ervaring wordt primair per gebruiker opgeslagen.

Dit is belangrijk omdat wat voor gebruiker A werkt, niet voor gebruiker B hoeft te werken.

Voorbeeld:

```text
User A:
    Binary → goed

User B:
    Multi-icon → goed
```

De Interaction Strategy kan deze ervaring gebruiken om de presentatie aan te passen.

Experience mag echter nooit automatisch worden behandeld als waarheid.

**Aan/uit per gebruiker (besluit 11, V2).** Standaard **aan**. Bij het aanmaken van een gebruiker staat de instelling zichtbaar aan, met in gewone taal wat er onthouden wordt, zodat de beheerder bewust kiest. Uit betekent: er wordt niets opgebouwd en niets gebruikt. Daarnaast is er een knop **"Ervaring wissen"**. Experience wordt alleen opgebouwd uit wat de gebruiker in een sessie deed; wie Experience uitzet, krijgt de keuze om de opgebouwde ervaring ook te wissen.

---

# 23. System-wide Experience (na de MVP)

In een latere fase kan Intento ook leren van ervaringen over meerdere gebruikers.

Bijvoorbeeld:

```text
User sessions
      ↓
Anonymized / aggregated experience
      ↓
System Experience Agent
      ↓
Patterns
      ↓
Possible system improvements
```

Dit is nadrukkelijk een latere stap.

De individuele gebruikerservaring blijft gescheiden van algemene systeemkennis.

---

# 24. Bias & Uncertainty Layer

Bias is een expliciet onderdeel van het ontwerp.

Bias kan ontstaan in:

- AI-modellen;
- trainingsdata;
- taal;
- cultuur;
- genderassumpties;
- symbolen;
- Vocabulary;
- gebruikerservaring;
- contactselectie;
- interactiestrategie;
- semantische interpretatie;
- feedback loops;
- AI-gegenereerde symbolen.

Daarom wordt Bias & Uncertainty niet alleen als één losse agent gezien.

Het is een cross-cutting layer.

```text
             BIAS & UNCERTAINTY
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    Intent       Vocabulary   Experience
       │            │            │
       ▼            ▼            ▼
   Questions     Contacts     Strategy
```

De layer bewaakt onder andere:

- onzekerheid;
- aannames;
- stereotypering;
- culturele interpretaties;
- overmatige afhankelijkheid van historische ervaring;
- feedback loops;
- ondervertegenwoordiging;
- overconfidence.

**Concreet in de MVP:**

| # | Maatregel |
|---|---|
| B1 | Elke presentatie wordt vastgelegd met volgorde en vorm (Presented). |
| B2 | Elke inference draagt confidence, aannames en alternatieven. |
| B3 | Ranking ordent alleen; ze verbergt nooit een optie. |
| B4 | **Bias-rapport** voor de beheerder: aandeel keuzes op de eerste plek, JA-aandeel in Binary Mode, aandeel per contact op de eerste plek, aantal vormwisselingen, aantal gaps. |
| B5 | **Overconfidence** wordt geteld: een voorstel met confidence ≥ 0,9 dat de gebruiker met NEE afwijst, of een confidence die in één beurt ≥ 0,4 stijgt zonder nieuw antwoord. |
| B6 | Prompts verbieden aannames over gender, cultuur of relaties; contactgegevens komen nooit in een prompt (V6). |

**Uitwerking van B4/B5 (N14.3).** Alles uit Presented, Observed en de zekerheid in Inferred, binnen de bewaartermijn, per organisatie (of één gebruiker, of de laatste dagen). *Eerste plek* telt keuzes uit tegels en zet er de toevalsverwachting naast (gemiddeld 1 / aantal tegels). *Contact op de eerste plek*: van de verzendingen (JA op versturen naar dát contact) hoe vaak dat het eerst aangeboden contact van het gesprek was. *Vormwisselingen*: inferences `mode_change` na de startbeurt. *Plotselinge stijging*: de zekerheid van de beste hypothese stijgt van de ene beurt op de volgende met ≥ 0,4 terwijl de gebruiker daartussen geen JA gaf en niets koos (een NEE of "Geen van deze" telt dus als "geen nieuw antwoord" dat zo'n sprong rechtvaardigt).

---

# 25. Feedback loop protection

Een belangrijk risico is een zelfversterkende feedback loop.

Voorbeeld:

```text
Intento toont "moeder" als eerste keuze.
        ↓
Gebruiker kiest moeder.
        ↓
AI concludeert:
"Gebruiker prefereert moeder."
        ↓
Moeder wordt nog vaker als eerste getoond.
        ↓
Gebruiker kiest opnieuw moeder.
        ↓
AI krijgt opnieuw "bewijs".
```

Maar het systeem heeft de gebruiker zelf beïnvloed.

Daarom moet Intento altijd registreren wat er werd gepresenteerd.

Besluit 7 houdt de ranking bewust eenvoudig: wat het vaakst gekozen wordt, komt eerst. Omdat de plek van elke keuze wordt vastgelegd, laat het bias-rapport (B4) zien hoe sterk die ranking de keuzes stuurt. Een ranking die daarvoor corrigeert, is een latere stap.

In Binary Mode speelt daarnaast **ja-zeggen**: wie moeite heeft met kiezen, zegt vaker JA op wat het eerst komt. Ook dat aandeel staat in het bias-rapport.

---

# 26. Observed / Presented / Inferred

Dit onderscheid is een kernonderdeel van het datamodel.

**Observed** — wat daadwerkelijk gebeurde (vastgelegd door de backend).

```text
User selected:
    mother
Response time:
    4,2 s
```

**Presented** — wat Intento aanbood (vastgelegd door de backend, op het moment dat het naar de tablet ging).

```text
Presented:
    mother
    caregiver
    brother

Order:
    mother
    caregiver
    brother

Interaction mode:
    multi-icon
```

**Inferred** — wat Intento denkt dat dit betekent (afkomstig van een agent).

```text
Inference:
    user may prefer mother as contact
    confidence: 0.67
```

Deze drie gegevens worden afzonderlijk opgeslagen, elk in een eigen tabel (§39).

---

# 27. Provenance

Voor belangrijke AI-beslissingen moet achteraf kunnen worden gereconstrueerd:

```text
Input
  ↓
Available options
  ↓
Presentation
  ↓
User choice
  ↓
AI inference
  ↓
Result
```

Dit is belangrijk voor:

- debugging;
- bias-analyse;
- kwaliteitsverbetering;
- gebruikersveiligheid;
- onderzoek;
- uitlegbaarheid.

Per agentaanroep wordt ook een **AI Decision** vastgelegd: welke agent, status (gelukt / terugval / ongeldig), model, promptversie, duur en validatie-uitkomst. De prompttekst zelf niet: die volgt uit de promptversie en de input.

De beheerder kan een sessie **terugzien** in drie kolommen: *Getoond* (Presented), *Gekozen* (Observed) en *Gedacht* (Inferred).

---

# 28. Contact Agent

Wanneer de Communication Intent bevestigd is, kan de gebruiker ervoor kiezen deze te delen.

Bijvoorbeeld:

```text
Intent:
    "Ik heb hoofdpijn."

Intento:
    "Wil je dit sturen?"
```

Bij JA start de Sharing Workflow.

De Contact Agent bepaalt de volgorde waarin beschikbare contacten worden aangeboden.

Input:

- geconfigureerde contacten;
- eerdere keuzes;
- gebruikerservaring;
- context;
- huidige interactiestrategie.

**Contacten (besluit 8)** zijn de contacten van de gebruiker: naam (bv. "Mama"), relatie, een pictogram uit de Vocabulary en een e-mailadres. Ze worden beheerd door de beheerder of een gekoppelde begeleider. Naam en e-mailadres zijn persoonsgegevens en staan **versleuteld** opgeslagen.

**Opt-in (V5).** Een contact krijgt eerst een e-mail met een bevestigingslink. Alleen bevestigde contacten worden aangeboden. De link opent een pagina waarop het contact zelf op "Ja, ik wil berichten ontvangen" klikt; het openen van de link alleen bevestigt niets (mailscanners openen links vooraf). De mail noemt het contact zoals de beheerder hem invoerde en de organisatie, maar **niet de gebruiker**: klopt het adres niet, dan leert een vreemde niets over de persoon. Een nieuw e-mailadres vraagt opnieuw toestemming.

**Implementatie:** regels, geen LLM. De namen en e-mailadressen van contacten gaan **nooit** naar een LLM (V6); de vragen over contacten zijn vaste zinnen ("Wil je dit naar {naam} sturen?").

---

# 29. Contact selection

In Multi-icon Mode:

```text
Met wie wil je dit delen?

[ MOEDER ] [ BROER      ]
[ ZUS    ] [ BEGELEIDER ]

[ Geen van deze ]
```

Na een keuze volgt altijd: "Naar moeder sturen?" — JA/NEE.

In Binary Mode:

```text
Wil je dit naar moeder sturen?
JA / NEE

Bij NEE:

Wil je dit naar broer sturen?
JA / NEE
```

Daar is de vraag zelf de bevestiging: JA verstuurt.

**Volgorde (besluit 7):** Experience aan → wie het vaakst gekozen is, eerst. Experience uit → de vaste volgorde die de beheerder bij de contacten instelde. Hetzelfde geldt voor de startconcepten (zolang de gebruiker in dit gesprek nog nergens JA op zei; daarna bepalen zijn antwoorden de volgorde) en voor de tegels op elk multi-icon-scherm. Bij gelijke aantallen blijft de vaste volgorde. De ordening gebeurt met regels in de agentdienst, op de samenvatting die de backend alleen bij Experience aan meestuurt.

De AI mag de volgorde bepalen.

De AI mag niet zelfstandig bepalen naar wie het bericht wordt gestuurd.

Zegt de gebruiker bij elk contact NEE, dan wordt er niets verstuurd: de boodschap blijft bevestigd, en de tablet toont hem.

---

# 30. Contact preferences

Na verloop van tijd kan Intento bijvoorbeeld leren:

```text
Mother:
    frequently selected

Brother:
    sometimes selected

Caregiver:
    rarely selected
```

Dit kan de ranking beïnvloeden.

Maar:

```text
frequently selected
≠
always preferred
```

Daarom wordt ook hier de provenance bijgehouden: bij elke keuze ook op welke plek het contact stond (§41).

---

# 31. Sharing Workflow

De workflow is:

```text
Intent klaar (inference)
        ↓
"Bedoel je: Ik heb hoofdpijn?"   JA / NEE
        ↓ JA                       (NEE → terug naar clarify)
Communication Intent staat vast (Observed)
        ↓
Tablet toont en spreekt de boodschap uit   ← Speak
        ↓
Heeft de gebruiker een bevestigd contact?  nee → klaar
        ↓ ja
"Wil je dit sturen?"   JA / NEE           (NEE → klaar)   ← Cancel
        ↓ JA
Contact Agent (volgorde) → Interaction Strategy
        ↓
User selects contact (+ bevestiging in multi-icon)
        ↓
Delivery: e-mail                          ← Send
        ↓
"Verstuurd naar moeder"
```

**Waarom "Bedoel je …?" (besluit 6).** Als de gebruiker JA zei op "pijn?" en JA op "hoofd?", dan is "Ik heb hoofdpijn" een conclusie van de AI (Inferred): de gebruiker heeft die zin nooit gezien. Pas zijn JA op die zin maakt er iets van wat hij zelf koos (Observed). Daarom is er geen boodschap, geen uitspraak en geen verzending zonder die JA.

Mogelijke acties:

- **Speak** — de tablet spreekt de bevestigde boodschap uit (als voorlezen aanstaat), met een knop "🔊 Nog eens";
- **Send** — per e-mail naar een contact;
- **Cancel** — NEE op "Wil je dit sturen?", of ⏹ Stoppen.

In de toekomst kunnen hier andere acties aan worden toegevoegd.

---

# 32. Delivery

De uiteindelijke delivery-action wordt pas uitgevoerd nadat de gebruiker de benodigde keuze heeft gemaakt.

Bijvoorbeeld:

```text
Communication Intent:
    "Ik heb hoofdpijn."

Contact:
    Mother

Action:
    Send
```

Intento voert daarna pas de daadwerkelijke verzending uit.

AI mag niet zelfstandig besluiten:

> "De gebruiker heeft waarschijnlijk hulp nodig, dus ik stuur dit naar moeder."

Dat is niet toegestaan.

**Hoe (besluit 9):**

- De **backend** verstuurt, nooit de agentdienst, en alleen na een Observed JA op dát contact (invariant I3, §52).
- De e-mail bevat de boodschap en de naam van de gebruiker ("Bericht van Jan via Intento: 'Ik heb hoofdpijn.'").
- Elke verzending wordt vastgelegd (contact, tijdstip, status gelukt/mislukt). Mislukt de verzending, dan ziet de gebruiker dat op de tablet.
- De **beheerder** ziet in de beheeromgeving alle bevestigde berichten van zijn organisatie: wanneer, van wie, de boodschap en aan wie verstuurd (of "niet verstuurd").
- Een beheerder kan instellen dat hij van elk verstuurd bericht een **kopie per e-mail** krijgt, met de ontvanger erbij.

---

# 33. Interaction Strategy als herbruikbare capability

Interaction Strategy moet niet alleen onderdeel zijn van de Intent Workflow.

Dezelfde capability kan worden gebruikt voor:

- intent questions;
- contact selection;
- confirmation;
- action selection;
- future workflows.

Voorbeeld:

```python
InteractionStrategy.choose(
    options,
    user_experience,
    context,
    allowed_modes,
)
```

De uitkomst is altijd een **presentatie** in hetzelfde formaat (§34), wat er ook gekozen moet worden. De tablet hoeft dus niet te weten of hij een vraag, een bevestiging of een contactkeuze toont: hij toont een presentatie.

---

# 34. Agent communication

Agents communiceren via gestructureerde resultaten. Elk resultaat zit in dezelfde envelop:

```json
{
  "agent": "question-agent",
  "status": "success",
  "question": {
    "concept": "pain_location",
    "text": "Waar doet het pijn?"
  },
  "required_symbols": ["head", "chest", "stomach"],
  "confidence": 0.89,
  "assumptions": [],
  "needs_validation": true,
  "meta": {
    "model": "gemma4:cloud",
    "prompt_version": "question-v1",
    "latency_ms": 1800
  }
}
```

`status` is `success`, `fallback` (de regelgebaseerde terugval nam het over) of `failed`.

Hierdoor wordt de architectuur:

- voorspelbaarder;
- testbaarder;
- makkelijker te vervangen;
- minder afhankelijk van één model.

**Contracten.** De contracten tussen backend en agentdienst zijn geversioneerd (`contract_version`). Ze staan aan de Python-kant in pydantic en aan de TypeScript-kant in zod, en **beide kanten worden getest tegen dezelfde voorbeeldbestanden** (`contracts/fixtures/`), zodat ze niet uit elkaar lopen.

---

# 35. Model/provider independence

Intento moet niet architectonisch afhankelijk zijn van één LLM.

De agentlaag moet bijvoorbeeld kunnen werken met:

- Local LLM
- Ollama
- OpenAI
- Gemini
- Claude
- Other provider

De agents spreken een intern contract.

De provider is een implementatiedetail.

**In de MVP (besluit 13):** Ollama, **lokaal** (`OLLAMA_URL`) of **in de cloud** (`OLLAMA_URL` + `OLLAMA_API_KEY`). De provider-interface in de agentdienst is één methode: berichten + JSON-schema erin, gevalideerde JSON eruit. Een `FakeProvider` met vaste antwoorden maakt alle tests deterministisch en offline.

Lessen uit de huidige worker die meegaan:

- Cloudmodellen verpakken JSON soms in een code-fence. De provider haalt die weg vóór het parsen, en valideert daarna altijd opnieuw.
- Elke aanroep heeft een time-out, en bij ongeldige JSON volgt hooguit één nieuwe poging.

**Privacy bij de cloud.** Bij Ollama Cloud verlaat gespreksinhoud de eigen omgeving: de concepten, vragen en antwoorden, zonder namen of contactgegevens (V6). Dat is een keuze van de platformbeheerder bij de installatie, en hij staat in `docs/security.md`.

---

# 36. Belangrijke ontwerpregel: AI bepaalt niet automatisch de waarheid

Intento werkt met hypotheses.

Bijvoorbeeld:

```text
Hypothesis A:
    headache
    confidence 0.70

Hypothesis B:
    general pain
    confidence 0.20

Hypothesis C:
    dizziness
    confidence 0.10
```

Nieuwe informatie kan de ranking veranderen.

Een eerder gekozen intent wordt dus niet automatisch permanent vastgezet.

---

# 37. Inconsistenties

Voorbeeld:

```text
Vraag:    Heb je pijn?                 Antwoord: JA
Vraag:    Heb je pijn aan je hoofd?    Antwoord: NEE
Vraag:    Heb je pijn aan je buik?     Antwoord: NEE
```

De Validation Agent kan constateren:

> Current intent "pain" remains plausible, but location is unresolved.

De Orchestrator bepaalt vervolgens een nieuwe vraag.

Als latere informatie volledig tegenstrijdig is:

```text
Previous:
    user has pain

Later:
    user indicates no pain
```

dan moet het systeem niet blind vasthouden aan de eerdere conclusie.

---

# 38. No silent semantic changes

Experience en AI mogen niet ongemerkt de betekenis van een symbool veranderen.

Bijvoorbeeld:

```text
Canonical meaning:
    water = water/drinken
```

Een gebruiker kan het symbool regelmatig gebruiken voor "ik wil drinken".

Dit kan als ervaring worden opgeslagen.

Maar het systeem mag niet automatisch wijzigen:

```text
water = dorst
```

zonder expliciete Vocabulary-beoordeling.

Technisch afgedwongen: de agentdienst heeft geen schrijftoegang tot de Vocabulary (§3.1).

---

# 39. Data separation

Het datamodel moet conceptueel onderscheid maken tussen:

| Begrip | Tabel(len) in de backend | Bevat persoonlijke inhoud? |
|---|---|---|
| Vocabulary | `VocabularyItem`, `VocabularyGap` | Nee (gaps zonder gebruiker) |
| Experience | `ExperienceStat` | Ja, per gebruiker |
| Session State | `CommunicationSession`, `SessionTurn` (versleutelde momentopname per beurt) | Ja, versleuteld |
| User Preferences | `UserCommunicationProfile` (instellingen) | Nee |
| Observed Events | `ObservedEvent` | Verwijzingen + reactietijd |
| Presentation Events | `PresentationEvent` | Ja, tekst versleuteld |
| Inferences | `Inference` | Ja, versleuteld |
| AI Decisions | `AgentDecision` | Nee (metadata) |
| Communication Intent | `CommunicationIntent` (alleen bevestigde boodschappen) | Ja, versleuteld |
| Contacten | `Contact` | Ja, naam en e-mail versleuteld |
| Verzendingen | `Delivery` | Verwijzingen + status |

Deze informatie mag niet zomaar in één generiek "user profile" terechtkomen.

Sessietabellen heten bewust `CommunicationSession` en niet `Session`: die naam is al van de inlogsessies.

---

# 40. End-to-end voorbeeld

**Stap 1 – gebruiker start communicatie**

De gebruiker tikt op de grote startknop.

```text
USER → ORCHESTRATOR (event: start)
```

**Stap 2 – Intent Agent**

```text
Possible intent: pain   (startconcept, vaakst gekozen)
```

**Stap 3 – Question Agent**

```text
Question: "Heb je pijn?"
```

**Stap 4 – Icon Agent**

```text
Vocabulary: pain-symbol   (exact)
```

**Stap 5 – Validation ‖ Safety**

```text
Question: valid
Symbol: valid
Semantic match: strong
Safety: ok
```

**Stap 6 – Interaction Strategy**

```text
Instelling: binary

Intento toont:
[PIJN]  Heb je pijn?
JA / NEE          ↩ Terug  ⏹ Stoppen
```

**Stap 7 – gebruiker antwoordt**

```text
JA   → OBSERVED (door de backend vastgelegd, met reactietijd)
```

**Stap 8 – volgende vraag**

```text
Question Agent: "Heb je pijn aan je hoofd?"
Icon Agent: head-symbol
```

**Stap 9 – onzekerheid / gap**

Stel dat het concept "duizelig" geen goed symbool heeft. Dan:

```text
Vocabulary Gap detected
```

De gebruiker ziet het woord "duizelig" met het pictogram dat er het dichtst bij komt; de beheerder krijgt een melding (§17).

**Stap 10 – voorstel**

Wanneer voldoende zekerheid is bereikt:

```json
{
  "message": "Ik heb hoofdpijn.",
  "intent": "headache",
  "confidence": 0.94
}
```

```text
[HOOFDPIJN]  Bedoel je: Ik heb hoofdpijn?
JA / NEE
```

**Stap 11 – bevestigd**

```text
JA → Communication Intent staat vast; de tablet spreekt hem uit.
```

**Stap 12 – delen?**

```text
Wil je dit sturen?
JA / NEE
```

**Stap 13 – Contact Agent**

Bij JA:

```text
Available contacts (bevestigd):
    mother
    brother
    caregiver
```

De Interaction Strategy bepaalt hoe deze worden aangeboden.

**Stap 14 – gebruiker kiest**

```text
"Wil je dit naar moeder sturen?"  JA
```

Dit wordt geregistreerd als:

```text
OBSERVED:
    JA op contact mother

PRESENTED:
    mother was first
    binary mode
```

En eventueel:

```text
INFERRED:
    mother may be preferred
    confidence: 0.67
```

**Stap 15 – verzenden**

```text
Backend controleert: JA op dít contact, contact van deze gebruiker, e-mail bevestigd
→ e-mail verstuurd → "Verstuurd naar moeder"
→ kopie naar de beheerder (als ingesteld)
```

**Stap 16 – Experience**

Na afloop (alleen als Experience aanstaat):

```text
Binary mode:            leidde tot bevestigde boodschap
Question "Heb je pijn?": JA
Headache symbol:        gekozen (bevestigd)
Mother:                 gekozen op plek 1
```

Deze ervaring wordt opgeslagen voor toekomstige sessies.

---

# 41. Belangrijkste feedback-loop bescherming

Elke belangrijke gebruikerskeuze moet minimaal kunnen worden gekoppeld aan:

- `session_id`
- `user_id`
- `timestamp`
- `interaction_mode`
- `presented_options`
- `presented_order`
- `selected_option`
- `response_time_ms`
- `previous_context`
- `agent_inference`
- `inference_confidence`

Hiermee kan later worden onderzocht:

> Heeft de gebruiker dit daadwerkelijk gekozen, of heeft Intento de keuze sterk gestuurd?

---

# 42. Human-in-the-loop

Menselijke tussenkomst is niet nodig tijdens een normale live interactie.

Menselijke beoordeling wordt vooral gebruikt voor:

- Vocabulary expansion (ontbrekende woorden);
- generated symbols (na de MVP);
- system-wide improvements;
- quality review (sessies terugzien);
- bias investigation (bias-rapport).

Dit voorkomt dat een gebruiker tijdens een gesprek moet wachten op een beheerder.

---

# 43. MVP

De eerste versie van de nieuwe architectuur richt zich op:

**Core**

- Orchestrator + Session State
- Intent Agent
- Question Agent (met vraagstrategie)
- Vocabulary/Icon Agent (exact + dichtstbij)
- Validation Agent (regels + optioneel LLM)
- Safety/Appropriateness Agent (regels + optioneel LLM)
- Interaction Strategy: Binary, Multi-icon, AI kiest
- Bevestiging "Bedoel je …?"
- ↩ Terug en ⏹ Stoppen
- Vocabulary repository met licentie en herkomst; import uit externe bron; eigen afbeelding + woord
- Ontbrekende woorden met melding aan de beheerder
- Contacten (met e-mail-opt-in), Contact Agent, versturen per e-mail
- Berichtenoverzicht en e-mailkopie voor de beheerder
- User-specific experience (aan/uit, wissen)
- Bias & Uncertainty (B1–B6)
- Observed/Presented/Inferred provenance, sessie terugzien
- Instelbare bewaartermijn

**Nog niet noodzakelijk voor MVP**

- System-wide Experience Agent
- automatische Vocabulary-publicatie
- AI-generated symbols, SVG-uploads
- complexe image-generation pipelines
- uitgebreide provider-routing (andere aanbieders dan Ollama)
- geavanceerde cross-user learning
- een ranking die corrigeert voor de plek waar een optie stond
- eigen foto's van contacten
- andere kanalen dan e-mail (sms, push, WhatsApp)

De architectuur moet deze functies later wel kunnen ondersteunen.

---

# 44. Toekomstige uitbreidingen

Mogelijke uitbreidingen:

```text
AI-generated symbols          → Vocabulary evolution
System-wide Experience        → Anonymized aggregate learning
Adaptive interaction          → Automatic strategy optimization
Provider routing              → Local + cloud models, andere aanbieders
Additional channels           → sms / push / andere acties
```

---

# 45. Architectuurprincipes samengevat

De belangrijkste ontwerpregels zijn:

1. De gebruiker blijft altijd in controle.
2. AI ondersteunt de gebruiker maar neemt de communicatie niet over.
3. Een boodschap is pas van de gebruiker na zijn JA op "Bedoel je …?".
4. Vocabulary is een centrale kerncomponent van Intento.
5. Live interacties gebruiken alleen gecontroleerde symbolen.
6. Vocabulary gaps worden automatisch gedetecteerd en door mensen opgelost.
7. AI-generated symbols zijn kandidaten, geen automatisch goedgekeurde symbolen.
8. Experience personaliseert de interactie maar verandert niet automatisch de waarheid.
9. Observed, Presented en Inferred worden strikt gescheiden; de backend legt Observed en Presented vast.
10. Bias en feedback loops worden expliciet gemonitord.
11. Onzekerheid moet zichtbaar zijn in plaats van verborgen.
12. Agents zijn gespecialiseerd en communiceren via duidelijke contracten.
13. De Orchestrator beheert de agent hand-offs en Session State.
14. Nieuwe informatie mag eerdere hypotheses corrigeren.
15. AI mag niet zelfstandig berichten versturen of namens de gebruiker beslissen.
16. De architectuur is provider-onafhankelijk.
17. Harde garanties zitten in code (backend-invarianten), niet in een prompt.

---

# 46. Kernmodel

Het uiteindelijke mentale model van Intento is:

```text
                     ┌───────────────┐
                     │     USER      │
                     └───────┬───────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  ORCHESTRATOR   │
                    │                 │
                    │ Session State   │
                    │ Agent hand-off  │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
      INTENT             QUESTION          VOCABULARY
       AGENT              AGENT              AGENT
          │                  │                  │
          └──────────────────┼──────────────────┘
                             ▼
                  VALIDATION ‖ SAFETY
                             │
                             ▼
                  INTERACTION STRATEGY
                     │              │
                     ▼              ▼
                  BINARY       MULTI-ICON
                     │              │
                     └──────┬───────┘
                            ▼
                           USER
                            │
                            ▼
                         RESPONSE
                            │
                            ▼
                       ORCHESTRATOR
                            │
                            ▼
                "BEDOEL JE …?" → JA
                            │
                            ▼
                   COMMUNICATION INTENT
                            │
                  ┌─────────┴─────────┐
                  │                   │
                  ▼                   ▼
                SPEAK              SHARE
                                      │
                                      ▼
                                CONTACT AGENT
                                      │
                                      ▼
                                   USER (JA)
                                      │
                                      ▼
                                SEND (e-mail)


        ┌─────────────────────────────────────────┐
        │        BIAS & UNCERTAINTY LAYER         │
        │                                         │
        │  Bias │ Confidence │ Provenance         │
        │  Assumptions │ Feedback loops           │
        └─────────────────────────────────────────┘


        ┌─────────────────────────────────────────┐
        │             EXPERIENCE                  │
        │                                         │
        │  User experience → personalization      │
        │  System experience → future improvement │
        └─────────────────────────────────────────┘


        ┌─────────────────────────────────────────┐
        │              VOCABULARY                 │
        │                                         │
        │ Symbols │ Concepts │ Context            │
        │ Provenance │ Licenses │ Semantic data   │
        │ Gaps │ Proposals │ Approved symbols     │
        └─────────────────────────────────────────┘
```

---

# 47. Essentie van het ontwerp

Intento wordt daarmee geen chatbot die probeert te raden wat iemand bedoelt.

Het wordt een agentic communication system dat:

```text
Observe
   ↓
Hypothesize
   ↓
Ask
   ↓
Present
   ↓
Validate
   ↓
Observe again
   ↓
Refine
   ↓
Confirm (JA van de gebruiker)
   ↓
Communicate
```

waarbij gedurende het hele proces geldt:

```text
WHAT HAPPENED
      ≠
WHAT WAS PRESENTED
      ≠
WHAT AI THINKS IT MEANS
```

Dat onderscheid vormt samen met de gecontroleerde Vocabulary, de Orchestrator, de Interaction Strategy en de Bias & Uncertainty Layer de kern van het nieuwe Intento-ontwerp.

---

# Uitwerking voor de bouw

# 48. Tablet-UX

Algemene regels: grote klikvlakken, één beslissing per scherm, rustig ontwerp, JA en NEE altijd op dezelfde plek. ↩ Terug en ⏹ Stoppen staan op elk scherm van een lopend gesprek.

| Scherm | Inhoud |
|---|---|
| Koppelen | Ongewijzigd (koppelcode). |
| Start | Eén grote knop met pictogram ("Ik wil iets zeggen"). De gebruiker begint zelf. |
| Binary | Pictogram + vraag + ✔ JA / ✖ NEE (§12). |
| Multi-icon | Vraag + 2–8 tegels + "Geen van deze" (§13). |
| Bedoel je | Pictogram(men) + "Bedoel je: Ik heb hoofdpijn?" + JA/NEE. |
| Klaar | De boodschap groot in beeld, uitgesproken als voorlezen aanstaat, "🔊 Nog eens", en daarna eventueel "Wil je dit sturen?". |
| Contact | Binary: "Wil je dit naar {naam} sturen?"; multi-icon: contacttegels. |
| Verstuurd | "Verstuurd naar moeder" (of "Versturen is niet gelukt"), knop "Nieuw gesprek". |
| Even geen hulp | De agentdienst is niet bereikbaar: "Het lukt nu even niet", met Opnieuw proberen en Stoppen. |

- **↩ Terug** maakt het laatste antwoord ongedaan en zet het vorige scherm exact terug. Na een verzending kan Terug niet meer: een verstuurd bericht is niet terug te halen. Terug vanaf "Wil je dit sturen?" maakt dus ook de JA op "Bedoel je …?" ongedaan: de boodschap is dan niet meer bevestigd (de provenance houdt de JA en de Terug vast), en een nieuwe JA bevestigt hem opnieuw.
- **⏹ Stoppen** beëindigt het gesprek; er wordt niets vastgesteld of verstuurd. De tablet gaat terug naar Start.
- **Voorlezen** (bestaande instelling): de tablet spreekt de vraag en de boodschap uit, letterlijk zoals ze op het scherm staan.
- **Tekst tonen** (bestaande instelling): de labels onder de pictogrammen.

# 49. Beheeromgeving

| Onderdeel | Wie | Wat |
|---|---|---|
| Gebruikers | Beheerder | Ongewijzigd: aanmaken, begeleiders koppelen, tablet koppelen. |
| Instellingen per gebruiker | Beheerder, gekoppelde begeleider | §50. |
| Contacten per gebruiker | Beheerder, gekoppelde begeleider | Naam, relatie, pictogram, e-mail, status van de bevestiging, volgorde. |
| Vocabulary | Beheerder (lezen ook begeleider) | Overzicht, bewerken, intrekken, importeren, eigen afbeelding + woord, machinevertalingen nakijken, bronnen. |
| Ontbrekende woorden | Beheerder | Lijst met teller; "Woord toevoegen" of "Negeren". |
| Berichten | Beheerder | Alle bevestigde berichten, met ontvanger en status. |
| Sessies terugzien | Beheerder | Per beurt: Getoond / Gekozen / Gedacht + agentbeslissingen. |
| Ervaring | Beheerder | Wat er per gebruiker geleerd is, met "Ervaring wissen". |
| Bias-rapport | Beheerder | B4/B5. |
| Organisatie | Beheerder | Bewaartermijn. |
| Mijn account | Iedereen | Plus voor de beheerder: e-mailkopie van verstuurde berichten, e-mail bij een nieuw ontbrekend woord. |

# 50. Instellingen

**Per gebruiker** (`UserCommunicationProfile`):

| Instelling | Waarden | Standaard |
|---|---|---|
| Vorm (`interactionMode`) | `binary` / `multi` / `ai` | `binary` |
| Opties per scherm (`optionsPerScreen`) | 2–8 (alleen multi-icon) | 4 |
| Vraagstrategie (`questionStrategy`) | §7.1 | `general_to_specific` |
| Experience (`experienceEnabled`) | aan/uit | aan |
| Maximum aantal vragen (`maxQuestions`) | 5–30 | 15 |
| Tekst tonen (`showText`) | aan/uit | aan |
| Voorlezen (`speechEnabled`) | aan/uit | uit |
| Stem (`speechVoice`) | stemcatalogus | ongewijzigd |

**Per organisatie:** bewaartermijn (`retentionDays`, 7–365, standaard 90).

**Per installatie (env):** voorsteldrempel, LLM-deel van Validation/Safety aan/uit, toegestane licenties, uploadlimiet, Ollama-adres, -model en -API-key (zie `.env.example`).

# 51. API

**Tablet** (apparaatsessie):

| Endpoint | Doel |
|---|---|
| `POST /communication/sessions` | Start; sluit een eventueel lopend gesprek af. Antwoord: `{ sessionId, turn, presentation }`. |
| `GET /communication/sessions/current` | Het lopende gesprek hervatten (na herladen). |
| `POST /communication/sessions/:id/answer` | `{ turn, answer: "yes" \| "no" }` of `{ turn, optionRef }` of `{ turn, noneOfThese: true }`, plus `responseTimeMs`. Een verouderde `turn` geeft 409. |
| `POST /communication/sessions/:id/back` | ↩ Terug. |
| `POST /communication/sessions/:id/stop` | ⏹ Stoppen. |
| `GET /assets/:id?exp=…&sig=…` | Afbeelding via een ondertekende, vervallende URL. |

**Beheer** (accountsessie, rol + tenant gecontroleerd): `/vocabulary` (lijst, bewerken, intrekken), `/vocabulary/upload`, `/vocabulary/external/search`, `/vocabulary/import`, `/vocabulary/attributions`, `/vocabulary/gaps`, `/users/:id/contacts`, `/contacts/verify` (publiek, met token), `/messages`, `/communication/sessions/:id/provenance`, `/users/:id/experience`, `/organization/settings`, `/reports/bias`, `/users/:id/settings`, `/accounts/me/notifications`.

**Agentdienst** (alleen voor de backend, API-key):

| Endpoint | Doel |
|---|---|
| `GET /health` | Leeft de dienst? Zonder key. |
| `POST /v1/turn` | Eén beurt: `TurnRequest` → `TurnResponse` (§34). |
| `POST /v1/experience` | Observaties na afloop van een sessie (§21). |

Alle fouten in de bestaande vorm: `{ "error": { "code": "…", "message": "…" } }`. Is de agentdienst onbereikbaar of ongeldig, dan `503 AGENT_UNAVAILABLE`.

# 52. Harde invarianten

De backend controleert elk antwoord van de agentdienst. Dit staat in **code met tests**, los van elke prompt en elke strategie:

| # | Invariant |
|---|---|
| I1 | Elke optie verwijst naar een `approved` item dat voor deze organisatie beschikbaar is, of in een deelfase naar een bevestigd contact van déze gebruiker, met diens eigen naam als woord; een vraag over één contact noemt die naam. Een `exact` symbool draagt een woord en concept van dat item zelf (anders is het een `stand_in`); het pictogram van een gap staat ook in de Vocabulary. |
| I2 | Een Communication Intent ontstaat alleen door een Observed JA op een "Bedoel je …?"-presentatie met precies die tekst. |
| I3 | Er wordt alleen verstuurd na een Observed JA op dát contact (de binary contactvraag of de bevestiging in multi-icon), naar een contact van deze gebruiker met een bevestigd e-mailadres. |
| I4 | Binary: precies één optie. Multi-icon: 2 tot het ingestelde aantal, verschillend. Nooit een lege presentatie. Refs uniek, posities 0…n-1. |
| I5 | `stand_in` kan alleen samen met een gap in hetzelfde antwoord. |
| I6 | Geen "Bedoel je …?" zonder minstens één antwoord van de gebruiker. |
| I7 | Een expliciet ingestelde vorm wisselt nooit; bij "AI kiest" niet binnen 3 beurten na de vorige wissel. |
| I8 | De agentdienst kan niets in de Vocabulary of de contacten wijzigen; het contract heeft daar geen velden voor. |

Schendt een antwoord een invariant, dan wordt het verworpen, als `AgentDecision` met status `invalid` vastgelegd, en krijgt de tablet "Even geen hulp" (§48).

# 53. Privacy, bewaartermijn en beveiliging

- **Wat er bewaard wordt.** Dit ontwerp vervangt de oude regel "nooit AI-aannames opslaan". Presented, Observed en Inferred en de AI Decisions worden **wél** bewaard: zonder die gegevens is feedback-loop-bescherming (§25) onmogelijk. Wel versleuteld, per organisatie gescheiden, en alleen zo lang als de bewaartermijn.
- **Bewaartermijn (besluit 12).** Per organisatie instelbaar, standaard 90 dagen. Een opruimtaak verwijdert ouder materiaal: sessies, momentopnamen, provenance, bevestigde berichten en verzendingen. Experience blijft bestaan tot hij gewist wordt. Gaps bevatten geen gebruikersgegevens en blijven tot ze afgehandeld zijn.
- **Versleuteld at-rest** (AES-256-GCM, bestaande `ENCRYPTION_KEY`): Session State, presentatieteksten, inferences, bevestigde berichten, contactnamen en e-mailadressen.
- **Tenant-isolatie.** Elke query wordt gefilterd op organisatie en gebruiker, en dat wordt per endpoint getest (bestaande aanpak, ADR-0005).
- **Uploads.** Alleen PNG/JPEG/WebP, groottelimiet, controle op de werkelijke bestandsinhoud (magic bytes, niet de extensie), opgeslagen buiten de webroot, alleen bereikbaar via ondertekende, vervallende URL's.
- **Externe import.** Alleen https, alleen van de bekende bron, met groottelimiet en time-out; de afbeelding wordt gekopieerd, er wordt nooit live naar de bron gelinkt.
- **Service-to-service.** Backend → agentdienst met een gedeeld geheim (API-key), net als de spraakdienst. De agentdienst heeft geen open poort naar buiten.
- **E-mail.** Een e-mail is niet versleuteld onderweg naar de ontvanger. Daarom worden alleen bevestigde contacten gemaild, en alleen na JA van de gebruiker.
- **Audit-log** voor beheeracties: Vocabulary wijzigen/importeren/intrekken, contacten, bewaartermijn, ervaring wissen, en elke verzending.

# 54. Testen en evaluatie

- **Agentdienst:** unittests per agent met de `FakeProvider` (vaste antwoorden, ook ongeldige JSON en time-outs → terugval). Python-checks: ruff, mypy strict, unittest, pip-audit.
- **Contracten:** dezelfde voorbeeldbestanden getest met pydantic én zod (§34).
- **Backend:** `inject()`-tests met een nep-agentdienst; een test per invariant (I1–I8); isolatietests per endpoint.
- **Scenario's:** een gesimuleerde gebruiker ("bedoelt hoofdpijn", "bedoelt duizelig", "dorst", "tegenstrijdige antwoorden") speelt een volledig gesprek. Met de `FakeProvider` draait dat in de gewone testsuite. Met echte Ollama is er een los evaluatiescript dat slagingspercentage, aantal vragen en duur per agent rapporteert.
- **Tablet:** componenttests per scherm; een rooktest van begin tot eind in Docker.

# 55. Wat verdwijnt en wat blijft

**Blijft:** organisaties, accounts en rollen (ADMIN/CAREGIVER/USER), zelfaanmelding, e-mailverificatie, wachtwoordbeheer, gebruikersbeheer, begeleiders koppelen, tablet koppelen, platform-operatorconsole, audit-log, versleuteling, mailtransport, spraakdienst (voorlezen + stem), huisstijl en menu, Docker. De OpenSymbols-client wordt hergebruikt voor de import.

**Verdwijnt:**

- **AI en gespreksflow:** `server/src/conversation/*`, `server/src/ai/*` (orchestrator, prompts, validatielaag, drempels, mock-provider, wachtrij, worker-tokens), de gespreksstrategieën (`refine`, `explore`, `calm`, `context-first`, `guess`), de correctieflow, de vrije ronde, de gok als tegel en door de AI aangedragen concepten.
- **Knoppen:** "Staat er niet bij", "Dit is genoeg", "Opnieuw beginnen" (wordt ⏹ Stoppen), het oude ✅/❌-voorstelscherm, de contextindicator.
- **Instellingen:** `iconsPerScreen` (wordt `optionsPerScreen`), `aiLearningEnabled` (wordt `experienceEnabled`), `supportMode`, `contextIndicator`, `conversationStrategy`, `speechHints`.
- **Begeleiderfuncties:** vraagmodus, ondersteuningsmodus, meekijken, berichtenlijst met afhandelen, e-mailseintje aan begeleiders.
- **Beheerschermen:** AAC-bibliotheek (wordt Vocabulary), Conceptvoorstellen, Voorkeuren, Persoonlijke context, Gesprekken, AI-activiteit, Worker-tokens, AI-statusbadge.
- **Data:** `AacSymbol`, `AacConceptRelation`, `ConversationSession`, `ConversationStep`, `GeneratedMessage`, `MessageAcknowledgement`, `CorrectionEvent`, `ConceptProposal`, `Preference`, `PersonalContext`, `AiJob`, `WorkerToken`.
- **Infrastructuur:** `ai-worker/` en de compose-service `ai-worker` (profiel `ai`).
- **ADR's** die vervangen worden: 0008, 0009, 0010, 0012, 0013, 0014.
