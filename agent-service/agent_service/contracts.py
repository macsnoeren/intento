"""Contracten v1 tussen backend en agentdienst (INTENTO-NEW-DESIGN §5, §34, §51).

Dezelfde vormen staan aan de TypeScript-kant in zod (`shared/src/agent-contract.ts`). Beide kanten
worden getest tegen dezelfde voorbeeldbestanden in `contracts/fixtures/`, zodat ze niet uit elkaar lopen.

Ontwerpregels:

- **JSON-sleutels in snake_case**, aan beide kanten gelijk.
- **Geen onbekende velden** (`extra="forbid"`): een veld dat maar aan één kant bestaat, valt meteen op.
- **Geen schrijfvelden** (invariant I8): het contract heeft geen enkel veld waarmee de agentdienst de
  Vocabulary of de contacten kan wijzigen. Hij kan alleen tonen, concluderen en melden (gaps).
- Contactgegevens: alleen id, naam, pictogram en volgorde — **nooit een e-mailadres** (V6). De naam
  gaat nooit naar een LLM; dat bewaakt de agentdienst zelf.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

CONTRACT_VERSION: Literal[1] = 1

Confidence = Annotated[float, Field(ge=0.0, le=1.0)]
Ref = Annotated[str, Field(min_length=1, max_length=200)]
ShortText = Annotated[str, Field(min_length=1, max_length=300)]
NonNegative = Annotated[int, Field(ge=0)]

Phase = Literal[
    "clarify", "confirm_message", "share_ask", "share_contact", "confirm_send", "done", "stopped"
]
InteractionModeSetting = Literal["binary", "multi", "ai"]
InteractionMode = Literal["binary", "multi"]
QuestionStrategy = Literal["general_to_specific", "concrete_first", "short_and_calm"]
Representation = Literal["exact", "stand_in"]


class Contract(BaseModel):
    """Basis: onbekende velden zijn een fout, geen stille toevoeging."""

    model_config = ConfigDict(extra="forbid")


# --- Wat de backend meestuurt ----------------------------------------------------------------------


class Settings(Contract):
    """De communicatie-instellingen van de gebruiker (§50) die voor de agents tellen."""

    interaction_mode: InteractionModeSetting
    options_per_screen: Annotated[int, Field(ge=2, le=8)]
    question_strategy: QuestionStrategy
    max_questions: Annotated[int, Field(ge=5, le=30)]
    experience_enabled: bool


class VocabularyEntry(Contract):
    """Eén beschikbaar Vocabulary-item, compact: geen afbeelding, geen licentie (§3.1)."""

    id: Ref
    labels: Annotated[list[ShortText], Field(min_length=1)]
    concepts: Annotated[list[Ref], Field(min_length=1)]
    contexts: list[Ref]
    part_of_speech: Ref | None = None
    is_start: bool
    sort_order: int


class ContactEntry(Contract):
    """Een bevestigd contact van de gebruiker. Nooit een e-mailadres (V6)."""

    id: Ref
    name: ShortText
    vocabulary_item_id: Ref | None = None
    sort_order: int


class ExperienceCount(Contract):
    """Hoe vaak iets getoond en gekozen is (§21, laag 1)."""

    ref: Ref
    presented: NonNegative
    chosen: NonNegative
    chosen_at_first_position: NonNegative


class ExperienceSummary(Contract):
    """Samenvatting van de Experience van deze gebruiker; alleen als Experience aanstaat (§22)."""

    symbols: list[ExperienceCount]
    contacts: list[ExperienceCount]
    modes: list[ExperienceCount]


class StartEvent(Contract):
    type: Literal["start"]


class AnswerYesEvent(Contract):
    type: Literal["answer_yes"]


class AnswerNoEvent(Contract):
    type: Literal["answer_no"]


class SelectOptionEvent(Contract):
    type: Literal["select_option"]
    option_ref: Ref


class NoneOfTheseEvent(Contract):
    type: Literal["none_of_these"]


Event = Annotated[
    StartEvent | AnswerYesEvent | AnswerNoEvent | SelectOptionEvent | NoneOfTheseEvent,
    Field(discriminator="type"),
]


# --- Presentatie: wat de tablet toont (§33) ---------------------------------------------------------


class Option(Contract):
    """Eén optie op het scherm: een symbool uit de Vocabulary of een contact."""

    ref: Ref
    kind: Literal["symbol", "contact"]
    vocabulary_item_id: Ref | None = None
    contact_id: Ref | None = None
    label: ShortText
    concept: Ref | None = None
    representation: Representation
    position: NonNegative


class Presentation(Contract):
    """Wat de tablet toont. Altijd dezelfde vorm, wat er ook gekozen moet worden (§33)."""

    kind: Literal[
        "question",
        "confirm_message",
        "share_ask",
        "share_contact",
        "confirm_send",
        "ask_stop",
        "done",
        "stopped",
    ]
    mode: InteractionMode
    text: ShortText
    options: list[Option]
    message: ShortText | None = None


# --- Session State (§5) -----------------------------------------------------------------------------


class Hypothesis(Contract):
    concept: Ref
    label: ShortText
    confidence: Confidence


class AskedQuestion(Contract):
    turn: NonNegative
    concept: Ref | None = None
    text: ShortText


class Answer(Contract):
    """Wat de gebruiker antwoordde, zoals de agentdienst het meekreeg (de backend legt Observed vast)."""

    turn: NonNegative
    answer: Literal["yes", "no", "selected", "none_of_these"]
    concepts: list[Ref]
    option_ref: Ref | None = None


class Proposal(Contract):
    """Het voorstel "Bedoel je: …?" — een inference tot de gebruiker JA zegt (§31)."""

    message: ShortText
    concepts: Annotated[list[Ref], Field(min_length=1)]
    confidence: Confidence


class ShareState(Contract):
    contacts_asked: list[Ref]
    selected_contact: Ref | None = None
    sent_to: list[Ref]


class SessionState(Contract):
    session_id: Ref
    phase: Phase
    turn: NonNegative
    interaction_mode: InteractionMode
    mode_since_turn: NonNegative
    current_intent: Hypothesis | None = None
    intent_hypotheses: list[Hypothesis]
    questions_asked: list[AskedQuestion]
    answers: list[Answer]
    rejected_concepts: list[Ref]
    uncertainties: list[ShortText]
    assumptions: list[ShortText]
    proposal: Proposal | None = None
    communication_intent: Proposal | None = None
    share: ShareState
    last_presentation: Presentation | None = None


# --- Wat de agentdienst teruggeeft ------------------------------------------------------------------


class Inference(Contract):
    """Wat een agent concludeert (Inferred). Nooit een feit (§2.5)."""

    agent: Ref
    kind: Ref
    payload: dict[str, JsonValue]
    confidence: Confidence | None = None


class AgentDecision(Contract):
    """Eén agentaanroep, voor de provenance (§27). De prompttekst zelf niet."""

    agent: Ref
    status: Literal["success", "fallback", "failed"]
    model: Ref | None = None
    prompt_version: Ref | None = None
    latency_ms: NonNegative
    validation: Literal["valid", "invalid", "skipped"] | None = None
    reason: ShortText | None = None


class Gap(Contract):
    """Een woord dat de Vocabulary niet goed dekt (§17). Zonder gebruiker of sessie."""

    type: Literal["vocabulary_gap"]
    concept: Ref
    label: ShortText
    context: Ref | None = None
    best_available_item_id: Ref | None = None
    confidence: Confidence


#: Hooguit zoveel recente handelingen in een `TurnRequest`; de wisselregels kijken er hooguit 4 terug.
MAX_RECENT_EVENTS = 12


class RecentEvent(Contract):
    """Wat de gebruiker op een eerder scherm deed, zoals de backend het vastlegde (Observed, §26).

    Ook ↩ Terug, dat de agentdienst zelf nooit ziet (de backend zet het vorige scherm terug). Nodig voor
    de wisselregels van "AI kiest" (§14).
    """

    turn: NonNegative
    screen: Literal[
        "question",
        "confirm_message",
        "share_ask",
        "share_contact",
        "confirm_send",
        "ask_stop",
    ]
    mode: InteractionMode
    event: Literal["answer_yes", "answer_no", "select_option", "none_of_these", "back"]


class TurnRequest(Contract):
    contract_version: Literal[1]
    session_id: Ref
    turn: NonNegative
    event: Event
    state: SessionState | None = None
    settings: Settings
    vocabulary: Annotated[list[VocabularyEntry], Field(min_length=1)]
    contacts: list[ContactEntry]
    experience: ExperienceSummary | None = None
    #: De laatste handelingen in dit gesprek, oudste eerst, inclusief die van deze beurt.
    recent: Annotated[list[RecentEvent], Field(max_length=MAX_RECENT_EVENTS)]


class TurnResponse(Contract):
    contract_version: Literal[1]
    session_id: Ref
    turn: NonNegative
    state: SessionState
    presentation: Presentation
    inferences: list[Inference]
    decisions: list[AgentDecision]
    gaps: list[Gap]


# --- Na afloop: de Experience Agent (§21 laag 2, N12.4) --------------------------------------------

#: Hooguit zoveel schermen per gesprek; meer zegt een observatie niets extra.
MAX_EXPERIENCE_SCREENS = 60
#: Hooguit zoveel observaties per gesprek.
MAX_EXPERIENCE_NOTES = 5


class ExperienceOption(Contract):
    """Een symbool zoals het op het scherm stond. Geen contacten: die gaan nooit naar een LLM (V6)."""

    label: ShortText
    concept: Ref | None = None
    representation: Representation
    position: NonNegative


class ExperienceScreen(Contract):
    """Eén scherm van het afgeronde gesprek (Presented) met wat de gebruiker deed (Observed).

    Schermen over contacten (`share_contact`, `confirm_send`) stuurt de backend niet mee: daar staan
    namen op. Of er verstuurd is, staat in `ExperienceRequest.sent`.
    """

    turn: NonNegative
    kind: Literal["question", "confirm_message", "share_ask", "ask_stop"]
    mode: InteractionMode
    text: ShortText
    options: Annotated[list[ExperienceOption], Field(max_length=8)]
    #: Wat de gebruiker op dit scherm deed; `None` = niets (het gesprek eindigde hier).
    answer: Literal["yes", "no", "selected", "none_of_these", "back", "stop"] | None = None
    #: De plek van de gekozen tegel (bij `selected`).
    chosen_position: NonNegative | None = None
    response_time_ms: NonNegative | None = None


class ExperienceRequest(Contract):
    contract_version: Literal[1]
    session_id: Ref
    settings: Settings
    #: `confirmed`: de gebruiker zei JA op "Bedoel je …?"; `stopped`: het gesprek eindigde zonder.
    outcome: Literal["confirmed", "stopped"]
    #: Is de boodschap naar iemand verstuurd (zonder te zeggen naar wie)?
    sent: bool
    screens: Annotated[
        list[ExperienceScreen], Field(min_length=1, max_length=MAX_EXPERIENCE_SCREENS)
    ]


class ExperienceNote(Contract):
    """Een observatie over het gesprek: geen waarheid (§21, §36), en in de MVP stuurt ze niets bij."""

    about: Literal["mode", "question", "symbol", "flow"]
    text: ShortText
    confidence: Confidence


class ExperienceResponse(Contract):
    contract_version: Literal[1]
    session_id: Ref
    notes: Annotated[list[ExperienceNote], Field(max_length=MAX_EXPERIENCE_NOTES)]
    decision: AgentDecision


def field_paths(schema: dict[str, JsonValue]) -> list[str]:
    """Alle veldpaden van een JSON-schema (`a.b`, `a[].c`), voor de vergelijking met de zod-kant.

    Zo valt ook een **optioneel** veld op dat maar aan één kant bestaat: dat zou de voorbeeldbestanden
    niet altijd breken, de lijst met paden wel.
    """
    raw_defs = schema.get("$defs", {})
    defs = raw_defs if isinstance(raw_defs, dict) else {}
    paths: set[str] = set()
    # Verwijzingen die we nu aan het aflopen zijn: een recursieve vorm mag geen oneindige lus worden.
    active: set[str] = set()

    def walk(node: JsonValue, prefix: str) -> None:
        if not isinstance(node, dict):
            return
        ref = node.get("$ref")
        if isinstance(ref, str) and ref not in active:
            active.add(ref)
            walk(schema if ref == "#" else defs.get(ref.rsplit("/", 1)[-1]), prefix)
            active.discard(ref)
        for key in ("anyOf", "oneOf", "allOf"):
            variants = node.get(key)
            if isinstance(variants, list):
                for variant in variants:
                    walk(variant, prefix)
        props = node.get("properties")
        if isinstance(props, dict):
            for name, child in props.items():
                path = f"{prefix}.{name}" if prefix else name
                paths.add(path)
                walk(child, path)
        items = node.get("items")
        if items is not None:
            walk(items, f"{prefix}[]")
        additional = node.get("additionalProperties")
        if isinstance(additional, dict):
            walk(additional, f"{prefix}{{}}")

    walk(schema, "")
    return sorted(paths)
