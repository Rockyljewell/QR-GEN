---
name: qrgen-batch-scanning
description: Build multi-barcode scanning with QRGen. Track decoded codes in one camera frame, highlight their locations, display automatic counts, and choose results from an accessible list. Use when the user wants to scan several barcodes at once, count decoded items, or review multiple results.
---

# Batch scanning

`mode="batch"` decodes up to 20 codes per frame (`maxResults`), follows each code across frames
with a stable `id`, draws a highlight on every code, and provides selection buttons below the camera preview.
Identical codes in different places (two cans of the same product) get separate tracks. Counts describe
decoded tracks in view; missing, obscured or unreadable codes can still affect accuracy.

## Web component

```html
<qrgen-scanner id="counter" mode="batch" symbologies="retail,code128" style="height: 70vh"></qrgen-scanner>
<p>In view: <b id="inView">0</b> · Unique values seen: <b id="unique">0</b></p>
<script type="module">
  import "qrgen-sdk/elements";
  const el = document.getElementById("counter");
  const seen = new Map(); // data → count of distinct tracks
  el.addEventListener("track", (e) => {
    inView.textContent = e.detail.tracked.length;
    for (const t of e.detail.added) seen.set(t.data, (seen.get(t.data) ?? 0) + 1);
    unique.textContent = seen.size;
  });
  el.addEventListener("select", (e) => console.log("Chosen results", e.detail.selection));
</script>
```

Events:

- `track`: `{ tracked, added, removed }` after every processed frame. Each item is a `TrackedBarcode`:
  a `Barcode` plus `id`, `firstSeen`, `lastSeen` and `count` (frames seen). Tracks are dropped 500 ms after
  they leave the view.
- `scan`: only codes that pass the duplicate filter. In batch mode the default is `-1`, so each code
  is reported once per session; set `duplicate-filter="0"` to hear every new track.
- `select`: `{ barcode, selected, selection }` when a result's selection changes. Rows support touch,
  mouse and keyboard. `el.selection`, `el.selectBarcode(id, selected?)` and `el.clearSelection()` are
  available too. The automatic in-view count stays independent of selection.

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
