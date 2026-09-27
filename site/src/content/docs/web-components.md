---
title: Web Components
description: "Reference for the <qrgen-scanner> and <qrgen-barcode> custom elements: attributes, properties, methods, events, CSS custom properties, parts and sizing."
group: Web
order: 2
status: stable
---

`qrgen-sdk/elements` registers two framework-agnostic custom elements:

- `<qrgen-scanner>`: a complete camera scanner with viewfinder, code highlights, torch, camera switch, zoom, pause, a success toast, and start, loading and error screens.
- `<qrgen-barcode>`: renders any supported barcode as crisp, scalable SVG.

They work in plain HTML and in every framework. The React and Vue wrappers are thin layers over these elements.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

```js
import "qrgen-sdk/elements"; // registers <qrgen-scanner> and <qrgen-barcode>
```

The import is safe to run more than once and on the server (registration is skipped where `customElements` doesn't exist). Without a bundler, load the [CDN bundle](../cdn/) instead; it registers both elements too.

## `<qrgen-scanner>`

```html
<qrgen-scanner symbologies="qr,ean13,code128" mode="continuous" style="height: 480px"></qrgen-scanner>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.querySelector("qrgen-scanner");
  scanner.addEventListener("scan", (event) => {
    console.log(event.detail.barcode.symbology, event.detail.barcode.data);
  });
  scanner.addEventListener("error", (event) => {
    console.warn(event.detail.code, event.detail.message);
  });
</script>
```

By default the element opens the camera as soon as it is added to the page. The scanner needs a secure context (HTTPS or `http://localhost`); elsewhere it shows its error screen with an `insecure-context` error.

### Attributes and properties

Attributes are strings. The properties in the second column accept typed values (arrays, numbers, objects, booleans), which is convenient from frameworks. Setting a property updates the attribute.

| Attribute | Property | Values | Default | Description |
| --- | --- | --- | --- | --- |
| `symbologies` | `symbologies` | Comma or space separated ids, aliases or groups. The property also accepts an array and returns the resolved id array. | all | What to scan. See [Symbologies](../symbologies/). |
| `mode` | `mode` | `single`, `continuous`, `batch` | `continuous` | [Scan mode](../concepts/#scan-modes). |
| `duplicate-filter` | `duplicateFilter` | Milliseconds; `0` reports every frame, `-1` once per session | `1000` (`-1` in batch) | [Duplicate filter](../concepts/#duplicate-filter). |
| `beep` | `beep` | boolean | `true` | Play a tone on scan. |
| `vibrate` | `vibrate` | boolean | `true` | Vibrate on scan, where supported. |
| `camera` | `camera` | `back`, `front` or a `deviceId` | `back` | Which camera to open. Changing it restarts the camera. |
| `torch` | `torch` | boolean | `false` | Turn the flashlight on when the camera supports it. |
| `viewfinder` | `viewfinder` | `frame`, `line`, `none` | `frame` (`line` when only linear symbologies are enabled) | Viewfinder style. Hidden in batch mode. |
| `scan-area` | `scanArea` | `"x,y,width,height"`, normalized 0 to 1 (property: `{ x, y, width, height }`) | derived from the viewfinder | Overrides the automatic decode region. |
| `max-results` | `maxResults` | integer | `1` (`20` in batch) | Codes decoded per frame. |
| `autostart` | `autostart` | boolean | `true` | Start the camera when the element connects. When `false`, a **Start scanning** screen is shown. |
| `controls` | | `none` | shown | `none` hides the built-in buttons, the batch counter and the **Scan again** button. |
| `accent` | | CSS color, hex recommended | `#5cc9d6` | Accent color. Same as setting `--qrgen-accent`. |
| `hint` | | text | mode-specific | Instruction pill at the bottom. `hint=""` hides it. |
| `toast` | | boolean | `true` | Show the success toast with the scanned value (single and continuous modes). |
| `try-harder` | | boolean | `false` | Spend more CPU per frame on damaged or tiny codes. |
| `resolution` | | `sd`, `hd`, `fhd`, `4k` | `hd` | Requested camera resolution (640x480, 1280x720, 1920x1080, 3840x2160). |
| `worker` | | boolean | `true` | Decode in a Web Worker. |

Boolean attributes are `true` when present without a value (`<qrgen-scanner torch>`), and `false` for the values `false`, `0`, `off` and `no`. Because `autostart`, `beep` and `vibrate` default to `true`, turn them off with an explicit value: `autostart="false"`.

Changes to most attributes apply immediately while scanning. `camera` restarts the camera. `resolution` and `worker` take effect the next time the element creates its scanner (for example after you change `camera`, or remove and re-add the element).

Read-only properties:

| Property | Type | Description |
| --- | --- | --- |
| `state` | `ScannerState` | `idle`, `starting`, `scanning`, `paused`, `stopped` or `error`. |
| `scanner` | `BarcodeScanner \| null` | The underlying [`BarcodeScanner`](../javascript/), created on first start. Use it for `frame` events, `stats` and options the element has no attribute for, such as `maxDecodeSize`. |
| `lastResult` | `Barcode \| null` | The last barcode reported by a `scan` event. |
| `selection` | `TrackedBarcode[]` | Batch mode: codes the user tapped. |
| `options` | `BarcodeScannerOptions` | The scanner options derived from the current attributes. |

### Methods

| Method | Returns | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Open the camera and start scanning. Rejects with a `QRGenError` on failure (the error screen is shown too). |
| `stop()` | `void` | Stop and release the camera. Shows the start screen. |
| `pause()` | `void` | Stop decoding, keep the preview. |
| `resume()` | `void` | Continue after `pause()` or a single-mode scan. |
| `setTorch(on)` | `Promise<boolean>` | `false` when the camera has no torch. |
| `toggleTorch()` | `Promise<boolean>` | The new torch state. |
| `setZoom(zoom)` | `Promise<boolean>` | `false` when zoom is not supported. |
| `switchCamera()` | `Promise<void>` | Front/back, or the next camera. |
| `clearSelection()` | `void` | Batch mode: clear the tapped selection and fire `select` with an empty selection. |

Removing the element from the page stops the camera and releases everything. Adding it back starts it again (unless `autostart="false"`).

### Events

All events are `CustomEvent`s that bubble and cross shadow DOM boundaries. Read the payload from `event.detail`.

| Event | `detail` | When |
| --- | --- | --- |
| `scan` | `{ barcodes: Barcode[], barcode: Barcode }` | New codes passed the duplicate filter. `barcode` is `barcodes[0]`. |
| `track` | `{ tracked: TrackedBarcode[], added: TrackedBarcode[], removed: TrackedBarcode[] }` | Batch mode, after every decoded frame. |
| `select` | `{ barcode: TrackedBarcode \| null, selected: boolean, selection: TrackedBarcode[] }` | Batch mode: the user tapped a highlighted code, or `clearSelection()` was called (`barcode: null`). |
| `ready` | `{ engine: "worker" \| "main" }` | The camera is open and decoding started. |
| `statechange` | `{ state: ScannerState }` | The scanner state changed. |
| `error` | `{ code: QRGenErrorCode, message: string }` | Starting failed or the engine failed to load. See [error codes](../options-events/#error-codes). |

In TypeScript, cast the event to read `detail`:

```ts
import "qrgen-sdk/elements";
import type { Barcode } from "qrgen-sdk";

const el = document.querySelector("qrgen-scanner")!; // typed as QRGenScannerElement
el.addEventListener("scan", (event) => {
  const { barcode } = (event as CustomEvent<{ barcodes: Barcode[]; barcode: Barcode }>).detail;
  console.log(barcode.data);
});
```

The element doesn't re-dispatch the per-frame `frame` event. Subscribe on the underlying scanner when you need it:

```js
el.addEventListener("ready", () => {
  el.scanner.on("frame", ({ barcodes, decodeMs }) => console.log(barcodes.length, decodeMs));
});
```

### Screens and built-in controls

The element manages its own screens:

- **Start**: shown when `autostart="false"` or after `stop()`. A **Start scanning** button calls `start()`. Starting from a tap also unlocks audio on iOS.
- **Loading**: while the camera and engine start.
- **Error**: shows the error message and a **Try again** button.
- **Scan again**: in single mode, after a successful scan.

While scanning, the top bar has pause, torch and camera-switch buttons, and the bottom bar has a zoom pill and, in batch mode, a counter. Torch, switch and zoom only appear when the device supports them. `controls="none"` hides both bars and the **Scan again** button; in single mode you then resume with `resume()` from your own UI.

### Styling

CSS custom properties, set on the element or any ancestor:

| Property | Default | Used for |
| --- | --- | --- |
| `--qrgen-accent` | `#5cc9d6` | Highlights, laser line, buttons, toast icon, counter |
| `--qrgen-accent-contrast` | `#062029` | Text and icons on accent-colored surfaces |
| `--qrgen-radius` | `0px` | Corner radius of the element |
| `--qrgen-font` | system UI stack | All text |

```css
qrgen-scanner {
  --qrgen-accent: #ff6b35;
  --qrgen-accent-contrast: #ffffff;
  --qrgen-radius: 16px;
  --qrgen-font: "Inter", system-ui, sans-serif;
}
```

The `accent` attribute sets `--qrgen-accent` as an inline style, so it wins over stylesheet values. Use hex colors (`#rgb` or `#rrggbb`) for the accent: the overlay derives translucent fills from them.

Shadow parts, for deeper styling with `::part()`:

| Part | Element |
| --- | --- |
| `root` | Container of everything inside the element |
| `video` | The camera preview (`object-fit: cover`) |
| `overlay` | Canvas that draws code highlights |
| `viewfinder` | The viewfinder frame or line |
| `hint` | The instruction pill |
| `toast` | The success toast |
| `controls` | The top and bottom control bars (both carry this part) |

```css
qrgen-scanner::part(hint) {
  bottom: 24px;
  font-size: 15px;
}
qrgen-scanner::part(toast) {
  border-radius: 12px;
}
qrgen-scanner::part(video) {
  filter: saturate(0.8);
}
```

More recipes, including a fully custom UI, are in [UI customization](../ui-customization/).

### Sizing

The element is `display: block` with `width: 100%`, `height: 100%` and `min-height: 280px`. Inside a container without an explicit height it collapses to 280 px, so give it a height or an aspect ratio:

```css
/* Fixed height */
qrgen-scanner { height: 480px; }

/* Aspect ratio */
qrgen-scanner { height: auto; aspect-ratio: 3 / 4; max-width: 480px; }

/* Full screen */
qrgen-scanner { position: fixed; inset: 0; height: 100dvh; }
```

The video fills the element with `object-fit: cover`, so the preview is cropped rather than letterboxed. The decode region follows what is visible.

## `<qrgen-barcode>`

```html
<qrgen-barcode value="https://example.com" symbology="qr" ec-level="M" style="width: 160px"></qrgen-barcode>
<qrgen-barcode value="5901234123457" symbology="ean13" hrt style="width: 240px"></qrgen-barcode>
<qrgen-barcode value="(01)09501101530003(17)250101(10)ABC123" symbology="data-matrix" gs1></qrgen-barcode>
```

### Attributes

| Attribute | Default | Description |
| --- | --- | --- |
| `value` | | The data to encode. Nothing renders while it is empty. Also available as the `value` property. |
| `symbology` | `qr` | Symbology id or alias. Must be [writable](../symbologies/). |
| `scale` | `4` | Module size in pixels, which sets the SVG's natural size. |
| `ec-level` | encoder default | Error correction: `L`, `M`, `Q`, `H` for QR, or a percentage for Aztec and PDF417. |
| `foreground` | `#000000` | Bar and module color. |
| `background` | `#ffffff` | Background color, or `transparent`. |
| `hrt` | off | Print the human-readable text under linear barcodes. |
| `margin` | on | Quiet zone around the symbol. `margin="false"` removes it. |
| `gs1` | off | Encode `value` as GS1 (HRI form, `(01)...(10)...`). |
| `rotate` | `0` | `0`, `90`, `180` or `270`. |
| `alt` | `"<symbology> barcode: <value>"` | Accessible label on the SVG (`role="img"`). |

`hrt` and `gs1` are on when present, unless set to `"false"`. Changing any attribute re-renders.

The read-only `svg` property holds the last rendered SVG markup, handy for downloads:

```js
const el = document.querySelector("qrgen-barcode");
el.addEventListener("render", () => {
  const url = URL.createObjectURL(new Blob([el.svg], { type: "image/svg+xml" }));
  document.querySelector("a#download").href = url;
});
```

### Events

| Event | `detail` | When |
| --- | --- | --- |
| `render` | `{ svg: string, symbology: Symbology }` | The barcode rendered. |
| `error` | `{ message: string }` | The value can't be encoded (for example letters in an EAN-13). The message is also shown in place of the barcode. |

### Sizing and parts

The element is `inline-block`. Without CSS it renders at its natural size (modules times `scale`). Set a `width` (or `height`) and the SVG scales without blurring, keeping its aspect ratio. The inner container is exposed as `::part(barcode)`.

## Frameworks

- React: [`QRGenScanner` and `QRGenBarcode`](../react/)
- Vue and Nuxt: [components and plugin](../vue/)
- [Angular](../angular/), [Svelte](../svelte/): use the elements directly
- WebViews and iframes: the [embed page and bridge](../embed-bridge/)
