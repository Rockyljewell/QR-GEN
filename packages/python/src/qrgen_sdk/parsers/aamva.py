# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""AAMVA driver license / ID card parser (SPEC section 3.3).

Parses the PDF417 on the back of North American driver licenses and ID cards
(AAMVA DL/ID Card Design Standard, versions 1 to 10). The parser never raises and
returns ``None`` when the input is not AAMVA data.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Any, Dict, List, Optional, Tuple

__all__ = ["parse_aamva", "is_aamva", "AAMVA_FIELD_NAMES"]

#: Titles for the most common data element ids (for display purposes).
AAMVA_FIELD_NAMES: Dict[str, str] = {
    "DAA": "Full name (legacy)",
    "DAB": "Family name (legacy)",
    "DAC": "First name",
    "DAD": "Middle name",
    "DAE": "Name suffix (legacy)",
    "DAG": "Street address 1",
    "DAH": "Street address 2",
    "DAI": "City",
    "DAJ": "Jurisdiction code",
    "DAK": "Postal code",
    "DAQ": "Customer ID number",
    "DAR": "License classification (legacy)",
    "DAS": "Restrictions (legacy)",
    "DAT": "Endorsements (legacy)",
    "DAU": "Height",
    "DAW": "Weight (pounds)",
    "DAX": "Weight (kilograms)",
    "DAY": "Eye color",
    "DAZ": "Hair color",
    "DBA": "Expiration date",
    "DBB": "Date of birth",
    "DBC": "Sex",
    "DBD": "Issue date",
    "DBN": "Alias family name",
    "DBG": "Alias given name",
    "DBS": "Alias suffix",
    "DCA": "Vehicle class",
    "DCB": "Restrictions",
    "DCD": "Endorsements",
    "DCF": "Document discriminator",
    "DCG": "Country",
    "DCK": "Inventory control number",
    "DCS": "Family name",
    "DCT": "Given names (legacy)",
    "DCU": "Name suffix",
    "DDA": "Compliance type",
    "DDB": "Card revision date",
    "DDD": "Limited duration document",
    "DDE": "Family name truncation",
    "DDF": "First name truncation",
    "DDG": "Middle name truncation",
    "DDH": "Under 18 until",
    "DDI": "Under 19 until",
    "DDJ": "Under 21 until",
    "DDK": "Organ donor",
    "DDL": "Veteran",
}

_HEADER = re.compile(r"(ANSI |AAMVA)\s?(\d{6})(\d{2})")
_SUBFILE = re.compile(r"^([A-Z]{2})(\d{4})(\d{4})$")
_FIELD = re.compile(r"^([A-Z][A-Z0-9]{2})(.*)$", re.DOTALL)


def _find_header(text: str) -> Optional[re.Match]:
    match = _HEADER.search(text[:64])
    return match or _HEADER.search(text)


def _parse_designators(text: str, pos: int, version: int) -> Tuple[Optional[int], List[Tuple[str, int, int]], int]:
    """Return ``(jurisdiction_version, designators, body_start)``."""
    jurisdiction_version: Optional[int] = None
    if version >= 2 and text[pos : pos + 2].isdigit():
        jurisdiction_version = int(text[pos : pos + 2])
        pos += 2
    designators: List[Tuple[str, int, int]] = []
    count_text = text[pos : pos + 2]
    if count_text.isdigit():
        count = int(count_text)
        cursor = pos + 2
        for _ in range(count):
            match = _SUBFILE.match(text[cursor : cursor + 10])
            if not match:
                break
            designators.append((match.group(1), int(match.group(2)), int(match.group(3))))
            cursor += 10
        if len(designators) == count and count > 0:
            return jurisdiction_version, designators, cursor
    return jurisdiction_version, designators, pos


def _parse_fields(body: str, types: List[str]) -> Tuple[Dict[str, str], str]:
    """Split subfile data into ``{element id: value}``; also return the first DL/ID type seen."""
    fields: Dict[str, str] = {}
    document_type = ""
    for line in re.split(r"[\n\r\x1e]+", body):
        line = line.strip("\x00")
        if not line:
            continue
        # A subfile starts with its two-letter type ("DL", "ID", "ZC"...) directly
        # followed by its first element.
        if len(line) >= 5 and line[:2] in types:
            rest = line[2:]
            kind = line[:2]
            if (kind in ("DL", "ID") and rest[:1] == "D") or (kind[0] == "Z" and rest[:2] == kind):
                if kind in ("DL", "ID") and not document_type:
                    document_type = kind
                line = rest
        match = _FIELD.match(line)
        if not match:
            continue
        code, value = match.group(1), match.group(2).rstrip()
        if code[0] not in "DZ":
            continue
        fields.setdefault(code, value)
    return fields, document_type


def _valid(year: int, month: int, day: int) -> Optional[_dt.date]:
    try:
        return _dt.date(year, month, day)
    except ValueError:
        return None


def _parse_date(value: str, canada: Optional[bool]) -> Optional[_dt.date]:
    digits = re.sub(r"\D", "", value or "")[:8]
    if len(digits) != 8:
        return None
    us = _valid(int(digits[4:8]), int(digits[0:2]), int(digits[2:4]))  # MMDDCCYY
    ca = _valid(int(digits[0:4]), int(digits[4:6]), int(digits[6:8]))  # CCYYMMDD
    if canada is True:
        return ca or us
    if canada is False:
        return us or ca
    if us and not ca:
        return us
    if ca and not us:
        return ca
    if us and ca:
        return ca if 1900 <= ca.year <= 2100 else us
    return None


def _age(dob: _dt.date, today: _dt.date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _postal(value: str, canada: bool) -> str:
    value = value.strip()
    if not canada and re.fullmatch(r"\d{9}", value):
        return value[:5] if value[5:] == "0000" else "%s-%s" % (value[:5], value[5:])
    if not canada and re.fullmatch(r"\d{5}-?0000", value):
        return value[:5]
    return value.replace("  ", " ").strip()


def _sex(value: str) -> str:
    value = (value or "").strip().upper()
    return {"1": "M", "2": "F", "9": "X", "M": "M", "F": "F", "X": "X"}.get(value, "")


def _split_legacy_name(value: str) -> Tuple[str, str, str, str]:
    """Split DAA (``LAST,FIRST,MIDDLE[,SUFFIX]``) into first, middle, last, suffix."""
    value = value.strip()
    if "," in value or "$" in value:
        parts = [p.strip() for p in re.split(r"[,$]", value)]
        parts += [""] * (4 - len(parts))
        return parts[1], " ".join(p for p in parts[2:3] if p), parts[0], parts[3]
    tokens = value.split()
    if len(tokens) >= 2:
        return tokens[0], " ".join(tokens[1:-1]), tokens[-1], ""
    return value, "", "", ""


def is_aamva(data: Any) -> bool:
    """Return ``True`` when ``data`` looks like an AAMVA DL/ID payload."""
    return parse_aamva(data) is not None


def parse_aamva(data: Any, *, today: Optional[_dt.date] = None) -> Optional[Dict[str, Any]]:
    """Parse an AAMVA driver license or ID card barcode.

    Args:
        data: The decoded PDF417 text.
        today: Reference date for ``age``, ``isExpired`` and ``isUnder21`` (default: today).

    Returns:
        A dict with the SPEC keys (``issuerId``, ``aamvaVersion``, ``jurisdictionVersion``,
        ``documentType``, ``firstName``, ``middleName``, ``lastName``, ``suffix``,
        ``fullName``, ``dateOfBirth``, ``issueDate``, ``expiryDate``, ``sex``,
        ``documentNumber``, ``street``, ``city``, ``state``, ``postalCode``, ``country``,
        ``eyeColor``, ``height``, ``age``, ``isExpired``, ``isUnder21``, ``fields``), or
        ``None``. Dates are ISO ``YYYY-MM-DD`` strings (``""`` when missing); ``age``,
        ``isExpired`` and ``isUnder21`` are ``None`` when the needed date is missing.
    """
    try:
        return _parse(data, today or _dt.date.today())
    except Exception:  # the parsers never raise
        return None


def _parse(data: Any, today: _dt.date) -> Optional[Dict[str, Any]]:
    if isinstance(data, (bytes, bytearray)):
        data = bytes(data).decode("latin-1")
    if not isinstance(data, str) or len(data) < 10:
        return None
    text = data
    header = _find_header(text)
    issuer_id = ""
    version = 0
    jurisdiction_version = 0
    types: List[str] = ["DL", "ID"]
    designator_types: List[str] = []
    if header:
        issuer_id = header.group(2)
        version = int(header.group(3))
        jv, designators, body_start = _parse_designators(text, header.end(), version)
        jurisdiction_version = jv or 0
        for kind, _, _ in designators:
            designator_types.append(kind)
            if kind not in types:
                types.append(kind)
        body = text[body_start:]
    else:
        if not text.lstrip().startswith("@"):
            return None
        match = re.search(r"(DL|ID)(?=DA[A-Z])", text)
        if not match:
            return None
        body = text[match.start() :]
    # Some issuers omit designators for their jurisdiction subfile; recognise any
    # line that starts with a Z-subfile type followed by one of its elements.
    for match in re.finditer(r"(?:^|[\n\r])(Z[A-Z])(?=Z[A-Z])", body):
        if match.group(1) not in types:
            types.append(match.group(1))

    fields, document_type = _parse_fields(body, types)
    if not any(code in fields for code in ("DAQ", "DCS", "DAC", "DAA", "DAB", "DBB")):
        return None
    if not document_type:
        document_type = next((t for t in designator_types if t in ("DL", "ID")), "DL")

    get = lambda code: fields.get(code, "").strip()  # noqa: E731

    country = get("DCG").upper()
    if country not in ("USA", "CAN"):
        country = "CAN" if issuer_id in _CANADIAN_IINS else ("USA" if issuer_id else "")
    canada: Optional[bool] = {"CAN": True, "USA": False}.get(country)
    if version == 1:
        canada = None  # AAMVA 2000 used CCYYMMDD everywhere; rely on plausibility

    first, middle, last, suffix = get("DAC"), get("DAD"), get("DCS") or get("DAB"), get("DCU") or get("DAE")
    if not first and get("DCT"):
        given = [p for p in re.split(r"[,$ ]+", get("DCT")) if p]
        first = given[0] if given else ""
        middle = middle or " ".join(given[1:])
    if get("DAA") and not (first and last):
        f, m, l, s = _split_legacy_name(get("DAA"))
        first, middle, last, suffix = first or f, middle or m, last or l, suffix or s
    full_name = " ".join(p for p in (first, middle, last, suffix) if p)

    dob = _parse_date(get("DBB"), canada)
    issued = _parse_date(get("DBD"), canada)
    expiry = _parse_date(get("DBA"), canada)
    age = _age(dob, today) if dob else None

    street = get("DAG")
    if get("DAH"):
        street = ("%s, %s" % (street, get("DAH"))).strip(", ")

    return {
        "issuerId": issuer_id,
        "aamvaVersion": version,
        "jurisdictionVersion": jurisdiction_version,
        "documentType": document_type,
        "firstName": first,
        "middleName": middle,
        "lastName": last,
        "suffix": suffix,
        "fullName": full_name,
        "dateOfBirth": dob.isoformat() if dob else "",
        "issueDate": issued.isoformat() if issued else "",
        "expiryDate": expiry.isoformat() if expiry else "",
        "sex": _sex(get("DBC")),
        "documentNumber": get("DAQ"),
        "street": street,
        "city": get("DAI"),
        "state": get("DAJ"),
        "postalCode": _postal(get("DAK"), country == "CAN"),
        "country": country,
        "eyeColor": get("DAY"),
        "height": get("DAU"),
        "age": age,
        "isExpired": (expiry < today) if expiry else None,
        "isUnder21": (age < 21) if age is not None else None,
        "fields": dict(fields),
    }


# Issuer identification numbers of Canadian jurisdictions (used when DCG is missing).
_CANADIAN_IINS = {
    "604426",  # Prince Edward Island
    "604428",  # Quebec
    "604429",  # Yukon
    "604432",  # Alberta
    "604433",  # Nunavut
    "604434",  # Northwest Territories
    "636012",  # Ontario
    "636013",  # Nova Scotia
    "636016",  # Newfoundland and Labrador
    "636017",  # New Brunswick
    "636028",  # British Columbia
    "636044",  # Saskatchewan
    "636048",  # Manitoba
}
