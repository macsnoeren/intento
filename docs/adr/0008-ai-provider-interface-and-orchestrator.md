# 0008. AI-provider-interface, orchestrator en providerkeuze

- **Status:** geaccepteerd
- **Datum:** 2026-07-10

## Context

Fase 5 introduceert de AI: de gebruiker helpen zijn intentie te vinden door per beurt de meest
waardevolle pictogramvraag te kiezen (DESIGN §7). T5.1 legt het **fundament** onder die fase — de
provider-agnostische interface, de orchestrator en het promptmodel — zonder al de gescripte engine te
vervangen (dat is T5.2). Er spelen een paar krachten door elkaar:

1. **Vervangbaarheid (DESIGN §9.1).** Het AI-model is een onderdeel, niet het systeem. De rest van de
   app mag niet aan één provider vastzitten.
2. **Privacy by design (DESIGN §9.4, CLAUDE.md).** Intento verwerkt de communicatie-intentie van
   kwetsbare mensen. Die inhoud ongefilterd naar een externe cloud-LLM sturen wringt met
   gegevensminimalisatie en expliciete toestemming.
3. **De client praat nooit met de AI (DESIGN §8.1).** Alles loopt via de backend, die toegang,
   toestemming, context en de AAC-begrenzing controleert.
4. **Testbaarheid.** De flow moet volledig, deterministisch en zonder netwerk te testen zijn.
5. **Begrensde, verse context (DESIGN §7.7).** Elke aanroep krijgt alléén
   `systeemregels + doel + AAC-regels + gebruikerscontext + gesprekscontext + laatste keuze` — géén
   onbeperkte chatgeschiedenis.

## Beslissing

**We zetten de AI achter een smalle, provider-agnostische `AiProvider`-interface, met een AI-Orchestrator
als tussenlaag en een deterministische mock-provider als standaard.** Concreet (`server/src/ai/`):

- **`AiProvider`-interface** (`provider.ts`): één methode `selectNextQuestion(prompt): AiQuestionDecision`.
  In- en uitvoer zijn zod-schema's. Bewust **niet** in `@intento/shared`: dit is de interne interface
  backend ↔ orchestrator/worker (DESIGN §8.2, `POST /ai/next-decision`); de web-client kent ze niet.
- **`AiOrchestrator`** (`orchestrator.ts`): stelt per aanroep de beperkte prompt samen (via
  `buildAiPrompt`), roept de provider aan en **valideert de uitvoer opnieuw** met zod. Een provider (en
  straks een externe worker, T5.5) wordt nooit vertrouwd — ongestructureerde of ongeldige uitvoer bereikt
  de gebruiker nooit. De orchestrator is vrij van DB/HTTP: de aanroeper levert de gesprekscontext en de
  (AAC-begrensde) opties, zodat alles deterministisch te testen is.
- **`buildAiPrompt`** (`prompt.ts`): de enige plek die een `AiPrompt` vormt. De sleutelset is **gesloten**
  (afgedwongen door `aiPromptSchema`), er is geen veld voor chatgeschiedenis of vrije invoer, en de
  gespreks-/optiecontext bestaat puur uit AAC-concepten (`{concept, label}`). Zo is aantoonbaar dat
  alléén toegestane context de provider bereikt (§7.7, §7.8).
- **`MockAiProvider`** (`mock-provider.ts`): de standaard voor dev en **alle tests** — geen netwerk, geen
  key, deterministisch. Stelt uitsluitend aangeboden opties voor (AAC-begrensd) met een aflopende,
  geklemde confidence, zodat de drempellogica van T5.2 getest kan worden.
- **Providerkeuze via env** (`AI_PROVIDER`, ADR/`createAiProvider`): in T5.1 is alleen `mock`
  aangesloten. De concept-ruimte is de **conceptsleutel** (taalneutraal, stabiel), niet symbool-id's of
  vrije tekst — de validatielaag (T5.2) mapt concepten terug op `AacSymbol`.

**Providerrichting.** Vanwege privacy by design kiezen we voor een **self-hosted LLM (Ollama)** als
eerste echte provider, niet een externe cloud-API. Dat sluit aan op de gedistribueerde AI-workers uit
T5.5/T5.6 (worker draait Ollama op een aparte machine). De concrete Ollama-provider wordt **niet** in
T5.1 gebouwd — `AI_PROVIDER=ollama` weigert bewust te starten tot T5.5/T5.6, zodat een misconfiguratie
niet stil op "geen AI" uitkomt. De interface blijft provider-agnostisch: een andere provider kan later
naast Ollama komen zonder de flow te raken.

## Gevolgen

- **Makkelijker:** de gespreksflow (T5.2) hangt alleen aan de orchestrator, niet aan een model; tests zijn
  deterministisch zonder netwerk; de begrensde context zit op één plek en is testbaar; de validatie-bij-
  binnenkomst maakt de latere externe worker (T5.5) veilig inpasbaar.
- **Moeilijker/afweging:** een self-hosted LLM vergt eigen infrastructuur (T5.6) i.p.v. een kant-en-klare
  cloud-API — bewust, om de communicatie-inhoud niet aan derden prijs te geven. In T5.1 draait er nog geen
  echt model; de mock levert nog geen "echte" intelligentie (dat is inherent aan het fundament).
- **Later heroverwegen:** of naast Ollama een (optionele, per organisatie in te schakelen) externe
  provider gewenst is; hoe de gebruikerscontext (T6.1) met toestemmingsfilter in `userContext` landt.

## Alternatieven overwogen

- **Direct tegen een cloud-LLM (bv. via SDK) vanuit de route** — koppelt de flow aan één provider, schendt
  de vervangbaarheidseis (§9.1) en zet de communicatie-inhoud bij een derde. Afgewezen.
- **AI-schema's in `@intento/shared`** — zou suggereren dat de client de AI-interface kent; strijdig met
  "de client praat nooit met de AI" (§8.1). De AI-schema's blijven server-intern.
- **Geen mock, tegen een echt/gemockt netwerk testen** — traag, niet-deterministisch en netwerkafhankelijk.
  Een deterministische in-process mock (zoals bij de OpenSymbols-client, ADR-0006) is de standaard.
- **De orchestrator zelf uit de DB laten lezen** — maakt unit-tests DB-afhankelijk; we houden de
  orchestrator puur en laten de aanroeper (T5.2) de context laden.
