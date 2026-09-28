# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""QRGen for Python: barcode, QR code and ID scanning, generation and parsing.

Quick start::

    import qrgen_sdk

    svg = qrgen_sdk.generate("https://example.com")            # SVG string
    png = qrgen_sdk.generate("hello", format="png", scale=8)   # PNG bytes
    for code in qrgen_sdk.scan("photo.jpg", symbologies=["qr", "retail"]):
        print(code.symbology, code.data, qrgen_sdk.parse_content(code.data)["type"])

See https://github.com/Rockyljewell/QR-GEN for the cross-platform specification.
"""

from ._version import __version__
from .generator import GenerateError, generate, save
from .models import Barcode, Point, Quad, Size, TrackedBarcode
from .parsers import parse_aamva, parse_content, parse_gs1
from .scanner import ScanError, scan, scan_file
from .symbologies import (
    GROUPS,
    SYMBOLOGIES,
    SYMBOLOGY_IDS,
    UnknownSymbologyError,
    resolve_symbologies,
    supported_symbologies,
    symbology_name,
    writable_symbologies,
)
from .tracking import BatchTracker, DuplicateFilter

__all__ = [
    "__version__",
    "scan",
    "scan_file",
    "generate",
    "save",
    "parse_content",
    "parse_gs1",
    "parse_aamva",
    "resolve_symbologies",
    "supported_symbologies",
    "writable_symbologies",
    "symbology_name",
    "Barcode",
    "TrackedBarcode",
    "Point",
    "Quad",
    "Size",
    "DuplicateFilter",
    "BatchTracker",
    "SYMBOLOGIES",
    "SYMBOLOGY_IDS",
    "GROUPS",
    "ScanError",
    "GenerateError",
    "UnknownSymbologyError",
]
