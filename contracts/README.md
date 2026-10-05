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
