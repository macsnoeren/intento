"""De meegestuurde Vocabulary als opzoekindex (INTENTO-NEW-DESIGN §3.1, §15).

De agentdienst krijgt de Vocabulary per beurt mee en mag hem nooit wijzigen (I8); deze index is
alleen-lezen.
"""

from __future__ import annotations

from collections.abc import Sequence

from .contracts import VocabularyEntry


def normalize(text: str) -> str:
    """Vergelijkbare vorm van een woord: kleine letters, spaties samengevoegd, `_` als spatie."""
    return " ".join(text.replace("_", " ").lower().split())


class VocabularyIndex:
    def __init__(self, entries: Sequence[VocabularyEntry]) -> None:
        self.entries: list[VocabularyEntry] = sorted(entries, key=lambda e: (e.sort_order, e.id))
        self._by_id = {entry.id: entry for entry in self.entries}
        # Concept → eerste item (in vaste volgorde) dat dat concept draagt.
        self._by_concept: dict[str, VocabularyEntry] = {}
        # Woord (label of synoniem) → eerste item met dat woord.
        self._by_label: dict[str, VocabularyEntry] = {}
        for entry in self.entries:
            for concept in entry.concepts:
                self._by_concept.setdefault(normalize(concept), entry)
            for label in entry.labels:
                self._by_label.setdefault(normalize(label), entry)

    def get(self, item_id: str) -> VocabularyEntry | None:
        return self._by_id.get(item_id)

    def for_concept(self, concept: str) -> VocabularyEntry | None:
        return self._by_concept.get(normalize(concept))

    def for_label(self, label: str) -> VocabularyEntry | None:
        """Het item met dit woord als label of synoniem."""
        return self._by_label.get(normalize(label))

    def start_items(self) -> list[VocabularyEntry]:
        """De startconcepten in vaste volgorde (§6: start)."""
        return [entry for entry in self.entries if entry.is_start]

    @staticmethod
    def label(entry: VocabularyEntry) -> str:
        return entry.labels[0]

    @staticmethod
    def concept(entry: VocabularyEntry) -> str:
        return entry.concepts[0]
