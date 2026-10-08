"""Contact Agent: welk contact als volgende wordt aangeboden (INTENTO-NEW-DESIGN §28, §29).

Regels, geen LLM: de namen van contacten gaan nooit naar een taalmodel (V6), en de vragen erover zijn
vaste zinnen. De volgorde (§29 besluit 7): met Experience wie het vaakst gekozen is eerst, en anders (of
bij gelijke aantallen) de vaste volgorde die de beheerder instelde (`sort_order`). De Contact Agent kiest
nooit zelf een ontvanger: hij bepaalt alleen wie er als volgende gevraagd wordt (§32), en de ranking
slaat nooit iemand over.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..contracts import ContactEntry, Option, SessionState
from .experience import NO_RANKING, Ranking


def contact_order(
    contacts: Sequence[ContactEntry], ranking: Ranking = NO_RANKING
) -> list[ContactEntry]:
    """Vaakst gekozen eerst; daarna `sort_order`, en bij gelijke waarde de volgorde waarin de backend
    ze gaf."""
    fixed = [
        c for _, c in sorted(enumerate(contacts), key=lambda pair: (pair[1].sort_order, pair[0]))
    ]
    return ranking.contacts(fixed, lambda c: c.id)


def next_contacts(
    state: SessionState,
    contacts: Sequence[ContactEntry],
    limit: int,
    ranking: Ranking = NO_RANKING,
) -> list[ContactEntry]:
    """De volgende `limit` contacten die in dit gesprek nog niet getoond zijn, in volgorde."""
    asked = set(state.share.contacts_asked)
    return [c for c in contact_order(contacts, ranking) if c.id not in asked][:limit]


def next_contact(
    state: SessionState, contacts: Sequence[ContactEntry], ranking: Ranking = NO_RANKING
) -> ContactEntry | None:
    """Het eerste contact dat in dit gesprek nog niet gevraagd is, of `None`."""
    page = next_contacts(state, contacts, 1, ranking)
    return page[0] if page else None


#: De vraag boven de contacttegels in multi-icon (§29).
CONTACT_TILES_TEXT = "Met wie wil je dit delen?"


def confirm_send_question(name: str) -> str:
    """Na een keuze uit de tegels altijd nog: "Naar {naam} sturen?" (§29)."""
    return f"Naar {name} sturen?"


def contact_question(name: str) -> str:
    """De vaste vraag in binary (§29): de vraag is zelf de bevestiging, JA verstuurt."""
    return f"Wil je dit naar {name} sturen?"


def contact_option(contact: ContactEntry, position: int = 0) -> Option:
    """Het contact als optie op het scherm: zijn naam en zijn pictogram (als hij er een heeft)."""
    return Option(
        ref=f"contact-{contact.id}",
        kind="contact",
        vocabulary_item_id=contact.vocabulary_item_id,
        contact_id=contact.id,
        label=contact.name,
        concept=None,
        representation="exact",
        position=position,
    )
