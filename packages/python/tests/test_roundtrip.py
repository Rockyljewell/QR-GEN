"""generate() -> scan() round trips through real PNG/SVG images."""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

import qrgen_sdk
from qrgen_sdk import GenerateError, generate, save, scan, scan_file

CASES = [
    ("qr", "https://example.com/QRGen?x=1", {}),
    ("micro-qr", "12345", {}),
    ("data-matrix", "Data Matrix 123", {}),
    ("aztec", "Aztec payload", {}),
    ("pdf417", "PDF417 payload 0123456789", {}),
    ("ean13", "9501101530003", {}),
    ("ean8", "96385074", {}),
    ("upca", "036000291452", {}),
    ("code128", "QRGEN-128", {}),
    ("code128", "(01)09501101530003(17)250101(10)ABC123", {"gs1": True}),
    ("code39", "QRGEN39", {}),
    ("itf", "12345678", {}),
    # Beyond the required set:
    ("rmqr", "RMQR", {}),
    ("micro-pdf417", "micro", {}),
    ("maxicode", "MaxiCode text", {}),
    ("upce", "01234565", {}),
    ("isbn", "9780306406157", {}),
    ("code93", "CODE93", {}),
    ("codabar", "A12345B", {}),
    ("itf14", "15400141288763", {}),
    ("databar", "(01)09501101530003", {}),
    ("databar-expanded", "(01)09501101530003(10)ABC", {}),
    ("databar-limited", "(01)09501101530003", {}),
    ("telepen", "TELEPEN", {}),
    ("qr", "(01)09501101530003(10)ABC", {"gs1": True}),
    ("data-matrix", "(01)09501101530003(10)ABC", {"gs1": True}),
]


@pytest.mark.parametrize("symbology,data,options", CASES, ids=[f"{c[0]}-{i}" for i, c in enumerate(CASES)])
def test_png_round_trip(symbology, data, options):
    png = generate(data, symbology=symbology, format="png", scale=3, **options)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    found = scan(png, symbologies=[symbology])
    assert len(found) == 1, found
    code = found[0]
    expected = data
    if symbology in ("databar", "databar-limited") and not data.startswith("("):
        expected = "(01)" + data
    assert code.data == expected
    assert code.symbology == symbology
    assert code.symbology_name == qrgen_sdk.SYMBOLOGIES[symbology].name
    if options.get("gs1") or symbology.startswith("databar"):
        assert code.is_gs1 and code.content_type == "gs1"
        assert code.parsed()["type"] == "gs1"
    width, height = Image.open(io.BytesIO(png)).size
    assert code.frame_size.width == width and code.frame_size.height == height
    xs = [p.x for p in code.location]
    assert 0 <= min(xs) < max(xs) <= width


def test_scan_all_symbologies_reports_conventional_ids():
    assert [b.symbology for b in scan(generate("036000291452", symbology="upca", format="png"))] == ["upca"]
    # Books are EAN-13 unless only ISBN is requested (matches ML Kit / Vision).
    assert [b.symbology for b in scan(generate("9780306406157", symbology="isbn", format="png"))] == ["ean13"]
    assert [b.symbology for b in scan(generate("15400141288763", symbology="itf14", format="png"))] == ["itf14"]


def test_qr_filter_excludes_micro_qr():
    png = generate("12345", symbology="micro-qr", format="png")
    assert scan(png, symbologies=["qr"]) == []
    assert [b.symbology for b in scan(png, symbologies=["qr", "micro-qr"])] == ["micro-qr"]


def test_symbology_filter_excludes_other_codes():
    png = generate("hello", format="png")
    assert scan(png, symbologies=["retail"]) == []


def test_input_types(tmp_path):
    png = generate("input types", format="png", scale=4)
    path = tmp_path / "code.png"
    path.write_bytes(png)
    pil = Image.open(io.BytesIO(png))
    for image in (str(path), path, png, bytearray(png), io.BytesIO(png), pil, pil.convert("RGB"), pil.convert("RGBA"), pil.convert("P")):
        assert [b.data for b in scan(image)] == ["input types"], type(image)
    assert [b.data for b in scan_file(path)] == ["input types"]


def test_numpy_input():
    np = pytest.importorskip("numpy")
    png = generate("numpy", format="png", scale=4)
    gray = np.array(Image.open(io.BytesIO(png)).convert("L"))
    bgr = np.stack([gray] * 3, axis=-1)
    bgra = np.concatenate([bgr, np.full(gray.shape + (1,), 255, dtype=np.uint8)], axis=-1)
    for image in (gray, bgr, bgra):
        assert [b.data for b in scan(image)] == ["numpy"]


def test_multiple_codes_and_max_results():
    a = Image.open(io.BytesIO(generate("first", format="png", scale=4))).convert("L")
    b = Image.open(io.BytesIO(generate("second", format="png", scale=4))).convert("L")
    canvas = Image.new("L", (a.width + b.width + 40, max(a.height, b.height) + 20), 255)
    canvas.paste(a, (10, 10))
    canvas.paste(b, (a.width + 30, 10))
    assert sorted(x.data for x in scan(canvas)) == ["first", "second"]
    assert len(scan(canvas, max_results=1)) == 1


def test_rotated_and_inverted():
    png = generate("rotate me", format="png", scale=4)
    rotated = Image.open(io.BytesIO(png)).rotate(90, expand=True)
    assert [b.data for b in scan(rotated)] == ["rotate me"]
    inverted = generate("inverted", format="png", foreground="#ffffff", background="#000000")
    assert [b.data for b in scan(inverted)] == ["inverted"]


def test_barcode_json_shape():
    code = scan(generate("json", format="png"))[0]
    payload = code.to_dict()
    assert list(payload) == [
        "data", "symbology", "symbologyName", "rawBytes", "contentType", "isGS1", "location",
        "frameSize", "orientation", "ecLevel", "symbologyIdentifier", "timestamp",
    ]
    assert base64.b64decode(payload["rawBytes"]) == b"json"
    assert set(payload["location"]) == {"topLeft", "topRight", "bottomRight", "bottomLeft"}
    assert payload["symbologyIdentifier"] == "]Q1"
    assert payload["ecLevel"] in ("L", "M", "Q", "H")
    assert payload["timestamp"] > 1_700_000_000_000
    assert code.to_dict(include_parsed=True)["parsed"] == {"type": "text", "text": "json"}


def test_svg_output_and_options():
    svg = generate("svg", scale=2)
    assert "<svg" in svg and 'fill="#000000"' in svg
    colored = generate("svg", foreground="#ff0000", background="#00000000")
    assert 'fill="#FF0000"' in colored and 'fill-opacity="0.0"' in colored
    no_margin = generate("x", format="png", margin=False)
    with_margin = generate("x", format="png")
    assert Image.open(io.BytesIO(no_margin)).width < Image.open(io.BytesIO(with_margin)).width
    hrt = generate("96385074", symbology="ean8", hrt=True)
    assert "<text" in hrt
    assert scan(generate("ec", format="png", ec_level="H"))[0].ec_level == "H"
    assert generate("jpeg", format="jpg")[:2] == b"\xff\xd8"


def test_binary_data():
    payload = bytes(range(0, 40))
    code = scan(generate(payload, format="png"))[0]
    assert code.raw_bytes == payload
    assert code.content_type == "binary"


def test_save_picks_format(tmp_path):
    svg_path = save("saved", tmp_path / "a.svg")
    png_path = save("saved", tmp_path / "a.png", scale=3)
    assert open(svg_path, encoding="utf-8").read().lstrip().startswith("<?xml")
    assert scan_file(png_path)[0].data == "saved"
    with pytest.raises(GenerateError):
        save("x", tmp_path / "a.unknown")


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(data="12345678901234", symbology="ean13"),  # too long
        dict(data="ABC", symbology="ean8"),
        dict(data="x", format="pdf"),
        dict(data="x", scale=0),
        dict(data="", symbology="qr"),
        dict(data="x", foreground="red-ish"),
    ],
)
def test_generate_errors(kwargs):
    with pytest.raises(GenerateError):
        generate(**kwargs)


def test_unknown_symbology():
    with pytest.raises(qrgen_sdk.UnknownSymbologyError):
        generate("x", symbology="nope")
    with pytest.raises(qrgen_sdk.UnknownSymbologyError):
        scan(generate("x", format="png"), symbologies=["nope"])


def test_bad_image_input():
    with pytest.raises(qrgen_sdk.ScanError):
        scan(b"not an image")
    with pytest.raises(qrgen_sdk.ScanError):
        scan(12345)
    with pytest.raises(FileNotFoundError):
        scan("/definitely/not/here.png")
