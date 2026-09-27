---
name: qrgen-migration
description: Migrate an app from html5-qrcode, @zxing/browser or @zxing/library, QuaggaJS/quagga2, jsQR, instascan, the native BarcodeDetector API, or a commercial scanning SDK (such as Scandit, Dynamsoft or Cognex) to QRGen. Maps their concepts, options and callbacks to QRGen equivalents and removes the old dependency. Use when the user wants to replace or swap their current barcode scanner library.
---

# Migrating to QRGen

1. Find the current scanner: search for `Html5Qrcode`, `Html5QrcodeScanner`, `BrowserMultiFormatReader`,
   `@zxing/`, `Quagga`, `jsQR`, `Instascan`, `BarcodeDetector`, `scandit`, `SparkScan`, `BarcodeCapture`,
   `Dynamsoft`.
2. Replace it with the closest QRGen equivalent below. Keep the app's existing result handling by
   mapping `barcode.data` and `barcode.symbology`.
3. Remove the old package, its license keys and its CDN tags. Delete dead code.
4. Build, run the tests, and add a round-trip test (see the `qrgen-testing` skill).

## html5-qrcode

| html5-qrcode | QRGen |
| --- | --- |
| `new Html5QrcodeScanner("reader", { fps, qrbox })` | `<qrgen-scanner>` (built-in UI, viewfinder, torch, camera switch) |
| `html5QrCode.start({ facingMode: "environment" }, config, onSuccess)` | `new BarcodeScanner({ video, camera: "back" }).on("scan", …).start()` |
| `formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]` | `symbologies: ["qr"]` |
| `qrbox` | automatic from the viewfinder, or `scanArea` |
| `onScanSuccess(decodedText, result)` | `scan` event: `detail.barcode.data`, `detail.barcode.symbology` |
| `html5QrCode.scanFile(file)` | `scanImage(file)` |
| `stop()` / `clear()` | `stop()` / remove the element |

## @zxing/browser / @zxing/library

| ZXing | QRGen |
| --- | --- |
| `new BrowserMultiFormatReader(hints)` + `decodeFromVideoDevice` | `<qrgen-scanner>` or `BarcodeScanner` (decodes in a worker) |
| `DecodeHintType.POSSIBLE_FORMATS` | `symbologies` |
| `DecodeHintType.TRY_HARDER` | `tryHarder: true` |
| `result.getText()` / `getBarcodeFormat()` | `barcode.data` / `barcode.symbology` |
| `decodeFromImageUrl(url)` | `scanImage(url)` |
| `BrowserQRCodeSvgWriter` | `generate(data, { symbology: "qr" }).svg` |

## QuaggaJS / quagga2

| Quagga | QRGen |
| --- | --- |
| `Quagga.init({ inputStream, decoder: { readers: ["ean_reader", "code_128_reader"] } })` | `symbologies: ["ean13", "code128"]` |
| `Quagga.onDetected(cb)` | `scan` event |
| `Quagga.onProcessed` + canvas drawing | `frame` event (every decode) or the built-in overlay |
| `locate: true` | automatic (full frame in batch mode) |

## BarcodeDetector (native)

`new BarcodeDetector({ formats: ["qr_code"] }).detect(video)` becomes `BarcodeScanner`
or `<qrgen-scanner>`. QRGen works in every browser (Safari, Firefox), not only Chromium, and reads more
formats. Format names map as follows: `qr_code`→`qr`, `ean_13`→`ean13`, `code_128`→`code128`,
`data_matrix`→`data-matrix`, `pdf417`→`pdf417`, `aztec`→`aztec`, `upc_a`→`upca`, `itf`→`itf`.

## Commercial SDKs (for example Scandit)

QRGen is an independent open-source project, not affiliated with Scandit or other vendors. Concepts
map roughly like this:

| Commercial concept | QRGen |
| --- | --- |
| Pre-built scanning UI (e.g. SparkScan) | `<qrgen-scanner>`, `QRGenScannerView` (iOS), `QRGenScannerView` / Compose `QRGenScanner` (Android) |
| Barcode capture (single/continuous) | `mode="single"` / `mode="continuous"` |
| Multi-barcode tracking with AR overlays (e.g. MatrixScan) | `mode="batch"` + `track` / `select` events |
| ID capture (AAMVA barcode) | PDF417 + `parseAAMVA` (MRZ/OCR not included) |
| Code duplicate filter | `duplicateFilter` (ms, `0`, `-1`) |
| Symbology settings | `symbologies` ids and groups |
| License key | none |

Tell the user honestly: commercial engines may still outperform QRGen on damaged, blurry or very small
codes, in low light, and at extreme angles. Test with their real labels before switching production
traffic.
