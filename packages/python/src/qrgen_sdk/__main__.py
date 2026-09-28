# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""``python -m qrgen_sdk`` entry point."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
