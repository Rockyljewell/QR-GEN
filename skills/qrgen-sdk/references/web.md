# Web: the `<qrgen-scanner>` element

Works in plain HTML and every framework. `import "qrgen-sdk/elements"` registers `<qrgen-scanner>`
and `<qrgen-barcode>`. Importing it on the server is safe; registration then does nothing.

## Install

```bash
npm install qrgen-sdk   # or the tarball: https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz
```

CDN (no build step):

```html
<script type="module" src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js"></script>
<!-- or a classic script exposing window.QRGen -->
<script src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js"></script>
```

## Attributes (all optional)

| attribute | values | default |
| --- | --- | --- |
| `symbologies` | comma list of ids/groups, e.g. `qr,ean13` or `retail` | `all` |
| `mode` | `single`, `continuous`, `batch` | `continuous` |
| `duplicate-filter` | ms; `0` every frame, `-1` once per session | `1000` (`-1` in batch) |
| `beep`, `vibrate` | `true` / `false` | `true` |
| `camera` | `back`, `front`, or a deviceId | `back` |
| `torch` | `true` / `false` | `false` |
| `viewfinder` | `frame`, `line`, `none` | `frame` (`line` for linear-only) |
| `scan-area` | `x,y,width,height` normalized 0..1 | derived from the viewfinder |
| `max-results` | codes per frame | `1` (`20` in batch) |
| `autostart` | `false` shows a Start button | `true` |
| `controls` | `none` hides built-in buttons | shown |
| `accent` | CSS color for viewfinder/highlights | `#5cc9d6` |
| `hint` | helper text | built-in |
| `toast` | `false` hides the success toast | `true` |
| `try-harder` | `true` for damaged/small codes (slower) | `false` (`true` in batch) |
| `resolution` | `sd`, `hd`, `fhd`, `4k` | `hd` |

Properties mirror the attributes (`el.symbologies = ["qr"]`, `el.mode = "single"`).

## Methods

`start()`, `stop()`, `pause()`, `resume()`, `setTorch(on)`, `toggleTorch()`, `switchCamera()`,
`setZoom(z)`, `clearSelection()`; getters `state`, `scanner` (the underlying `BarcodeScanner`),
`selection`, `lastResult`.

## Events (`CustomEvent`, bubbling, composed)

| event | detail |
| --- | --- |
| `scan` | `{ barcodes: Barcode[], barcode: Barcode }`, new codes after the duplicate filter |
| `track` | `{ tracked, added, removed }` (batch mode) |
| `select` | `{ barcode, selected, selection }` (batch tap) |
| `ready` | `{ engine: "worker" \| "main" }` |
| `error` | `{ code, message }` |
| `statechange` | `{ state: "idle" \| "starting" \| "scanning" \| "paused" \| "stopped" \| "error" }` |

## Styling

The element fills its container: give it a height (`style="height: 60vh"`). CSS custom properties
`--qrgen-accent`, `--qrgen-accent-contrast`, `--qrgen-radius`, `--qrgen-font`; parts `::part(video)`,
`::part(overlay)`, `::part(viewfinder)`, `::part(hint)`, `::part(toast)`, `::part(controls)`.

## Render a barcode

```html
<qrgen-barcode value="https://example.com" symbology="qr" ec-level="M" style="width: 180px"></qrgen-barcode>
<qrgen-barcode value="5901234123457" symbology="ean13" hrt></qrgen-barcode>
```

## Self-hosting the engine (offline, strict CSP)

```js
import { configure } from "qrgen-sdk";
configure({ wasmBaseUrl: "/qrgen/" }); // serve node_modules/qrgen-sdk/dist/wasm/* at /qrgen/
```

Or set `window.QRGEN_WASM_BASE = "/qrgen/"` before the SDK loads.
