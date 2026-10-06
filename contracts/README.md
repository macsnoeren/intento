# Contracten backend ↔ agentdienst

De contracten (versie `contract_version: 1`) staan aan de Python-kant in
[`agent-service/agent_service/contracts.py`](../agent-service/agent_service/contracts.py) (pydantic) en
aan de TypeScript-kant in `shared/src/agent-contract.ts` (zod). Beide kanten worden getest tegen
**dezelfde** voorbeeldbestanden in `fixtures/` (INTENTO-NEW-DESIGN §34):

- `fixtures/valid/*.json` — moet aan beide kanten geaccepteerd worden;
- `fixtures/invalid/*.json` — moet aan beide kanten geweigerd worden.

Een bestand heet `<model>.<naam>.json`; het voorvoegsel (`turn_request`, `turn_response`) bepaalt tegen
welk model het gevalideerd wordt. Wijzig je een contract, dan wijzig je beide kanten en voeg je een
geldig én een ongeldig voorbeeld toe.

`fields.json` bevat per model alle veldpaden (`state.share.sent_to`, `presentation.options[].ref`, …).
Beide kanten leiden hun paden af uit hun eigen JSON-schema en vergelijken die met dit bestand. Zo valt
ook een **optioneel** veld op dat maar aan één kant bestaat — dat zou de voorbeeldbestanden niet altijd
breken. Na een bewuste contractwijziging regenereer je het bestand vanuit pydantic:

```bash
cd agent-service && .venv/bin/python -c "import json; from agent_service.contracts import *; \
print(json.dumps({'turn_request': field_paths(TurnRequest.model_json_schema()), \
'turn_response': field_paths(TurnResponse.model_json_schema())}, indent=2))" > ../contracts/fields.json
```

`question_strategies.json` bevat de sleutels van de vraagstrategieën (INTENTO-NEW-DESIGN §7.1), in
volgorde. `shared/` (`QUESTION_STRATEGY_KEYS`, de catalogus en het contractschema) en de agentdienst
(`agents/strategies.py`) worden er allebei tegen getest; een strategie toevoegen of hernoemen gebeurt
dus aan beide kanten en hier.
