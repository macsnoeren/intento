"""Prompts als versiebestanden (INTENTO-NEW-DESIGN §34).

Elke prompt staat in een eigen bestand `<naam>-v<versie>.md` in deze map. De versie komt mee in elke
`AgentDecision`, zodat in de provenance terug te zien is met welke prompt een vraag tot stand kwam.
Een prompt wijzigen = een nieuw bestand met een hoger versienummer; een oud bestand blijft staan
zolang er gesprekken naar verwijzen.

Een prompt helpt, maar is nooit de waarborg: wat nooit mag, dwingt de backend af (§52).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from importlib import resources

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
_FILE = re.compile(r"^(?P<name>[a-z][a-z0-9_]*)-v(?P<version>\d+)\.md$")


@dataclass(frozen=True)
class Prompt:
    name: str
    version: int
    text: str

    @property
    def id(self) -> str:
        """Zoals in `AgentDecision.prompt_version`, bv. `question-v1`."""
        return f"{self.name}-v{self.version}"


def _versions(name: str) -> dict[int, str]:
    found: dict[int, str] = {}
    for entry in resources.files(__package__).iterdir():
        match = _FILE.match(entry.name)
        if match and match.group("name") == name:
            found[int(match.group("version"))] = entry.name
    return found


def load_prompt(name: str, version: int | None = None) -> Prompt:
    """Laadt een prompt; zonder versie de hoogste. Gooit `LookupError` als hij niet bestaat."""
    if not _NAME.match(name):
        raise LookupError(f"ongeldige promptnaam {name!r}")
    versions = _versions(name)
    if not versions:
        raise LookupError(f"geen prompt {name!r}")
    chosen = max(versions) if version is None else version
    if chosen not in versions:
        raise LookupError(f"geen prompt {name}-v{chosen}")
    text = resources.files(__package__).joinpath(versions[chosen]).read_text(encoding="utf-8")
    return Prompt(name=name, version=chosen, text=text.strip())
