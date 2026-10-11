# Availability and existing-engine research

Research checked on October 11, 2026. This document distinguishes implemented diagnostics from proposed adapters and experiments. Existing decoder technology remains the foundation; the work below makes it easier to use reliably and measures whether the experience improves.

## Implemented in this experiment batch

`getRuntimeCapabilities()` reports the portable JavaScript engine's declared read/write symbologies, basic camera prerequisites, optional worker and BarcodeDetector API presence, and configured reader/writer asset sources. It works during server rendering. It neither opens a camera nor queries permission, initializes an engine, creates a detector/worker or requests a network asset. Optional environment/configuration inputs make the query deterministic without mutating global configuration.

The report deliberately separates declared format support from an operational check. A camera marked `available` has a secure context and `getUserMedia` API; permission, device presence, iframe policy and actual camera startup remain untested. [Browser camera requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) explain why those later checks can still fail.

`checkSymbologies()` accepts the existing aliases and groups and returns resolved, supported, unsupported and unknown requests. Applications can show an understandable compatibility error before starting a scanner. Supplying an explicit support list also allows checking another platform's declared formats. This helper does not change the existing scanner's handling of options.

## Android: use ML Kit capabilities already present

QR-GEN pins bundled ML Kit barcode-scanning 17.3.0 in `packages/android/gradle/libs.versions.toml`. Its `MlKitFormats.options()` currently configures formats only. Google's guide documents potential barcode boxes from bundled 17.1.0 and zoom suggestions from 17.2.0, so this work need not start with a dependency upgrade. Bundled models are available immediately; unbundled Play-services models may need a first-use download. The guide also documents the centered, single-Data-Matrix limitation. [ML Kit Android guide](https://developers.google.com/ml-kit/vision/barcode-scanning/android).

Undecoded potential barcodes have null raw data; they must become a separate guidance/candidate event, never a successful scan or an empty payload. [`BarcodeScannerOptions.Builder`](https://developers.google.com/android/reference/com/google/mlkit/vision/barcode/BarcodeScannerOptions.Builder).

First native implementation slice:

1. Add opt-in potential-region events, retaining camera source/session identity and frame transforms. Test null raw values, out-of-frame boxes, pause, stop, rebinding and stale results.
2. Add opt-in ML Kit zoom suggestions with a bounded callback. Clamp to camera limits, reject stale sessions, respect manual zoom, and limit repeated adjustments. Read CameraX's reported maximum and provide it to ML Kit; the official builder warns that omitting it can produce unbounded suggestions. [`ZoomSuggestionOptions.Builder`](https://developers.google.com/android/reference/com/google/mlkit/vision/barcode/ZoomSuggestionOptions.Builder).
3. Run paired physical-device trials with the same labels and starting distance. Record successful reads, time to first correct result, zoom oscillation, false reads, thermal behavior and battery cost. Default settings change only after the evidence supports them.

QR-GEN already exposes `setZoomRatio`, `minZoomRatio` and `maxZoomRatio`; preserve that manual path and lifecycle protections. Candidate detection and zoom callbacks must not bypass the analyzer's rule that every accepted `ImageProxy` closes exactly once.

For simple one-shot Android scanning, a separate optional Google code-scanner adapter could reduce integration effort: its UI lives in Play services, does not require the host app's camera permission, and supports `enableAutoZoom()` from 16.1.0. It requires a downloaded module and is suited to workflows without custom camera UI. It is therefore an additional capability, not a universal offline or cross-platform replacement. [Google code scanner guide](https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner).

## Web: optional platform acceleration with portable fallback

BarcodeDetector remains an optional, experimental browser feature with incomplete availability. [Browser API documentation](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector). Its specification makes format support platform-dependent and allows `getSupportedFormats()` to resolve to an empty list. Constructor presence alone proves neither useful format coverage nor a successful scan. [Barcode Detection specification](https://wicg.github.io/shape-detection-api/#barcode-detection-api).

Next slice: an explicitly selected adapter should asynchronously query formats, map only covered QR-GEN formats, and fall back to the portable engine for unsupported requests or runtime failure. Keep its initialization outside the read-only diagnostic API. Benchmark it independently before enabling automatic selection.

The specified result has text, format and geometry. QR-GEN's result contract also contains raw bytes, GS1 status and other metadata. An adapter must honestly mark unavailable information and preserve strict/binary workflows with the portable engine; it must not reconstruct arbitrary payload bytes by re-encoding returned text. Add fixtures for Unicode, embedded separators, empty payloads, binary data, orientation and multiple equal-value symbols. These are compatibility requirements inferred by comparing the specification with `packages/sdk/src/types.ts`, not additional promises made by BarcodeDetector.

## Offline packaging: supply assets and verify the complete app

The SDK already accepts preloaded reader/writer byte buffers and specific/base URLs. Its build copies both WASM files to `dist/wasm`, and the Node entry loads local package binaries. The engine's documented integration hooks include `locateFile` and `wasmBinary`. [zxing-wasm integration documentation](https://github.com/Sec-ant/zxing-wasm#integrating-in-non-web-runtimes).

A relative or same-origin URL describes asset routing, not proven offline availability. A binary buffer proves supplied bytes, not a valid engine or a cached application shell. Consequently the capability report always leaves offline readiness `unverified`.

The implemented `/offline/` browser example supplies a dedicated shell, pinned JS and both matching WASM assets. Its narrowly scoped worker verifies the build's asset hashes and compiles both WASM files before publishing a versioned cache. Failed replacement installs preserve the previous working copy; successful updates wait for old tabs to close. Readiness requires a complete cache and an actual local generate/decode check. [Service-worker installation and cache lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

The browser regression covers installed tools reloaded without network, creation plus image scanning, a failed engine install, a mismatched SDK update, a valid upgrade and a cold first offline visit. It blocks external page requests and observes service-worker requests. Additional packaging gates are an application shipped locally without ever contacting a CDN, restrictive-CSP worker fallback and browser cache eviction. Camera availability still depends on the browser's origin and permission rules.

## Stability and review gates

Every added engine path needs shared compatibility fixtures, a declared support list, source/session guards and a documented fallback. Keep new adaptation opt-in until device results exist. Maintain a small fast regression suite for lifecycle and configuration; record paired benchmark results separately so synthetic image recovery is never presented as physical-camera performance. Review each small slice before broadening platform scope.

The current capability tests cover server rendering, secure/insecure/missing camera contexts, API presence without invocation, immutable configuration reads, asset precedence and unknown/unsupported format requests. These tests verify diagnostic behavior; they are not a physical-device certification or an offline-browser certification.
