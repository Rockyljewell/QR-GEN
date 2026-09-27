---
title: "Options, events & errors"
description: "Reference tables for QRGen scanner options and their element attributes, BarcodeScanner and element events with payloads, and every error code with its causes and fixes."
group: Reference
order: 3
label: Options & events
---

This page collects the scanner options, events and error codes in one place. The option names are shared by every QRGen SDK (camelCase in JavaScript, Swift, Kotlin, Dart and C#; snake_case in Python).

## Scanner options

| Option | Element attribute | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `symbologies` | `symbologies` | `string[] \| string` | all | Ids, aliases or [groups](../symbologies/#groups) to look for. |
| `mode` | `mode` | `"single" \| "continuous" \| "batch"` | `"continuous"` | `single` pauses after the first scan; `batch` tracks many codes. See [scan modes](../concepts/#scan-modes). |
| `duplicateFilter` | `duplicate-filter` | `number` (ms) | `1000`; `-1` in batch | Suppress the same symbology and data within this window. `0` reports every frame, `-1` once per session. |
| `beep` | `beep` | `boolean` | `true` | Play a tone on scan. |
| `vibrate` | `vibrate` | `boolean` | `true` | Vibrate on scan, where supported. |
| `camera` | `camera` | `"back" \| "front" \| string` | `"back"` | Facing mode, or a `deviceId` from `Camera.list()`. |
| `torch` | `torch` | `boolean` | `false` | Flashlight. On `BarcodeScanner`, call `setTorch(true)` after `ready` instead. |
| `viewfinder` | `viewfinder` | `"frame" \| "line" \| "none"` | `"frame"`; `"line"` for linear-only sets | Viewfinder style. UI only; `BarcodeScanner` has no viewfinder. |
| `scanArea` | `scan-area` | `{ x, y, width, height }` (0 to 1); attribute `"x,y,w,h"` | Full frame; the element derives it from the viewfinder | Region of the camera frame to decode. |
| `maxResults` | `max-results` | `number` | `1`; `20` in batch | Codes decoded per frame. |
| `tryHarder` | `try-harder` | `boolean` | `false` for the camera | More CPU per frame for damaged, tiny or low-contrast codes. |
| `resolution` | `resolution` | `"sd" \| "hd" \| "fhd" \| "4k"` | `"hd"` | Requested camera resolution: 640x480, 1280x720, 1920x1080, 3840x2160. |
| `worker` | `worker` | `boolean` | `true` | Decode in a Web Worker. |

`BarcodeScanner` only:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `video` | `HTMLVideoElement` | a detached element | Where the preview plays. |
| `maxDecodeSize` | `number` | `1280` | Longest side, in pixels, of the image handed to the decoder. Lower is faster; higher finds smaller codes. |
| `maxFps` | `number` | `24` | Upper bound for decodes per second. |
| `tryInvert` | `boolean \| "alternate"` | `"alternate"` | Look for white-on-black codes on every frame (`true`), never (`false`), or every other frame. |

`<qrgen-scanner>` only:

| Attribute | Default | Description |
| --- | --- | --- |
| `autostart` | `true` | Start when connected. `false` shows a **Start scanning** screen. |
| `controls` | shown | `none` hides the buttons, the batch counter and **Scan again**. |
| `accent` | `#5cc9d6` | Accent color (hex). |
| `hint` | mode-specific | Instruction text; `""` hides it. |
| `toast` | `true` | Success toast with the scanned value. |

Other option sets:

- `scanImage()`: `symbologies`, `maxResults` (default 255), `tryHarder` (default `true`). See [Image scanning](../image-scanning/#options).
- `generate()`: see [Barcode generation](../barcode-generation/#options).
- `configure()`: see [Installation](../installation/#self-host-the-webassembly-engine).
- REST API query and body options: see [REST API](../rest-api/#scan).
- Embed page query string: see [Embed bridge](../embed-bridge/#query-options).

## BarcodeScanner events

Subscribe with `scanner.on(event, listener)`, which returns an unsubscribe function.

| Event | Payload | When |
| --- | --- | --- |
| `scan` | `{ barcodes: Barcode[] }` | New codes passed the duplicate filter. |
| `frame` | `{ barcodes: Barcode[], frameSize: Size, decodeMs: number }` | After every decoded frame, with everything found in it. |
| `track` | `{ tracked, added, updated, removed }` (`TrackedBarcode[]`) | Batch mode, after every decoded frame. |
| `state` | `ScannerState` | `idle`, `starting`, `scanning`, `paused`, `stopped`, `error`. |
| `ready` | `{ engine: "worker" \| "main", camera: Camera }` | Camera open, decoding started. |
| `error` | `QRGenError` | Start failed (also rejects `start()`), or the engine failed while scanning. |

## Element events

`<qrgen-scanner>` dispatches `CustomEvent`s that bubble and are composed. The payload is `event.detail`.

| Event | `detail` | React prop | Vue event |
| --- | --- | --- | --- |
| `scan` | `{ barcodes: Barcode[], barcode: Barcode }` | `onScan(barcodes, barcode)` | `@scan` |
| `track` | `{ tracked, added, removed }` | `onTrack(detail)` | `@track` |
| `select` | `{ barcode: TrackedBarcode \| null, selected: boolean, selection: TrackedBarcode[] }` | `onSelect(detail)` | `@select` |
| `ready` | `{ engine: "worker" \| "main" }` | `onReady(detail)` | `@ready` |
| `statechange` | `{ state: ScannerState }` | `onStateChange(state)` | `@statechange` |
| `error` | `{ code: QRGenErrorCode, message: string }` | `onError(error)` | `@error` |

`<qrgen-barcode>` dispatches:

| Event | `detail` |
| --- | --- |
| `render` | `{ svg: string, symbology: Symbology }` |
| `error` | `{ message: string }` |

The embed page forwards the scanner events as bridge messages; see the [message envelope](../embed-bridge/#message-envelope).

## Error codes

Errors are `QRGenError` instances with a `code`. The element's `error` event and the bridge carry `{ code, message }`.

| Code | Meaning | Common causes | Fix |
| --- | --- | --- | --- |
| `insecure-context` | The page isn't a secure context. | Served over `http://` from a hostname or IP other than `localhost`; opened from an unusual scheme. | Serve over HTTPS (or `http://localhost` in development). |
| `camera-permission-denied` | The browser or OS refused camera access. Mapped from `NotAllowedError`, `PermissionDeniedError` and `SecurityError`. | The user clicked **Block**, or blocked the camera for the site earlier; the OS denies the browser or app (macOS, Windows, iOS and Android privacy settings); an `<iframe>` without `allow="camera"`; a `Permissions-Policy` header without `camera`; a WebView host that doesn't grant camera requests. | Explain why you need the camera and how to re-enable it in the site settings. For iframes add `allow="camera"`. In apps, request the OS permission and grant WebView requests (see [Embed bridge](../embed-bridge/#host-examples)). |
| `camera-not-found` | No camera matched. Mapped from `NotFoundError`, `DevicesNotFoundError` and `OverconstrainedError`. | No camera on the device, or it is disabled; a `deviceId` that no longer exists (the scanner retries with the facing mode first). | Offer image upload with `scanImage()` as a fallback. Refresh the list with `Camera.list()`. |
| `camera-in-use` | The camera couldn't be started. Mapped from `NotReadableError`, `TrackStartError` and `AbortError`. | Another app or tab holds the camera (common on Windows); a driver or hardware error; on Android, the app lacks the runtime permission while the WebView granted the request. | Close other apps using the camera and retry. On Android, request the `CAMERA` permission before starting. |
| `engine-load-failed` | The WebAssembly engine couldn't be downloaded or compiled. | No network; a CSP without `'wasm-unsafe-eval'` or without the wasm origin in `connect-src`; a wrong `wasmBaseUrl` (404); wasm files missing from a serverless deployment. The message includes the URL that failed. | Allow the wasm origin and `'wasm-unsafe-eval'`, or [self-host the wasm](../installation/#self-host-the-webassembly-engine) and check the URL. |
| `unsupported` | The environment lacks a required feature, or the operation isn't possible. | A browser or WebView without `getUserMedia`; no Canvas 2D; a symbology that can't be generated. | Update the browser, open the page in the system browser instead of an in-app one, or fall back to `scanImage()`. |
| `bad-request` | The input is invalid. | `scanImage()` got an image that isn't loaded or a URL that failed; `generate()` got empty data, an unknown symbology, or data the symbology can't encode (the message says why); invalid REST requests. | Fix the input. Validate data before generating, for example digits only for EAN-13. |
| `unknown` | Anything else. | Unexpected browser errors. | Check `error.cause` for the original error. |

Handle errors from the promise or the event:

```js
import "qrgen-sdk/elements";

const scanner = document.querySelector("qrgen-scanner");

scanner.addEventListener("error", ({ detail }) => {
  switch (detail.code) {
    case "camera-permission-denied":
      showHelp("Allow camera access in your browser settings, then tap Try again.");
      break;
    case "camera-not-found":
      showHelp("No camera found. You can upload a photo instead.");
      break;
    case "insecure-context":
      showHelp("The scanner needs a secure (https) connection.");
      break;
    default:
      showHelp(detail.message);
  }
});

function showHelp(text) {
  document.querySelector("#help").textContent = text;
}
```

The element also shows its own error screen with the message and a **Try again** button.

The REST API returns the codes that apply to it (`bad-request`, `unsupported`, `engine-load-failed`, `unknown`), plus `not-found` (404) and `payload-too-large` (413). See [REST API errors](../rest-api/#errors).
