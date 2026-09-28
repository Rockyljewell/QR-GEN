# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""GS1 element string and GS1 Digital Link parser (SPEC section 3.2).

Accepted inputs:

* HRI form: ``(01)09501101530003(17)250101(10)ABC123``
* raw form with ASCII 29 (GS) separators, optionally prefixed with an AIM symbology
  identifier such as ``]C1``, ``]d2``, ``]Q3`` or ``]e0``
* GS1 Digital Link URLs: ``https://id.gs1.org/01/09501101530003/10/ABC123?17=250101``

The parser never raises. It returns ``None`` when the input is not valid GS1 data.
"""

from __future__ import annotations

import calendar
import datetime as _dt
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, unquote, urlsplit

__all__ = [
    "AIDefinition",
    "AI_TABLE",
    "GS",
    "lookup_ai",
    "parse_gs1",
    "format_hri",
    "to_element_string",
    "is_gs1_digital_link",
]

#: ASCII 29, the FNC1 / group separator used between variable-length fields.
GS = "\x1d"


@dataclass(frozen=True)
class AIDefinition:
    """One GS1 Application Identifier.

    Attributes:
        ai: The AI digits (for weight/measure AIs the decimal digit is included).
        title: GS1 data title, for example ``"BATCH/LOT"``.
        components: Format components such as ``(("N", 13, True), ("X", 17, False))``,
            meaning ``N13`` followed by ``X..17``. The boolean is ``True`` for fixed length.
        decimals: Implied decimal places for measure/amount AIs, else ``None``.
        is_date: Value starts with a ``YYMMDD`` date.
    """

    ai: str
    title: str
    components: Tuple[Tuple[str, int, bool], ...]
    decimals: Optional[int] = None
    is_date: bool = False
    currency_prefix: bool = False

    @property
    def fixed_length(self) -> Optional[int]:
        """Total length when every component is fixed, else ``None``."""
        if all(fixed for _, _, fixed in self.components):
            return sum(length for _, length, _ in self.components)
        return None

    @property
    def max_length(self) -> int:
        """Longest valid value."""
        return sum(length for _, length, _ in self.components)

    def validate(self, value: str) -> bool:
        """Check ``value`` against the AI format (length and numeric components)."""
        pos = 0
        for index, (kind, length, fixed) in enumerate(self.components):
            last = index == len(self.components) - 1
            if fixed:
                part = value[pos : pos + length]
                if len(part) != length:
                    return False
            else:
                part = value[pos:] if last else value[pos : pos + length]
                if len(part) > length:
                    return False
                if not part and index == 0:
                    return False
            if kind == "N" and part and not part.isdigit():
                return False
            if kind == "X" and part and not _is_cset82(part):
                return False
            pos += len(part)
        return pos == len(value)


def _is_cset82(text: str) -> bool:
    # GS1 restricts alphanumeric AIs to character set 82. Scanned data in the wild
    # is not always compliant, so only control characters are rejected here.
    return not any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in text)


def _fmt(spec: str) -> Tuple[Tuple[str, int, bool], ...]:
    parts = []
    for token in spec.split():
        match = re.fullmatch(r"([NX])(\.\.)?(\d+)", token)
        if not match:  # pragma: no cover - table typo guard
            raise ValueError(f"bad AI format {spec!r}")
        parts.append((match.group(1), int(match.group(3)), match.group(2) is None))
    return tuple(parts)


_DATE_AIS = {"11", "12", "13", "15", "16", "17"}

# (ai, title, format). Formats follow the GS1 General Specifications: N = numeric,
# X = GS1 character set 82, "N13 X..17" = 13 digits then up to 17 characters.
_BASE: List[Tuple[str, str, str]] = [
    ("00", "SSCC", "N18"),
    ("01", "GTIN", "N14"),
    ("02", "CONTENT", "N14"),
    ("03", "MTO GTIN", "N14"),
    ("10", "BATCH/LOT", "X..20"),
    ("11", "PROD DATE", "N6"),
    ("12", "DUE DATE", "N6"),
    ("13", "PACK DATE", "N6"),
    ("15", "BEST BEFORE or BEST BY", "N6"),
    ("16", "SELL BY", "N6"),
    ("17", "USE BY or EXPIRY", "N6"),
    ("20", "VARIANT", "N2"),
    ("21", "SERIAL", "X..20"),
    ("22", "CPV", "X..20"),
    ("235", "TPX", "X..28"),
    ("240", "ADDITIONAL ID", "X..30"),
    ("241", "CUST. PART No.", "X..30"),
    ("242", "MTO VARIANT", "N..6"),
    ("243", "PCN", "X..20"),
    ("250", "SECONDARY SERIAL", "X..30"),
    ("251", "REF. TO SOURCE", "X..30"),
    ("253", "GDTI", "N13 X..17"),
    ("254", "GLN EXTENSION COMPONENT", "X..20"),
    ("255", "GCN", "N13 N..12"),
    ("30", "VAR. COUNT", "N..8"),
    ("37", "COUNT", "N..8"),
    ("400", "ORDER NUMBER", "X..30"),
    ("401", "GINC", "X..30"),
    ("402", "GSIN", "N17"),
    ("403", "ROUTE", "X..30"),
    ("410", "SHIP TO LOC", "N13"),
    ("411", "BILL TO", "N13"),
    ("412", "PURCHASE FROM", "N13"),
    ("413", "SHIP FOR LOC", "N13"),
    ("414", "LOC No.", "N13"),
    ("415", "PAY TO", "N13"),
    ("416", "PROD/SERV LOC", "N13"),
    ("417", "PARTY", "N13"),
    ("420", "SHIP TO POST", "X..20"),
    ("421", "SHIP TO POST", "N3 X..9"),
    ("422", "ORIGIN", "N3"),
    ("423", "COUNTRY - INITIAL PROCESS.", "N3 N..12"),
    ("424", "COUNTRY - PROCESS.", "N3"),
    ("425", "COUNTRY - DISASSEMBLY", "N3 N..12"),
    ("426", "COUNTRY - FULL PROCESS", "N3"),
    ("427", "ORIGIN SUBDIVISION", "X..3"),
    ("4300", "SHIP TO COMP", "X..35"),
    ("4301", "SHIP TO NAME", "X..35"),
    ("4302", "SHIP TO ADD1", "X..70"),
    ("4303", "SHIP TO ADD2", "X..70"),
    ("4304", "SHIP TO SUB", "X..70"),
    ("4305", "SHIP TO LOC", "X..70"),
    ("4306", "SHIP TO REG", "X..70"),
    ("4307", "SHIP TO COUNTRY", "X2"),
    ("4308", "SHIP TO PHONE", "X..30"),
    ("4309", "SHIP TO GEO", "N20"),
    ("4310", "RTN TO COMP", "X..35"),
    ("4311", "RTN TO NAME", "X..35"),
    ("4312", "RTN TO ADD1", "X..70"),
    ("4313", "RTN TO ADD2", "X..70"),
    ("4314", "RTN TO SUB", "X..70"),
    ("4315", "RTN TO LOC", "X..70"),
    ("4316", "RTN TO REG", "X..70"),
    ("4317", "RTN TO COUNTRY", "X2"),
    ("4318", "RTN TO POST", "X..20"),
    ("4319", "RTN TO PHONE", "X..30"),
    ("4320", "SRV DESCRIPTION", "X..35"),
    ("4321", "DANGEROUS GOODS", "N1"),
    ("4322", "AUTH LEAVE", "N1"),
    ("4323", "SIG REQUIRED", "N1"),
    ("4324", "NBEF DEL DT", "N10"),
    ("4325", "NAFT DEL DT", "N10"),
    ("4326", "REL DATE", "N6"),
    ("4330", "MAX TEMP F", "N6 X..1"),
    ("4331", "MAX TEMP C", "N6 X..1"),
    ("4332", "MIN TEMP F", "N6 X..1"),
    ("4333", "MIN TEMP C", "N6 X..1"),
    ("7001", "NSN", "N13"),
    ("7002", "MEAT CUT", "X..30"),
    ("7003", "EXPIRY TIME", "N10"),
    ("7004", "ACTIVE POTENCY", "N..4"),
    ("7005", "CATCH AREA", "X..12"),
    ("7006", "FIRST FREEZE DATE", "N6"),
    ("7007", "HARVEST DATE", "N6 N..6"),
    ("7008", "AQUATIC SPECIES", "X..3"),
    ("7009", "FISHING GEAR TYPE", "X..10"),
    ("7010", "PROD METHOD", "X..2"),
    ("7011", "TEST BY DATE", "N6 N..4"),
    ("7020", "REFURB LOT", "X..20"),
    ("7021", "FUNC STAT", "X..20"),
    ("7022", "REV STAT", "X..20"),
    ("7023", "GIAI - ASSEMBLY", "X..30"),
    ("7040", "UIC+EXT", "N1 X3"),
    ("710", "NHRN PZN", "X..20"),
    ("711", "NHRN CIP", "X..20"),
    ("712", "NHRN CN", "X..20"),
    ("713", "NHRN DRN", "X..20"),
    ("714", "NHRN AIM", "X..20"),
    ("715", "NHRN NDC", "X..20"),
    ("716", "NHRN AIC", "X..20"),
    ("7240", "PROTOCOL", "X..20"),
    ("7241", "AIDC MEDIA TYPE", "N2"),
    ("7242", "VCN", "X..25"),
    ("7250", "DOB", "N8"),
    ("7251", "DOB TIME", "N12"),
    ("7252", "BIO SEX", "N1"),
    ("7253", "FAMILY NAME", "X..40"),
    ("7254", "GIVEN NAME", "X..40"),
    ("7255", "SUFFIX", "X..10"),
    ("7256", "FULL NAME", "X..90"),
    ("7257", "PERSON ADDR", "X..70"),
    ("7258", "BIRTH SEQUENCE", "N1 X1 N1"),
    ("7259", "BABY", "X..40"),
    ("8001", "DIMENSIONS", "N14"),
    ("8002", "CMT No.", "X..20"),
    ("8003", "GRAI", "N14 X..16"),
    ("8004", "GIAI", "X..30"),
    ("8005", "PRICE PER UNIT", "N6"),
    ("8006", "ITIP", "N14 N2 N2"),
    ("8007", "IBAN", "X..34"),
    ("8008", "PROD TIME", "N8 N..4"),
    ("8009", "OPTSEN", "X..50"),
    ("8010", "CPID", "X..30"),
    ("8011", "CPID SERIAL", "N..12"),
    ("8012", "VERSION", "X..20"),
    ("8013", "GMN", "X..25"),
    ("8014", "MUDI", "X..25"),
    ("8017", "GSRN - PROVIDER", "N18"),
    ("8018", "GSRN - RECIPIENT", "N18"),
    ("8019", "SRIN", "N..10"),
    ("8020", "REF No.", "X..25"),
    ("8026", "ITIP CONTENT", "N14 N2 N2"),
    ("8030", "DIGSIG", "X..90"),
    ("8110", "COUPON", "X..70"),
    ("8111", "POINTS", "N4"),
    ("8112", "PAPERLESS COUPON", "X..70"),
    ("8200", "PRODUCT URL", "X..70"),
    ("90", "INTERNAL", "X..30"),
]

# 7030-7039 processor approval numbers, 7230-7239 certification references.
_BASE += [("703%d" % s, "PROCESSOR # %d" % s, "N3 X..27") for s in range(10)]
_BASE += [("723%d" % s, "CERT # %d" % (s + 1), "X2 X..28") for s in range(10)]
_BASE += [("9%d" % d, "INTERNAL", "X..90") for d in range(1, 10)]

# Measures with an implied decimal point: 310n..369n, all N6.
_MEASURES = {
    "310": "NET WEIGHT (kg)",
    "311": "LENGTH (m)",
    "312": "WIDTH (m)",
    "313": "HEIGHT (m)",
    "314": "AREA (m2)",
    "315": "NET VOLUME (l)",
    "316": "NET VOLUME (m3)",
    "320": "NET WEIGHT (lb)",
    "321": "LENGTH (in)",
    "322": "LENGTH (ft)",
    "323": "LENGTH (yd)",
    "324": "WIDTH (in)",
    "325": "WIDTH (ft)",
    "326": "WIDTH (yd)",
    "327": "HEIGHT (in)",
    "328": "HEIGHT (ft)",
    "329": "HEIGHT (yd)",
    "330": "GROSS WEIGHT (kg)",
    "331": "LENGTH (m), log",
    "332": "WIDTH (m), log",
    "333": "HEIGHT (m), log",
    "334": "AREA (m2), log",
    "335": "VOLUME (l), log",
    "336": "VOLUME (m3), log",
    "337": "KG PER m2",
    "340": "GROSS WEIGHT (lb)",
    "341": "LENGTH (in), log",
    "342": "LENGTH (ft), log",
    "343": "LENGTH (yd), log",
    "344": "WIDTH (in), log",
    "345": "WIDTH (ft), log",
    "346": "WIDTH (yd), log",
    "347": "HEIGHT (in), log",
    "348": "HEIGHT (ft), log",
    "349": "HEIGHT (yd), log",
    "350": "AREA (in2)",
    "351": "AREA (ft2)",
    "352": "AREA (yd2)",
    "353": "AREA (in2), log",
    "354": "AREA (ft2), log",
    "355": "AREA (yd2), log",
    "356": "NET WEIGHT (troy oz)",
    "357": "NET VOLUME (oz)",
    "360": "NET VOLUME (qt)",
    "361": "NET VOLUME (gal.)",
    "362": "VOLUME (qt), log",
    "363": "VOLUME (gal.), log",
    "364": "VOLUME (in3)",
    "365": "VOLUME (ft3)",
    "366": "VOLUME (yd3)",
    "367": "VOLUME (in3), log",
    "368": "VOLUME (ft3), log",
    "369": "VOLUME (yd3), log",
}

# Amounts with an implied decimal point: 390n..395n.
_AMOUNTS = {
    "390": ("AMOUNT", "N..15", False),
    "391": ("AMOUNT", "N3 N..15", True),
    "392": ("PRICE", "N..15", False),
    "393": ("PRICE", "N3 N..15", True),
    "394": ("PRCNT OFF", "N4", False),
    "395": ("PRICE/UoM", "N6", False),
}


def _build_table() -> Dict[str, AIDefinition]:
    table: Dict[str, AIDefinition] = {}
    for ai, title, spec in _BASE:
        table[ai] = AIDefinition(ai, title, _fmt(spec), is_date=ai in _DATE_AIS)
    for prefix, title in _MEASURES.items():
        for n in range(10):
            table[prefix + str(n)] = AIDefinition(prefix + str(n), title, _fmt("N6"), decimals=n)
    for prefix, (title, spec, iso) in _AMOUNTS.items():
        for n in range(10):
            table[prefix + str(n)] = AIDefinition(
                prefix + str(n), title, _fmt(spec), decimals=n, currency_prefix=iso
            )
    return table


#: Every known AI keyed by its digits.
AI_TABLE: Dict[str, AIDefinition] = _build_table()


def lookup_ai(ai: str) -> Optional[AIDefinition]:
    """Return the definition of ``ai`` or ``None`` when it is not in the table."""
    return AI_TABLE.get(ai)


# Digital Link primary keys and the legacy short names accepted in paths/queries.
_DL_PRIMARY = {"00", "01", "253", "255", "401", "402", "414", "417", "8003", "8004", "8006", "8010", "8013", "8017", "8018"}
_DL_SHORT_NAMES = {
    "gtin": "01",
    "itip": "8006",
    "cpid": "8010",
    "gln": "414",
    "party": "417",
    "gsrnp": "8017",
    "gsrn": "8018",
    "gcn": "255",
    "sscc": "00",
    "gdti": "253",
    "ginc": "401",
    "gsin": "402",
    "grai": "8003",
    "giai": "8004",
    "gmn": "8013",
    "cpv": "22",
    "lot": "10",
    "ser": "21",
    "glnx": "254",
    "srin": "8019",
    "tpx": "235",
    "exp": "17",
}


def _century_year(yy: int, today: _dt.date) -> int:
    """GS1 sliding century window (General Specifications 7.12)."""
    current = today.year
    base = current - current % 100
    diff = yy - current % 100
    if diff >= 51:
        return base - 100 + yy
    if diff <= -50:
        return base + 100 + yy
    return base + yy


def _iso_date(value: str, today: _dt.date) -> Optional[str]:
    if len(value) < 6 or not value[:6].isdigit():
        return None
    yy, mm, dd = int(value[0:2]), int(value[2:4]), int(value[4:6])
    if not 1 <= mm <= 12:
        return None
    year = _century_year(yy, today)
    last = calendar.monthrange(year, mm)[1]
    if dd == 0:
        dd = last
    if dd > last:
        return None
    return "%04d-%02d-%02d" % (year, mm, dd)


def _number(defn: AIDefinition, value: str) -> Optional[float]:
    digits = value[3:] if defn.currency_prefix else value
    if not digits.isdigit() or defn.decimals is None:
        return None
    number = int(digits) / (10 ** defn.decimals)
    return int(number) if float(number).is_integer() else number


def _element(ai: str, value: str, today: _dt.date, raw: Optional[str] = None) -> Tuple[Dict[str, Any], bool]:
    """Return ``(element dict, ok)``; ``ok`` is False when a known AI has an invalid value."""
    defn = AI_TABLE.get(ai)
    element: Dict[str, Any] = {"ai": ai, "title": defn.title if defn else "UNKNOWN", "value": value}
    if raw is not None and raw != value:
        element["raw"] = raw
    if defn is None:
        return element, bool(value)
    if not defn.validate(value):
        return element, False
    if defn.is_date:
        iso = _iso_date(value, today)
        if iso:
            element["date"] = iso
    if defn.decimals is not None:
        number = _number(defn, value)
        if number is not None:
            element["number"] = number
    return element, True


def _result(elements: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not elements or not any(e["ai"] in AI_TABLE for e in elements):
        return None
    values: Dict[str, str] = {}
    for element in elements:
        values.setdefault(element["ai"], element["value"])
    return {"elements": elements, "values": values}


_HRI_AI = re.compile(r"\((\d{2,4})\)")
_SYMBOLOGY_ID = re.compile(r"^\][A-Za-z][0-9A-Za-z]")


def _parse_hri(text: str, today: _dt.date) -> Optional[Dict[str, Any]]:
    matches = list(_HRI_AI.finditer(text))
    if not matches or matches[0].start() != 0:
        return None
    elements = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        value = text[match.end() : end].replace(GS, "")
        element, ok = _element(match.group(1), value, today)
        if not ok:
            return None
        elements.append(element)
    return _result(elements)


def _parse_raw(text: str, today: _dt.date) -> Optional[Dict[str, Any]]:
    elements = []
    pos = 0
    length = len(text)
    while pos < length:
        if text[pos] == GS:
            pos += 1
            continue
        ai = None
        for size in (2, 3, 4):
            candidate = text[pos : pos + size]
            if len(candidate) == size and candidate.isdigit() and candidate in AI_TABLE:
                ai = candidate
                break
        if ai is None:
            return None
        defn = AI_TABLE[ai]
        pos += len(ai)
        fixed = defn.fixed_length
        if fixed is not None:
            value = text[pos : pos + fixed]
            if len(value) != fixed:
                return None
            pos += fixed
        else:
            end = text.find(GS, pos)
            if end < 0:
                end = length
            value = text[pos:end]
            pos = end
        element, ok = _element(ai, value, today)
        if not ok:
            return None
        elements.append(element)
    return _result(elements)


def _dl_ai(segment: str) -> Optional[str]:
    if segment.isdigit() and segment in AI_TABLE:
        return segment
    return _DL_SHORT_NAMES.get(segment)


def _parse_digital_link(url: str, today: _dt.date) -> Optional[Dict[str, Any]]:
    parts = urlsplit(url)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return None
    segments = [unquote(s) for s in parts.path.split("/") if s]
    start = None
    for index in range(len(segments) - 1):
        ai = _dl_ai(segments[index])
        if ai in _DL_PRIMARY:
            start = index
            break
    if start is None:
        return None
    pairs = segments[start:]
    if len(pairs) % 2:
        return None
    elements = []
    for index in range(0, len(pairs), 2):
        ai = _dl_ai(pairs[index])
        if ai is None:
            return None
        raw = pairs[index + 1]
        value = raw
        if ai in ("01", "02", "03") and value.isdigit() and len(value) in (8, 12, 13):
            value = value.zfill(14)
        element, ok = _element(ai, value, today, raw=raw)
        if not ok:
            return None
        elements.append(element)
    for key, raw in parse_qsl(parts.query, keep_blank_values=False):
        ai = key if key.isdigit() and key in AI_TABLE else _DL_SHORT_NAMES.get(key)
        if ai is None:
            continue  # non-AI parameters such as linkType are ignored
        element, ok = _element(ai, raw, today)
        if not ok:
            return None
        elements.append(element)
    return _result(elements)


def is_gs1_digital_link(url: str) -> bool:
    """Return ``True`` when ``url`` is a GS1 Digital Link URI with a valid primary key."""
    try:
        return _parse_digital_link(url.strip(), _dt.date.today()) is not None
    except Exception:
        return False


def parse_gs1(data: Any, *, today: Optional[_dt.date] = None) -> Optional[Dict[str, Any]]:
    """Parse GS1 element strings or a GS1 Digital Link URL.

    Args:
        data: HRI text, raw text with GS separators (optionally prefixed with a
            symbology identifier such as ``]C1``), or a Digital Link URL.
        today: Reference date for the two-digit-year century window (default: today).

    Returns:
        ``{"elements": [{"ai", "title", "value", "date"?, "number"?, "raw"?}], "values": {ai: value}}``
        or ``None`` when the input is not GS1 data.

    Example:
        >>> result = parse_gs1("(01)09501101530003(17)250101(10)ABC123")
        >>> result["values"]
        {'01': '09501101530003', '17': '250101', '10': 'ABC123'}
        >>> result["elements"][1]["date"]
        '2025-01-01'
    """
    try:
        if not isinstance(data, str):
            if isinstance(data, (bytes, bytearray)):
                data = bytes(data).decode("latin-1")
            else:
                return None
        today = today or _dt.date.today()
        text = data.strip(" \t\r\n")
        if not text:
            return None
        if re.match(r"^https?://", text, re.IGNORECASE):
            return _parse_digital_link(text, today)
        if _SYMBOLOGY_ID.match(text):
            text = text[3:]
        text = text.replace("<GS>", GS).replace("\\x1d", GS)
        text = text.lstrip(GS).rstrip(GS)
        if not text:
            return None
        if text.startswith("("):
            return _parse_hri(text, today)
        return _parse_raw(text, today)
    except Exception:  # the parsers never raise
        return None


def format_hri(result: Dict[str, Any]) -> str:
    """Render a :func:`parse_gs1` result as HRI text: ``(01)...(10)...``."""
    return "".join("(%s)%s" % (e["ai"], e["value"]) for e in result.get("elements", []))


def to_element_string(result: Dict[str, Any]) -> str:
    """Render a :func:`parse_gs1` result as a raw element string with GS separators.

    A separator is written after every variable-length field except the last.
    """
    out = []
    elements = result.get("elements", [])
    for index, element in enumerate(elements):
        out.append(element["ai"] + element["value"])
        defn = AI_TABLE.get(element["ai"])
        if index < len(elements) - 1 and (defn is None or defn.fixed_length is None):
            out.append(GS)
    return "".join(out)
