---
title: Barcode scanning
description: "Scan barcodes and QR codes from the camera: single and continuous modes, symbology choice, viewfinders, scan areas, duplicate filtering, feedback, torch and zoom."
group: Features
order: 1
---

This page covers camera scanning of one code at a time, the most common use: checkout, ticket validation, login QR codes, asset lookup. The examples use the [`<qrgen-scanner>` element](../web-components/); every option exists on [`BarcodeScanner`](../javascript/) under the camelCase name, and on the React and Vue components as props.

To scan many codes at once, see [Batch scanning](../batch-scanning/). For photos and files, see [Image scanning](../image-scanning/).

## Single and continuous

**Single** mode stops after the first code. Use it when a scan completes a task, such as filling a form field or logging in:

```html
<qrgen-scanner id="scanner" mode="single" symbologies="qr" style="height: 360px"></qrgen-scanner>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.getElementById("scanner");
  scanner.addEventListener("scan", async ({ detail }) => {
    const ok = await submitToken(detail.barcode.data);
    if (!ok) scanner.resume(); // wrong code: scan again
  });

  async function submitToken(token) {
    const res = await fetch("/api/login/qr", { method: "POST", body: token });
    return res.ok;
  }
</script>
```

After a scan the scanner pauses and shows a **Scan again** button. Call `resume()` to continue from code, or `stop()` to release the camera.

**Continuous** mode (the default) keeps scanning and reports each new code once per duplicate-filter window. Use it for queues of items: checkout, receiving parcels, validating a line of tickets.

```html
<qrgen-scanner mode="continuous" symbologies="retail" duplicate-filter="3000" style="height: 360px"></qrgen-scanner>
```

## Choose symbologies

By default the scanner looks for all 26 symbologies. Each one you enable costs decode time on every frame and adds a small chance of misreading something else as that type. Enable only what you expect:

| Use case | `symbologies` |
| --- | --- |
| QR codes only (logins, links, payments, Wi-Fi) | `qr` |
| Retail products, groceries | `retail` (EAN-13, EAN-8, UPC-A, UPC-E, ISBN, GS1 DataBar) |
| Books | `ean13` (ISBNs are EAN-13 barcodes starting with 978 or 979) |
| Shipping labels, warehouses | `code128,data-matrix,qr` or `gs1` |
| Healthcare packs, UDI | `data-matrix,code128` (GS1) |
| Boarding passes, tickets | `pdf417,aztec,qr` |
| Driver licenses and IDs | `pdf417` (see [ID scanning](../id-scanning/)) |
| Asset tags, industrial | `code128,code39,qr,data-matrix` |
| Automotive (VIN) | `code39,data-matrix` |

Ids, aliases and groups can be mixed: `symbologies="retail,qr"`. The full list is on the [Symbologies](../symbologies/) page.

> **Note:** ISBN and ITF-14 are special cases of EAN-13 and Interleaved 2 of 5. When the parent symbology is enabled too (as with the default `all` or `retail`), a book barcode is reported as `ean13` and an ITF-14 as `itf`; enable `isbn` or `itf14` without the parent to get the specific id. `parseContent()` still tells you the kind: see [product codes](../parsers/#product-codes).

Linear-only sets (for example `retail`) switch the viewfinder to a wide `line` style automatically.

## Viewfinder styles

| `viewfinder` | Looks like | Use for |
| --- | --- | --- |
| `frame` | Square with rounded corner marks | QR, Data Matrix and mixed sets (default) |
| `line` | Wide, short box with a pulsing laser line | Linear barcodes (default when only linear symbologies are enabled) |
| `none` | Nothing; the whole preview is scanned | Documents, large labels, or your own overlay |

The viewfinder dims the area around it and flashes the accent color on a successful scan. Code highlights are drawn on the video wherever the code is detected.

## Scan area

The element only decodes the part of the frame inside the viewfinder, plus a small margin, and updates this region automatically on resize. That makes scanning faster and prevents picking up a neighboring code by accident. With `viewfinder="none"`, the whole visible preview is decoded.

To set the region yourself, pass normalized coordinates of the camera frame (`x,y,width,height`, each 0 to 1):

```html
<!-- A horizontal band across the middle of the frame -->
<qrgen-scanner scan-area="0.05,0.4,0.9,0.2" viewfinder="none"></qrgen-scanner>
```

With `BarcodeScanner` there is no viewfinder, so the default is the full frame. Set `scanArea` to speed it up:

```js
const scanner = new BarcodeScanner({ video, scanArea: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } });
```

The `location` of each result is always in full-frame pixels, whatever the scan area.

## Duplicate filter

A code held in front of the camera is seen in every frame. `duplicate-filter` sets how long, in milliseconds, the same code (same symbology and data) is suppressed after it was reported:

| Value | Behavior | Typical use |
| --- | --- | --- |
| `1000` (default) | Once per second | General use |
| `3000` to `5000` | Once per few seconds | Checkout: prevents double-scanning an item that stays in view |
| `0` | Every frame | Measuring, custom logic |
| `-1` | Once until `start()` or `resume()` | Collecting a set of unique codes |

To count the same product twice, the user moves it out of view and back after the window, or you use `-1` with your own "add again" button. See [Core concepts](../concepts/#duplicate-filter).

## Feedback

A short beep and a 40 ms vibration confirm each scan. Turn them off with `beep="false"` and `vibrate="false"`. Browsers only play audio after a user gesture, so on iOS the beep works when scanning starts from a tap; use `autostart="false"` to show a **Start scanning** button that provides one.

For custom feedback, turn off the built-in beep and react to `scan` yourself:

```js
const ok = new Audio("/sounds/ok.mp3");

scanner.setAttribute("beep", "false");
scanner.addEventListener("scan", () => {
  ok.currentTime = 0;
  void ok.play();
  navigator.vibrate?.([30, 40, 30]);
});
```

With `BarcodeScanner`, you can tune the built-in tone through `scanner.feedback.options` (`frequency` in Hz, default 2100; `duration` in ms, default 90; `volume` 0 to 1, default 0.12).

## Torch and zoom

The element shows torch, zoom and camera-switch buttons when the device supports them. To control them from code:

```js
scanner.addEventListener("ready", async () => {
  const caps = scanner.scanner.camera.capabilities; // { torch, zoom, focusMode }
  if (caps.torch) await scanner.setTorch(true);
  if (caps.zoom) await scanner.setZoom(Math.min(2, caps.zoom.max));
});
```

`setTorch()` and `setZoom()` resolve to `false` when the camera doesn't support them. Support depends on the browser and device: Chrome on Android exposes both on most phones, while Safari on iOS offers limited or no support. The `torch` attribute turns the torch on as soon as the camera is ready.

Zoom helps with small codes: 2x zoom lets the user hold the phone further away, where the camera can focus.

## Difficult codes

| Problem | Option |
| --- | --- |
| Small, blurry or damaged codes | `try-harder` (more CPU per frame) and `resolution="fhd"` |
| White-on-black (inverted) codes | Checked on every other frame by default. With `BarcodeScanner`, `tryInvert: true` checks every frame. |
| Several codes in view, you want all of them | `max-results="5"` in continuous mode, or [batch mode](../batch-scanning/) |
| Slow phones | Fewer symbologies, `resolution="sd"`, and a smaller `maxDecodeSize` on the underlying scanner |

More in [Troubleshooting](../troubleshooting/#codes-are-not-found).

## Handle results

`data` is the raw text. Use `parseContent()` to find out what it is and act on it:

```js
import "qrgen-sdk/elements";
import { parseContent } from "qrgen-sdk";

document.querySelector("qrgen-scanner").addEventListener("scan", ({ detail }) => {
  const { barcode } = detail;
  const content = parseContent(barcode.data, { symbology: barcode.symbology });

  switch (content.type) {
    case "url":
      if (new URL(content.url).hostname === "example.com") location.href = content.url; // only follow trusted hosts
      break;
    case "wifi":
      showWifi(content.ssid, content.password ?? "");
      break;
    case "product":
      lookUpProduct(content.gtin); // 14-digit GTIN, zero padded
      break;
    case "gs1":
      console.log("Batch", content.gs1.values["10"], "expires", content.gs1.elements.find((e) => e.ai === "17")?.date);
      break;
    default:
      console.log(barcode.symbologyName, barcode.data);
  }
});

function showWifi(ssid, password) {
  alert(`Network: ${ssid}\nPassword: ${password}`);
}

function lookUpProduct(gtin) {
  console.log("Look up", gtin);
}
```

Pass the `symbology` hint so numeric data is interpreted correctly (for example an 8-digit UPC-E). Every content type is described in [Parsers](../parsers/).

> **Warning:** Scanned data is untrusted input. Don't open scanned URLs automatically without checking the host, and never insert `data` into the page as HTML.
