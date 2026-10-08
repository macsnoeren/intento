"""Ranking uit Experience: wat het vaakst gekozen is, eerst (INTENTO-NEW-DESIGN §2.4, §29 besluit 7).

Regels, geen LLM. De backend stuurt een samenvatting van de Experience van deze gebruiker mee, alleen als
Experience aanstaat (§22); zonder samenvatting blijft alles in de vaste volgorde.

Ranking **ordent alleen**: elke functie hier geeft precies dezelfde opties terug, in een andere volgorde,
en verbergt er nooit een (§2.4). Bij een gelijk aantal keuzes blijft de volgorde die er al was (de vaste
volgorde, of die van de agent). Bewust eenvoudig: geen correctie voor de plek waarop iets stond — hoe
sterk de ranking de keuzes stuurt, laat het bias-rapport zien (§25).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TypeVar

from ..contracts import ExperienceSummary

T = TypeVar("T")


class Ranking:
    """Hoe vaak elk symbool (per Vocabulary-item) en elk contact gekozen is."""

    def __init__(self, summary: ExperienceSummary | None) -> None:
        self._symbols = {c.ref: c.chosen for c in summary.symbols} if summary else {}
        self._contacts = {c.ref: c.chosen for c in summary.contacts} if summary else {}

    def symbol_chosen(self, item_id: str | None) -> int:
        return self._symbols.get(item_id, 0) if item_id else 0

    def contact_chosen(self, contact_id: str) -> int:
        return self._contacts.get(contact_id, 0)

    def symbols(self, items: Sequence[T], item_id: Callable[[T], str | None]) -> list[T]:
        """Vaakst gekozen symbool eerst; gelijk → de volgorde zoals gegeven."""
        return _stable_by(items, lambda item: self.symbol_chosen(item_id(item)))

    def contacts(self, items: Sequence[T], contact_id: Callable[[T], str]) -> list[T]:
        """Vaakst gekozen contact eerst; gelijk → de volgorde zoals gegeven."""
        return _stable_by(items, lambda item: self.contact_chosen(contact_id(item)))


def _stable_by(items: Sequence[T], chosen: Callable[[T], int]) -> list[T]:
    # `sorted` is stabiel: bij een gelijk aantal blijft de gegeven volgorde staan.
    return sorted(items, key=lambda item: -chosen(item))


#: Geen Experience (uit, of nog niets geleerd): alles in de vaste volgorde.
NO_RANKING = Ranking(None)
