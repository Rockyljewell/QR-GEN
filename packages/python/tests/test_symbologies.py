from __future__ import annotations

import pytest

import qrgen_sdk
from qrgen_sdk.symbologies import (
    GROUPS,
    SYMBOLOGIES,
    SYMBOLOGY_IDS,
    UnknownSymbologyError,
    id_from_zxing,
    normalize_key,
    resolve_symbology,
    resolve_symbologies,
    symbology_name,
    to_zxing_formats,
)

SPEC_IDS = [
    "qr", "micro-qr", "rmqr", "data-matrix", "aztec", "pdf417", "micro-pdf417", "maxicode",
    "ean13", "ean8", "upca", "upce", "isbn", "code128", "code39", "code93", "codabar", "itf",
    "itf14", "databar", "databar-expanded", "databar-limited", "code32", "pzn", "telepen",
    "dx-film-edge",
]


def test_ids_match_spec_order():
    assert list(SYMBOLOGY_IDS) == SPEC_IDS


@pytest.mark.parametrize("name", ["QRCode", "qr-code", "QR", "qr", "QR Code", " q r "])
def test_qr_aliases(name):
    assert resolve_symbology(name) == "qr"


@pytest.mark.parametrize(
    "alias,expected",
    [
        ("microqrcode", "micro-qr"),
        ("Micro-QR", "micro-qr"),
        ("rMQRCode", "rmqr"),
        ("DataMatrix", "data-matrix"),
        ("DM", "data-matrix"),
        ("AztecCode", "aztec"),
        ("CompactPDF417", "pdf417"),
        ("MicroPDF417", "micro-pdf417"),
        ("MaxiCode", "maxicode"),
        ("EAN", "ean13"),
        ("JAN", "ean13"),
        ("GTIN-13", "ean13"),
        ("EAN-13", "ean13"),
        ("gtin8", "ean8"),
        ("UPC", "upca"),
        ("UPC-A", "upca"),
        ("UPC-E", "upce"),
        ("ISBN-13", "isbn"),
        ("GS1-128", "code128"),
        ("EAN128", "code128"),
        ("Code 3 of 9", "code39"),
        ("NW-7", "codabar"),
        ("Interleaved 2 of 5", "itf"),
        ("I2of5", "itf"),
        ("ITF-14", "itf14"),
        ("RSS14", "databar"),
        ("DataBar Omni", "databar"),
        ("RSS Expanded", "databar-expanded"),
        ("RSS-Limited", "databar-limited"),
        ("Code 32", "code32"),
        ("DX Film Edge", "dx-film-edge"),
    ],
)
def test_aliases(alias, expected):
    assert resolve_symbology(alias) == expected


def test_resolve_mixed_ids_and_groups():
    assert resolve_symbologies(["QRCode", "retail"]) == [
        "qr", "ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited",
    ]


def test_resolve_string_and_dedup():
    assert resolve_symbologies("ean13, qr,QR ean-13") == ["qr", "ean13"]


@pytest.mark.parametrize("empty", [None, [], "", ["all"], "ALL"])
def test_default_is_all(empty):
    assert resolve_symbologies(empty) == SPEC_IDS


def test_groups_match_spec():
    linear = "ean13 ean8 upca upce isbn code128 code39 code93 codabar itf itf14 databar databar-expanded databar-limited code32 pzn telepen dx-film-edge".split()
    matrix = "qr micro-qr rmqr data-matrix aztec pdf417 micro-pdf417 maxicode".split()
    assert resolve_symbologies(["linear"]) == linear
    assert resolve_symbologies(["1D"]) == linear
    assert resolve_symbologies(["matrix"]) == matrix
    assert resolve_symbologies(["2d"]) == matrix
    assert resolve_symbologies(["industrial"]) == ["data-matrix", "code128", "code39", "code93", "codabar", "itf", "itf14"]
    assert set(resolve_symbologies(["gs1"])) == set(GROUPS["gs1"])
    assert set(linear) | set(matrix) == set(SPEC_IDS)


def test_unknown_raises_or_is_ignored():
    with pytest.raises(UnknownSymbologyError):
        resolve_symbologies(["qr", "nope"])
    assert resolve_symbologies(["qr", "nope"], ignore_unknown=True) == ["qr"]
    with pytest.raises(ValueError):
        resolve_symbology("retail")  # groups are not single symbologies


def test_names():
    assert symbology_name("qr") == "QR Code"
    assert symbology_name("itf") == "Interleaved 2 of 5"
    assert SYMBOLOGIES["databar-expanded"].name == "GS1 DataBar Expanded"
    assert normalize_key("Data-Matrix!") == "datamatrix"


def test_qr_does_not_include_micro_qr_formats():
    names = {fmt.name for fmt in to_zxing_formats(["qr"])}
    assert names == {"QRCodeModel1", "QRCodeModel2"}
    assert "MicroQRCode" in {fmt.name for fmt in to_zxing_formats(["micro-qr"])}


def test_reverse_mapping():
    assert id_from_zxing("QRCode", "x", ["qr"]) == "qr"
    assert id_from_zxing("MicroQRCode", "x", ["qr"]) is None
    assert id_from_zxing("EAN13", "0036000291452", ["upca"]) == "upca"
    assert id_from_zxing("EAN13", "0036000291452", ["ean13"]) == "ean13"
    assert id_from_zxing("EAN13", "9780306406157", ["isbn"]) == "isbn"
    assert id_from_zxing("EAN13", "9780306406157", ["isbn", "ean13"]) == "ean13"
    assert id_from_zxing("ITF", "15400141288763", ["itf14"], "]I1") == "itf14"
    assert id_from_zxing("ITF", "12345678", ["itf14"]) is None
    assert id_from_zxing("ITF", "12345678", None) == "itf"
    assert id_from_zxing("Code32", "A123456788", ["code39"]) == "code39"
    assert id_from_zxing("TelepenAlpha", "X", None) == "telepen"
    assert id_from_zxing("DataBarExpStk", "X", None) == "databar-expanded"
    assert id_from_zxing("Unknown", "X", None) is None


def test_supported_symbologies_cover_spec():
    assert qrgen_sdk.supported_symbologies() == SPEC_IDS
    assert qrgen_sdk.supported_symbologies("write") == SPEC_IDS
