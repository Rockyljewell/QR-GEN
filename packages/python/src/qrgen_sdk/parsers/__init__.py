"""Pure-Python parsers for decoded barcode content (SPEC section 3).

All parsers return plain dicts with the camelCase keys used by every QRGen
platform, so ``json.dumps(result)`` matches the other SDKs. They never raise.
"""

from .aamva import parse_aamva
from .content import CONTENT_TYPES, expand_upce, gtin_checksum_valid, parse_content
from .gs1 import AI_TABLE, format_hri, lookup_ai, parse_gs1, to_element_string

__all__ = [
    "parse_content",
    "parse_gs1",
    "parse_aamva",
    "CONTENT_TYPES",
    "AI_TABLE",
    "lookup_ai",
    "format_hri",
    "to_element_string",
    "gtin_checksum_valid",
    "expand_upce",
]
