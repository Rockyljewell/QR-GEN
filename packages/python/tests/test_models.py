from __future__ import annotations

import json

from qrgen_sdk import Barcode, Point, Quad, Size


def test_barcode_defaults_and_round_trip():
    code = Barcode(
        data="https://example.com",
        symbology="qr",
        raw_bytes=b"https://example.com",
        location=Quad(Point(10, 10), Point(90, 10), Point(90, 90), Point(10, 90)),
        frame_size=Size(1280, 720),
        ec_level="M",
        symbology_identifier="]Q1",
        timestamp=1735689600000,
    )
    assert code.symbology_name == "QR Code"
    payload = code.to_dict()
    assert payload == {
        "data": "https://example.com",
        "symbology": "qr",
        "symbologyName": "QR Code",
        "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
        "contentType": "text",
        "isGS1": False,
        "location": {
            "topLeft": {"x": 10, "y": 10},
            "topRight": {"x": 90, "y": 10},
            "bottomRight": {"x": 90, "y": 90},
            "bottomLeft": {"x": 10, "y": 90},
        },
        "frameSize": {"width": 1280, "height": 720},
        "orientation": 0,
        "ecLevel": "M",
        "symbologyIdentifier": "]Q1",
        "timestamp": 1735689600000,
    }
    again = Barcode.from_dict(json.loads(json.dumps(payload)))
    assert again == code


def test_quad_helpers():
    quad = Quad(Point(0, 0), Point(10, 0), Point(10, 20), Point(0, 20))
    assert quad.center == Point(5, 10)
    assert quad.bounds == (0, 0, 10, 20)
    assert [p.x for p in quad] == [0, 10, 10, 0]
