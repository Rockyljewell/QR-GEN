# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0
import io
import pytest
from PIL import Image, ImageOps
from qrgen_sdk import generate, scan
from qrgen_sdk.scanner import decode

CASES = [("pdf417", "PDF417 reversed"), ("ean13", "5901234123457"), ("code128", "REVERSED-128"), ("databar", "(01)09521234543213")]

@pytest.mark.parametrize("symbology,data", CASES)
@pytest.mark.parametrize("rotate", [0, 90, 180, 270])
def test_inverted_formats(symbology, data, rotate):
    image = Image.open(io.BytesIO(generate(data, symbology=symbology, format="png", scale=4, foreground="#ffffff", background="#000000"))).convert("RGB").rotate(rotate, expand=True)
    original = image.tobytes()
    assert [(x.symbology, x.data) for x in scan(image, symbologies=[symbology])] == [(symbology, data)]
    assert image.tobytes() == original

def test_mixed_polarity_identical_payloads_and_limits():
    normal = Image.open(io.BytesIO(generate("SAME-128", symbology="code128", format="png", scale=4))).convert("RGB")
    image = Image.new("RGB", (normal.width * 2 + 80, normal.height + 40), "#888888")
    image.paste(normal, (20, 20))
    image.paste(ImageOps.invert(normal), (normal.width + 60, 20))
    original = image.tobytes()
    found = scan(image, symbologies=["code128"], max_results=2)
    assert [x.data for x in found] == ["SAME-128", "SAME-128"]
    assert found[0].location.bounds[0] < normal.width < found[1].location.bounds[0]
    assert len(scan(image, symbologies=["code128"], max_results=1)) == 1
    assert len(decode(image, ["code128"], image.width, image.height, try_invert=False)) == 1
    assert image.tobytes() == original

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
