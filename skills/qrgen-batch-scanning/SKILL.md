---
name: qrgen-batch-scanning
description: Build multi-barcode (batch, MatrixScan-style) scanning with QRGen. Track many codes in one camera frame with AR highlights, count inventory, receive pallets, pick orders, let users tap codes to select them, or find a specific item among many. Use when the user wants to scan several barcodes at once, count items, or show overlays on every detected code.
---

# Batch scanning

`mode="batch"` decodes up to 20 codes per frame (`maxResults`), follows each code across frames
with a stable `id`, draws a highlight on every code, and lets the user tap to select one.
Identical codes in different places (two cans of the same product) get separate tracks, so counts are
correct.

## Web component

```html
<qrgen-scanner id="counter" mode="batch" symbologies="retail,code128" style="height: 70vh"></qrgen-scanner>
<p>In view: <b id="inView">0</b> · Unique codes seen: <b id="unique">0</b> · Selected: <b id="picked">0</b></p>
<script type="module">
  import "qrgen-sdk/elements";
  const el = document.getElementById("counter");
  const seen = new Map(); // data → count of distinct tracks
  el.addEventListener("track", (e) => {
    inView.textContent = e.detail.tracked.length;
    for (const t of e.detail.added) seen.set(t.data, (seen.get(t.data) ?? 0) + 1);
    unique.textContent = seen.size;
  });
  el.addEventListener("select", (e) => (picked.textContent = e.detail.selection.length));
</script>
```

Events:

- `track`: `{ tracked, added, removed }` after every processed frame. Each item is a `TrackedBarcode`:
  a `Barcode` plus `id`, `firstSeen`, `lastSeen` and `count` (frames seen). Tracks are dropped 500 ms after
  they leave the view.
- `scan`: only codes that pass the duplicate filter. In batch mode the default is `-1`, so each code
  is reported once per session; set `duplicate-filter="0"` to hear every new track.
- `select`: `{ barcode, selected, selection }` when the user taps a highlight. `el.selection` and
  `el.clearSelection()` are available too.

Batch mode hides the viewfinder, decodes the whole frame, and turns `tryHarder` on by default, because
codes can be anywhere in the image. Use `resolution="fhd"` for small codes far away. It costs more CPU.

## React

```tsx
<QRGenScanner mode="batch" symbologies={["retail"]} onTrack={({ tracked }) => setCount(tracked.length)} onSelect={({ selection }) => setPicked(selection)} />
```

## Custom UI with BarcodeScanner + BarcodeTracker

```ts
import { BarcodeScanner } from "qrgen-sdk";
const scanner = new BarcodeScanner({ video, mode: "batch", symbologies: ["qr", "data-matrix"], maxResults: 30 });
scanner.on("track", ({ tracked }) => draw(tracked)); // tracked[i].location is in video pixels
await scanner.start();
```

`BarcodeTracker` is also exported for your own frame source (e.g. a WebCodecs pipeline):
`tracker.update(barcodes, now)` → `{ tracked, added, updated, removed }`.

## Native

- Swift: `ScannerOptions(mode: .batch)`, `.onTrack { tracked in }` / `scanner.onTrack`.
- Kotlin: `ScannerOptions(mode = Mode.BATCH)`, `onTrack` listener.
- Python webcams: `scan_camera(mode="batch", on_scan=...)`.

## UX tips

- Tell users to hold the phone about 30–60 cm from the shelf and move slowly.
- Show the running count prominently and give haptic feedback on new items.
- Offer "Done" to freeze the list. Don't rely on tracks after the camera stops, because `tracked` resets.
- For "find this item", compare `tracked[].data` with the target and highlight only matches (use the
  `frame`/`track` data with your own overlay, or `controls="none"` plus a custom canvas).
