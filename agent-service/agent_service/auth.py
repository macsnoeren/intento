"""Controle van de API-key waarmee de backend zich meldt (INTENTO-NEW-DESIGN §51, §53)."""

from __future__ import annotations

import hmac

_PREFIX = "Bearer "


def is_authorized(authorization_header: str | None, expected_token: str) -> bool:
    """Klopt de `Authorization`-header met het gedeelde geheim?

    De vergelijking is constant in tijd (`hmac.compare_digest`): zo lekt de responstijd niet hoeveel
    tekens van een geraden token al klopten. Een leeg verwacht token wordt nooit geaccepteerd — de
    configuratie dwingt er al een af, maar deze functie vertrouwt daar niet blind op.
    """
    if not expected_token or not authorization_header:
        return False
    header = authorization_header.strip()
    if not header.startswith(_PREFIX):
        return False
    given = header[len(_PREFIX) :].strip()
    return hmac.compare_digest(given.encode("utf-8"), expected_token.encode("utf-8"))
