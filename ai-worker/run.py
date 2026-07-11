#!/usr/bin/env python3
"""Gemaks-entrypoint zodat `python run.py` hetzelfde doet als `python -m ai_worker`."""

import sys

from ai_worker.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
