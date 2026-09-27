---
title: JavaScript
description: "Scan barcodes from the camera with the BarcodeScanner API and your own video element, decode images with scanImage, and generate barcodes, in plain JavaScript or TypeScript."
group: Web
order: 1
badge: TypeScript
status: stable
---

The `qrgen-sdk` package exposes three core functions: `BarcodeScanner` for camera scanning, `scanImage()` for still images, and `generate()` for creating barcodes. Use them directly when you want full control over the UI. If you want a ready-made scanner, use the [`<qrgen-scanner>` element](../web-components/) instead; it is built on the same `BarcodeScanner`.

Everything is written in TypeScript and ships with type declarations.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## Scan from the camera

Create a `BarcodeScanner`, give it a `<video>` element for the preview, listen for `scan` events, and call `start()`:

```html
<video id="preview" style="width: 100%; max-width: 640px; background: #000"></video>
<button id="start">Start scanning</button>
<p id="result"></p>
<script type="module" src="./main.ts"></script>
```

```ts
import { BarcodeScanner, QRGenError } from "qrgen-sdk";

const video = document.querySelector<HTMLVideoElement>("#preview")!;
const result = document.querySelector<HTMLParagraphElement>("#result")!;

const scanner = new BarcodeScanner({
  video,
  symbologies: ["qr", "ean13", "code128"],
  mode: "continuous",
});

scanner.on("scan", ({ barcodes }) => {
  const [barcode] = barcodes;
  result.textContent = `${barcode.symbologyName}: ${barcode.data}`;
});

document.querySelector("#start")!.addEventListener("click", async () => {
  try {
    await scanner.start();
  } catch (err) {
    const e = err as QRGenError;
    result.textContent = `${e.code}: ${e.message}`;
  }
});
```

`start()` asks for camera permission, opens the back camera, plays it into your video element (it sets `playsinline` and `muted` for you, which iOS requires), loads the decoder, and resolves once frames are being decoded. Call it from a click handler: the user gesture lets the beep play on iOS.

> **Note:** Camera access requires a secure context: HTTPS or `http://localhost`. On any other origin `start()` rejects with `insecure-context`.

If you don't pass a `video`, the scanner creates a detached one that is used only for decoding. Pass your own when you want the user to see the preview.

### Options

The constructor takes the shared [scanner options](../options-events/#scanner-options) plus a few web-specific ones:

```ts
import { BarcodeScanner } from "qrgen-sdk";

const video = document.querySelector("video")!;
const scanner = new BarcodeScanner({
  video,
  symbologies: ["qr", "data-matrix"], // ids, aliases or groups; default: all
  mode: "continuous",                 // "single" | "continuous" | "batch"
  duplicateFilter: 1000,              // ms; 0 = every frame, -1 = once per session
  beep: true,
  vibrate: true,
  camera: "back",                     // "back" | "front" | a deviceId
  resolution: "hd",                   // "sd" | "hd" | "fhd" | "4k"
  scanArea: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }, // normalized; default: full frame
  maxResults: 1,                      // codes per frame; default 1 (20 in batch mode)
  tryHarder: false,                   // more CPU per frame for damaged or tiny codes
  worker: true,                       // decode in a Web Worker
  maxDecodeSize: 1280,                // longest side of the image handed to the decoder
  maxFps: 24,                         // upper bound for decodes per second
  tryInvert: "alternate",             // look for white-on-black codes on every other frame
});
```

Read the resolved values (with defaults filled in) from `scanner.options`.

### Change options while scanning

`setOptions()` applies new options without restarting the camera. It works for `symbologies`, `mode`, `duplicateFilter`, `beep`, `vibrate`, `scanArea`, `maxResults`, `tryHarder`, `maxDecodeSize`, `maxFps` and `tryInvert`:

```ts
scanner.setOptions({ symbologies: ["pdf417"], tryHarder: true });
```

`setOptions()` merges with the options you passed before and re-derives the mode-dependent defaults, so switching modes is a one-liner:

```ts
scanner.setOptions({ mode: "batch" }); // maxResults 20, duplicateFilter -1, tryHarder true
scanner.setOptions({ mode: "continuous" }); // back to maxResults 1, duplicateFilter 1000
```

`camera`, `resolution` and `worker` are fixed when the scanner is created. To use a different camera, call `switchCamera()` or create a new scanner.

## Events

`on()` subscribes and returns a function that unsubscribes. `once()` fires a single time, `off()` removes a listener.

```ts
const unsubscribe = scanner.on("frame", ({ barcodes, decodeMs }) => drawOverlay(barcodes));
unsubscribe();
```

| Event | Payload | When |
| --- | --- | --- |
| `scan` | `{ barcodes: Barcode[] }` | New codes that passed the duplicate filter. Usually one; several when `maxResults` > 1. |
| `frame` | `{ barcodes: Barcode[], frameSize: Size, decodeMs: number }` | After every decoded frame, including frames with no codes and duplicates. Use it for overlays. |
| `track` | `{ tracked, added, updated, removed }` (all `TrackedBarcode[]`) | Batch mode only, after every decoded frame. See [Batch scanning](../batch-scanning/). |
| `state` | `ScannerState` | The state changed: `"idle"`, `"starting"`, `"scanning"`, `"paused"`, `"stopped"` or `"error"`. |
| `ready` | `{ engine: "worker" \| "main", camera: Camera }` | The camera is open and decoding has started. |
| `error` | `QRGenError` | Starting failed, or the engine failed to load while scanning. |

`start()` both emits `error` and rejects with the same `QRGenError`, so you can handle failures either way. The error's `code` tells you what went wrong; see [error codes](../options-events/#error-codes).

In `single` mode, the scanner pauses itself right before emitting `scan`. Call `resume()` to scan the next code.

## Controls

```ts
scanner.on("ready", async ({ camera }) => {
  const { torch, zoom } = camera.capabilities;

  if (torch) await scanner.setTorch(true);          // returns false if the camera refused
  if (zoom) await scanner.setZoom(Math.min(2, zoom.max));
});

scanner.pause();        // stop decoding, keep the camera open
scanner.resume();       // continue after pause() or a single-mode scan
await scanner.toggleTorch();
await scanner.switchCamera(); // front <-> back, or the next camera when there are more than two
```

| Member | Returns | Notes |
| --- | --- | --- |
| `start()` | `Promise<void>` | Open the camera and start decoding. No-op while already starting or scanning. |
| `stop()` | `void` | Stop decoding and release the camera. `start()` again to restart. |
| `pause()` | `void` | Stop decoding; the preview keeps running. |
| `resume()` | `void` | Continue decoding. Resets the duplicate filter. |
| `setTorch(on)` | `Promise<boolean>` | `false` when the camera has no torch or refused. |
| `toggleTorch()` | `Promise<boolean>` | The new torch state. |
| `setZoom(zoom)` | `Promise<boolean>` | Clamped to the camera's range. `false` when zoom is not supported. |
| `switchCamera()` | `Promise<void>` | Restarts the camera with the other facing mode or the next device. |
| `setOptions(partial)` | `void` | See above. |
| `destroy()` | `void` | Stop, remove all listeners and release audio. |
| `state` | `ScannerState` | Current state. |
| `options` | resolved options | Current options with defaults filled in. |
| `camera` | `Camera` | `capabilities`, `isTorchOn`, `isFront`, `videoSize`, `track`, `stream`. |
| `tracker` | `BarcodeTracker` | The batch-mode tracker. |
| `feedback` | `Feedback` | The beep and vibration helper. |
| `stats` | `{ decodeMs, fps, engine }` | Diagnostics, see below. |

Torch and zoom depend on the browser and device. Chrome on Android supports both on most phones; Safari on iOS has limited or no support depending on the version. Check `camera.capabilities` after `ready` instead of assuming: `torch` is `false` and `zoom` is `null` when the camera doesn't offer them.

### Choose a camera

```ts
import { BarcodeScanner, Camera } from "qrgen-sdk";

const cameras = await Camera.list(); // MediaDeviceInfo[]; labels are empty until permission is granted
const usb = cameras.find((c) => /usb|logitech/i.test(c.label));

const scanner = new BarcodeScanner({ video, camera: usb?.deviceId ?? "back" });
```

`camera` accepts `"back"` (default), `"front"` or a `deviceId`. If a pinned device disappears, the scanner falls back to the facing mode. `Camera.isSupported()` tells you whether `getUserMedia` exists at all.

## Stats

`scanner.stats` is updated after every decode:

| Field | Meaning |
| --- | --- |
| `decodeMs` | Smoothed decode time per frame, in milliseconds. |
| `fps` | Decodes in the last second. Capped by `maxFps` and the camera frame rate. |
| `engine` | `"worker"` or `"main"`, or `""` before the first start. |

```ts
setInterval(() => console.log(`${scanner.stats.fps} fps, ${scanner.stats.decodeMs.toFixed(1)} ms, ${scanner.stats.engine}`), 1000);
```

If `decodeMs` is high, see [slow scanning](../troubleshooting/#scanning-is-slow).

## Clean up

Release the camera when the user leaves the screen. In a single-page app, call `destroy()` when the view unmounts:

```ts
scanner.destroy();
```

While the tab is hidden, the scanner skips decoding but keeps the camera open. To release it, stop and restart on visibility changes:

```ts
document.addEventListener("visibilitychange", () => {
  if (document.hidden) scanner.stop();
  else void scanner.start();
});
```

## Scan images

`scanImage()` decodes a `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ImageData`, `<img>`, `<canvas>`, `<video>` (current frame), `ImageBitmap`, `OffscreenCanvas` or a URL string, and resolves with every code it finds:

```ts
import { scanImage } from "qrgen-sdk";

const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  const barcodes = await scanImage(file, { symbologies: ["qr", "ean13"] });
  if (barcodes.length === 0) console.log("No code found");
  for (const b of barcodes) console.log(b.symbology, b.data);
});
```

Options: `symbologies`, `maxResults` (default 255) and `tryHarder` (default `true` for images). Details, drag and drop and clipboard examples are in [Image scanning](../image-scanning/).

## Generate barcodes

```ts
import { generate } from "qrgen-sdk";

const { svg, png } = await generate("https://example.com", { symbology: "qr", ecLevel: "M", scale: 6 });
document.querySelector("#code")!.innerHTML = svg;
```

`generate()` returns the SVG markup, a PNG `Blob` (in browsers), the module matrix and a text rendering. `generateSVG()` returns only the SVG and `generateDataURL()` returns a `data:image/svg+xml` URL for an `<img>`. See [Barcode generation](../barcode-generation/).

## Parse the result

```ts
import { parseContent } from "qrgen-sdk";

scanner.on("scan", ({ barcodes }) => {
  const parsed = parseContent(barcodes[0].data, { symbology: barcodes[0].symbology });
  if (parsed.type === "url") window.open(parsed.url, "_blank", "noopener");
  if (parsed.type === "wifi") console.log(`Network ${parsed.ssid}, password ${parsed.password ?? "(none)"}`);
});
```

See [Parsers](../parsers/) for every content type.

## TypeScript

All types are exported from `qrgen-sdk`:

```ts
import type { Barcode, TrackedBarcode, BarcodeScannerOptions, ScannerState, ScanImageOptions, GenerateOptions, ParsedContent, QRGenErrorCode } from "qrgen-sdk";
```

The full list is in the [JavaScript API reference](../api/).
