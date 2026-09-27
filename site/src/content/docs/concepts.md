---
title: Core concepts
description: "Symbologies and groups, scan modes, the Barcode result object, duplicate filtering, scan areas, feedback, worker decoding and privacy in QRGen."
group: Get started
order: 5
---

These concepts apply to every QRGen package. The names are shared across the JavaScript, native and Python SDKs, so what you learn here carries over.

## Symbologies

A symbology is a barcode type: QR Code, EAN-13, Code 128, PDF417 and so on. QRGen identifies each one with a short lowercase id such as `qr`, `ean13`, `code128` or `data-matrix`. The full list, with aliases and platform support, is on the [Symbologies](../symbologies/) page.

Anywhere you pass symbologies, you can use ids, aliases, display names and groups. Matching ignores case and punctuation, so `QRCode`, `qr-code`, `QR` and `qr` all mean `qr`, and `EAN-13` means `ean13`. Unknown names are ignored.

```js
new BarcodeScanner({ symbologies: ["qr", "EAN-13", "code128"] });
new BarcodeScanner({ symbologies: "qr, ean13 code128" }); // strings are split on commas and spaces
new BarcodeScanner({ symbologies: ["retail", "qr"] }); // groups expand
```

### Groups

| Group | Expands to |
| --- | --- |
| `all` | Every symbology (the default) |
| `linear` or `1d` | `ean13` `ean8` `upca` `upce` `isbn` `code128` `code39` `code93` `codabar` `itf` `itf14` `databar` `databar-expanded` `databar-limited` `code32` `pzn` `telepen` `dx-film-edge` |
| `matrix` or `2d` | `qr` `micro-qr` `rmqr` `data-matrix` `aztec` `pdf417` `micro-pdf417` `maxicode` |
| `retail` | `ean13` `ean8` `upca` `upce` `isbn` `databar` `databar-expanded` `databar-limited` |
| `industrial` | `code128` `code39` `code93` `codabar` `itf` `itf14` `data-matrix` |
| `gs1` | `code128` `data-matrix` `qr` `databar` `databar-expanded` `databar-limited` |

When you don't pass symbologies, QRGen looks for all of them. That is convenient, but every extra symbology costs decode time and raises the chance of a false read. In production, enable only what you expect to scan. [Barcode scanning](../barcode-scanning/#choose-symbologies) has recommended sets.

## Scan modes

| Mode | Behavior | Use it for |
| --- | --- | --- |
| `continuous` (default) | Keeps scanning. Each new code fires a `scan` event, repeats are suppressed by the duplicate filter. | Checkout lanes, ticket gates, scanning a stack of parcels |
| `single` | Pauses after the first successful scan. Call `resume()` (or tap **Scan again** in the element) to scan the next one. | Login QR codes, "scan to fill this field" flows |
| `batch` | Tracks every code in view at once, with a stable id per physical code. Fires `track` events every frame and a `scan` event for each newly seen code. | Shelf audits, counting inventory, picking one code among many |

In `batch` mode, the defaults change: `maxResults` becomes 20 (codes decoded per frame) instead of 1, and `duplicateFilter` becomes `-1` (each code value reported once per session). See [Batch scanning](../batch-scanning/).

## The Barcode result

Every platform returns the same object for a decoded code:

```json
{
  "data": "https://example.com",
  "symbology": "qr",
  "symbologyName": "QR Code",
  "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
  "contentType": "text",
  "isGS1": false,
  "location": {
    "topLeft": { "x": 10, "y": 10 },
    "topRight": { "x": 90, "y": 10 },
    "bottomRight": { "x": 90, "y": 90 },
    "bottomLeft": { "x": 10, "y": 90 }
  },
  "frameSize": { "width": 1280, "height": 720 },
  "orientation": 0,
  "ecLevel": "M",
  "symbologyIdentifier": "]Q1",
  "timestamp": 1735689600000
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `data` | `string` | The decoded text. GS1 data is returned in human-readable form, for example `(01)09501101530003(10)ABC123`. |
| `symbology` | `string` | Symbology id, for example `qr` or `ean13`. |
| `symbologyName` | `string` | Display name, for example `QR Code`. |
| `rawBytes` | `string` | Base64 of the raw payload bytes. May be `""`. Decode it with `fromBase64()` when you need the exact bytes, for binary payloads or data with control characters. |
| `contentType` | `string` | `text`, `binary`, `gs1`, `iso15434`, `mixed` or `unknown-eci`. |
| `isGS1` | `boolean` | `true` when the code carries GS1 data (FNC1 in first position). |
| `location` | `Quadrilateral` | The four corners of the code, in pixels of the source frame or image. |
| `frameSize` | `Size` | Width and height of the source frame or image, so you can map `location` to the screen. |
| `orientation` | `number` | Rotation of the code in degrees. |
| `ecLevel` | `string` | Error correction level when the symbology has one (`L`, `M`, `Q`, `H` for QR), else `""`. |
| `symbologyIdentifier` | `string` | AIM symbology identifier, for example `]Q1` for QR or `]C1` for GS1-128, when known. |
| `timestamp` | `number` | When the code was decoded, in milliseconds since the Unix epoch. |

In batch mode, results are `TrackedBarcode` objects: the same fields plus `id` (stable while the code stays in view), `firstSeen`, `lastSeen` (timestamps) and `count` (frames it was seen in).

`data` is raw text. To know what it means (a URL, Wi-Fi credentials, a product GTIN, a driver license), pass it to [`parseContent()`](../parsers/).

## Duplicate filter

A camera sees the same code in many consecutive frames. The duplicate filter decides how often a code is reported. Two results count as the same code when both `symbology` and `data` match.

| `duplicateFilter` | Behavior |
| --- | --- |
| `1000` (default) | Report a code at most once per second. Holding a code in front of the camera reports it again every second. |
| any positive number | Same, with that window in milliseconds. `3000` suits checkout, where a repeat within 3 seconds is almost always accidental. |
| `0` | Report every detection in every frame. Useful for measuring, rarely for users. |
| `-1` | Report each code once per session. The filter resets when you call `start()` or `resume()`. Default in `batch` mode. |

The filter only affects `scan` events. The `frame` event (and `track` in batch mode) always contains everything decoded in the frame, so overlays stay live.

## Scan area and viewfinder

Decoding the full camera frame is wasteful when the user aims at the center. The scan area is the region of each frame that is handed to the decoder, as a normalized rectangle (`0` to `1`) relative to the camera frame:

```js
new BarcodeScanner({ scanArea: { x: 0.1, y: 0.35, width: 0.8, height: 0.3 } });
```

The `<qrgen-scanner>` element derives the scan area from its viewfinder automatically. It measures the viewfinder on screen, maps it through the video's `object-fit: cover` crop into camera-frame coordinates, adds a 12% margin, and updates it whenever the element or the video resizes. Users can only scan what they can see inside the viewfinder, and the decoder never wastes time on the parts of the frame that are cropped off screen.

The viewfinder has three styles:

| `viewfinder` | Shape | Default when |
| --- | --- | --- |
| `frame` | Square with corner marks | The enabled symbologies include any 2D code |
| `line` | Wide, short rectangle with a pulsing laser line | Only linear (1D) symbologies are enabled |
| `none` | No viewfinder, the whole visible video is scanned | Never (batch mode hides the viewfinder automatically) |

Setting an explicit `scan-area` on the element overrides the automatic region; the viewfinder is then only a visual guide. With `BarcodeScanner`, there is no viewfinder: set `scanArea` yourself, or leave it unset to decode the full frame.

## Feedback

On each successful scan the SDK plays a short tone through the Web Audio API and vibrates for 40 ms through the Vibration API. Turn either off with `beep: false` or `vibrate: false` (`beep="false"`, `vibrate="false"` on the element). In batch mode, feedback is throttled to at most one beep every 250 ms.

Browsers only allow audio after a user gesture. `start()` unlocks audio, so the beep works when scanning starts from a tap. If the scanner starts automatically on page load, iOS stays silent until the user taps the page. Set `autostart="false"` on the element to show a **Start scanning** button instead. iOS Safari does not support vibration.

## Worker and main-thread decoding

Camera frames are decoded in a Web Worker by default, so decoding never blocks scrolling, animations or your own code. The worker is created from a Blob URL and loads the same wasm file.

If a worker can't be created (for example a Content Security Policy without `worker-src blob:`), the SDK logs `[qrgen] decoding on the main thread: ...` and falls back to decoding on the main thread. Everything still works, but heavy decoding can cause jank on slow devices. The `ready` event and `scanner.stats.engine` tell you which engine is in use (`"worker"` or `"main"`). Force the main thread with `worker: false` or `configure({ worker: false })`.

`scanImage()` always decodes on the main thread, because it runs once rather than 24 times a second.

## Privacy

All decoding happens on the device. Camera frames and images are never uploaded, and QRGen collects no analytics. The only network requests the browser SDK makes are:

- Downloading `zxing_reader.wasm` (and `zxing_writer.wasm` if you generate barcodes) from jsDelivr, unless you [self-host them](../installation/#self-host-the-webassembly-engine).
- Fetching image URLs you pass to `scanImage()`.

The REST API and CLI process images on the machine they run on. If you run `qrgen serve` on a server, images you send to it do leave the device, so treat that server like any other service that handles user data. For ID documents, read [privacy guidance for ID scanning](../id-scanning/#privacy).
