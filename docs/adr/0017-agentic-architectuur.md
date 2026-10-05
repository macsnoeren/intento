# 0017. Agentic architectuur: een stateless agentdienst met eigen orchestrator

- **Status:** geaccepteerd
- **Datum:** 2026-10-05

## Context

De eerste versie van Intento had één AI-Orchestrator in de TypeScript-backend (ADR-0008), een
validatielaag met drempels (ADR-0009), een wachtrij waaruit een Python-worker jobs haalde
(ADR-0010), door de AI aangedragen concepten (ADR-0012), vijf gespreksstrategieën (ADR-0013) en een
berichtenlijst met afhandelen door de begeleider (ADR-0014). Gebruikerstests lieten zien dat die flow
moeilijk te volgen en moeilijk te testen was: de regie, de prompts en de garanties liepen door
elkaar, en een gok van de AI kon als tegel op het scherm komen.

Het nieuwe ontwerp (`INTENTO-NEW-DESIGN.md`) kiest voor **gespecialiseerde agents** (Intent,
Question, Icon, Validation, Safety, Contact, Experience) onder regie van één **orchestrator** die
voorspelbaar beslist wie aan de beurt is (ontwerp §4), en voor een strikte scheiding tussen wat de
gebruiker deed (Observed), wat er getoond werd (Presented) en wat de AI concludeert (Inferred)
(ontwerp §2.5, §26).

## Beslissing

1. **Een aparte agentdienst in Python** (`agent-service/`) vervangt de `ai-worker`. Hij bevat de
   orchestrator, de agents en de Interaction Strategy. Python omdat de spraakdienst al zo is opgezet
   (stdlib-HTTP-server, unittest), en omdat de LLM-kant daar het minst omslachtig is.
2. **Eigen orchestrator, geen agentframework.** De orchestrator is zelf geen LLM: een zuivere
   functie `step(TurnRequest) -> TurnResponse` met vaste fasen (`clarify`, `confirm_message`,
   `share_ask`, `share_contact`, `confirm_send`, `done`, `stopped`). Agents roepen elkaar niet aan.
3. **Stateless tussen beurten.** De backend stuurt per beurt de Session State, de gebeurtenis, de
   instellingen, de compacte Vocabulary, de Experience-samenvatting en de contacten (id + naam, nooit
   e-mail) mee; de agentdienst geeft de nieuwe Session State, de presentatie, de inferences, de
   agentbeslissingen en de gaps terug. Hij bewaart niets.
4. **De backend is de enige eigenaar van alle data.** Hij legt Observed en Presented vast, slaat de
   Session State versleuteld per beurt op (zodat ↩ Terug exact is zonder agentaanroep), en toetst
   elk antwoord opnieuw met zod en de harde invarianten (ontwerp §52) voordat er iets getoond of
   opgeslagen wordt. Versturen gebeurt alleen door de backend.
5. **Geen wachtrij.** De backend roept `POST /v1/turn` rechtstreeks aan, met een gedeeld geheim en
   een time-out, zoals bij de spraakdienst. Onbereikbaar of ongeldig → `503 AGENT_UNAVAILABLE` en de
   tablet toont "Het lukt nu even niet".
6. **Contracten in pydantic én zod**, beide getest tegen dezelfde voorbeeldbestanden in
   `contracts/fixtures/`, met een `contract_version`.
7. **Elke LLM-agent heeft een regelgebaseerde terugval.** De gebruiker krijgt nooit een leeg scherm.
8. **LLM-provider: Ollama** (lokaal of cloud) achter een interface met één methode; een
   `FakeProvider` maakt de tests deterministisch en offline.

## Gevolgen

- De garanties (geen boodschap zonder JA, nooit versturen zonder JA op dát contact, alleen
  symbolen uit de eigen Vocabulary) zitten in backendcode met tests, los van elke prompt.
- Per beurt gaat de compacte Vocabulary mee (ruim 3.400 regels met de startset). Binnen het
  compose-netwerk is dat acceptabel; blijkt het bij het meten te traag, dan komt er een cache op
  versie.
- Er is geen datamigratie van oude gesprekken: de oude tabellen verdwijnen (ontwerp §55).
- Twee talen aan weerszijden van het contract betekent dubbel onderhoud van de vormen; de gedeelde
  fixtures vangen elke afwijking.
- ADR-0008, 0009, 0010, 0012, 0013 en 0014 zijn hiermee vervangen.

## Alternatieven overwogen

- **De agents in de TypeScript-backend** — één taal minder, maar de LLM-logica en de dataregie lopen
  dan weer door elkaar, en het eerdere ontwerp liet zien hoe moeilijk dat te testen werd.
- **Een agentframework (LangGraph e.d.)** — de regie moet voorspelbaar en testbaar zijn; een framework
  voegt een laag toe die we niet nodig hebben en die zelf beslissingen neemt.
- **De wachtrij houden** — die loste trage inferentie op, maar elke beurt van een gesprek wacht hoe
  dan ook op het antwoord; een directe aanroep met time-out is eenvoudiger en even robuust.
- **State in de agentdienst** — dan zijn er twee data-eigenaren, en zijn tenant-isolatie, bewaartermijn
  en versleuteling op twee plekken te bewaken.
