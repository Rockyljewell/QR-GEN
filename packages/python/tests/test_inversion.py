# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0
import io
import pytest
import zxingcpp
from PIL import Image, ImageOps
from qrgen_sdk import generate, scan
from qrgen_sdk import scanner as scanner_module
from qrgen_sdk.scanner import decode
from qrgen_sdk.symbologies import WRITABLE_SYMBOLOGIES

CASES = [("pdf417", "PDF417 reversed"), ("ean13", "5901234123457"), ("code128", "REVERSED-128"), ("databar", "(01)09521234543213")]
# zxing-cpp searches both polarities of these itself; every other format relies on
# the explicit inverted pass.
NATIVE_INVERSION = {"qr", "micro-qr", "rmqr", "data-matrix", "aztec"}
EXAMPLES = {
    "pdf417": "PDF417 payload", "micro-pdf417": "micro", "maxicode": "MaxiCode text",
    "ean13": "9501101530003", "ean8": "96385074", "upca": "036000291452", "upce": "01234565",
    "isbn": "9780306406157", "code128": "QRGEN-128", "code39": "QRGEN39", "code93": "CODE93",
    "codabar": "A12345B", "itf": "12345678", "itf14": "15400141288763",
    "databar": "(01)09501101530003", "databar-expanded": "(01)09501101530003(10)ABC",
    "databar-limited": "(01)09501101530003", "telepen": "TELEPEN", "code32": "01234567",
    "pzn": "1234562", "dx-film-edge": "77-4",
}

@pytest.mark.parametrize("symbology,data", CASES)
@pytest.mark.parametrize("rotate", [0, 90, 180, 270])
def test_inverted_formats(symbology, data, rotate):
    image = Image.open(io.BytesIO(generate(data, symbology=symbology, format="png", scale=4, foreground="#ffffff", background="#000000"))).convert("RGB").rotate(rotate, expand=True)
    original = image.tobytes()
    assert [(x.symbology, x.data) for x in scan(image, symbologies=[symbology])] == [(symbology, data)]
    assert image.tobytes() == original

@pytest.mark.parametrize("symbology", [sid for sid in WRITABLE_SYMBOLOGIES if sid not in NATIVE_INVERSION])
def test_inverted_only_image_for_every_explicitly_inverted_format(symbology):
    data = EXAMPLES[symbology]
    expected = [(x.symbology, x.data) for x in scan(generate(data, symbology=symbology, format="png", scale=4), symbologies=[symbology])]
    assert len(expected) == 1
    inverted = generate(data, symbology=symbology, format="png", scale=4, foreground="#ffffff", background="#000000")
    assert [(x.symbology, x.data) for x in scan(inverted, symbologies=[symbology])] == expected


def _pair(left_inverted, right_inverted):
    """Two copies of SAME-128 side by side on grey, each normal or inverted."""
    normal = Image.open(io.BytesIO(generate("SAME-128", symbology="code128", format="png", scale=4))).convert("RGB")
    image = Image.new("RGB", (normal.width * 2 + 80, normal.height + 40), "#888888")
    image.paste(ImageOps.invert(normal) if left_inverted else normal, (20, 20))
    image.paste(ImageOps.invert(normal) if right_inverted else normal, (normal.width + 60, 20))
    return image, normal.width


def test_mixed_polarity_returns_the_normal_code_only():
    # The inverted pass is a fallback for images where the normal pass found nothing.
    image, code_width = _pair(False, True)
    original = image.tobytes()
    found = scan(image, symbologies=["code128"], max_results=2)
    assert [x.data for x in found] == ["SAME-128"]
    assert found[0].location.bounds[0] < code_width
    assert len(decode(image, ["code128"], image.width, image.height, try_invert=False)) == 1
    assert image.tobytes() == original


def test_inverted_only_identical_payloads_and_limits():
    image, code_width = _pair(True, True)
    original = image.tobytes()
    found = scan(image, symbologies=["code128"], max_results=2)
    assert [x.data for x in found] == ["SAME-128", "SAME-128"]
    xs = sorted(x.location.bounds[0] for x in found)
    assert xs[0] < code_width < xs[1]
    assert len(scan(image, symbologies=["code128"], max_results=1)) == 1
    assert decode(image, ["code128"], image.width, image.height, try_invert=False) == []
    assert image.tobytes() == original


def _count_reads(monkeypatch):
    calls = []
    real = zxingcpp.read_barcodes

    def counting(image, **kwargs):
        calls.append(kwargs.get("try_invert"))
        return real(image, **kwargs)

    monkeypatch.setattr(scanner_module.zxingcpp, "read_barcodes", counting)
    return calls


def test_inverted_pass_skipped_when_the_normal_pass_finds_a_code(monkeypatch):
    png = generate("FAST-128", symbology="code128", format="png", scale=4)
    calls = _count_reads(monkeypatch)
    # Defaults: all symbologies, try_harder (two binarizers, inversion on), no limit.
    assert [x.data for x in scan(png)] == ["FAST-128"]
    assert calls == [True]
    calls.clear()
    image = Image.open(io.BytesIO(png))
    assert [x.data for x in decode(image, ["code128", "ean13"], image.width, image.height, max_results=5)] == ["FAST-128"]
    assert calls == [True]


def test_inverted_pass_runs_when_the_normal_pass_finds_nothing(monkeypatch):
    png = generate("SLOW-128", symbology="code128", format="png", scale=4, foreground="#ffffff", background="#000000")
    calls = _count_reads(monkeypatch)
    assert [x.data for x in scan(png, symbologies=["code128"])] == ["SLOW-128"]
    # Both binarizers miss the normal image, then the first one reads the inverted copy.
    assert calls == [True, True, False]

def test_low_level_rgba_inversion_preserves_input():
    image = Image.open(io.BytesIO(generate("RGBA-128", symbology="code128", format="png", scale=4, foreground="#ffffff", background="#000000"))).convert("RGBA")
    original = image.tobytes()
    assert [x.data for x in decode(image, ["code128"], image.width, image.height)] == ["RGBA-128"]
    assert image.tobytes() == original

def test_numpy_inversion_does_not_change_input():
    np = pytest.importorskip("numpy")
    image = Image.open(io.BytesIO(generate("ARRAY-128", symbology="code128", format="png", scale=4, foreground="#ffffff", background="#000000")))
    for mode in ["L", "RGB", "RGBA"]:
        array = np.array(image.convert(mode))
        original = array.copy()
        assert [x.data for x in scan(array, symbologies=["code128"])] == ["ARRAY-128"]
        np.testing.assert_array_equal(array, original)
