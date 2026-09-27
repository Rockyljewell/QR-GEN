---
title: "Linux & Raspberry Pi"
description: "Scan barcodes on Linux servers, desktops and Raspberry Pi: the Node CLI, the REST API and Docker, Python with OpenCV webcams, and a Chromium kiosk running the web scanner."
group: "Server & Linux"
order: 5
status: stable
---

QRGen runs on Linux in several ways. Pick the one that matches where your images come from and who looks at the screen.

| Option | Best for | Camera | Guide |
| --- | --- | --- | --- |
| Node CLI (`qrgen`) | Scanning and generating image files, scripts, cron jobs | No | [CLI](../cli/) |
| REST API or Docker | A barcode service for other machines or languages | No | [REST API & Docker](../rest-api/) |
| Python package with OpenCV | Headless scanning from USB webcams and Raspberry Pi camera modules | Yes | [Python](../python/#webcam-scanning) |
| Chromium kiosk with `<qrgen-scanner>` | A touchscreen scanning station with the full scanner UI | Yes | Below |

## Node CLI

Install Node.js 18.17 or later (Raspberry Pi OS Bookworm and current Ubuntu releases ship a recent enough `nodejs` package; otherwise use [NodeSource](https://github.com/nodesource/distributions) or nvm), then:

```bash
npm install -g qrgen-sdk
qrgen scan label.jpg
qrgen generate "https://example.com" -o qr.png
```

> **Note:** Until the first npm release is published, install the latest build with `npm install -g https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

The engine is WebAssembly, so there are no native modules to compile: the same package runs on x86-64, arm64 and 32-bit ARM. Every command and flag is in [CLI](../cli/).

A watch folder that decodes new scans into a JSON Lines file (uses `inotifywait` from `inotify-tools` and `jq`, both external packages):

```bash
inotifywait -m -e close_write --format '%w%f' ~/incoming | while read -r file; do
  qrgen scan "$file" --json | jq -c --arg file "$file" '{file: $file, barcodes: .}' >> ~/results.jsonl
done
```

## REST API and Docker

```bash
docker run -d --name qrgen --restart unless-stopped -p 8080:8080 ghcr.io/rockyljewell/qr-gen:latest
```

Or without Docker, as a systemd service:

```ini
# /etc/systemd/system/qrgen.service
[Unit]
Description=QRGen REST API
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/env qrgen serve --host 127.0.0.1 --port 8080
Restart=on-failure
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now qrgen
curl http://127.0.0.1:8080/health
```

Use `--host 0.0.0.0` to accept connections from other machines, and put a reverse proxy with authentication in front if the network isn't trusted. Endpoints are documented in [REST API & Docker](../rest-api/).

## Python and OpenCV

For headless camera scanning (a Pi on a conveyor, a USB webcam at a door), the Python package reads frames with OpenCV or picamera2 and prints or posts results, with no browser involved. It is documented on its own page: see [webcam scanning](../python/#webcam-scanning) and the [Linux and Raspberry Pi notes](../python/#linux-and-raspberry-pi) for wheels, virtual environments, the `video` group, camera modules and performance.

## Chromium kiosk

To give a scanning station the full scanner UI (viewfinder, highlights, feedback), run the web scanner full screen in Chromium.

### 1. The page

```html
<!-- ~/kiosk/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scanner</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; }
      qrgen-scanner { position: fixed; inset: 0; height: 100%; }
    </style>
  </head>
  <body>
    <qrgen-scanner symbologies="qr,code128,ean13" duplicate-filter="3000" resolution="hd"></qrgen-scanner>
    <script type="module">
      import { configure } from "./vendor/qrgen.js";

      configure({ wasmBaseUrl: "./vendor/wasm/" });

      document.querySelector("qrgen-scanner").addEventListener("scan", async ({ detail }) => {
        // Hand the result to your backend, for example a local service on port 3000.
        await fetch("http://localhost:3000/scanned", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(detail.barcode),
        }).catch(() => undefined);
      });
    </script>
  </body>
</html>
```

Copy the SDK and engine next to it so the kiosk works offline:

```bash
mkdir -p ~/kiosk/vendor/wasm
cp node_modules/qrgen-sdk/dist/browser/qrgen.js ~/kiosk/vendor/
cp node_modules/qrgen-sdk/dist/wasm/*.wasm ~/kiosk/vendor/wasm/
```

### 2. Serve it on localhost

The camera needs a secure context, and `http://localhost` counts as one. Any static server works:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory ~/kiosk
```

### 3. Start Chromium in kiosk mode

```bash
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  http://localhost:8000/
```

On Raspberry Pi OS the binary may be called `chromium-browser`.

| Flag | Why |
| --- | --- |
| `--kiosk` | Full screen, no browser UI. |
| `--use-fake-ui-for-media-stream` | Accepts camera permission requests automatically, so nobody has to click **Allow** on an unattended kiosk. |
| `--autoplay-policy=no-user-gesture-required` | Lets the scan beep play without a tap first. |
| `--noerrdialogs`, `--disable-session-crashed-bubble` | No restore prompts after a power cut. |

> **Warning:** `--use-fake-ui-for-media-stream` grants camera access to every page the browser opens. Use it only on a dedicated kiosk that loads your own page.

If the page is served from another machine over plain HTTP, Chromium treats it as insecure. Serve it over HTTPS, or explicitly allow that origin (for kiosks on a trusted network only): `--unsafely-treat-insecure-origin-as-secure=http://192.168.1.10:8000 --user-data-dir=$HOME/.kiosk-profile`.

Start Chromium from your desktop session's autostart, or from a systemd user unit, so it comes back after a reboot.

## USB webcams

Linux exposes webcams through Video4Linux (V4L2), and Chromium and OpenCV both read them. A few tips:

- **Permissions.** The user running the browser or script needs access to `/dev/video*`. Add it to the `video` group: `sudo usermod -aG video $USER`, then log in again.
- **Find cameras.** Install `v4l-utils` and run `v4l2-ctl --list-devices`. A single webcam often has several `/dev/video` nodes; the first one of each camera is usually the video stream, the others are metadata.
- **Formats.** `v4l2-ctl -d /dev/video0 --list-formats-ext` shows supported resolutions and frame rates. Over USB 2, 1080p at 30 fps usually needs MJPEG; 720p is a good default for scanning (`resolution="hd"`).
- **Focus.** Many cheap webcams have fixed focus tuned for faces at arm's length, so small barcodes up close are blurry. Hold codes further away and raise the resolution, or use an autofocus webcam. On cameras with manual controls, `v4l2-ctl -d /dev/video0 --list-ctrls` shows them; for example `v4l2-ctl -d /dev/video0 -c focus_automatic_continuous=0 -c focus_absolute=40` (control names vary by camera and kernel version; older kernels use `focus_auto`).
- **Exposure.** Under bright lights or with glossy labels, lowering exposure reduces glare: look for `auto_exposure` and `exposure_time_absolute` in `--list-ctrls`.
- **Choosing a camera in the browser.** With several webcams, list them with `Camera.list()` and set the element's `camera` attribute to the `deviceId` you want. Labels are available after the first permission grant (immediately with `--use-fake-ui-for-media-stream`).

### Raspberry Pi camera modules

Camera modules on the CSI connector use libcamera. Browser support for them depends on the OS release and Chromium's configuration, so for a browser kiosk a USB (UVC) webcam is the most reliable choice. With a camera module, the Python package with picamera2 is the simplest route; see the [Python Linux notes](../python/#linux-and-raspberry-pi).

## ARM64 and Raspberry Pi notes

- **Use a 64-bit OS.** Raspberry Pi OS (64-bit) on a Pi 4 or Pi 5 runs everything on this page. Node.js and the npm package also work on 32-bit ARM, but prebuilt Python wheels for the engine are only published for 64-bit ARM.
- **Docker images.** Check which architectures an image provides with `docker buildx imagetools inspect ghcr.io/rockyljewell/qr-gen:latest`. If there is no `linux/arm64` entry, build the image on the device: `docker build -t qrgen .` in a clone of the repository.
- **Performance.** WebAssembly decoding is CPU-bound. On a Pi, limit `symbologies` to what you scan, keep `resolution="hd"` or lower, and for the web scanner consider a smaller decode size: after the element's `ready` event, call `el.scanner.setOptions({ maxDecodeSize: 960 })`, where `el` is the `<qrgen-scanner>` element.
- **Cooling.** Continuous camera decoding keeps a core busy. A Pi without a heatsink can throttle after a few minutes; `vcgencmd get_throttled` reports it.
