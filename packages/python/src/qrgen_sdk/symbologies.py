"""Symbology ids, names, aliases and groups (SPEC section 1).

Every QRGen API accepts and returns the lowercase ids defined here. Inputs are
matched case-insensitively after removing everything except ``[a-z0-9]``, so
``"QRCode"``, ``"qr-code"``, ``"QR"`` and ``"qr"`` all resolve to ``"qr"``.

This module is pure Python. The zxing-cpp specific helpers
(:func:`to_zxing_formats`, :func:`id_from_zxing`) import ``zxingcpp`` lazily.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Dict, FrozenSet, Iterable, List, Optional, Sequence, Tuple, Union

if TYPE_CHECKING:  # pragma: no cover
    import zxingcpp

__all__ = [
    "SymbologyInfo",
    "SYMBOLOGIES",
    "SYMBOLOGY_IDS",
    "GROUPS",
    "WRITABLE_SYMBOLOGIES",
    "UnknownSymbologyError",
    "normalize_key",
    "resolve_symbology",
    "resolve_symbologies",
    "symbology_name",
    "to_zxing_formats",
    "zxing_create_format",
    "id_from_zxing",
    "supported_symbologies",
    "writable_symbologies",
]


@dataclass(frozen=True)
class SymbologyInfo:
    """Static description of one symbology.

    Attributes:
        id: Canonical lowercase id (for example ``"data-matrix"``).
        name: Human readable name (for example ``"Data Matrix"``).
        aliases: Extra names accepted by :func:`resolve_symbologies`.
        zxing_formats: zxing-cpp ``BarcodeFormat`` member names used when reading.
        zxing_create: zxing-cpp ``BarcodeFormat`` member name used when generating,
            or ``None`` when the symbology cannot be generated.
    """

    id: str
    name: str
    aliases: Tuple[str, ...] = ()
    zxing_formats: Tuple[str, ...] = ()
    zxing_create: Optional[str] = None
    parent: Optional[str] = field(default=None, compare=False)


# Order matches the SPEC table; resolve_symbologies() returns ids in this order.
_TABLE: Tuple[SymbologyInfo, ...] = (
    SymbologyInfo("qr", "QR Code", ("qrcode",), ("QRCodeModel1", "QRCodeModel2"), "QRCode"),
    SymbologyInfo("micro-qr", "Micro QR Code", ("microqrcode",), ("MicroQRCode",), "MicroQRCode"),
    SymbologyInfo("rmqr", "rMQR Code", ("rmqrcode",), ("RMQRCode",), "RMQRCode"),
    SymbologyInfo("data-matrix", "Data Matrix", ("datamatrix", "dm"), ("DataMatrix",), "DataMatrix"),
    SymbologyInfo("aztec", "Aztec", ("azteccode",), ("AztecCode", "AztecRune"), "Aztec"),
    SymbologyInfo("pdf417", "PDF417", ("compactpdf417",), ("PDF417", "CompactPDF417"), "PDF417"),
    SymbologyInfo("micro-pdf417", "MicroPDF417", ("micropdf417",), ("MicroPDF417",), "MicroPDF417"),
    SymbologyInfo("maxicode", "MaxiCode", (), ("MaxiCode",), "MaxiCode"),
    SymbologyInfo("ean13", "EAN-13", ("ean", "jan", "gtin13"), ("EAN13",), "EAN13"),
    SymbologyInfo("ean8", "EAN-8", ("gtin8",), ("EAN8",), "EAN8"),
    SymbologyInfo("upca", "UPC-A", ("upc",), ("UPCA",), "UPCA", parent="ean13"),
    SymbologyInfo("upce", "UPC-E", (), ("UPCE",), "UPCE"),
    # zxing-cpp 3.1 only reports ISBN when EAN13 is enabled as well.
    SymbologyInfo("isbn", "ISBN", ("isbn13",), ("ISBN", "EAN13"), "ISBN", parent="ean13"),
    SymbologyInfo("code128", "Code 128", ("gs1128", "ean128"), ("Code128",), "Code128"),
    SymbologyInfo("code39", "Code 39", ("code3of9",), ("Code39", "Code39Std", "Code39Ext"), "Code39"),
    SymbologyInfo("code93", "Code 93", (), ("Code93",), "Code93"),
    SymbologyInfo("codabar", "Codabar", ("nw7",), ("Codabar",), "Codabar"),
    SymbologyInfo("itf", "Interleaved 2 of 5", ("interleaved2of5", "i2of5"), ("ITF",), "ITF"),
    SymbologyInfo("itf14", "ITF-14", (), ("ITF14",), "ITF14", parent="itf"),
    SymbologyInfo(
        "databar",
        "GS1 DataBar",
        ("rss14", "databaromni"),
        ("DataBar", "DataBarOmni", "DataBarStk", "DataBarStkOmni"),
        "DataBar",
    ),
    SymbologyInfo(
        "databar-expanded", "GS1 DataBar Expanded", ("rssexpanded",), ("DataBarExp", "DataBarExpStk"), "DataBarExp"
    ),
    SymbologyInfo("databar-limited", "GS1 DataBar Limited", ("rsslimited",), ("DataBarLtd",), "DataBarLtd"),
    SymbologyInfo("code32", "Code 32 (Italian Pharmacode)", (), ("Code32",), "Code32", parent="code39"),
    SymbologyInfo("pzn", "PZN", (), ("PZN",), "PZN", parent="code39"),
    SymbologyInfo("telepen", "Telepen", (), ("Telepen", "TelepenAlpha", "TelepenNumeric"), "Telepen"),
    SymbologyInfo("dx-film-edge", "DX Film Edge", (), ("DXFilmEdge",), "DXFilmEdge"),
)

#: All symbologies keyed by id, in SPEC order.
SYMBOLOGIES: Dict[str, SymbologyInfo] = {info.id: info for info in _TABLE}

#: All ids in SPEC order.
SYMBOLOGY_IDS: Tuple[str, ...] = tuple(SYMBOLOGIES)

_LINEAR = (
    "ean13 ean8 upca upce isbn code128 code39 code93 codabar itf itf14 databar "
    "databar-expanded databar-limited code32 pzn telepen dx-film-edge"
).split()
_MATRIX = "qr micro-qr rmqr data-matrix aztec pdf417 micro-pdf417 maxicode".split()

#: Group name -> ids (SPEC section 1, "Groups").
GROUPS: Dict[str, Tuple[str, ...]] = {
    "all": SYMBOLOGY_IDS,
    "linear": tuple(_LINEAR),
    "1d": tuple(_LINEAR),
    "matrix": tuple(_MATRIX),
    "2d": tuple(_MATRIX),
    "retail": tuple("ean13 ean8 upca upce isbn databar databar-expanded databar-limited".split()),
    "industrial": tuple("code128 code39 code93 codabar itf itf14 data-matrix".split()),
    "gs1": tuple("code128 data-matrix qr databar databar-expanded databar-limited".split()),
}

#: Ids that :func:`qrgen_sdk.generate` can encode (SPEC section 7).
WRITABLE_SYMBOLOGIES: Tuple[str, ...] = tuple(info.id for info in _TABLE if info.zxing_create)

_NON_ALNUM = re.compile(r"[^a-z0-9]")


def normalize_key(name: str) -> str:
    """Return the lookup key for a symbology or group name.

    >>> normalize_key("QR-Code")
    'qrcode'
    """
    return _NON_ALNUM.sub("", str(name).lower())


def _build_lookup() -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for info in _TABLE:
        for key in (info.id, info.name, *info.aliases):
            lookup.setdefault(normalize_key(key), info.id)
    # "QR" is the common short form of "QR Code".
    lookup.setdefault("qr", "qr")
    return lookup


_LOOKUP = _build_lookup()
_GROUP_LOOKUP = {normalize_key(k): k for k in GROUPS}


class UnknownSymbologyError(ValueError):
    """Raised when a symbology or group name cannot be resolved."""

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Unknown symbology {name!r}. Use one of: {', '.join(SYMBOLOGY_IDS)} "
            f"or a group ({', '.join(GROUPS)})."
        )
        self.name = name


def resolve_symbology(name: str) -> str:
    """Resolve a single symbology name or alias (not a group) to its id.

    Raises:
        UnknownSymbologyError: if ``name`` is not a known symbology.
    """
    key = normalize_key(name)
    if key in _LOOKUP:
        return _LOOKUP[key]
    raise UnknownSymbologyError(name)


def resolve_symbologies(
    symbologies: Union[None, str, Iterable[str]] = None,
    *,
    ignore_unknown: bool = False,
) -> List[str]:
    """Expand ids, aliases and groups into a de-duplicated list of ids.

    Args:
        symbologies: ``None`` or an empty list means ``["all"]``. A string is split
            on commas and whitespace, so ``"qr,ean13"`` works.
        ignore_unknown: Skip unknown names instead of raising.

    Returns:
        Ids in SPEC order.

    Raises:
        UnknownSymbologyError: for an unknown name unless ``ignore_unknown`` is set.

    >>> resolve_symbologies(["QRCode", "retail"])[:3]
    ['qr', 'ean13', 'ean8']
    """
    if symbologies is None:
        names: List[str] = []
    elif isinstance(symbologies, str):
        names = [part for part in re.split(r"[,\s]+", symbologies) if part]
    else:
        names = [str(part) for part in symbologies if str(part).strip()]
    if not names:
        return list(SYMBOLOGY_IDS)

    wanted: set = set()
    for name in names:
        key = normalize_key(name)
        if key in _GROUP_LOOKUP:
            wanted.update(GROUPS[_GROUP_LOOKUP[key]])
        elif key in _LOOKUP:
            wanted.add(_LOOKUP[key])
        elif not ignore_unknown:
            raise UnknownSymbologyError(name)
    return [sid for sid in SYMBOLOGY_IDS if sid in wanted]


def symbology_name(symbology_id: str) -> str:
    """Return the human readable name for an id (``"qr"`` -> ``"QR Code"``)."""
    info = SYMBOLOGIES.get(symbology_id)
    return info.name if info else symbology_id


# --------------------------------------------------------------------------- zxing-cpp


def _zx():  # type: ignore[no-untyped-def]
    import zxingcpp

    return zxingcpp


def to_zxing_formats(symbology_ids: Sequence[str]) -> "zxingcpp.BarcodeFormats":
    """Map resolved ids to a ``zxingcpp.BarcodeFormats`` value for reading.

    ``qr`` maps to ``QRCodeModel1 | QRCodeModel2`` because ``QRCode`` in zxing-cpp v3
    also matches Micro QR and rMQR. Results must still be post-filtered with
    :func:`id_from_zxing`.
    """
    zx = _zx()
    members = []
    seen = set()
    for sid in symbology_ids:
        info = SYMBOLOGIES.get(sid)
        if info is None:
            continue
        for fmt_name in info.zxing_formats:
            fmt = getattr(zx.BarcodeFormat, fmt_name, None)
            if fmt is not None and fmt_name not in seen:
                seen.add(fmt_name)
                members.append(fmt)
    return zx.BarcodeFormats(members)


def zxing_create_format(symbology_id: str) -> "zxingcpp.BarcodeFormat":
    """Return the zxing-cpp format used to generate ``symbology_id``.

    Raises:
        ValueError: if the id cannot be generated.
    """
    info = SYMBOLOGIES.get(symbology_id)
    if info is None or not info.zxing_create:
        raise ValueError(f"Symbology {symbology_id!r} cannot be generated")
    return getattr(_zx().BarcodeFormat, info.zxing_create)


# zxing-cpp format name -> base id (before the requested-set refinements below).
_FORMAT_TO_ID: Dict[str, str] = {
    "QRCode": "qr",
    "QRCodeModel1": "qr",
    "QRCodeModel2": "qr",
    "MicroQRCode": "micro-qr",
    "RMQRCode": "rmqr",
    "DataMatrix": "data-matrix",
    "Aztec": "aztec",
    "AztecCode": "aztec",
    "AztecRune": "aztec",
    "PDF417": "pdf417",
    "CompactPDF417": "pdf417",
    "MicroPDF417": "micro-pdf417",
    "MaxiCode": "maxicode",
    "EAN13": "ean13",
    "EAN8": "ean8",
    "UPCA": "upca",
    "UPCE": "upce",
    "ISBN": "isbn",
    "Code128": "code128",
    "Code39": "code39",
    "Code39Std": "code39",
    "Code39Ext": "code39",
    "Code93": "code93",
    "Codabar": "codabar",
    "ITF": "itf",
    "ITF14": "itf14",
    "DataBar": "databar",
    "DataBarOmni": "databar",
    "DataBarStk": "databar",
    "DataBarStkOmni": "databar",
    "DataBarExp": "databar-expanded",
    "DataBarExpStk": "databar-expanded",
    "DataBarExpanded": "databar-expanded",
    "DataBarLtd": "databar-limited",
    "DataBarLimited": "databar-limited",
    "Code32": "code32",
    "PZN": "pzn",
    "Telepen": "telepen",
    "TelepenAlpha": "telepen",
    "TelepenNumeric": "telepen",
    "DXFilmEdge": "dx-film-edge",
}


def _gs1_check_ok(digits: str) -> bool:
    if not digits.isdigit() or len(digits) < 2:
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def id_from_zxing(
    format_name: str,
    text: str = "",
    requested: Optional[Iterable[str]] = None,
    symbology_identifier: str = "",
) -> Optional[str]:
    """Map a zxing-cpp result format back to a QRGen id.

    The requested set refines ambiguous results, mirroring what ML Kit and Apple
    Vision report:

    * an EAN-13 with a leading ``0`` is reported as ``upca`` when ``upca`` was requested;
    * an EAN-13 with a ``978``/``979`` prefix is reported as ``isbn`` when ``isbn`` but not
      ``ean13`` was requested;
    * a 14 digit ITF is reported as ``itf14`` when ``itf14`` was requested;
    * Code 32 and PZN fall back to ``code39`` when only ``code39`` was requested.

    Returns:
        The id, or ``None`` when the result is not part of the requested set (so the
        caller should drop it).
    """
    wanted: FrozenSet[str] = frozenset(requested) if requested is not None else frozenset(SYMBOLOGY_IDS)
    sid = _FORMAT_TO_ID.get(format_name)
    if sid is None:
        return None

    if sid == "ean13":
        digits = text.strip()
        if digits.startswith("0") and "upca" in wanted:
            sid = "upca"
        elif digits[:3] in ("978", "979") and "isbn" in wanted and "ean13" not in wanted:
            sid = "isbn"
    elif sid == "isbn" and "isbn" not in wanted and "ean13" in wanted:
        sid = "ean13"
    elif sid == "upca" and "upca" not in wanted and "ean13" in wanted:
        sid = "ean13"
    elif sid == "itf":
        digits = text.strip()
        if (
            "itf14" in wanted
            and len(digits) == 14
            and digits.isdigit()
            and ("itf" not in wanted or symbology_identifier == "]I1" or _gs1_check_ok(digits))
        ):
            sid = "itf14"
    elif sid == "itf14" and "itf14" not in wanted and "itf" in wanted:
        sid = "itf"

    if sid not in wanted:
        parent = SYMBOLOGIES[sid].parent
        if parent and parent in wanted:
            sid = parent
        else:
            return None
    return sid


def supported_symbologies(kind: str = "read") -> List[str]:
    """Return the ids this installation can read (``kind="read"``) or write (``"write"``).

    The list is computed from the formats compiled into the installed zxing-cpp build.
    """
    try:
        zx = _zx()
    except ImportError:  # pragma: no cover - zxing-cpp is a hard dependency
        return []
    flag = zx.BarcodeFormat.AllCreatable if kind == "write" else zx.BarcodeFormat.AllReadable
    available = {fmt.name for fmt in zx.barcode_formats_list(zx.BarcodeFormats(flag))}
    result = []
    for info in _TABLE:
        if kind == "write":
            if info.zxing_create and info.zxing_create in available:
                result.append(info.id)
        elif any(name in available for name in info.zxing_formats):
            result.append(info.id)
    return result


def writable_symbologies() -> List[str]:
    """Shortcut for ``supported_symbologies("write")``."""
    return supported_symbologies("write")
