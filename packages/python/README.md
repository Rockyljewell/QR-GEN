# qrgen-sdk (Python)

Open-source (MIT) barcode, QR code and ID scanning for Python. Decode 26 symbologies
from images and webcams, generate SVG/PNG barcodes, parse GS1, AAMVA driver licenses
and QR payloads (Wi-Fi, vCard, payments…), and run a REST API with the standard
library only.

It is the Python member of the [QRGen](https://github.com/Rockyljewell/QR-GEN) family.
Symbology ids, the result JSON, parsers and the REST API follow the shared
[specification](https://github.com/Rockyljewell/QR-GEN/blob/main/docs/SPEC.md), so
results are interchangeable with the JavaScript, iOS, Android, Flutter, React Native
and .NET packages. Decoding and encoding use [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp).

## Install

```bash
pip install qrgen-sdk                 # scan, generate, parse, REST server
pip install "qrgen-sdk[camera]"       # + webcam / Raspberry Pi camera (OpenCV, numpy)
```

Until the package is published on PyPI, install it from GitHub:

```bash
pip install "git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python"
pip install "qrgen-sdk[camera] @ git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python"
```

Requirements: Python 3.9+, `zxing-cpp>=3.1` and Pillow (installed automatically).
zxing-cpp 3.1 ships wheels for Python 3.10+ on Linux x86-64/aarch64 (glibc 2.28+), macOS and
Windows; on Python 3.9 or other platforms pip builds it from source, which needs CMake and a
C++17 compiler.

## Quick start

```python
import qrgen_sdk

# Generate
svg = qrgen_sdk.generate("https://example.com")                      # SVG string
png = qrgen_sdk.generate("https://example.com", format="png", scale=8)  # PNG bytes
qrgen_sdk.save("(01)09501101530003(17)250101(10)ABC123", "label.png",
               symbology="code128", gs1=True, hrt=True)

# Scan: a path, bytes, a file object, a PIL image or a numpy (OpenCV) array
for code in qrgen_sdk.scan("label.png", symbologies=["qr", "retail", "code128"]):
    print(code.symbology, code.data)          # code128 (01)09501101530003(17)250101(10)ABC123
    print(code.to_dict())                      # SPEC section 2 JSON (camelCase)
    print(qrgen_sdk.parse_content(code.data))  # {"type": "gs1", "gs1": {...}}
```

### Scanning options

```python
qrgen_sdk.scan(image, symbologies=None, try_harder=True, max_results=None) -> list[Barcode]
qrgen_sdk.scan_file(path, **same_options)
```

* `symbologies`: ids, aliases or groups (`"qr"`, `"QRCode"`, `"ean-13"`, `"retail"`,
  `"2d"`, `"qr,ean13"`...). `None` means `all`.
* `try_harder`: also search rotated, downscaled and inverted variants and retry with a
  second binarizer. Use `False` for speed.
* GS1 data comes back in HRI form (`"(01)...(10)..."`) with `is_gs1=True`.
* UPC-A is reported as 12 digits and UPC-E as 8 digits; books report as `ean13` unless
  you ask only for `isbn`.

`Barcode` fields: `data`, `symbology`, `symbology_name`, `raw_bytes`, `content_type`,
`is_gs1`, `location` (`Quad` of `Point`s), `frame_size`, `orientation`, `ec_level`,
`symbology_identifier`, `timestamp`. `Barcode.to_dict()` returns the camelCase JSON
shape shared by every QRGen platform; `Barcode.from_dict()` reads it back.

### Generating options

```python
qrgen_sdk.generate(data, symbology="qr", format="svg", scale=4, ec_level=None,
                   gs1=False, hrt=False, margin=True, foreground=None, background=None)
qrgen_sdk.save(data, "out.svg", **options)   # format from the extension
```

* Writable: qr, micro-qr, rmqr, data-matrix, aztec, pdf417, micro-pdf417, maxicode,
  ean13, ean8, upca, upce, isbn, code128, code39, code93, codabar, itf, itf14, databar,
  databar-expanded, databar-limited, code32, pzn, telepen, dx-film-edge.
* `format`: `svg` (returns `str`) or `png` (returns `bytes`); `jpeg`, `webp`, `bmp`,
  `gif` and `tiff` work too.
* `ec_level`: `L`/`M`/`Q`/`H` for QR codes; `0`-`8` or a percentage for PDF417/Aztec.
* `foreground`/`background`: `#rrggbb`, `#rrggbbaa` or `"transparent"`.
* `data` may be `bytes` for binary 2D codes.

Invalid input raises `qrgen_sdk.GenerateError` (a `ValueError`).

## Parsers

Pure Python, never raise, and return dicts with the SPEC's camelCase keys so
`json.dumps()` matches the other platforms.

```python
from qrgen_sdk import parse_content, parse_gs1, parse_aamva

parse_content("WIFI:T:WPA;S:Home;P:secret;;")
# {'type': 'wifi', 'ssid': 'Home', 'password': 'secret', 'security': 'WPA', 'hidden': False}

parse_gs1("(01)09501101530003(17)250101(10)ABC123")["values"]
# {'01': '09501101530003', '17': '250101', '10': 'ABC123'}

parse_gs1("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101")   # Digital Link
parse_gs1("]C1" "0109501101530003" "10ABC123\x1d" "3103000195")           # raw + GS
# element 3103 -> {"ai": "3103", "title": "NET WEIGHT (kg)", "value": "000195", "number": 0.195}

license = parse_aamva(pdf417_text)          # North American DL/ID cards
license["fullName"], license["dateOfBirth"], license["age"], license["isUnder21"]
```

* `parse_content` types: `url`, `gs1-digital-link`, `email` (mailto:, MATMSG, SMTP),
  `phone`, `sms`, `wifi` (with backslash escapes), `geo`, `contact` (vCard, MECARD),
  `event` (VEVENT), `payment` (EPC/SEPA `BCD`, `bitcoin:`, `ethereum:`, `upi://pay`,
  `payto://` and other coins as `other`), `product` (GTIN with check digit), `gs1`,
  `aamva` and `text`. Pass `symbology=` as a hint (for example to read 8 digits as UPC-E).
* `parse_gs1` knows 750+ AIs (counting decimal variants) (00-03, 10-17, 20-22, 235, 240-243, 250-255, 30, 310n-369n,
  37, 390n-395n, 400-403, 410-417, 420-427, 4300-4333, 7001-7259, 8001-8200, 90-99)
  with fixed/variable lengths, dates as ISO `date` (day `00` = last day of the month)
  and decimal AIs as `number`.
* `parse_aamva(data, today=date(...))` handles AAMVA versions 1-10, legacy `DAA`/`DCT`
  names, US (`MMDDCCYY`) vs Canadian (`CCYYMMDD`) dates, ZIP+4, and computes `age`,
  `isExpired` and `isUnder21` against an injectable `today`.

## Command line

The console script is `qrgen-py` (so it does not clash with the Node `qrgen` CLI);
`qrgen-sdk` and `python -m qrgen_sdk` are aliases.

```bash
qrgen-py scan photo.jpg shelf.png --symbologies qr,ean13      # "symbology<TAB>data"
qrgen-py scan photo.jpg --json --parse                         # SPEC JSON + parsed content
qrgen-py generate "https://example.com" -o qr.svg
qrgen-py generate "(01)09501101530003(10)ABC" --symbology code128 --gs1 --hrt -o label.png
qrgen-py generate "hello" --format png --scale 8 > hello.png
qrgen-py parse "WIFI:T:WPA;S:Home;P:secret;;"
qrgen-py parse --unescape '@\n\x1e\rANSI 636014100002DL...'   # AAMVA with escapes
qrgen-py camera --mode batch --symbologies retail
qrgen-py serve --port 8080
qrgen-py symbologies
```

Exit codes: `0` success, `1` nothing found / not parseable, `2` error.

## Webcam scanning

```python
from qrgen_sdk.camera import Camera, scan_camera

# One-liner: preview window, highlight quads, prints every new code
scan_camera(on_scan=lambda codes: print([c.data for c in codes]))

# Full control
with Camera(device=0, symbologies=["qr", "ean13"], mode="continuous",
            duplicate_filter=1000, width=1280, height=720) as cam:
    for frame, result in cam.frames():
        for code in result.new:           # passed the duplicate filter
            print(code.symbology, code.data)
```

* `mode`: `single` (stop after the first scan), `continuous`, or `batch` (tracks many
  codes with stable ids; `result.tracked` holds `TrackedBarcode`s with `id`,
  `first_seen`, `last_seen`, `count`, dropped after 500 ms unseen).
* `duplicate_filter`: ms before the same symbology+data is reported again; `0` reports
  every frame, `-1` once per session.
* `scan_area=(x, y, w, h)` (0..1) restricts decoding to a region of interest.
* `Camera.process(frame)` works on any BGR/grayscale numpy frame, so you can plug in
  picamera2, GStreamer, RTSP streams or video files. `DuplicateFilter` and
  `BatchTracker` (in `qrgen_sdk.tracking`) are plain Python classes with an injectable
  clock.
* The `camera` extra installs `opencv-python-headless`, which has no GUI. For a preview
  window install `opencv-python` instead; without GUI support scanning continues and a
  warning is printed. Press `q` or Esc to quit the window.

## REST server

A dependency-free implementation of SPEC section 6 (`http.server.ThreadingHTTPServer`,
CORS enabled, JSON errors).

```bash
qrgen-py serve --port 8080                 # localhost only
qrgen-py serve --host 0.0.0.0 --port 8080  # reachable from other machines
```

```bash
curl -s localhost:8080/health
curl -s -X POST --data-binary @photo.png -H "Content-Type: image/png" "localhost:8080/v1/scan?symbologies=qr,ean13"
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"image":"data:image/png;base64,iVBOR...","symbologies":["qr"],"tryHarder":true}' localhost:8080/v1/scan
curl -s "localhost:8080/v1/generate?data=hello&format=png&scale=8" -o hello.png
curl -s -X POST -H "Content-Type: application/json" -d '{"data":"hello","symbology":"qr","format":"svg"}' localhost:8080/v1/generate
curl -s -X POST -H "Content-Type: application/json" -d '{"data":"WIFI:T:WPA;S:Home;P:x;;"}' localhost:8080/v1/parse
```

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{"ok": true, "version": "1.0.0"}` |
| GET | `/v1/symbologies` | `{"read": [...], "write": [...]}` |
| POST | `/v1/scan` | raw image bytes or JSON `{image, symbologies, tryHarder, maxResults}`; `?symbologies=` |
| GET/POST | `/v1/generate` | `data, symbology, format, scale, ecLevel, gs1, hrt, margin, foreground, background` |
| POST | `/v1/parse` | JSON `{data}` (or a text body); `type: "gs1"/"aamva"` runs a specific parser |

Errors look like `{"error": {"code": "bad-request", "message": "..."}}`. Embed it with
`qrgen_sdk.server.create_server(host, port)` or `start_in_thread()`. The server has no
authentication; put it behind a reverse proxy before exposing it publicly.

## Linux and Raspberry Pi

* **Wheels:** zxing-cpp publishes manylinux wheels (glibc 2.28+) for x86-64 and aarch64 on
  Python 3.10+, so `pip install qrgen-sdk` works on 64-bit Raspberry Pi OS (Bookworm) and
  Ubuntu without a compiler. On 32-bit (armv7) systems or Python 3.9, pip builds zxing-cpp from
  source: `sudo apt install cmake g++ python3-dev` first (it takes a while on a Pi), or use a
  64-bit OS.
* **Virtual environments:** Raspberry Pi OS and recent Debian/Ubuntu block system-wide
  pip installs. Use `python3 -m venv ~/qrgen && ~/qrgen/bin/pip install "qrgen-sdk[camera]"`.
  To reuse the distro's OpenCV and picamera2, create the venv with
  `--system-site-packages` and `sudo apt install python3-opencv python3-picamera2`.
* **USB webcams** use V4L2: `qrgen-py camera --device 0` (or `/dev/video0`). Add your
  user to the `video` group if you get `camera-in-use`/permission errors
  (`sudo usermod -aG video $USER`, then log in again). `v4l2-ctl --list-devices` lists cameras.
* **Raspberry Pi Camera Module** (libcamera): run `qrgen-py camera --device picamera2`
  (uses picamera2), or wrap OpenCV with `libcamerify qrgen-py camera`.
* **Headless / SSH:** use `--no-window` (or `show_window=False`) and `--json` to stream
  results; `qrgen-py camera --no-window --json | jq .data`.
* **Performance:** on a Pi 4/5 use 640x480 or 1280x720 capture (`--width 1280 --height 720`),
  narrow `--symbologies`, and set a `--scan-area`. Camera frames use a fast decoder
  configuration by default (`try_harder=False`).
* **Run as a service:** `qrgen-py serve --host 0.0.0.0` under systemd gives every device
  on the network a barcode API.

## Status

Version 1.0.0.

* Tested (pytest, 220 tests, Linux x86-64, Python 3.11, zxing-cpp 3.1.1): symbology
  ids/aliases/groups and zxing-cpp mapping; generate -> scan round trips through real
  PNGs for 26 symbologies (including GS1 Code 128, QR and Data Matrix); the SPEC GS1 and
  AAMVA vectors plus many parser cases; duplicate filter and batch tracker; camera
  frame processing on synthetic frames and a generated video file; the REST server on
  an ephemeral port; the CLI.
* Not tested here: physical webcams, Raspberry Pi hardware and picamera2, the OpenCV
  preview window, Python versions other than 3.11 (3.9+ is supported by design),
  Windows and macOS.
* Not yet on PyPI; install from GitHub as shown above.

## License

MIT. See [LICENSE](LICENSE).
