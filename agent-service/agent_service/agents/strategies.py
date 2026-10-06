"""Vraagstrategieën (INTENTO-NEW-DESIGN §7.1).

Een strategie is een **instructie die de Question Agent meekrijgt**. De sleutels liggen vast (zelfde
lijst als in `shared/`, getest tegen `contracts/question_strategies.json`); label en uitleg zijn voor
mensen, de instructie is voor het model. Een strategie verandert de manier van vragen, nooit de
garanties (§52): die liggen in de backend.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import get_args

from ..contracts import QuestionStrategy


@dataclass(frozen=True)
class Strategy:
    key: QuestionStrategy
    label: str
    explanation: str
    instruction: str


STRATEGIES: dict[QuestionStrategy, Strategy] = {
    "general_to_specific": Strategy(
        key="general_to_specific",
        label="Van algemeen naar specifiek",
        explanation="Eerst het onderwerp, daarna de details. De standaard.",
        instruction=(
            "Vraag eerst naar het onderwerp, dan naar details. Is het onderwerp al bevestigd, vraag "
            'dan naar één detail ervan (bv. na JA op pijn: "Heb je pijn aan je hoofd?").'
        ),
    ),
    "concrete_first": Strategy(
        key="concrete_first",
        label="Concreet eerst",
        explanation="Meteen naar concrete dingen; abstracte tussenstappen overslaan.",
        instruction=(
            'Vraag meteen naar het concrete ding, niet naar een categorie ("Wil je water?" in plaats '
            'van "Wil je iets drinken?"). Sla abstracte tussenstappen over.'
        ),
    ),
    "short_and_calm": Strategy(
        key="short_and_calm",
        label="Kort en rustig",
        explanation="Korte, eenvoudige vragen, één ding tegelijk.",
        instruction=(
            "Stel een zo kort mogelijke vraag van hooguit vijf woorden, één ding tegelijk, in rustige "
            "en eenvoudige woorden. Liever een vraag meer dan een moeilijke vraag."
        ),
    ),
}

#: De sleutels zoals het contract ze kent.
STRATEGY_KEYS: tuple[QuestionStrategy, ...] = get_args(QuestionStrategy)


def instruction_for(key: QuestionStrategy) -> str:
    return STRATEGIES[key].instruction
