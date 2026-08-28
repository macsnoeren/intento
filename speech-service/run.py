#!/usr/bin/env python3
"""Gemaks-entrypoint zodat `python run.py` hetzelfde doet als `python -m speech_service`."""

import sys

from speech_service.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
