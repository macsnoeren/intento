"""Contact Agent: welk contact als volgende wordt aangeboden (INTENTO-NEW-DESIGN §28, §29).

Regels, geen LLM: de namen van contacten gaan nooit naar een taalmodel (V6), en de vragen erover zijn
vaste zinnen. De volgorde is de vaste volgorde die de beheerder instelde (`sort_order`); met Experience
komt in N12.2 "wie het vaakst gekozen is, eerst" erbij. De Contact Agent kiest nooit zelf een ontvanger:
hij bepaalt alleen wie er als volgende gevraagd wordt (§32).
"""

from __future__ import annotations

from collections.abc import Sequence

from ..contracts import ContactEntry, Option, SessionState


def contact_order(contacts: Sequence[ContactEntry]) -> list[ContactEntry]:
    """De vaste volgorde: `sort_order`, en bij gelijke waarde de volgorde waarin de backend ze gaf."""
    return [
        c for _, c in sorted(enumerate(contacts), key=lambda pair: (pair[1].sort_order, pair[0]))
    ]


def next_contacts(
    state: SessionState, contacts: Sequence[ContactEntry], limit: int
) -> list[ContactEntry]:
    """De volgende `limit` contacten die in dit gesprek nog niet getoond zijn, in volgorde."""
    asked = set(state.share.contacts_asked)
    return [c for c in contact_order(contacts) if c.id not in asked][:limit]


def next_contact(state: SessionState, contacts: Sequence[ContactEntry]) -> ContactEntry | None:
    """Het eerste contact dat in dit gesprek nog niet gevraagd is, of `None`."""
    page = next_contacts(state, contacts, 1)
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
