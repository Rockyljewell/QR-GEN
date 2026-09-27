---
title: Migrating from other SDKs
description: "Move to QRGen from html5-qrcode, @zxing/browser and @zxing/library, QuaggaJS and quagga2, or a commercial SDK such as Scandit, with side-by-side API and concept mappings."
group: Reference
order: 6
label: Migration
---

This page maps the APIs and concepts of popular barcode libraries to their QRGen equivalents, with before-and-after code. In most apps the migration is small: replace the scanner setup, rename the format constants to [symbology ids](../symbologies/), and read `barcode.data` instead of the old result's text.

Install QRGen first:

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## From html5-qrcode

### Pre-built scanner

Before:

```js
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from "html5-qrcode";

const scanner = new Html5QrcodeScanner(
  "reader",
  { fps: 10, qrbox: { width: 250, height: 250 }, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.EAN_13] },
  false
);
scanner.render(
  (decodedText, decodedResult) => console.log(decodedText, decodedResult.result.format.formatName),
  (errorMessage) => {} // called on every frame without a code
);
```

After:

```html
<qrgen-scanner id="reader" symbologies="qr,ean13" style="height: 400px"></qrgen-scanner>

<script type="module">
  import "qrgen-sdk/elements";

  document.getElementById("reader").addEventListener("scan", ({ detail }) => {
    console.log(detail.barcode.data, detail.barcode.symbologyName);
  });
</script>
```

### Camera API

Before:

```js
import { Html5Qrcode } from "html5-qrcode";

const reader = new Html5Qrcode("reader");
await reader.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => console.log(text));
// later
await reader.stop();
```

After:

```js
import { BarcodeScanner } from "qrgen-sdk";

const scanner = new BarcodeScanner({ video: document.querySelector("video"), camera: "back", symbologies: ["qr"] });
scanner.on("scan", ({ barcodes }) => console.log(barcodes[0].data));
await scanner.start();
// later
scanner.stop();
```

### Mapping

| html5-qrcode | QRGen |
| --- | --- |
| `Html5QrcodeScanner(...).render(onSuccess)` | `<qrgen-scanner>` with a `scan` listener, or [`QRGenScanner`](../react/) in React |
| `new Html5Qrcode(id).start(camera, config, onSuccess)` | `new BarcodeScanner({ video, camera }).start()` with `scanner.on("scan", ...)` |
| `stop()`, `clear()` | `stop()`, `destroy()` (the element cleans up when removed) |
| `pause()`, `resume()` | `pause()`, `resume()` |
| `scanFile(file)` | `scanImage(file)`, which returns every code in the image |
| `Html5Qrcode.getCameras()` | `Camera.list()` |
| `{ facingMode: "environment" }` or a camera id | `camera: "back"`, `"front"` or a `deviceId` |
| `formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE, ...]` | `symbologies: ["qr", ...]` |
| `fps` | `maxFps` (default 24) |
| `qrbox` | The element's viewfinder sets the scan region automatically; `scanArea` for custom regions |
| `decodedText` | `barcode.data` |
| `decodedResult.result.format.formatName` | `barcode.symbology` (id) or `barcode.symbologyName` |
| Torch via `getRunningTrackCameraCapabilities()` | `setTorch(true)`, `toggleTorch()`, or the element's torch button |
| Error callback on every frame | Not needed; `error` fires only for real failures |

Format names: `QR_CODE` is `qr`, `DATA_MATRIX` is `data-matrix`, `EAN_13` is `ean13`, `UPC_A` is `upca`, `CODE_128` is `code128`, `CODE_39` is `code39`, `ITF` is `itf`, `PDF_417` is `pdf417`, `AZTEC` is `aztec`, `RSS_14` is `databar`, `RSS_EXPANDED` is `databar-expanded`.

## From @zxing/browser and @zxing/library

`@zxing/library` is a JavaScript port of the Java ZXing library, and `@zxing/browser` adds camera helpers. QRGen uses zxing-cpp, a separate C++ implementation, compiled to WebAssembly and run in a Web Worker.

Before:

```js
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

const hints = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);
const reader = new BrowserMultiFormatReader(hints);

const controls = await reader.decodeFromVideoDevice(undefined, "preview", (result, error) => {
  if (result) console.log(result.getText(), BarcodeFormat[result.getBarcodeFormat()]);
});
// later
controls.stop();

const fromImage = await reader.decodeFromImageUrl("/label.png");
```

After:

```js
import { BarcodeScanner, scanImage } from "qrgen-sdk";

const scanner = new BarcodeScanner({ video: document.getElementById("preview"), symbologies: ["qr", "code128"], tryHarder: true });
scanner.on("scan", ({ barcodes }) => console.log(barcodes[0].data, barcodes[0].symbology));
await scanner.start();
// later
scanner.stop();

const fromImage = await scanImage("/label.png"); // an array; empty when nothing is found
```

| @zxing/browser, @zxing/library | QRGen |
| --- | --- |
| `BrowserMultiFormatReader`, `BrowserQRCodeReader`, ... | `BarcodeScanner` (one class for all formats) |
| `decodeFromVideoDevice(deviceId, video, callback)` | `new BarcodeScanner({ video, camera: deviceId })`, `on("scan")`, `start()` |
| `IScannerControls.stop()` | `scanner.stop()` |
| `controls.switchTorch(on)` | `scanner.setTorch(on)` |
| `BrowserMultiFormatReader.listVideoInputDevices()` | `Camera.list()` |
| `decodeFromImageUrl`, `decodeFromImageElement`, `decodeFromCanvas` | `scanImage(url \| img \| canvas)` |
| `decodeOnce...` | `mode: "single"` |
| `DecodeHintType.POSSIBLE_FORMATS` | `symbologies` |
| `DecodeHintType.TRY_HARDER` | `tryHarder` |
| `NotFoundException` for frames without a code | No exception; an empty result or no `scan` event |
| `result.getText()` | `barcode.data` |
| `result.getBarcodeFormat()` | `barcode.symbology` |
| `result.getResultPoints()` | `barcode.location` (four corners) |
| `result.getRawBytes()` | `fromBase64(barcode.rawBytes)` |
| `BrowserQRCodeSvgWriter`, `MultiFormatWriter` | `generate()`, `generateSVG()`, `<qrgen-barcode>` |

## From QuaggaJS and quagga2

Quagga reads linear (1D) barcodes. QRGen reads the same linear formats and adds QR, Data Matrix, PDF417 and the other 2D codes.

Before:

```js
import Quagga from "@ericblade/quagga2";

Quagga.init(
  {
    inputStream: { type: "LiveStream", target: document.querySelector("#scanner"), constraints: { facingMode: "environment" } },
    decoder: { readers: ["ean_reader", "upc_reader", "code_128_reader"] },
    locate: true,
  },
  (err) => {
    if (err) return console.error(err);
    Quagga.start();
  }
);
Quagga.onDetected((data) => console.log(data.codeResult.code, data.codeResult.format));
// later
Quagga.stop();
```

After:

```html
<qrgen-scanner id="scanner" symbologies="ean13,upca,code128" style="height: 400px"></qrgen-scanner>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.getElementById("scanner");
  scanner.addEventListener("scan", ({ detail }) => console.log(detail.barcode.data, detail.barcode.symbology));
  // later: scanner.stop(), or remove the element
</script>
```

| Quagga | QRGen |
| --- | --- |
| `Quagga.init(config, cb)` and `Quagga.start()` | Add `<qrgen-scanner>` (starts automatically), or `new BarcodeScanner(options).start()` |
| `Quagga.stop()` | `stop()` |
| `Quagga.onDetected(cb)` | `scan` event |
| `Quagga.onProcessed(cb)` | `frame` event on `BarcodeScanner` (every decoded frame) |
| `Quagga.decodeSingle({ src })` | `scanImage(src)` |
| `inputStream.constraints` | `camera`, `resolution` |
| `inputStream.area` | `scanArea` (normalized 0 to 1) |
| `locate: true` | Always on; codes are found anywhere in the scan area, at any angle |
| `frequency` | `maxFps` |
| `numOfWorkers` | Decoding runs in a Web Worker automatically |
| `data.codeResult.code` | `barcode.data` |
| `data.codeResult.format` | `barcode.symbology` |
| `data.box`, `data.line` | `barcode.location` |

Reader names:

| Quagga reader | QRGen id |
| --- | --- |
| `ean_reader` | `ean13` |
| `ean_8_reader` | `ean8` |
| `upc_reader` | `upca` |
| `upc_e_reader` | `upce` |
| `code_128_reader` | `code128` |
| `code_39_reader`, `code_39_vin_reader` | `code39` |
| `code_93_reader` | `code93` |
| `codabar_reader` | `codabar` |
| `i2of5_reader` | `itf` |
| `code_32_reader` | `code32` |
| `2of5_reader` (Standard 2 of 5) | Not supported |

Quagga apps often filter results by error rate or wait for several identical reads before accepting a code. QRGen's engine verifies check digits and symbol structure, so you can usually remove those heuristics. If you still see misreads, limit `symbologies` to what you actually scan.

## From Scandit and other commercial SDKs

> **Note:** QRGen is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Scandit AG. Scandit, SparkScan and MatrixScan are trademarks of Scandit AG. Product names below are used only to describe equivalent concepts.

Commercial SDKs such as Scandit are built around similar concepts: a capture mode that recognizes barcodes in camera frames, a camera abstraction, overlays and viewfinders, and settings for symbologies, duplicates and feedback. The table maps these concepts to QRGen. API names differ between Scandit SDK versions and platforms, so check their documentation for the exact names in your version.

| Scandit concept | QRGen equivalent |
| --- | --- |
| License key and data capture context | None. No key, no account, no activation. |
| Camera and frame source on/off | `scanner.start()`, `scanner.stop()` |
| Barcode capture (single-barcode scanning) | Continuous mode (`mode="continuous"`, the default) with the `scan` event |
| Disabling capture temporarily | `pause()` and `resume()` |
| Barcode capture settings: enabled symbologies | `symbologies` ([ids](../symbologies/)) |
| Code duplicate filter | `duplicateFilter` (ms; `0` and `-1` behave as in [Core concepts](../concepts/#duplicate-filter)) |
| Location selection (restricting the scan area) | `scanArea`, or automatic from the element's viewfinder |
| Rectangular and laserline viewfinders | `viewfinder="frame"` and `viewfinder="line"` |
| Capture feedback (sound, vibration) | `beep`, `vibrate`, `scanner.feedback` |
| SparkScan (pre-built scanning UI) | `<qrgen-scanner>`, `QRGenScanner` in React and Vue, the [embed page](../embed-bridge/) in WebViews |
| MatrixScan (tracking many barcodes, "BarcodeBatch", previously "BarcodeTracking") | Batch mode (`mode="batch"`) with `track` events and `TrackedBarcode` ids; [`BarcodeTracker`](../batch-scanning/#barcodetracker-for-custom-interfaces) for custom pipelines |
| MatrixScan basic overlay (highlights on tracked codes) | Built into `<qrgen-scanner>` in batch mode, or your own canvas: see [UI customization](../ui-customization/#build-a-fully-custom-ui) |
| Tap-to-select on tracked codes | The element's `select` event and `selection` |
| ID capture (AAMVA barcode) | [`parseAAMVA()`](../id-scanning/) on a scanned PDF417 |
| ID capture (MRZ, visual inspection zone, OCR) | Not available |
| Barcode generator | [`generate()`](../barcode-generation/), `<qrgen-barcode>` |
| Parsers (GS1, AAMVA, and others) | [`parseContent()`, `parseGS1()`, `parseAAMVA()`](../parsers/) |
| Barcode result: data, symbology, location, GS1 flag | `barcode.data`, `barcode.symbology`, `barcode.location`, `barcode.isGS1` |

Symbology names: an EAN-13/UPC-A setting corresponds to `ean13` and `upca` (QRGen lists them separately; enable both), QR to `qr`, Data Matrix to `data-matrix`, Code 128 to `code128`, PDF417 to `pdf417`, Interleaved 2 of 5 to `itf`, GS1 DataBar to `databar`, `databar-expanded` and `databar-limited`.

A typical "scan a barcode, look up the product" flow in QRGen:

```html
<qrgen-scanner id="scanner" symbologies="ean13,upca,upce,code128" duplicate-filter="2000" style="height: 60vh"></qrgen-scanner>

<script type="module">
  import "qrgen-sdk/elements";
  import { parseContent } from "qrgen-sdk";

  document.getElementById("scanner").addEventListener("scan", ({ detail }) => {
    const content = parseContent(detail.barcode.data, { symbology: detail.barcode.symbology });
    if (content.type === "product") console.log("Look up GTIN", content.gtin);
  });
</script>
```

### Before you switch

Be realistic about the trade-offs:

- **Recognition performance.** Commercial SDKs invest heavily in computer vision. They may still outperform QRGen on badly damaged, blurry or very small codes, at long distances, in poor lighting, at steep angles and on low-end devices. Test QRGen with your real codes, devices and conditions before switching.
- **Features.** QRGen doesn't include OCR, MRZ reading, AR overlays beyond highlights, or item counting and search workflows as ready-made products. You can build some of these on batch mode and your own UI.
- **Support.** QRGen is community supported through [GitHub](https://github.com/Rockyljewell/QR-GEN/issues). There is no SLA.

In return you get an Apache-2.0 licensed SDK with no license keys, per-device fees or telemetry, on-device processing, and the same API across the web, Node.js, Python and native platforms.
