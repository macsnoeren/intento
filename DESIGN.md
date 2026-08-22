# Intento — Geconsolideerd ontwerp

**Status:** geconsolideerd uit `INTENTO-DESIGN/` (documenten 01–09, versie 0.1)
**Doel:** één document als ontwerpbron voor implementatie. De originele documenten in `INTENTO-DESIGN/` blijven naslag; bij twijfel of detailvragen gelden die als bron en wordt dit document bijgewerkt.

---

## 1. Visie en missie

Intento is een AI-ondersteunde communicatieapplicatie (AAC — Augmentative and Alternative Communication) voor mensen met een beperkt communicatievermogen: mensen die niet of moeilijk kunnen spreken, met afasie, neurologische aandoeningen of motorische beperkingen.

Traditionele AAC zegt: *"Zoek het woord dat je wilt zeggen."*
Intento draait dat om: *"Wat probeer je duidelijk te maken?"*

Niet de gebruiker zoekt naar pictogrammen — de AI helpt de gebruiker zijn of haar **intentie** te vinden door steeds passende pictogramkeuzes voor te stellen, context op te bouwen en uiteindelijk een volledige boodschap te formuleren die de gebruiker bevestigt.

**Kernzin voor ontwikkeling:** Intento is geen chatbot. Het is een AI-ondersteund communicatiehulpmiddel waarbij de AI actief helpt om de intentie van de gebruiker via AAC-pictogrammen te achterhalen, terwijl de gebruiker altijd eigenaar blijft van de boodschap.

### Kernprincipes (product)

1. **De gebruiker blijft de bron van communicatie.** De AI mag voorstellen, vragen stellen, patronen herkennen en zinnen formuleren. De gebruiker bepaalt de keuzes, of een voorstel klopt en wanneer een boodschap klaar is.
2. **AI zoekt naar intentie, niet naar woorden.** De eerste vraag gaat over de bedoeling (iets vertellen / vragen / willen / voelen / probleem), niet over een concreet woord.
3. **De AAC-bibliotheek begrenst de AI.** De AI kiest primair uit een beheerde pictogrambibliotheek. Nieuwe concepten ontstaan alleen als het begrip ontbreekt, de AI dit onderbouwt en een beheerder het beoordeelt.
4. **Privacy en eigenaarschap.** De gebruiker bezit zijn gegevens: versleuteld opgeslagen, alleen gebruikt met toestemming, exporteerbaar en meeneembaar naar een andere omgeving.

---

## 2. Rollen en organisatiestructuur

| Rol | Wie | Mag | Mag niet |
|---|---|---|---|
| **Gebruiker** (USER) | De persoon die communiceert | Gesprek starten, pictogrammen kiezen, boodschap bevestigen/afwijzen, vorige keuze herstellen, toestemming beheren | — |
| **Begeleider** (CAREGIVER) | Familielid, verzorger | Gebruiker helpen bedienen (aantikken), vragen stellen (vraagmodus), persoonlijke context beheren, instellingen aanpassen (met toestemming) | Een boodschap namens de gebruiker bevestigen zonder gebruikersinteractie |
| **Beheerder** (ADMIN) | Zorginstelling, familiebeheerder | Gebruikers toevoegen/verwijderen, begeleiders koppelen, rechten beheren, AAC-bibliotheek onderhouden, nieuwe AI-concepten beoordelen, instellingen beheren | — |

Structuur: een **Organization** (omgeving: zorginstelling, familie) bevat beheerders, begeleiders en gebruikers. Elke gebruiker heeft een persoonlijk profiel, persoonlijke context, voorkeuren en communicatie-instellingen. Een organisatie beheert toegang, maar is **niet** eigenaar van de communicatie-identiteit van de gebruiker.

---

## 3. Communicatiemodel en flows

### 3.1 Basisflow (vrij gesprek)

```
Start communicatie
→ AI bepaalt mogelijke intentie
→ AI toont pictogramkeuzes (vraag + N opties)
→ Gebruiker kiest één pictogram
→ AI verwerkt keuze + context, bepaalt nieuwe opties
→ Voldoende zekerheid?
   Nee → volgende vraag stellen (loop)
   Ja  → boodschap voorstellen ("Ik denk dat je wilt zeggen: … Klopt dat? ✅/❌")
→ Gebruiker bevestigt of corrigeert
```

Startscherm-categorieën: 🗣 Iets zeggen · ❤️ Hoe ik mij voel · 🤕 Er is iets aan de hand · ❓ Een vraag stellen · 🎯 Iets willen.

Voorbeeldroute: 🎯 Iets willen → 🚶 Iets doen → 🌳 Buiten → 🐕 Met hond → voorstel *"Ik wil buiten wandelen met mijn hond."*

### 3.2 Vraagmodus (begeleider stelt vraag)

Begeleider typt een vraag ("Wat wil je drinken?"). De AI gebruikt de vraag als context, beperkt de mogelijke antwoorden (🥤 Water · 🧃 Sap · ☕ Koffie · 🥛 Melk) en helpt het antwoord formuleren. Het antwoord wordt door de gebruiker samengesteld en bevestigd.

### 3.3 Ondersteuningsmodus

Als de gebruiker cognitief kan kiezen maar motorisch niet kan bedienen: de gebruiker geeft de keuze aan, de begeleider tikt aan. De app toont "Ondersteuningsmodus actief". De begeleider voert alleen de handeling uit; de betekenis blijft van de gebruiker.

### 3.4 Correctieflow (gebruiker kiest ❌ Nee)

De AI gaat **niet** terug naar het begin, maar rolt precies **één stap** terug:
1. de laatste keuze verdwijnt en dat concept wordt de rest van het gesprek niet meer aangeboden;
2. op dat punt volgt een nieuwe vraag, binnen de route die de gebruiker verder heeft staan;
3. nogmaals ❌ rolt de volgende stap terug — zo loopt de gebruiker zijn route in zijn eigen tempo terug;
4. de afwijzing is een signaal, maar er worden **geen voorkeuren van geleerd**.

> **Waarom niet "bepalen waar het misging".** Tot Fase 10 probeerde Intento de verkeerde afslag te *vinden*: eerst via de laagste per-stap-zekerheid, later via het kantelpunt van de hypothese. Beide signalen wezen in de praktijk de keuze aan die de gebruiker juist het bewustst had gemaakt — in de gebruikerstest verdween na één ❌ de hele route en werd de éérste keuze permanent uitgesloten. Dat keert §2 om: de onzekerheid van de AI werd afgewenteld op de gebruiker. Eén stap tegelijk is voorspelbaar, altijd herhaalbaar, en gooit nooit meer weg dan de gebruiker op dat moment aanwijst.

### 3.5 Vorige keuze herstellen

Altijd beschikbaar: `↩ Terug` — verwijdert de laatste keuze, herstelt de vorige context en toont de vorige opties opnieuw.

### 3.6 Einde gesprek

Opslaan: bevestigde boodschap, gebruikte route, eventueel nieuwe voorkeur.
**Niet** opslaan: onzekere aannames, afgewezen voorstellen, irrelevante gesprekken.

### 3.7 Onboarding (begeleider)

1. Account maken → 2. Gebruiker toevoegen (naam, communicatie-instellingen, aantal pictogrammen, ondersteuningstype) → 3. Persoonlijke-contextwizard (belangrijke personen, favorieten, dagelijkse plekken) → 4. Communicatiestijl instellen (aantal keuzes: 2/4/6/8) → 5. Tablet koppelen via code.

### 3.8 Persoonlijke context uitbreiden (suggestie)

Als de AI merkt dat een gebruiker vaak hetzelfde concept kiest, krijgt de begeleider een suggestie ("Wil je toevoegen: favoriete activiteit — wandelen?"). Begeleider kan accepteren, aanpassen of weigeren.

---

## 4. Functionele requirements (MVP tenzij anders vermeld)

| ID | Requirement | Kern-acceptatiecriteria |
|---|---|---|
| FR-001 | Start communicatie | Gesprek starten vanaf hoofdscherm; pictogramkeuzes, geen tekstinvoer als primaire interface |
| FR-002 | AI bepaalt communicatierichting | Eerste laag classificeert intentie (willen/vertellen/gevoel/probleem/lichamelijk/vraag); gebruiker zoekt niet zelf door categorieboom |
| FR-003 | Pictogram-gebaseerde keuzes | Elke keuze heeft minimaal één AAC-pictogram; tekst ondersteunend; aantal opties instelbaar (2/4/6/8) |
| FR-004 | AI-keuzeoptimalisatie | AI gebruikt gesprekcontext, AAC-bibliotheek, persoonlijke context, eerdere keuzes, voorkeuren; vermijdt irrelevantie en herhaling; kiest opties die onzekerheid verminderen |
| FR-005 | Eén keuze per stap | Elke keuze afzonderlijk verwerkt; context na iedere keuze bijgewerkt |
| FR-006 | Contextopbouw | Keuzes binnen een gesprek worden onthouden en gebruikt bij volgende vragen |
| FR-007 | Boodschap genereren | Bij voldoende zekerheid volledig voorstel; gebruiker kan bevestigen of afwijzen |
| FR-008 | AI-bevestiging | JA/NEE alleen als laatste controle bij voldoende vertrouwen, niet als standaardvraag |
| FR-009 | Correctie verwerken | Bij NEE: analyse eerdere keuzes, niet dezelfde route, gerichter doorvragen |
| FR-010 | Vorige keuze herstellen | `↩ Vorige keuze`-functie altijd beschikbaar |
| FR-011 | Begeleider-ondersteuning | Begeleider kan aantikken namens gebruiker; kan niet zelfstandig bevestigen |
| FR-012 | Vraagmodus | Begeleidersvraag wordt AI-context; AI beperkt antwoorden; gebruiker stelt antwoord samen |
| FR-013 | Persoonlijke context | Optioneel; begeleider kan toevoegen; gebruiker behoudt eigenaarschap |
| FR-014 | AI leert van gebruiker | Alleen van bevestigde communicatie; uitschakelbaar; voorkeuren beheerbaar |
| FR-015 | AAC-bibliotheek | Pictogram, betekenis, categorie, relaties, synoniemen |
| FR-016 | Nieuwe AI-concepten | Niet automatisch actief; naar beheeromgeving; koppelbaar aan pictogram |
| FR-017 | Gebruikersbeheer | Beheerder: toevoegen, verwijderen, profiel aanpassen, begeleiders koppelen |
| FR-018 | Tabletkoppeling | Apparaat koppelen via beheer (koppelcode); geen dagelijkse login; beveiligde toegang |
| FR-019 | Gegevenseigenaarschap | Exporteren, meenemen, toestemming beheren |
| FR-020 | Privacy | Versleutelde opslag; AI krijgt alleen toegestane context; gecontroleerde toegang |

**MVP-scope:** pictogramcommunicatie, AI-vragen, contextopbouw, boodschap genereren, bevestiging, correctie, basisbeheeromgeving, persoonlijke context.
**Expliciet géén MVP:** communicatie op afstand, berichten versturen, stemgenerator/spraakuitvoer, agenda-integratie, oogbesturing, externe zorgsystemen, emotieherkenning via camera.

**Kwaliteitscriteria:** eenvoudig te bedienen, weinig cognitieve belasting, betrouwbaar, fouten herstelbaar, wordt persoonlijker na gebruik.

---

## 5. UX-specificatie

### 5.1 UX-principes

- **Minimale cognitieve belasting:** één beslissing per scherm, maximaal één keuze per stap, geen lange menu's of complexe navigatie.
- **Pictogrammen primair,** tekst ondersteunend (voor begeleiders; niet noodzakelijk voor gebruik).
- **Grote duidelijke interacties:** tabletgericht, grote klikvlakken, weinig kleine knoppen, duidelijke contrasten, voldoende ruimte (voorbereid op beperkte motoriek en toekomstige oogbesturing).
- **De gebruiker houdt controle:** keuze, bevestiging en correctie liggen bij de gebruiker.

### 5.2 Drie interfaces

1. **Gebruikersapp (tablet)** — startscherm met intentiecategorieën; AI-keuzescherm (vraag + N grote pictogramopties, één keuze per scherm); AI-voorstelscherm (pictogramreeks + zin + ✅/❌); correctiescherm (gerichte hervraag, niet terug naar start); optionele contextindicator (pad van keuzes, uitschakelbaar per gebruiker); altijd `↩ Terug`.
2. **Begeleiderinterface** — vraag stellen (verschijnt in gebruikersapp), gebruiker ondersteunen (ondersteuningsmodus-indicator), context bekijken, instellingen aanpassen.
3. **Beheeromgeving** — dashboard (gebruikers, begeleiders), gebruikersbeheer (aantal keuzes, AI-leren aan/uit, persoonlijke context), persoonlijke-contextwizard (personen, favorieten, dagelijkse plekken), AAC-bibliotheekbeheer (pictogrammen, categorieën, nieuwe concepten koppelen en goedkeuren).

### 5.3 Instellingen per gebruiker

- Aantal opties per scherm: 2 / 4 / 6 / 8 (standaard **4**). Minder = eenvoudiger; meer = sneller.
- Tekst tonen: aan/uit.
- Contextindicator: aan/uit.
- AI-leren: aan/uit.
- Ondersteuningsmodus: aan/uit.
- **Gespreksstrategie** — de manier waarop de AI probeert te achterhalen wat de gebruiker bedoelt (§7.10). Een keuze uit de ingebouwde strategieën, standaard **"Stap voor stap verfijnen"**. De begeleider kiest hem, dus elke strategie draagt een korte uitleg in begrijpelijke taal ("Voor wie snel overprikkeld raakt"). Dit is een instelling over de **zoekwijze**, nooit over de waarborgen: geen enkele keuze hier verandert wie eigenaar is van de boodschap of wat de AI mag.

### 5.4 Foutpreventie en toegankelijkheid

Voorkom dubbele vragen, dezelfde keuzes opnieuw en lange communicatiepaden. Visueel: grote pictogrammen, rustig ontwerp, weinig afleiding. Motorisch: grote knoppen, begeleiderondersteuning. Cognitief: één keuze tegelijk, voorspelbare flow.

---

## 6. Datamodel

### 6.1 Principes

- Gebruiker is eigenaar van persoonlijke gegevens; organisatie beheert alleen toegang.
- Minimale opslag: alleen wat nodig is voor communicatie, personalisatie en verbetering.
- Context is gescheiden: elke AI-aanroep krijgt alleen noodzakelijke persoonlijke context, actuele gesprekcontext en toegestane voorkeuren — nooit onbeperkte toegang.

### 6.2 Entiteiten

| Entiteit | Kernvelden | Toelichting |
|---|---|---|
| **Organization** | id, name, type (family/care/personal), createdAt | Een Intento-omgeving |
| **Account** | id, email, role (ADMIN/CAREGIVER/USER), organizationId | Login voor personen met toegang |
| **User** | id, name, organizationId, active | De communicerende persoon (kan los staan van Account) |
| **UserCommunicationProfile** | userId, iconsPerScreen (2/4/6/8), showText, aiLearningEnabled, supportMode | Communicatie-instellingen |
| **PersonalContext** | userId, category (PERSON/PET/PLACE/ACTIVITY/FOOD/OBJECT/ROUTINE/OTHER), name, relationship, aiUsageAllowed | Persoonlijke informatie voor de AI |
| **Preference** | userId, concept, confidence (0–1), source (confirmed_usage) | Geleerde voorkeuren — alleen uit bevestigde keuzes |
| **AacSymbol** | id, concept, image, category, synonyms[] | Pictogram uit de bibliotheek |
| **AacConceptRelation** | parent, child, relation (contains/…) | Begripsrelaties (bijv. buiten → wandelen) |
| **ConversationSession** | id, userId, startedAt, status | Tijdelijk communicatieproces |
| **ConversationStep** | sessionId, question, selectedConcept, confidence | Elke keuze in een gesprek |
| **GeneratedMessage** | sessionId, message, confirmed | Door AI voorgestelde boodschap |
| **CorrectionEvent** | sessionId, type (wrong_guess/…), step | Correctie van de gebruiker |
| **Device** | id, userId, type, lastActive | Gekoppelde tablet |
| **ConceptProposal** | concept, reason, status, linkedSymbolId | Door AI voorgesteld nieuw begrip, ter beoordeling door beheerder (FR-016) |

### 6.3 AI-contextobject (per aanroep, tijdelijk)

```json
{
  "user": { "preferences": ["walking", "dog"] },
  "conversation": ["outside", "activity"],
  "availableSymbols": ["walking", "cycling", "park"]
}
```

### 6.4 Export/import en niet-opslaan

Profielexport bevat: communicatieprofiel, persoonlijke context, voorkeuren, instellingen. **Niet:** accountgegevens, organisatiegegevens. Nooit automatisch opgeslagen: AI-aannames, afgewezen boodschappen, onzekere voorspellingen, irrelevante gesprekken.

---

## 7. AI-architectuur

### 7.1 Vijf hoofdtaken

1. **Intentie herkennen** — soort communicatie bepalen (wens/gevoel/probleem/vraag/informatie).
2. **Volgende vraag bepalen** — de meest waardevolle pictogramopties kiezen: onzekerheid verminderen, gebruiker niet overladen, snelste route naar betekenis.
3. **Context onthouden tijdens gesprek** — keuzes combineren (buiten + wandelen + hond).
4. **Boodschap formuleren** — concepten → natuurlijke zin ("Ik wil buiten wandelen met mijn hond.").
5. **Leren van bevestigde communicatie** — alleen bevestigde keuzes, expliciete toestemming, beheerde context.

### 7.2 Conceptuele componenten

**Intent Classifier** (richting) · **Question Generator** (volgende vraag) · **Context Engine** (betekenis) · **Message Generator** (natuurlijke zin) · **Learning Engine** (voorkeuren).

### 7.3 Vraagselectie

Factoren: wat is al gekozen (context), wat past bij deze gebruiker (persoon), wat is waarschijnlijk bedoeld (waarschijnlijkheid), welke vraag geeft de meeste duidelijkheid (informatiewaarde). Niet "alle activiteiten tonen", maar gepersonaliseerd op basis van profiel en historie.

**De kandidatenset is niet één tak van de begrippenboom.** De AAC-relatieboom is een sterk *signaal* (de kinderen van de laatste keuze zijn meestal de meest relevante verfijning), maar niet de grens van wat de AI mag voorstellen. Per beurt wordt de kandidatenset samengesteld uit vier bronnen, ontdubbeld en begrensd op een maximum:

1. **Boomkinderen** — de verfijningen van de laatste keuze; het sterkste signaal.
2. **Retrieval over de hele bibliotheek** — concepten die tekstueel/semantisch aansluiten bij de begeleidersvraag, de toegestane persoonlijke context en het reeds gekozen pad.
3. **Geleerde voorkeuren** — de concepten die deze gebruiker vaker bevestigde (alleen als leren aanstaat).
4. **Intentiecategorieën** — als bodem, zodat er altijd een begin is.

Zonder stap 2 is de AI machteloos zodra een tak smal is: een intentie met drie kinderen laat het model geen enkele ruimte om te achterhalen wat de gebruiker bedoelt, hoe goed het model ook is. Dat was de oorzaak van de bevinding uit de derde gebruikerstest (Fase 10).

**Welke bronnen meedoen, in welke volgorde en hoeveel er aangeboden wordt, ligt niet vast maar volgt uit de gespreksstrategie van dit gesprek (§7.10).** De vier bronnen hierboven zijn de bronnen die er *zijn*; de strategie bepaalt hun volgorde en gewicht, het maximum van de kandidatenset en de onder- en bovengrens van het aanbod. De hierboven beschreven volgorde is die van de standaardstrategie `refine`.

### 7.4 Confidence-model

Elke interpretatie krijgt een zekerheidsscore:

| Zekerheid | Actie |
|---|---|
| < 60% | Nieuwe pictogramvraag stellen |
| 60–85% | Verder verfijnen |
| > 85% | Boodschap voorstellen (JA/NEE) |

De zekerheid is niet de rauwe waarde uit één modelantwoord maar de over beurten heen **gedempte** zekerheid van de hypothese, zodat één zelfverzekerd antwoord de voorsteldrempel niet in zijn eentje haalt.

**Zekerheid alleen is niet genoeg.** Een boodschap wordt pas voorgesteld als er ook niets meer te verfijnen valt: heeft de laatste keuze nog kinderen in de bibliotheek die de gebruiker niet gekozen of afgewezen heeft, dan blijft de AI vragen — hoe zeker ze ook is. Zonder die tweede voorwaarde kwam in de gebruikerstest "Ik wil iets warms eten." als voorstel op tafel, terwijl de bibliotheek onder "eten" zes concrete dingen kent. Zeker weten *dát* iemand wil eten is niet hetzelfde als weten *wát*. Een eindconcept (geen kinderen) blijft onveranderd een voorstel opleveren, en zijn alle verfijningen al gezien en afgewezen, dan valt er niets meer te vragen en geeft de zekerheid weer de doorslag.

De twee drempels en de demping zijn **parameters van de gespreksstrategie** (§7.10), niet van het systeem: de waarden in de tabel zijn die van de standaardstrategie `refine`. Een rustige strategie legt de voorsteldrempel hoger en dempt sterker; een verkennende legt hem lager. Wat níet varieert is de regel eronder: er komt nooit een boodschapvoorstel zonder dat de **gebruiker** zelf minstens één keuze heeft gemaakt (§2, §7.8).

### 7.5 Herhaling vermijden

De AI houdt bij: eerdere vragen, getoonde opties, afgewezen keuzes. Nooit dezelfde vraag opnieuw, nooit dezelfde foutieve route, geen irrelevante opties.

Dat bijhouden is meer dan een filter: de **negatieve context reist expliciet mee in de prompt**. Het model krijgt per aanroep:

- **`askedQuestions`** — de eerder in deze sessie gestelde vragen, zodat het niet dezelfde vraag anders formuleert.
- **`rejectedConcepts`** — de afgewezen concepten met hun soort afwijzing:
  - `wrong_guess` — de gebruiker wees een *voorstel* af (❌ Nee); de route klopte niet.
  - `no_fitting_option` — het juiste pictogram stond niet tussen de aangeboden opties; de gebruiker weet het beter dan de aangeboden set.

Een afwijzing wegfilteren zonder het te vertellen maakt de AI blind: ze ziet alleen een kleinere lijst en herhaalt haar redenering. `no_fitting_option` moet juist een **richtingverandering** uitlokken — andere invalshoek, niet dezelfde invalshoek met minder opties. Het gesprek valt daarbij nooit terug naar het startscherm: de gemaakte keuzes van de gebruiker blijven staan.

### 7.6 AAC-begrenzing en validatielaag

Prioriteit bij conceptkeuze — alle AI-output gaat door een **validatielaag** die deze trappen in volgorde afloopt:

1. **Bestaand AAC-concept** — exacte conceptsleutel; gebruiken.
2. **Synoniem of label van een bestaand concept** — omzetten naar dat concept; gebruiken.
3. **Nieuw concept** — het begrip bestaat aantoonbaar nog niet in de bibliotheek (niet als concept, niet als label, niet als synoniem). Dan mag de AI het **wel** aanbieden, onder harde voorwaarden:
   - er wordt meteen een pictogram bij gezocht (externe pictogrambron; een neutrale placeholder als er niets bruikbaars is);
   - het symbool is voor de gebruiker **zichtbaar gemarkeerd** als nieuw woord;
   - het wordt vastgelegd als voorstel voor de beheerder, met herkomst "AI-gegenereerd" en de onderbouwing van de AI.
4. **Beheer** — de beheerder ziet welke concepten nieuw zijn en kan het pictogram vervangen, het label bijstellen, het in de relatieboom hangen, of het samenvoegen met een bestaand symbool (dan wordt het begrip een synoniem en verdwijnt het als los concept).

Trap 1 en 2 zijn **niet optioneel en gaan altijd voor**: zonder die deduplicatie loopt de bibliotheek vol met bijna-duplicaten die op elkaar lijken, wat het kiezen voor de gebruiker juist moeilijker maakt.

> **Ontwerpwijziging (Fase 10).** Tot dan gold: *"de AI mag tijdens communicatie geen vrije concepten verzinnen"* — een onbekend concept werd stilzwijgend weggelaten. Dat is losgelaten. De reden: als het woord van de gebruiker niet in de bibliotheek staat, was er géén uitweg — de gebruiker zat vast in een woordenschat die iemand anders voor hem had bepaald. Het eigenaarschap (§2, §7.8) blijft geborgd doordat een nieuw concept nooit méér is dan een **voorstel**: de gebruiker kiest het zelf en bevestigt de boodschap zelf. Zie [ADR-0012](docs/adr/0012-ai-generated-concepts.md).

### 7.7 Promptingmodel

Elke AI-aanroep krijgt een verse, beperkte context (geen onbeperkte chatgeschiedenis):
`systeemregels + Intento-doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze`.

AI-input (voorbeeld): `{ "task": "select_next_question", "conversationContext": [...], "userContext": [...], "availableSymbols": [...] }`
AI-output (voorbeeld): `{ "question": "...", "options": [{ "symbol": "walking", "confidence": 0.72 }, ...], "reason": "..." }`

### 7.8 Veiligheidsregels (hard)

De AI mag **nooit**: een boodschap verzinnen zonder basis · persoonlijke informatie toevoegen zonder toestemming · namens de gebruiker spreken · een concept in een boodschap gebruiken dat de gebruiker niet zelf gekozen heeft — ook niet in een **verbogen vorm** ("warms" voor het concept `hot`).

Over nieuwe concepten (§7.6 trap 3) gelden dezelfde harde regels: een AI-gegenereerd concept is een **aanbod**, geen boodschap. Het bereikt de gebruiker uitsluitend als keuzeoptie, zichtbaar gemarkeerd, en komt pas in een boodschap als de gebruiker het zelf heeft aangetikt én de boodschap heeft bevestigd. De boodschapgeneratie blijft strikt begrensd tot de gekozen concepten; de beheerder houdt het laatste woord over wat blijvend in de bibliotheek terechtkomt.

### 7.9 Behoefte- en emotiedetectie

Naast activiteiten ondersteunt de AI: lichamelijke behoeften (pijn, honger, dorst, vermoeidheid), emoties (blij, verdrietig, boos, bang), sociale behoeften (iemand zien, hulp vragen, contact).

### 7.10 Gespreksstrategieën

Een **gespreksstrategie** is de benoemde manier waarop de AI probeert te achterhalen wat de gebruiker bedoelt. Ze bundelt de knoppen die tot nu toe verspreid in de code stonden tot één keuze met een naam, een uitleg en een stabiele sleutel.

Dat is geen opruimactie maar een ontwerpkeuze: die knoppen coderen een **aanname over de persoon**. De huidige set gaat uit van iemand die categorieën begrijpt en stapsgewijs verfijnt. Voor iemand die snel overprikkeld raakt zijn twaalf opties te veel; voor iemand die concrete dingen wél herkent maar niet kan categoriseren is "eerst kiezen tussen eten/drinken/iets doen" een omweg; voor iemand met een sterk vast dagritme is de persoonlijke context een beter startpunt dan de begrippenboom. Eén aanpak voor iedereen botst met §5.3 (instellingen per gebruiker) en met de belofte van §7.3 ("gepersonaliseerd op basis van profiel en historie").

**Parameters van een strategie:**

| Parameter | Wat het regelt |
|---|---|
| Kandidatenbronnen + volgorde/gewicht | Welke van de vier bronnen uit §7.3 meedoen en wat er vooraan staat |
| Maximum kandidatenset | Hoeveel kandidaten er maximaal aan het model worden voorgelegd |
| Onder- en bovengrens aanbod | Hoeveel opties de gebruiker minimaal en maximaal per scherm ziet |
| Verfijn- en voorsteldrempel | De twee grenzen uit het confidence-model (§7.4) |
| Demping van de zekerheid | Hoe zwaar één modelantwoord meeweegt in de hypothese |
| Promptformulering | De **inhoud** van het Intento-doel en de extra AAC-regels (§7.7) |
| Nieuwe concepten toegestaan | Of §7.6 trap 3 openstaat in dit gesprek |
| Minimum aantal gebruikerskeuzes vóór een voorstel | Hoeveel de gebruiker zelf gekozen moet hebben voordat er iets voorgesteld wordt |

**Wat een strategie NOOIT varieert.** Dit zijn domeinregels, geen instellingen (§2, §7.5, §7.6, §7.8):

- de gebruiker is eigenaar en bevestigt zelf;
- deduplicatie tegen bestaande concepten gaat altijd voor (§7.6 trap 1 en 2);
- afgewezen concepten komen nooit terug (§7.5);
- geen boodschapvoorstel zonder een keuze van de **gebruiker** — een strategie mag het minimum verhogen, nooit tot nul verlagen;
- de **gesloten promptsleutelset** (§7.7): een strategie vult de *inhoud* van het doel en de AAC-regels, nooit de *vorm* van de prompt;
- nooit een leeg scherm.

Een strategie verandert de **zoekwijze**, niet de **garanties**. Zonder die scheiding wordt elke nieuwe strategie een plek waar een waarborg stilletjes wegvalt; daarom draaien de domeinregels als één gedeelde invariant-testsuite over álle geregistreerde strategieën.

**De strategieën (MVP).** Elke strategie heeft een sleutel, een label en een uitleg in begrijpelijke taal, want de begeleider kiest hem — niet een ontwikkelaar.

| Sleutel | Label | Voor wie |
|---|---|---|
| `refine` (standaard) | Stap voor stap verfijnen | De huidige aanpak: van categorie naar detail |
| `explore` | Breed verkennen | Wie concrete dingen herkent maar moeilijk categoriseert; slaat abstracte tussenstappen over |
| `calm` | Rustig en bevestigend | Wie snel overprikkeld raakt: klein aanbod, één duidelijke vraag, later voorstellen |
| `context-first` | Context eerst | Wie een sterk vast dagritme heeft: voorkeuren en persoonlijke context vóór de begrippenboom |

**Selectie: gesprek → gebruiker → standaard.** Een gesprek kan een expliciete strategie meekrijgen (de begeleider die een vraag stelt, §3.2, weet welke situatie dit is); heeft het die niet, dan geldt de instelling van de gebruiker (§5.3); heeft die er geen, dan de standaard uit de registry. De strategie **ligt vast voor de duur van het gesprek**: halverwege wisselen zou het vastgelegde aanbod en de lopende hypothese inconsistent maken. Dat is een expliciete keuze, geen omissie.

**Zichtbaarheid.** De actieve strategie (sleutel + label) hoort bij het antwoord op "waarom deed de AI dit?": ze staat in de AI-beslissingslogregel, in het beheerscherm AI-activiteit en in de meekijk-weergave van de begeleider. Alleen sleutel en label — geen promptinhoud en geen persoonlijke context (§9.4).

Strategieën zijn **ingebouwd** (in code, met een stabiele sleutel), niet beheerd in de database; per organisatie bewerkbare strategieën staan bewust bij de post-MVP. Zie [ADR-0013](docs/adr/0013-conversation-strategies.md).

---

## 8. API-specificatie

### 8.1 Principes

- Alle communicatie beveiligd (HTTPS), geauthenticeerd en geautoriseerd.
- **Geen directe AI-toegang vanaf de client.** Flow: tablet → backend → AI-engine → backend → tablet. De backend controleert gebruiker, toestemming, context en beschikbare data.
- Consistente foutstructuur: `{ "error": { "code": "USER_NOT_FOUND", "message": "…" } }`.

### 8.2 Endpoints (uit ontwerp; definitieve vorm volgt bij implementatie)

| Gebied | Endpoint | Doel |
|---|---|---|
| Auth | `POST /auth/login` | Aanmelden (gebruiker/begeleider/beheerder) |
| Organisatie | `GET /organizations/{id}` | Omgeving ophalen |
| Gebruikers | `POST /users` · `GET /users/{id}` | Aanmaken / ophalen |
| Apparaat | `POST /devices/link` | Tablet koppelen via code |
| Gesprek | `POST /conversation/start` | Sessie starten; eerste vraag terug |
| Gesprek | `POST /conversation/{sessionId}/next` | **Kern-call:** keuze insturen, volgende vraag + opties terug |
| Gesprek | `POST /conversation/{sessionId}/choice` | Keuze opslaan |
| Gesprek | `POST /conversation/{sessionId}/generate` | Boodschap genereren (symbols, message, confidence) |
| Gesprek | `POST /conversation/{sessionId}/confirm` | Bevestigen → afronden, evt. leren, historie |
| Gesprek | `POST /conversation/{sessionId}/correction` | Correctie (`wrong_guess`) → heranalyse |
| Context | `POST /users/{id}/context` · `GET /users/{id}/context` | Persoonlijke context beheren |
| Voorkeuren | `GET /users/{id}/preferences` | Geleerde voorkeuren |
| AAC | `GET /aac/search?q=…` | Symbolen zoeken |
| Vraagmodus | `POST /question/start` | Begeleidersvraag → nieuwe sessie met vraagcontext |
| Beheer | `GET /admin/users` · `POST /admin/users/{id}/caregivers` · `PUT /users/{id}/settings` | Gebruikerslijst, begeleider koppelen, instellingen |
| Profiel | `GET /users/{id}/export` · `POST /users/import` | Versleuteld profiel exporteren/importeren |
| AI (intern) | `POST /ai/next-decision` | Interne interface backend ↔ AI-orchestrator |

Voorbereiding op later (geen MVP): events, notificaties, message queue voor communicatie op afstand.

---

## 9. Technische architectuur

### 9.1 Principes

- **Veiligheid boven snelheid:** gegevensminimalisatie, controle over AI-input, expliciete toestemming, veilige opslag.
- **AI is een onderdeel, niet het systeem:** de applicatie bepaalt welke gegevens beschikbaar zijn, welke pictogrammen toegestaan zijn en wanneer een boodschap klaar is.
- **Modulair:** onderdelen (waaronder het AI-model) moeten vervangbaar zijn.

### 9.2 Hoofdstructuur

```
Gebruikers → Tablet-app / Begeleiderinterface / Beheeromgeving
                    ↓
               Backend-API
   ┌──────────┬───────────┬──────────────┬─────────────┐
 Auth/User  Context     Conversation   AI-Orchestrator  AAC
 Service    Service     Service        (+ validatie)    Service
   └──────────┴───────────┴──────────────┴─────────────┘
                    ↓
             Database + Storage (pictogrammen, exports)
```

De **AI Orchestration Service** is de tussenlaag: context verzamelen, prompt samenstellen, AI-resultaat controleren (validatielaag tegen AAC-bibliotheek), output filteren.

### 9.3 Gekozen stack (op basis van PROJECT-NODEJS-sjabloon)

| Onderdeel | Keuze | Toelichting |
|---|---|---|
| Runtime/taal | Node.js ≥ 22 LTS, TypeScript strict | Sjabloonstandaard |
| HTTP-server | Fastify 5 | `buildApp()`-factory, testbaar via `inject()` |
| Validatie | zod | Op elke grens (body, query, params, env); types gedeeld client/server |
| Database | SQLite (dev) → PostgreSQL (productie) via Prisma | Migraties verplicht; relationeel model past bij §6 |
| Auth | argon2id + gehashte sessietokens (httpOnly + Secure cookies), account-lockout, rate limiting | Sjabloonstandaard |
| Frontend | React + Vite (tablet-first webapp) | Eén codebase voor gebruikersapp, begeleiderinterface en beheeromgeving (gescheiden routes/layouts) |
| AI | Externe LLM-API achter de AI-Orchestrator | Provider-agnostische interface; providerkeuze via ADR in de AI-fase; vervangbaar per §9.1 |
| Repostructuur | npm workspaces: `server/`, `web/`, `shared/` (zod-schema's/types) | Bevestigen via ADR in Fase 0 |

Alle structurele keuzes worden vastgelegd als ADR in `docs/adr/`.

### 9.4 Beveiliging en privacy

- Autorisatie per rol (zie §2); **elke query gefilterd op organisatie/gebruiker** en getest op isolatie.
- Privacy by design: minimale opslag, expliciete toestemming, versleuteling van persoonlijke context, communicatiegegevens en profielen; exportmogelijkheid.
- Monitoring van beschikbaarheid, fouten en prestaties — **niet** van communicatie-inhoud zonder toestemming.
- Offline-ondersteuning (later): laatste AAC-set lokaal, basiscommunicatie, synchronisatie achteraf.

### 9.5 Schaalbaarheid

Van 1 gebruiker naar duizenden; meerdere organisaties (families, zorginstellingen) in één platform (multi-tenant op organisatieniveau).

---

## 10. Roadmap en prioriteiten

### 10.1 Fasen (product)

| Fase | Doel | Inhoud |
|---|---|---|
| 0 — Conceptvalidatie | Basisidee bewijzen | Prototype: eenvoudige interface, vaste pictogrammen, AI-simulatie |
| 1 — AI-UX-prototype | Communicatieflow testen | Tabletinterface, pictogramkeuzes, eenvoudige context, boodschapgeneratie |
| 2 — MVP | Eerste bruikbare versie | Volledige gebruikersapp, basisbeheeromgeving, backend met AI-koppeling en AAC-bibliotheek |
| 3 — Pilot | Echt gebruik | Families/zorginstellingen; meten: initiatieven, duidelijkheid, frustratie, gesprekken, correcties |
| 4 — Productversie | Uitbreiden | Persoonlijke AI, uitgebreide AAC, spraakuitvoer, export/import |
| 5 — Geavanceerd | Toekomst | Communicatie op afstand, oogbesturing, sensoren, persoonlijke stem |

### 10.2 Prioriteiten

**Hoogste:** pictogramkeuzes · AI-vraagstelling · gesprekscontext · correctie · persoonlijk profiel.
**Middel:** beheeromgeving · leermechanisme · export/import.
**Laag:** stem · berichten sturen · integraties.

### 10.3 Definition of Done voor de MVP

✅ Gebruiker kan zelfstandig een boodschap maken · ✅ AI stelt passende pictogramkeuzes voor · ✅ gebruiker kan fouten corrigeren · ✅ begeleider kan ondersteunen · ✅ persoonlijke context wordt gebruikt · ✅ gegevens veilig opgeslagen.

### 10.4 Risico's en mitigatie

| Risico | Mitigatie |
|---|---|
| AI begrijpt gebruiker verkeerd | Beperkte AAC-set, bevestiging, correctieflow |
| Te veel vragen nodig | Informatiewaarde-gedreven vraagselectie, context onthouden |
| Gebruiker raakt gefrustreerd | Korte routes, terugknop, eenvoudige keuzes |
| Privacyrisico | Toestemming, versleuteling, minimale opslag |
| **Grootste productrisico:** technisch goed maar sluit niet aan bij echte communicatie | Gebruikerservaring > technische complexiteit; vroege validatie met doelgroep |
