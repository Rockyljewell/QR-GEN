## 0.1.0

First release.

- `QRGenScanner` widget built on `mobile_scanner` (5.1+, 6 and 7): QRGen symbology ids and
  groups, `single` / `continuous` / `batch` modes, duplicate filter, torch, camera switch,
  haptic feedback, a rounded corner-bracket viewfinder, code outlines and a success toast.
  The camera stops in the background, when `isActive` is false and when its route is covered.
- `QRGenWebScanner` widget built on `webview_flutter`: loads the hosted QRGen embed page,
  listens on the `QRGenBridge` JavaScript channel and exposes `QRGenWebScannerController`
  (`start`, `stop`, `pause`, `resume`, `setTorch`).
- Pure Dart models and utilities: `QRGenBarcode` / `QRGenTrackedBarcode` (SPEC JSON),
  `QRGenSymbology`, `QRGenScannerOptions`, `QRGenError`, `QRGenDuplicateFilter`,
  `QRGenBarcodeTracker`, `QRGenScanSession`, bridge message parsing and embed URL building.
