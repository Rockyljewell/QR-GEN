# Changelog

## 1.0.0 (unreleased)

First public version.

- **qrgen-sdk (web, Node):** `<qrgen-scanner>` and `<qrgen-barcode>` web components, React and Vue
  wrappers, `BarcodeScanner` with Web Worker decoding, single/continuous/batch modes, image scanning,
  generator for 26 symbologies, GS1/AAMVA/content parsers, embed bridge, `qrgen` CLI and REST server.
- **QRGenKit (iOS/macOS, beta):** AVFoundation + Vision scanner, SwiftUI and UIKit views, image
  scanning, Core Image generator, parsers.
- **qrgen-android (beta):** CameraX + ML Kit scanner view, Jetpack Compose component, image scanning,
  generator and parsers in `qrgen-core`.
- **qrgen-react-native (beta):** VisionCamera-based scanner and a WebView scanner.
- **qrgen_flutter (beta):** mobile_scanner-based widget and a WebView scanner.
- **QRGen.Net (beta):** parsers, REST client, ZXing.Net local encode/decode, MAUI scanner page.
- **qrgen-sdk for Python (beta):** image and webcam scanning, generator, parsers, CLI and REST server.
- **Agent Skills:** seven skills plus a Claude Code plugin marketplace.
- **Website:** marketing site, live demo, docs, `llms.txt`, embed page.
- **License:** Apache License 2.0 with a `NOTICE` file, copyright headers in every source file and a
  banner comment in the built SDK files. Created by Rockyljewell.
- **Sharing:** share button and share options (native share sheet, copy link, page QR code, social
  networks, messaging and email) on every page.
- **Retail tools (website):** a delivery receiving page (expected quantities, explicit
  confirmations, correction history and a local export) and a target product finder (exact
  barcode matching across live camera observations or a still image). Both run on the device.
- **QR print planner and offline tools (website):** plan a QR code for a print width and printer
  DPI with whole-dot modules, then export and check it; a standalone offline page makes QR codes
  and reads images without a network.
- **Spatial tracking:** opt-in spatial observations for batch scans in the Python, React Native
  and Flutter SDKs.
- **Adaptive capture (experiment):** opt-in, bounded adaptive camera resolution in the web
  scanner (`adaptive`). It can miss small codes beside large ones, so it is off by default.
- **Inverted codes in images:** light-on-dark linear, PDF417 and MaxiCode codes are read by the
  web, Node and Python image scanners through one extra inverted-pixel pass, which runs only when
  the normal pass found nothing (a normal code next to an inverted linear code returns the normal
  code only). In Node, that pass decodes PNG, JPEG, GIF and BMP through `pngjs`, `jpeg-js`,
  `omggif` and `bmp-ts`.
- **Decoder:** `zxing-wasm` 3.1.5.
- **Reliability:** scanner lifecycle, re-entrant destroy, camera retry, torch and highlight state
  fixes across platforms; monotonic clocks for duplicate filtering and tracking windows; stale
  native results rejected across pause and settings changes; GS1 field validation and separator
  fixes; preserved contact escapes, calendar components and multipart uploads.
