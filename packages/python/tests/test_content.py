# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json

import pytest

from qrgen_sdk import parse_content
from qrgen_sdk.parsers.content import CONTENT_TYPES, expand_upce, gtin_checksum_valid


def test_url():
    assert parse_content("https://example.com/path?q=1") == {"type": "url", "url": "https://example.com/path?q=1"}
    assert parse_content("HTTP://EXAMPLE.COM")["type"] == "url"
    assert parse_content("URLTO:https://example.com") == {"type": "url", "url": "https://example.com"}
    assert parse_content("MEBKM:TITLE:Example;URL:https\\://example.com;;") == {"type": "url", "url": "https://example.com"}


def test_gs1_digital_link(gs1_vector):
    result = parse_content("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101")
    assert result["type"] == "gs1-digital-link"
    assert result["url"].startswith("https://id.gs1.org/")
    assert result["gs1"]["values"] == {"01": "09501101530003", "10": "ABC123", "17": "250101"}


def test_email_variants():
    assert parse_content("mailto:jane@example.com?subject=Hi%20there&body=Hello") == {
        "type": "email", "to": "jane@example.com", "subject": "Hi there", "body": "Hello",
    }
    assert parse_content(r"MATMSG:TO:jane@example.com;SUB:Hi;BODY:Line\; two;;") == {
        "type": "email", "to": "jane@example.com", "subject": "Hi", "body": "Line; two",
    }
    assert parse_content("SMTP:jane@example.com:Subject:Body") == {
        "type": "email", "to": "jane@example.com", "subject": "Subject", "body": "Body",
    }
    assert parse_content("jane@example.com") == {"type": "email", "to": "jane@example.com"}
    assert parse_content("mailto:jane@example.com") == {"type": "email", "to": "jane@example.com"}


def test_phone_and_sms():
    assert parse_content("tel:+1-555-0100") == {"type": "phone", "number": "+1-555-0100"}
    assert parse_content("TEL:+15550100") == {"type": "phone", "number": "+15550100"}
    assert parse_content("sms:+15550100?body=Hello%20you") == {"type": "sms", "number": "+15550100", "body": "Hello you"}
    assert parse_content("SMSTO:+15550100:Hi there") == {"type": "sms", "number": "+15550100", "body": "Hi there"}
    assert parse_content("sms:+15550100") == {"type": "sms", "number": "+15550100"}


def test_wifi():
    assert parse_content("WIFI:T:WPA;S:Home;P:secret;;") == {
        "type": "wifi", "ssid": "Home", "password": "secret", "security": "WPA", "hidden": False,
    }


def test_wifi_escapes_hidden_and_order():
    result = parse_content(r'WIFI:S:My\;Net\:work\\5G;T:WEP;P:pa\,ss\"w;H:true;;')
    assert result == {"type": "wifi", "ssid": 'My;Net:work\\5G', "password": 'pa,ss"w', "security": "WEP", "hidden": True}


def test_wifi_open_network():
    assert parse_content("WIFI:S:Cafe;T:nopass;;") == {"type": "wifi", "ssid": "Cafe", "security": "nopass", "hidden": False}
    assert parse_content("WIFI:S:Cafe;;") == {"type": "wifi", "ssid": "Cafe", "security": "nopass", "hidden": False}
    assert parse_content('WIFI:S:"quoted";T:SAE;P:x;;')["ssid"] == "quoted"


def test_geo():
    assert parse_content("geo:37.786971,-122.399677") == {"type": "geo", "latitude": 37.786971, "longitude": -122.399677}
    assert parse_content("geo:40.7,-74.0,12.5?q=New%20York") == {
        "type": "geo", "latitude": 40.7, "longitude": -74.0, "altitude": 12.5, "query": "New York",
    }
    assert parse_content("geo:0,0?q=1600+Amphitheatre")["query"] == "1600 Amphitheatre"
    assert parse_content("geo:not,valid")["type"] == "text"


def test_vcard():
    vcard = (
        "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;Q;;\r\nFN:Jane Doe\r\nORG:Example Inc.;R&D\r\nTITLE:Engineer\r\n"
        "TEL;TYPE=CELL:+1 555 0100\r\nTEL;TYPE=WORK:+1 555 0101\r\nEMAIL:jane@example.com\r\n"
        "item1.EMAIL;type=INTERNET:jd@example.org\r\nURL:https://example.com\r\n"
        "ADR;TYPE=WORK:;;123 Main St;Springfield;IL;62701;USA\r\nNOTE:Line one\\nLine two\r\n"
        " continued\r\nEND:VCARD"
    )
    assert parse_content(vcard) == {
        "type": "contact",
        "name": "Jane Doe",
        "organization": "Example Inc. R&D",
        "title": "Engineer",
        "phones": ["+1 555 0100", "+1 555 0101"],
        "emails": ["jane@example.com", "jd@example.org"],
        "urls": ["https://example.com"],
        "address": "123 Main St, Springfield, IL, 62701, USA",
        "note": "Line one\nLine twocontinued",
        "format": "vcard",
    }


def test_vcard_structured_name_only_and_quoted_printable():
    vcard = "BEGIN:VCARD\nVERSION:2.1\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:M=C3=BCller;J=C3=BCrgen\nEND:VCARD"
    result = parse_content(vcard)
    assert result["name"] == "Jürgen Müller"
    assert result["phones"] == [] and result["emails"] == [] and result["urls"] == []


def test_mecard():
    assert parse_content("MECARD:N:Doe,Jane;TEL:+15550100;EMAIL:jane@example.com;URL:https\\://example.com;ADR:1 Main St;NOTE:Hi;ORG:ACME;;") == {
        "type": "contact",
        "name": "Jane Doe",
        "organization": "ACME",
        "phones": ["+15550100"],
        "emails": ["jane@example.com"],
        "urls": ["https://example.com"],
        "address": "1 Main St",
        "note": "Hi",
        "format": "mecard",
    }


def test_event():
    event = (
        "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Launch party\nDTSTART:20250101T190000Z\n"
        "DTEND;TZID=Europe/Berlin:20250101T230000\nLOCATION:Berlin\\, Germany\nDESCRIPTION:Bring friends\nEND:VEVENT\nEND:VCALENDAR"
    )
    assert parse_content(event) == {
        "type": "event",
        "summary": "Launch party",
        "start": "2025-01-01T19:00:00Z",
        "end": "2025-01-01T23:00:00",
        "location": "Berlin, Germany",
        "description": "Bring friends",
    }
    assert parse_content("BEGIN:VEVENT\nSUMMARY:All day\nDTSTART;VALUE=DATE:20250704\nEND:VEVENT")["start"] == "2025-07-04"


def test_epc_payment():
    epc = "BCD\n002\n1\nSCT\nBFSWDE33BER\nWikimedia Foerdergesellschaft\nDE33 1002 0500 0001 1947 00\nEUR123.45\n\n\nDonation\n"
    assert parse_content(epc) == {
        "type": "payment",
        "scheme": "epc",
        "name": "Wikimedia Foerdergesellschaft",
        "iban": "DE33100205000001194700",
        "bic": "BFSWDE33BER",
        "amount": "123.45",
        "currency": "EUR",
        "reference": "Donation",
    }


def test_crypto_and_upi_payments():
    assert parse_content("bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01&label=Shop&message=Order%2042") == {
        "type": "payment", "scheme": "bitcoin", "address": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
        "name": "Shop", "amount": "0.01", "currency": "BTC", "reference": "Order 42",
    }
    assert parse_content("ethereum:0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359@1?value=2.014e18") == {
        "type": "payment", "scheme": "ethereum", "address": "0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359",
        "amount": "2.014e18", "currency": "ETH",
    }
    assert parse_content("upi://pay?pa=shop@okbank&pn=Corner%20Shop&am=150.00&cu=INR&tn=Tea") == {
        "type": "payment", "scheme": "upi", "address": "shop@okbank", "name": "Corner Shop",
        "amount": "150.00", "currency": "INR", "reference": "Tea",
    }
    assert parse_content("litecoin:LQ3B36Yv2rBTxdgAdYpU2UcEZsaNwXeATk?amount=1")["scheme"] == "other"
    payto = parse_content("payto://iban/DE75512108001245126199?amount=EUR:10.50&receiver-name=Jane")
    assert payto["iban"] == "DE75512108001245126199" and payto["amount"] == "10.50" and payto["currency"] == "EUR"


@pytest.mark.parametrize(
    "data,kind,gtin,valid",
    [
        ("9501101530003", "ean13", "09501101530003", True),
        ("9501101530004", "ean13", "09501101530004", False),
        ("96385074", "ean8", "00000096385074", True),
        ("036000291452", "upca", "00036000291452", True),
        ("9780306406157", "isbn", "09780306406157", True),
        ("15400141288763", "gtin14", "15400141288763", True),
        ("04252614", "upce", "00042100005264", True),  # EAN-8 check digit fails, UPC-E passes
        ("01234565", "ean8", "00000001234565", True),  # valid as both; EAN-8 wins without a hint
    ],
)
def test_products(data, kind, gtin, valid):
    assert parse_content(data) == {"type": "product", "gtin": gtin, "kind": kind, "checksumValid": valid}


def test_product_symbology_hint():
    assert parse_content("01234565", symbology="upce") == {
        "type": "product", "gtin": "00012345000065", "kind": "upce", "checksumValid": True,
    }
    assert parse_content("01234565", symbology="ean8")["kind"] == "ean8"


def test_gs1_content(gs1_vector):
    result = parse_content(gs1_vector)
    assert result["type"] == "gs1"
    assert result["gs1"]["values"]["01"] == "09501101530003"
    assert parse_content("]C1010950110153000310ABC")["type"] == "gs1"
    assert parse_content("0109501101530003\x1d10ABC")["type"] == "gs1"


def test_aamva_content(aamva_vector):
    result = parse_content(aamva_vector)
    assert result["type"] == "aamva"
    assert result["aamva"]["lastName"] == "SAMPLE"


@pytest.mark.parametrize("data", ["hello world", "12345", "(555) 123-4567", "", "WIFI", "@home"])
def test_text_fallback(data):
    assert parse_content(data) == {"type": "text", "text": data}


def test_never_raises_and_types_are_known():
    for data in [None, 42, b"https://example.com", "BCD\n", "geo:", "sms:", "mailto:", "BEGIN:VCARD", "MECARD:", "upi://pay"]:
        result = parse_content(data)
        assert result["type"] in CONTENT_TYPES
        json.dumps(result)
    assert parse_content(b"https://example.com")["type"] == "url"


def test_checksum_helpers():
    assert gtin_checksum_valid("09501101530003")
    assert not gtin_checksum_valid("09501101530004")
    assert expand_upce("01234565") == "012345000065"
    assert expand_upce("04252614") == "042100005264"
    assert expand_upce("12345678")[0] == "1"
    assert expand_upce("21234565") is None
