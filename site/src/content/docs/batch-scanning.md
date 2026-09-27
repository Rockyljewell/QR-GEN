---
title: Batch scanning
description: "Scan and track many barcodes at once with batch mode: track events, TrackedBarcode ids, tap to select, counting items in view, and BarcodeTracker for custom interfaces."
group: Features
order: 2
---

Batch mode finds every code in view on every frame and follows each one as the camera moves. Each physical code gets a stable `id` while it stays in view, so two identical cans on a shelf are two separate tracks. Use it for shelf audits, receiving pallets with many labels, counting stock, or letting the user pick one code among several.

## Turn it on

```html
<qrgen-scanner mode="batch" symbologies="retail,code128" style="height: 70vh"></qrgen-scanner>
```

In batch mode the element:

- Decodes the whole visible preview (the viewfinder is hidden) and up to 20 codes per frame (`max-results`).
- Draws a highlight on every tracked code, with a label when eight or fewer are in view.
- Shows a counter pill: "3 barcodes in view", or "1 selected · 3 in view".
- Lets the user tap a highlight to select it; tapped codes show a check mark.
- Beeps (at most every 250 ms) when a code value appears for the first time.

The same mode is available as `mode: "batch"` on `BarcodeScanner`, the React `QRGenScanner` and the Vue component.

## Events

| Event | `detail` | When |
| --- | --- | --- |
| `track` | `{ tracked, added, removed }` | After every decoded frame. `tracked` is everything currently in view. |
| `scan` | `{ barcodes, barcode }` | A code value appeared for the first time this session. |
| `select` | `{ barcode, selected, selection }` | The user tapped a code (`selected` is `true` when it was added to the selection). |

`track` is the source of truth for what is in view. It fires up to 24 times per second, so update your UI from it sparingly (for example with `requestAnimationFrame`).

`scan` is filtered by the duplicate filter, which defaults to `-1` in batch mode: each distinct value (symbology plus data) is reported once until the scanner restarts. Two identical cans produce one `scan` event but two tracks. Use `track` to count.

## TrackedBarcode

Tracked results are regular [Barcode](../concepts/#the-barcode-result) objects with four extra fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `number` | Stable id for as long as the code stays in view. |
| `firstSeen` | `number` | When the track started (ms since epoch). |
| `lastSeen` | `number` | When the code was last decoded. |
| `count` | `number` | Number of frames the code was decoded in. |

`location` is updated every frame, in camera-frame pixels. A track is dropped when its code hasn't been decoded for 500 ms; if the code comes back later, it gets a new `id`.

## Tap to select

```html
<qrgen-scanner id="scanner" mode="batch" symbologies="code128" style="height: 60vh"></qrgen-scanner>
<button id="confirm" disabled>Pick selected</button>
<button id="clear">Clear</button>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.getElementById("scanner");
  const confirm = document.getElementById("confirm");

  scanner.addEventListener("select", ({ detail }) => {
    confirm.disabled = detail.selection.length === 0;
    confirm.textContent = `Pick ${detail.selection.length} selected`;
  });

  confirm.addEventListener("click", () => {
    const codes = scanner.selection.map((b) => b.data);
    console.log("Picked", codes);
    scanner.clearSelection();
  });

  document.getElementById("clear").addEventListener("click", () => scanner.clearSelection());
</script>
```

`selection` holds the tapped codes as `TrackedBarcode` objects captured at the moment of the tap. Tapping a selected code again deselects it. `clearSelection()` empties the selection and fires `select` with `barcode: null`.

## Count items in view

This example counts how many of each product are visible, and adds the current view to an inventory when the user confirms. Counting from the current view (instead of summing every `added` event) avoids double counting when a code briefly leaves the frame and comes back with a new track id.

```html
<qrgen-scanner id="scanner" mode="batch" symbologies="retail" hint="Frame the whole shelf, then tap Count" style="height: 60vh"></qrgen-scanner>
<p id="live">Nothing in view</p>
<button id="count">Count</button>
<table id="inventory"></table>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.getElementById("scanner");
  const live = document.getElementById("live");
  const inventory = new Map(); // GTIN -> quantity
  let inView = new Map();

  scanner.addEventListener("track", ({ detail }) => {
    inView = new Map();
    for (const code of detail.tracked) inView.set(code.data, (inView.get(code.data) ?? 0) + 1);
    live.textContent = inView.size
      ? [...inView].map(([gtin, n]) => `${gtin} x${n}`).join(", ")
      : "Nothing in view";
  });

  document.getElementById("count").addEventListener("click", () => {
    for (const [gtin, n] of inView) inventory.set(gtin, (inventory.get(gtin) ?? 0) + n);
    const table = document.getElementById("inventory");
    table.replaceChildren(
      ...[...inventory].map(([gtin, n]) => {
        const row = document.createElement("tr");
        row.append(Object.assign(document.createElement("td"), { textContent: gtin }), Object.assign(document.createElement("td"), { textContent: String(n) }));
        return row;
      })
    );
  });
</script>
```

Tips for reliable counts:

- Hold the camera still for a moment so every code is decoded; wait until the live count stops changing.
- Use `resolution="fhd"` for shelves with many small codes, so each code has enough pixels.
- Codes that are too small, too angled or occluded won't be found. Show the live count so the user can reposition.

## Batch mode with BarcodeScanner

```ts
import { BarcodeScanner } from "qrgen-sdk";

const scanner = new BarcodeScanner({ video, mode: "batch", symbologies: ["qr", "data-matrix"] });

scanner.on("track", ({ tracked, added, removed }) => {
  for (const t of added) console.log("new", t.id, t.data);
  for (const t of removed) console.log("gone", t.id, t.data);
  drawBoxes(tracked); // see UI customization for mapping locations to the screen
});

await scanner.start();
```

`BarcodeScanner`'s `track` payload also includes `updated`: the tracks that were seen again in this frame. The tracker is available as `scanner.tracker` (`size`, `all`, `clear()`).

Switching an existing scanner with `scanner.setOptions({ mode: "batch" })` applies the batch defaults (`maxResults: 20`, `duplicateFilter: -1`, `tryHarder: true`) unless you set those options yourself.

## BarcodeTracker for custom interfaces

`BarcodeTracker` is the tracking logic on its own. Feed it detections from any source (camera frames, a video file, your own decoder) and it assigns ids:

```ts
import { BarcodeScanner, BarcodeTracker } from "qrgen-sdk";

const tracker = new BarcodeTracker({ timeout: 800, maxJump: 3 });
const scanner = new BarcodeScanner({ video, mode: "continuous", maxResults: 10, duplicateFilter: 0 });

scanner.on("frame", ({ barcodes }) => {
  const { tracked, added, removed } = tracker.update(barcodes);
  render(tracked, added, removed);
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `timeout` | `500` | Drop a track after this many milliseconds without a detection. |
| `maxJump` | `3` | How far a code may move between frames and keep its id, relative to its size. |

`update(detections, now?)` returns `{ tracked, added, updated, removed }`. Detections match an existing track only when symbology and data are equal and the code is within `maxJump` code-sizes of the track's last position, so identical codes in different places get separate ids.

## Performance

Batch mode decodes the full frame for up to 20 codes, which is heavier than single-code scanning. On older phones:

- Limit `symbologies` to what is on the shelf.
- Lower `max-results` if you never have that many codes in view.
- Keep `resolution="hd"` unless codes are small.
- Check `scanner.stats` (`decodeMs`, `fps`) on the underlying `BarcodeScanner` to measure.
