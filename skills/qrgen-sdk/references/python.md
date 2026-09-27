# Python / Linux / Raspberry Pi: qrgen-sdk

Decode images and webcams, generate SVG/PNG, parse GS1/AAMVA/QR payloads, and run the REST API.
Built on zxing-cpp. Python 3.9+ (wheels for 3.10+ on Linux x86-64/aarch64, macOS, Windows).

## Install

```bash
pip install "git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python"
pip install "qrgen-sdk[camera] @ git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python"  # + OpenCV webcams
# once published: pip install qrgen-sdk / "qrgen-sdk[camera]"
```

## Use

```python
import qrgen_sdk

for code in qrgen_sdk.scan("label.jpg", symbologies=["qr", "retail", "code128"]):
    print(code.symbology, code.data)   # e.g. "code128", "(01)09501101530003(10)ABC"
    print(code.to_dict())               # SPEC JSON (camelCase)
    print(qrgen_sdk.parse_content(code.data))

svg = qrgen_sdk.generate("https://example.com")                        # str
png = qrgen_sdk.generate("5901234123457", symbology="ean13", format="png", hrt=True)  # bytes
qrgen_sdk.save("(01)09501101530003(10)ABC", "label.png", symbology="code128", gs1=True)
```

`scan()` accepts a path, bytes, a file object, a PIL image or a numpy/OpenCV array.

## Webcam (OpenCV)

```python
from qrgen_sdk.camera import Camera, scan_camera

scan_camera(on_scan=lambda codes: print([c.data for c in codes]))   # preview window + highlights

with Camera(device=0, symbologies=["qr", "ean13"], mode="continuous", duplicate_filter=1000) as cam:
    for frame, result in cam.frames():
        for code in result.new:            # passed the duplicate filter
            print(code.symbology, code.data)
```

`device` can be an index, `"/dev/video2"`, an RTSP/HTTP URL, a GStreamer pipeline or `"picamera2"`.
`mode="batch"` fills `result.tracked`. `Camera.process(frame)` works on any BGR/grayscale numpy frame.

## CLI and REST

```bash
qrgen-py scan label.jpg --json
qrgen-py generate "hello" -o hello.svg
qrgen-py camera --mode batch --symbologies retail
qrgen-py serve --host 0.0.0.0 --port 8080   # same REST API as the Docker image (binds 127.0.0.1 by default)
```

Linux notes: add the user to the `video` group for `/dev/video*`, use `v4l2-ctl --list-devices` to find
cameras, and use `opencv-python-headless` on servers without a display.
