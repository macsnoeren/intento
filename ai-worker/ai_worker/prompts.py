"""Prompt- en schemabouw per AI-taak, plus het vormen/opschonen van de Ollama-uitvoer (T5.6).

De backend levert per job een **beperkte, verse context** (T5.1, DESIGN §7.7): systeemregels, doel,
AAC-regels, gebruikerscontext en de gekozen concepten. Deze module zet die context om in een systeem- en
gebruikersprompt plus een JSON-schema voor Ollama, en vormt de Ollama-uitvoer terug tot exact de vorm die
de backend-endpoints verwachten (T5.5). De backend valideert die vorm daarna **opnieuw** met zod en tegen
de AAC-bibliotheek — deze opschoning is hulpvaardig, geen vertrouwensbasis.

De taak-strings spiegelen `server/src/ai/provider.ts` (`AI_TASK_*`): ze moeten letterlijk overeenkomen.
"""

from __future__ import annotations

from typing import Any

TASK_SELECT_NEXT_QUESTION = "select_next_question"
TASK_GENERATE_MESSAGE = "generate_message"

SUPPORTED_TASKS = (TASK_SELECT_NEXT_QUESTION, TASK_GENERATE_MESSAGE)


class PromptError(ValueError):
    """De job-payload of de Ollama-uitvoer heeft niet de verwachte vorm."""


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, (str, int, float))]


def _concept_ref(item: Any) -> tuple[str, str] | None:
    """Leest een {concept,label}-paar uit de payload; geeft None als het niet klopt."""
    if not isinstance(item, dict):
        return None
    concept = item.get("concept")
    if not isinstance(concept, str) or not concept:
        return None
    label = item.get("label")
    return concept, (label if isinstance(label, str) else concept)


def _clamp_confidence(value: Any) -> float | None:
    """Klemt een confidence naar [0, 1]; geeft None als het geen getal is (dan blijft het veld weg)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return max(0.0, min(1.0, float(value)))


def _render_rules(system_rules: list[str], goal: str, aac_rules: list[str], output_spec: str) -> str:
    """Bouwt de systeemprompt: regels + doel + AAC-regels + een **expliciete** beschrijving van de vereiste
    JSON-uitvoer. Die expliciete beschrijving is cruciaal: cloud-/reasoning-modellen honoreren Ollama's
    `format`-schema niet hard, dus de veldnamen moeten ook in natuurlijke taal in de prompt staan.
    """
    lines = ["SYSTEEMREGELS:"]
    lines += [f"- {rule}" for rule in system_rules]
    lines += ["", f"DOEL: {goal}", "", "AAC-REGELS:"]
    lines += [f"- {rule}" for rule in aac_rules]
    lines += ["", "ANTWOORDFORMAAT:", output_spec]
    return "\n".join(lines)


# Expliciete uitvoerbeschrijving per taak. Bewust met exacte veldnamen zodat een model dat het JSON-schema
# niet hard afdwingt (cloud/reasoning) tóch de juiste vorm produceert.
_QUESTION_OUTPUT_SPEC = (
    'Antwoord met UITSLUITEND één JSON-object, geen extra tekst, exact in deze vorm:\n'
    '{"question": "<de volgende vraag aan de gebruiker>", '
    '"options": [{"symbol": "<een conceptsleutel uit de TOEGESTANE OPTIES>", "confidence": <getal 0..1>}], '
    '"reason": "<korte onderbouwing>"}\n'
    '- Gebruik voor "symbol" uitsluitend een van de aangeboden conceptsleutels (niet het label, niet een '
    "nieuw woord).\n"
    "- Vul alle velden; laat geen veld weg en verzin geen andere veldnamen."
)

_MESSAGE_OUTPUT_SPEC = (
    'Antwoord met UITSLUITEND één JSON-object, geen extra tekst, exact in deze vorm:\n'
    '{"message": "<één korte, natuurlijke Nederlandse zin in de ik-vorm>", "confidence": <getal 0..1>}\n'
    "- Blijf strikt binnen de bevestigde concepten; voeg niets toe."
)


def build_select_next_question(payload: dict[str, Any]) -> tuple[str, str, dict[str, Any], list[str]]:
    """Bouwt (system, prompt, schema, allowed_concepts) voor de vraagselectie-taak.

    `allowed_concepts` zijn de conceptsleutels uit `availableSymbols`; de worker gebruikt ze zowel om
    Ollama via een `enum` te beperken als om de uitvoer achteraf op te schonen.
    """
    system_rules = _as_str_list(payload.get("systemRules"))
    aac_rules = _as_str_list(payload.get("aacRules"))
    goal = str(payload.get("goal", ""))

    available = [ref for ref in map(_concept_ref, payload.get("availableSymbols") or []) if ref]
    conversation = [ref for ref in map(_concept_ref, payload.get("conversationContext") or []) if ref]
    user_context = payload.get("userContext") or []
    last = _concept_ref(payload.get("lastChoice"))

    allowed_concepts = [concept for concept, _ in available]

    prompt_lines: list[str] = ["GEBRUIKERSCONTEXT:"]
    for item in user_context:
        if isinstance(item, dict):
            prompt_lines.append(f"- {item.get('kind', '')}: {item.get('value', '')}")
    prompt_lines += ["", "GESPREKSCONTEXT (reeds gekozen concepten):"]
    prompt_lines += [f"- {concept} ({label})" for concept, label in conversation]
    prompt_lines += ["", f"LAATSTE KEUZE: {last[0] if last else '(geen)'}"]
    prompt_lines += ["", "TOEGESTANE OPTIES (kies uitsluitend hieruit):"]
    prompt_lines += [f"- {concept} ({label})" for concept, label in available]

    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "symbol": (
                            {"type": "string", "enum": allowed_concepts}
                            if allowed_concepts
                            else {"type": "string"}
                        ),
                        "confidence": {"type": "number"},
                    },
                    "required": ["symbol", "confidence"],
                },
            },
            "reason": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["question", "options", "reason"],
    }

    system = _render_rules(system_rules, goal, aac_rules, _QUESTION_OUTPUT_SPEC)
    return system, "\n".join(prompt_lines), schema, allowed_concepts


def build_generate_message(payload: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """Bouwt (system, prompt, schema) voor de boodschapgeneratie-taak."""
    system_rules = _as_str_list(payload.get("systemRules"))
    aac_rules = _as_str_list(payload.get("aacRules"))
    goal = str(payload.get("goal", ""))

    chosen = [ref for ref in map(_concept_ref, payload.get("chosenConcepts") or []) if ref]
    user_context = payload.get("userContext") or []

    prompt_lines: list[str] = ["GEBRUIKERSCONTEXT:"]
    for item in user_context:
        if isinstance(item, dict):
            prompt_lines.append(f"- {item.get('kind', '')}: {item.get('value', '')}")
    prompt_lines += ["", "BEVESTIGDE CONCEPTEN (in volgorde; de eerste is de intentie):"]
    prompt_lines += [f"- {concept} ({label})" for concept, label in chosen]

    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "message": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["message"],
    }

    system = _render_rules(system_rules, goal, aac_rules, _MESSAGE_OUTPUT_SPEC)
    return system, "\n".join(prompt_lines), schema


def shape_question_result(raw: dict[str, Any], allowed_concepts: list[str]) -> dict[str, Any]:
    """Vormt de Ollama-uitvoer tot een geldig vraagbesluit-resultaat voor de backend.

    Opties met een onbekend concept worden weggelaten (de backend zou ze anders alsnog weigeren/als
    ConceptProposal afhandelen); confidences worden naar [0, 1] geklemd. Gooit `PromptError` als er geen
    bruikbare vraag/opties overblijven.
    """
    question = raw.get("question")
    if not isinstance(question, str) or not question.strip():
        raise PromptError("Ollama-uitvoer mist een geldige 'question'.")

    allowed = set(allowed_concepts)
    options: list[dict[str, Any]] = []
    for item in raw.get("options") or []:
        if not isinstance(item, dict):
            continue
        symbol = item.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            continue
        if allowed and symbol not in allowed:
            continue  # onbekend concept: weglaten (nooit vertrouwen)
        confidence = _clamp_confidence(item.get("confidence"))
        if confidence is None:
            confidence = 0.5
        options.append({"symbol": symbol, "confidence": confidence})

    result: dict[str, Any] = {
        "question": question.strip(),
        "options": options,
        "reason": str(raw.get("reason", "")),
    }
    top = _clamp_confidence(raw.get("confidence"))
    if top is not None:
        result["confidence"] = top
    return result


def shape_message_result(raw: dict[str, Any]) -> dict[str, Any]:
    """Vormt de Ollama-uitvoer tot een geldig boodschap-resultaat voor de backend."""
    message = raw.get("message")
    if not isinstance(message, str) or not message.strip():
        raise PromptError("Ollama-uitvoer mist een geldige 'message'.")
    result: dict[str, Any] = {"message": message.strip()}
    confidence = _clamp_confidence(raw.get("confidence"))
    if confidence is not None:
        result["confidence"] = confidence
    return result
