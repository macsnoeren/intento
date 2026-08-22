- [ ] Het design is small gemaakt. Ik zou het graag een wat professionelere webpagina maken dat ook wat breder is met een mooie menu ed.
- [x] De administrator van de webpagina mag ook een begeleider zijn. *(opgelost in T9.1, zie TASKS.md)*
- [x] Bij tablet koppelen mag de link er wel bijstaan voor de zekerheid. *(opgelost in T9.2, zie TASKS.md)*
- [x] De begeleider kan meekijken, maar moet elke keer op de verversen knop klikken. Dit moet gewoon automatisch gaan. *(opgelost in T9.3, zie TASKS.md)*
- [x] Het moet ook zichtbaar zijn in de tablet en de applicatie dat er een AI worker actief is. Andere is het gek. *(opgelost in T9.4, zie TASKS.md)*
- [x] Ik krijg in de tablet als je Ja zeg: "Alleen de gebruiker kan zelf een boodschap bevestigen; een begeleider kan dat nooit namens de gebruiker." *(opgelost in T9.5, zie TASKS.md)*
- [x] "Wat wil je duidelijk maken?" met de intentiecategorieën ask, problem, feel, want, say. Ik heb geen say maar de rest wel. *(opgelost in T9.6, zie TASKS.md)*
- [x] bij de begeleider blijft vraag versturen niet klikbaar (grayed-out) *(opgelost in T9.7, zie TASKS.md)*
- [x] Het lijkt erop dat er helemaal geen AI probeert te achterhalen wat de gebruiker wil. *(opgelost in T9.8, zie TASKS.md)*
- [x] De Ollama-worker kan een `OLLAMA_TOKEN` meesturen voor een afgeschermd endpoint. *(opgelost in T9.9)*
- [ ] Boodschap ik stel een vraag is dus niet een eindpunt! De AI moet dan achterhalen wat de vraag over gaat. Wat wil de gebruiker dan vragen?
- [ ] In de tablet was de boodschap er. Toen heb ik op opnieuw beginnen geklikt en toen ging het helemaal mis. Ik kreeg maar 1 optie een vraag stellen.
- [ ] De begeleider stelt een vraag "waarom nagels niet knippen". De AI geeft aan is er sprake van pijn en geeft 1 picto pijn. Ik kan niet iets anders kiezen of nee/iets anders. Ook met waar heb je pijn krijgen we drie opties, maar als de optie er niet tussen zit, dan kan je dat niet kiezen. Misschien altijd een optie erbij dat de opties er niet bijstaan picto. Als ik uiteindelijk nee kies dan gaat het helemaal mis.
- [ ] Bij het kiezen van opnieuw beginnen krijg ik dit gesprek is al beeindigd.
- [ ] Doet AI wel opties bedenken? Kan ik meer zien op de achtergrond wat de AI aan het doen is, want in het onderwerp vragen we veel aan de AI en houdt ie van allerlei dingen bij. Dat zie ik nu niet.
 

## Tweede testronde (22-08-2026)

- [x] Boodschap ik stel een vraag is dus niet een eindpunt! De AI moet dan achterhalen wat de vraag over gaat. Wat wil de gebruiker dan vragen? *(opgelost in T9.11)*
- [x] In de tablet was de boodschap er. Toen heb ik op opnieuw beginnen geklikt en toen ging het helemaal mis. Ik kreeg maar 1 optie een vraag stellen. *(opgelost in T9.13 + T9.10)*
- [x] De begeleider stelt een vraag "waarom nagels niet knippen". De AI geeft aan is er sprake van pijn en geeft 1 picto pijn. Ik kan niet iets anders kiezen of nee/iets anders. Ook met waar heb je pijn krijgen we drie opties, maar als de optie er niet tussen zit, dan kan je dat niet kiezen. Misschien altijd een optie erbij dat de opties er niet bijstaan picto. Als ik uiteindelijk nee kies dan gaat het helemaal mis. *(opgelost in T9.10 + T9.11 + T9.12 + T9.14)*
- [x] Bij het kiezen van opnieuw beginnen krijg ik dit gesprek is al beeindigd. *(opgelost in T9.13)*
- [x] Doet AI wel opties bedenken? Kan ik meer zien op de achtergrond wat de AI aan het doen is, want in het onderwerp vragen we veel aan de AI en houdt ie van allerlei dingen bij. Dat zie ik nu niet. *(opgelost in T9.15)*

## Derde testronde (22-08-2026)

- [x] Ik koos "Iets willen", kreeg antwoorden, gaf aan dat het er niet bij stond — en kreeg vervolgens weer de eerste opties. De eerste vijf opties zijn prima om mee te starten, maar daarna moet de AI proberen te achterhalen wát de persoon wil zeggen: opties voorleggen uit de bibliotheek, en als het er niet bij staat zelf een optie verzinnen. De AI moet daarbij context bijhouden van wat de persoon wél heeft geantwoord en wat hij níet wil. Dat lijkt niet geïmplementeerd. *(opgelost in Fase 10, T10.1 t/m T10.8 — zie TASKS.md en ADR-0012)*

## Vierde testronde (22-08-2026)

- [x] Het gaat niet altijd goed. Ik kom bijvoorbeeld uit op "Ik wil iets warms eten." Dat is niet heel concreet — dan mag de AI door om te ontdekken wat iemand wil eten. Als ik dan Nee zeg, zegt hij "Wat wil je drinken?", terwijl ik juist iets wil zeggen over wat ik wil eten. *(opgelost in T10.10: voorstellen vereist nu ook concreetheid, ❌ Nee rolt één stap terug in plaats van de hele route, retrieval matcht niet meer midden in een woord, en de safety-laag herkent buigingsvormen zoals "warms". T10.11 voegde "✅ Dit is genoeg" toe zodat je wél op "eten" kunt afronden als je dat wilt.)*
- [ ] De aanpak van de AI — de manier waarop hij probeert te achterhalen wat de gebruiker wil zeggen — moet aanpasbaar zijn: meerdere aanpakken die te selecteren zijn per gebruiker of per gesprek. *(uitgewerkt als Fase 11 in `TASKS.md`, T11.1 t/m T11.6)*
