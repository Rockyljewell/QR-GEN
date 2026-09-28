# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Classify and parse decoded barcode text (SPEC section 3.1).

:func:`parse_content` recognises URLs, GS1 Digital Link, e-mail, phone, SMS, Wi-Fi,
geo locations, contacts (vCard, MECARD), calendar events, payments (EPC/SEPA,
bitcoin, ethereum, UPI), product codes (GTIN), GS1 element strings, AAMVA driver
licenses and plain text. It never raises.
"""

from __future__ import annotations

import datetime as _dt
import quopri
import re
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlsplit

from .aamva import parse_aamva
from .gs1 import GS, parse_gs1

__all__ = ["parse_content", "gtin_checksum_valid", "expand_upce", "CONTENT_TYPES"]

#: Every ``type`` value :func:`parse_content` can return.
CONTENT_TYPES = (
    "url",
    "gs1-digital-link",
    "email",
    "phone",
    "sms",
    "wifi",
    "geo",
    "contact",
    "event",
    "payment",
    "product",
    "gs1",
    "aamva",
    "text",
)


# ----------------------------------------------------------------------------- helpers


def _prune(result: Dict[str, Any]) -> Dict[str, Any]:
    """Drop optional keys whose value is ``None`` or an empty string."""
    return {k: v for k, v in result.items() if v is not None and v != ""}


def _split_escaped(text: str, sep: str = ";") -> List[str]:
    """Split on ``sep`` honouring backslash escapes (``\\;``, ``\\,``, ``\\:``, ``\\\\``)."""
    parts: List[str] = []
    current: List[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text):
            current.append(text[index + 1])
            index += 2
            continue
        if char == sep:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
        index += 1
    parts.append("".join(current))
    return parts


def _key_values(body: str) -> List[tuple]:
    """Parse ``K:V;K:V;;`` (Wi-Fi, MECARD, MATMSG) into ``[(KEY, value)]``."""
    pairs = []
    for part in _split_escaped(body, ";"):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        pairs.append((key.strip().upper(), value))
    return pairs


def _unquote_wifi(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return value[1:-1]
    return value


def gtin_checksum_valid(digits: str) -> bool:
    """Return ``True`` when the last digit is a valid GS1 mod-10 check digit."""
    if not digits.isdigit() or len(digits) < 2:
        return False
    body, check = digits[:-1], int(digits[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def expand_upce(upce: str) -> Optional[str]:
    """Expand an 8 digit UPC-E code to its 12 digit UPC-A equivalent.

    >>> expand_upce("01234565")
    '012345000065'
    """
    if not (upce.isdigit() and len(upce) == 8 and upce[0] in "01"):
        return None
    ns, d, check = upce[0], upce[1:7], upce[7]
    last = d[5]
    if last in "012":
        body = d[0:2] + last + "0000" + d[2:5]
    elif last == "3":
        body = d[0:3] + "00000" + d[3:5]
    elif last == "4":
        body = d[0:4] + "00000" + d[4]
    else:
        body = d[0:5] + "0000" + last
    return ns + body + check


def _ical_datetime(value: str) -> str:
    value = value.strip()
    match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?", value)
    if not match:
        return value
    year, month, day, hour, minute, second, zulu = match.groups()
    if hour is None:
        return "%s-%s-%s" % (year, month, day)
    return "%s-%s-%sT%s:%s:%s%s" % (year, month, day, hour, minute, second or "00", zulu or "")


def _vcard_unescape(value: str) -> str:
    return re.sub(r"\\([nN,;:\\])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def _content_lines(text: str) -> List[tuple]:
    """Unfold vCard/iCalendar lines and return ``[(NAME, {params}, value)]``."""
    raw_lines = re.split(r"\r\n|\r|\n", text)
    lines: List[str] = []
    for line in raw_lines:
        if line[:1] in (" ", "\t") and lines:
            lines[-1] += line[1:]
        elif lines and lines[-1].endswith("=") and "QUOTED-PRINTABLE" in lines[-1].upper():
            lines[-1] = lines[-1][:-1] + line  # quoted-printable soft line break
        else:
            lines.append(line)
    result = []
    for line in lines:
        if ":" not in line:
            continue
        head, value = line.split(":", 1)
        pieces = head.split(";")
        name = pieces[0].strip().upper()
        if "." in name:
            name = name.split(".", 1)[1]  # item1.EMAIL -> EMAIL
        params: Dict[str, str] = {}
        for piece in pieces[1:]:
            if "=" in piece:
                key, val = piece.split("=", 1)
                params[key.strip().upper()] = val.strip()
            else:
                params.setdefault("TYPE", piece.strip())
        if params.get("ENCODING", "").upper() in ("QUOTED-PRINTABLE", "QP"):
            charset = params.get("CHARSET", "utf-8")
            try:
                value = quopri.decodestring(value.encode("latin-1")).decode(charset, "replace")
            except (LookupError, UnicodeEncodeError):
                pass
        result.append((name, params, value))
    return result


def _query(query: str) -> Dict[str, str]:
    parsed = parse_qs(query, keep_blank_values=False)
    return {k.lower(): v[0] for k, v in parsed.items() if v}


# ----------------------------------------------------------------------------- types


def _wifi(text: str) -> Dict[str, Any]:
    fields = {k: v for k, v in reversed(_key_values(text[5:]))}
    ssid = _unquote_wifi(fields.get("S", ""))
    password = _unquote_wifi(fields.get("P", ""))
    security = fields.get("T", "").strip()
    if security.upper() in ("NOPASS", "NONE", "OPEN") or (not security and not password):
        security = "nopass"
    elif not security:
        security = "WPA"
    else:
        security = security.upper()
    hidden = fields.get("H", "").strip().lower() in ("true", "1", "yes")
    return {"type": "wifi", "ssid": ssid, **({"password": password} if password else {}), "security": security, "hidden": hidden}


def _email(to: str, subject: Optional[str] = None, body: Optional[str] = None) -> Dict[str, Any]:
    result: Dict[str, Any] = {"type": "email", "to": to.strip()}
    if subject:
        result["subject"] = subject
    if body:
        result["body"] = body
    return result


def _email_mailto(text: str) -> Dict[str, Any]:
    address, _, query = text[7:].partition("?")
    params = _query(query)
    return _email(unquote(address), params.get("subject"), params.get("body"))


def _email_matmsg(text: str) -> Dict[str, Any]:
    fields = dict(reversed(_key_values(text[7:])))
    return _email(fields.get("TO", ""), fields.get("SUB"), fields.get("BODY"))


def _email_smtp(text: str) -> Dict[str, Any]:
    parts = text[5:].split(":", 2)
    parts += [""] * (3 - len(parts))
    return _email(parts[0], parts[1], parts[2])


def _sms_result(number: str, body: Optional[str]) -> Dict[str, Any]:
    result: Dict[str, Any] = {"type": "sms", "number": number.strip()}
    if body:
        result["body"] = body
    return result


def _sms(text: str) -> Dict[str, Any]:
    lower = text.lower()
    if lower.startswith(("smsto:", "mmsto:")):
        number, _, body = text[6:].partition(":")
        return _sms_result(number, body)
    rest = text.split(":", 1)[1]
    target, _, query = rest.partition("?")
    target = target.split(";", 1)[0]
    params = _query(query)
    return _sms_result(unquote(target), params.get("body"))


def _phone(text: str) -> Dict[str, Any]:
    number = text.split(":", 1)[1].split(";", 1)[0]
    return {"type": "phone", "number": unquote(number).strip()}


def _geo(text: str) -> Optional[Dict[str, Any]]:
    rest = text[4:]
    coords, _, query = rest.partition("?")
    coords = coords.split(";", 1)[0]
    parts = coords.split(",")
    if len(parts) < 2:
        return None
    try:
        lat, lon = float(parts[0]), float(parts[1])
        alt = float(parts[2]) if len(parts) > 2 and parts[2].strip() else None
    except ValueError:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    params = _query(query)
    return _prune({"type": "geo", "latitude": lat, "longitude": lon, "altitude": alt, "query": params.get("q")})


def _vcard(text: str) -> Dict[str, Any]:
    name = organization = title = address = note = None
    structured_name = None
    phones: List[str] = []
    emails: List[str] = []
    urls: List[str] = []
    for key, _params, value in _content_lines(text):
        if key == "FN":
            name = _vcard_unescape(value).strip() or name
        elif key == "N":
            parts = [_vcard_unescape(p).strip() for p in _split_semicolons(value)]
            parts += [""] * (5 - len(parts))
            last, first, middle, prefix, suffix = parts[:5]
            structured_name = " ".join(p for p in (prefix, first, middle, last, suffix) if p)
        elif key == "ORG":
            organization = " ".join(p for p in (_vcard_unescape(x).strip() for x in _split_semicolons(value)) if p)
        elif key == "TITLE":
            title = _vcard_unescape(value).strip()
        elif key == "TEL":
            phone = value.strip()
            if phone.lower().startswith("tel:"):
                phone = phone[4:]
            if phone:
                phones.append(phone)
        elif key == "EMAIL":
            if value.strip():
                emails.append(value.strip())
        elif key == "URL":
            if value.strip():
                urls.append(_vcard_unescape(value).strip())
        elif key == "ADR" and address is None:
            parts = [_vcard_unescape(p).strip() for p in _split_semicolons(value)]
            address = ", ".join(p for p in parts if p) or None
        elif key == "NOTE":
            note = _vcard_unescape(value).strip()
    return _prune(
        {
            "type": "contact",
            "name": name or structured_name,
            "organization": organization,
            "title": title,
            "phones": phones,
            "emails": emails,
            "urls": urls,
            "address": address,
            "note": note,
            "format": "vcard",
        }
    )


def _split_semicolons(value: str) -> List[str]:
    return re.split(r"(?<!\\);", value)


def _mecard(text: str) -> Dict[str, Any]:
    name = organization = title = address = note = None
    phones: List[str] = []
    emails: List[str] = []
    urls: List[str] = []
    for key, value in _key_values(text[7:]):
        value = value.strip()
        if not value:
            continue
        if key == "N":
            if "," in value:
                last, first = [p.strip() for p in value.split(",", 1)]
                name = " ".join(p for p in (first, last) if p)
            else:
                name = value
        elif key == "TEL" or key == "TEL-AV":
            phones.append(value)
        elif key == "EMAIL":
            emails.append(value)
        elif key == "URL":
            urls.append(value)
        elif key == "ADR":
            address = address or value
        elif key == "NOTE" or key == "MEMO":
            note = value
        elif key == "ORG":
            organization = value
        elif key == "TITLE":
            title = value
    return _prune(
        {
            "type": "contact",
            "name": name,
            "organization": organization,
            "title": title,
            "phones": phones,
            "emails": emails,
            "urls": urls,
            "address": address,
            "note": note,
            "format": "mecard",
        }
    )


def _event(text: str) -> Dict[str, Any]:
    fields: Dict[str, str] = {}
    in_event = "BEGIN:VEVENT" not in text.upper()
    for key, _params, value in _content_lines(text):
        if key == "BEGIN" and value.strip().upper() == "VEVENT":
            in_event = True
            continue
        if key == "END" and value.strip().upper() == "VEVENT":
            break
        if in_event and key not in fields:
            fields[key] = value
    return _prune(
        {
            "type": "event",
            "summary": _vcard_unescape(fields.get("SUMMARY", "")).strip(),
            "start": _ical_datetime(fields["DTSTART"]) if fields.get("DTSTART") else None,
            "end": _ical_datetime(fields["DTEND"]) if fields.get("DTEND") else None,
            "location": _vcard_unescape(fields.get("LOCATION", "")).strip(),
            "description": _vcard_unescape(fields.get("DESCRIPTION", "")).strip(),
        }
    )


def _epc(text: str) -> Optional[Dict[str, Any]]:
    lines = [line.strip() for line in re.split(r"\r\n|\n|\r", text)]
    if len(lines) < 7 or lines[0] != "BCD":
        return None
    lines += [""] * (12 - len(lines))
    bic, name, iban, amount_field = lines[4], lines[5], lines[6].replace(" ", ""), lines[7]
    currency = amount = None
    match = re.fullmatch(r"([A-Z]{3})?(\d+(?:\.\d{1,2})?)", amount_field)
    if match:
        currency = match.group(1) or "EUR"
        amount = match.group(2)
    reference = lines[9] or lines[10]
    return _prune(
        {
            "type": "payment",
            "scheme": "epc",
            "name": name,
            "iban": iban,
            "bic": bic,
            "amount": amount,
            "currency": currency or "EUR",
            "reference": reference,
        }
    )


def _bitcoin(text: str) -> Dict[str, Any]:
    rest = text.split(":", 1)[1].lstrip("/")
    address, _, query = rest.partition("?")
    params = _query(query)
    return _prune(
        {
            "type": "payment",
            "scheme": "bitcoin",
            "address": address,
            "name": params.get("label"),
            "amount": params.get("amount"),
            "currency": "BTC",
            "reference": params.get("message"),
        }
    )


def _ethereum(text: str) -> Dict[str, Any]:
    rest = text.split(":", 1)[1]
    if rest.lower().startswith("pay-"):
        rest = rest[4:]
    target, _, query = rest.partition("?")
    address = re.split(r"[@/]", target, maxsplit=1)[0]
    params = _query(query)
    if "/transfer" in target and params.get("address"):
        # ERC-20 transfer: the recipient is the "address" parameter.
        address = params["address"]
        amount = params.get("uint256")
    else:
        amount = params.get("value") or params.get("amount")
    return _prune({"type": "payment", "scheme": "ethereum", "address": address, "amount": amount, "currency": "ETH"})


def _upi(text: str) -> Dict[str, Any]:
    params = _query(urlsplit(text).query)
    return _prune(
        {
            "type": "payment",
            "scheme": "upi",
            "address": params.get("pa"),
            "name": params.get("pn"),
            "amount": params.get("am"),
            "currency": params.get("cu") or "INR",
            "reference": params.get("tr") or params.get("tn"),
        }
    )


def _payto(text: str) -> Dict[str, Any]:
    parts = urlsplit(text)
    segments = [unquote(s) for s in parts.path.split("/") if s]
    params = _query(parts.query)
    iban = bic = address = None
    if parts.netloc.lower() == "iban":
        if len(segments) >= 2:
            bic, iban = segments[0], segments[1]
        elif segments:
            iban = segments[0]
    else:
        address = "/".join(segments) or None
    currency = amount = None
    if params.get("amount") and ":" in params["amount"]:
        currency, amount = params["amount"].split(":", 1)
    return _prune(
        {
            "type": "payment",
            "scheme": "other",
            "address": address,
            "name": params.get("receiver-name"),
            "iban": iban,
            "bic": bic,
            "amount": amount,
            "currency": currency,
            "reference": params.get("message"),
        }
    )


def _crypto_other(text: str) -> Dict[str, Any]:
    scheme, rest = text.split(":", 1)
    address, _, query = rest.lstrip("/").partition("?")
    params = _query(query)
    return _prune(
        {
            "type": "payment",
            "scheme": "other",
            "address": address,
            "name": params.get("label"),
            "amount": params.get("amount"),
            "currency": {"litecoin": "LTC", "bitcoincash": "BCH", "dogecoin": "DOGE", "monero": "XMR", "dash": "DASH"}.get(
                scheme.lower()
            ),
            "reference": params.get("message") or params.get("tx_description"),
        }
    )


def _product(digits: str, symbology: Optional[str]) -> Optional[Dict[str, Any]]:
    length = len(digits)
    if length == 8:
        if symbology == "upce" or (
            symbology != "ean8" and not gtin_checksum_valid(digits) and expand_upce(digits) is not None
        ):
            upca = expand_upce(digits)
            if upca is not None:
                return {"type": "product", "gtin": upca.zfill(14), "kind": "upce", "checksumValid": gtin_checksum_valid(upca)}
        return {"type": "product", "gtin": digits.zfill(14), "kind": "ean8", "checksumValid": gtin_checksum_valid(digits)}
    if length == 12:
        return {"type": "product", "gtin": digits.zfill(14), "kind": "upca", "checksumValid": gtin_checksum_valid(digits)}
    if length == 13:
        kind = "isbn" if digits[:3] in ("978", "979") else "ean13"
        if symbology == "upca" and digits.startswith("0"):
            kind = "upca"
        return {"type": "product", "gtin": digits.zfill(14), "kind": kind, "checksumValid": gtin_checksum_valid(digits)}
    if length == 14:
        return {"type": "product", "gtin": digits, "kind": "gtin14", "checksumValid": gtin_checksum_valid(digits)}
    return None


_URL = re.compile(r"^[a-z][a-z0-9+.\-]*://\S+$", re.IGNORECASE)
_EMAIL = re.compile(r"^[^@\s:;,/]+@[^@\s:;,/]+\.[a-z]{2,}$", re.IGNORECASE)
_GS1_PREFIX = re.compile(r"^\](C1|e0|e1|e2|d2|Q3|J1)")
_GS1_SYMBOLOGIES = {"databar", "databar-expanded", "databar-limited"}
_PRODUCT_SYMBOLOGIES = {"ean13", "ean8", "upca", "upce", "isbn", "itf14"}
_CRYPTO = ("litecoin:", "bitcoincash:", "dogecoin:", "monero:", "dash:", "zcash:", "lightning:")


# ----------------------------------------------------------------------------- entry point


def parse_content(
    data: Any,
    *,
    symbology: Optional[str] = None,
    today: Optional[_dt.date] = None,
) -> Dict[str, Any]:
    """Classify decoded barcode text and extract its fields.

    Args:
        data: The decoded text (``Barcode.data``).
        symbology: Optional id of the symbology that produced ``data``; it helps to
            tell product codes and GS1 content apart (for example 8 digit UPC-E).
        today: Reference date for GS1 century and AAMVA age calculations.

    Returns:
        A dict whose ``type`` is one of :data:`CONTENT_TYPES` plus the fields listed in
        SPEC section 3.1 (camelCase). Unrecognised input returns
        ``{"type": "text", "text": data}``.

    Example:
        >>> parse_content("WIFI:T:WPA;S:Home;P:secret;;")
        {'type': 'wifi', 'ssid': 'Home', 'password': 'secret', 'security': 'WPA', 'hidden': False}
    """
    try:
        result = _classify(data, symbology, today)
    except Exception:  # the parsers never raise
        result = None
    if result is None:
        text = data if isinstance(data, str) else ("" if data is None else str(data))
        return {"type": "text", "text": text}
    return result


def _classify(data: Any, symbology: Optional[str], today: Optional[_dt.date]) -> Optional[Dict[str, Any]]:
    if isinstance(data, (bytes, bytearray)):
        data = bytes(data).decode("utf-8", "replace")
    if not isinstance(data, str):
        return None
    text = data.strip()
    if not text:
        return None
    lower = text.lower()
    upper_head = text[:16].upper()

    if text.startswith("@") or "ANSI " in text[:40] or "AAMVA" in text[:40]:
        aamva = parse_aamva(data, today=today)
        if aamva is not None:
            return {"type": "aamva", "aamva": aamva}

    if upper_head.startswith("WIFI:"):
        return _wifi(text)
    if lower.startswith("mailto:"):
        return _email_mailto(text)
    if upper_head.startswith("MATMSG:"):
        return _email_matmsg(text)
    if upper_head.startswith("SMTP:"):
        return _email_smtp(text)
    if lower.startswith("tel:"):
        return _phone(text)
    if lower.startswith(("sms:", "smsto:", "mms:", "mmsto:")):
        return _sms(text)
    if lower.startswith("geo:"):
        geo = _geo(text)
        if geo is not None:
            return geo
    if upper_head.startswith("BEGIN:VCARD"):
        return _vcard(text)
    if upper_head.startswith("MECARD:"):
        return _mecard(text)
    if upper_head.startswith(("BEGIN:VCALENDAR", "BEGIN:VEVENT")):
        return _event(text)
    if text.startswith("BCD") and "\n" in text:
        epc = _epc(text)
        if epc is not None:
            return epc
    if lower.startswith("bitcoin:"):
        return _bitcoin(text)
    if lower.startswith("ethereum:"):
        return _ethereum(text)
    if lower.startswith("upi://pay"):
        return _upi(text)
    if lower.startswith("payto://"):
        return _payto(text)
    if lower.startswith(_CRYPTO):
        return _crypto_other(text)
    if upper_head.startswith("MEBKM:"):
        fields = dict(reversed(_key_values(text[6:])))
        if fields.get("URL"):
            return {"type": "url", "url": fields["URL"].strip()}
    if upper_head.startswith("URLTO:"):
        return {"type": "url", "url": text[6:].strip()}

    if _URL.match(text):
        if lower.startswith(("http://", "https://")):
            gs1 = parse_gs1(text, today=today)
            if gs1 is not None:
                return {"type": "gs1-digital-link", "url": text, "gs1": gs1}
        return {"type": "url", "url": text}

    looks_gs1 = (
        _GS1_PREFIX.match(text) is not None
        or GS in data
        or text.startswith("(")
        or (symbology in _GS1_SYMBOLOGIES)
    )
    if looks_gs1:
        gs1 = parse_gs1(data, today=today)
        if gs1 is not None:
            return {"type": "gs1", "gs1": gs1}

    if text.isdigit() and (len(text) in (8, 12, 13, 14) or symbology in _PRODUCT_SYMBOLOGIES):
        product = _product(text, symbology)
        if product is not None:
            return product

    if _EMAIL.match(text):
        return {"type": "email", "to": text}
    return None
