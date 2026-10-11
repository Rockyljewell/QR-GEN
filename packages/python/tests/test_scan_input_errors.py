# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Image input failures obey ScanError and release only SDK-owned resources."""

import http.client
import io
import json
import struct
import warnings
import zlib

import numpy as np
import pytest
from PIL import Image

from qrgen_sdk import ScanError, generate, scan
from qrgen_sdk.server import start_in_thread


def oversized_png_header():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    ihdr = struct.pack(">IIBBBBB", 200000, 1000, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b"")


@pytest.mark.parametrize("kind", ["bytes", "bytearray", "memoryview", "path", "file"])
def test_oversized_image_is_a_scan_error(kind, tmp_path):
    data = oversized_png_header()
    if kind in ("path", "file"):
        path = tmp_path / "oversized.png"
        path.write_bytes(data)
        if kind == "path":
            with pytest.raises(ScanError):
                scan(path)
        else:
            with path.open("rb") as source:
                with pytest.raises(ScanError):
                    scan(source)
                assert not source.closed
        return
    source = {"bytes": bytes, "bytearray": bytearray, "memoryview": memoryview}[kind](data)
    with pytest.raises(ScanError):
        scan(source)


def test_pillow_bomb_warning_as_error_is_normalized(monkeypatch):
    output = io.BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="PNG")
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 200)
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with pytest.raises(ScanError):
            scan(output.getvalue())


def test_open_time_error_does_not_keep_owned_file_open(tmp_path):
    path = tmp_path / "oversized.png"
    path.write_bytes(oversized_png_header())
    with pytest.raises(ScanError) as retained_error:
        scan(path)
    assert retained_error.value.__cause__ is not None
    path.rename(path.with_suffix(".moved"))


@pytest.mark.parametrize("size", [(0, 32), (32, 0)])
def test_empty_pil_image_is_a_scan_error(size):
    image = Image.new("RGB", size)
    with pytest.raises(ScanError):
        scan(image)


@pytest.mark.parametrize("shape", [(0, 32), (32, 0), (0, 32, 3), (32, 0, 3), (32, 32, 0), (32, 32, 2), (32, 32, 5)])
def test_invalid_array_shape_is_a_scan_error(shape):
    with pytest.raises(ScanError):
        scan(np.zeros(shape, dtype=np.uint8))


def test_unconvertible_array_is_a_scan_error():
    with pytest.raises(ScanError):
        scan(np.full((4, 4), "invalid", dtype=object))


def test_unreadable_binary_reader_is_a_scan_error():
    class BrokenReader:
        def read(self):
            raise OSError("read failed")
    with pytest.raises(ScanError):
        scan(BrokenReader())


def test_closed_pil_image_is_a_scan_error():
    image = Image.new("RGB", (32, 32))
    image.close()
    with pytest.raises(ScanError):
        scan(image)


@pytest.mark.parametrize("fmt", ["BMP", "GIF", "TIFF"])
def test_retained_error_does_not_keep_owned_file_open(fmt, tmp_path, monkeypatch):
    data = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(data, format=fmt)
    path = tmp_path / ("truncated." + fmt.lower())
    path.write_bytes(data.getvalue()[:len(data.getvalue()) // 2])
    opened = []
    original_open = Image.open
    def observed_open(*args, **kwargs):
        image = original_open(*args, **kwargs)
        opened.append(image)
        return image
    monkeypatch.setattr(Image, "open", observed_open)
    try:
        with pytest.raises(ScanError) as retained_error:
            scan(path)
        # Retain the exception and its traceback during cleanup. On Windows,
        # an unclosed handle prevents rename; the explicit check also covers POSIX.
        assert retained_error.value.__cause__ is not None
        assert opened
        assert all(image.fp is None or image.fp.closed for image in opened)
        path.rename(path.with_suffix(".moved"))
    finally:
        for image in opened:
            image.close()


def test_caller_owned_pil_remains_usable():
    data = generate("PIL-OWNERSHIP", format="png")
    with Image.open(io.BytesIO(data)) as image:
        assert [code.data for code in scan(image)] == ["PIL-OWNERSHIP"]
        assert image.getpixel((0, 0)) is not None


@pytest.mark.parametrize("kind", ["path", "bytes", "pil"])
def test_broken_exif_keeps_loaded_pixels_usable(kind, tmp_path):
    data = generate("BROKEN-EXIF-FALLBACK", format="png")
    # A valid PNG containing an invalid TIFF header in its EXIF chunk. Loading
    # pixels works, but Pillow's EXIF transpose raises SyntaxError.
    exif = b"broken!"
    chunk = struct.pack(">I", len(exif)) + b"eXIf" + exif + struct.pack(">I", zlib.crc32(b"eXIf" + exif))
    data = data[:33] + chunk + data[33:]
    if kind == "path":
        path = tmp_path / "broken-exif.png"
        path.write_bytes(data)
        assert [code.data for code in scan(path)] == ["BROKEN-EXIF-FALLBACK"]
    elif kind == "bytes":
        assert [code.data for code in scan(data)] == ["BROKEN-EXIF-FALLBACK"]
    else:
        with Image.open(io.BytesIO(data)) as image:
            assert [code.data for code in scan(image)] == ["BROKEN-EXIF-FALLBACK"]
            assert image.getpixel((0, 0)) is not None


def test_caller_owned_reader_remains_open():
    with io.BytesIO(generate("READER-OWNERSHIP", format="png")) as source:
        assert [code.data for code in scan(source)] == ["READER-OWNERSHIP"]
        assert not source.closed
        source.seek(0)
        assert source.read(8) == b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize("mode", ["L", "RGB", "RGBA"])
def test_blank_images_return_no_codes(mode):
    assert scan(Image.new(mode, (32, 32), "white")) == []


def test_missing_file_keeps_file_not_found_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        scan(tmp_path / "missing.png")


def test_oversized_rest_input_is_bad_request():
    server, thread = start_in_thread(port=0, quiet=True)
    conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    try:
        conn.request("POST", "/v1/scan", body=oversized_png_header(), headers={"Content-Type": "image/png"})
        response = conn.getresponse()
        payload = json.loads(response.read())
        assert response.status == 400
        assert payload["error"]["code"] == "bad-request"
    finally:
        conn.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
