#!/usr/bin/env python3
"""Gemaks-entrypoint zodat `python run.py` hetzelfde doet als `python -m agent_service`."""

import sys

from agent_service.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
