---
title: UI customization
description: "Restyle the <qrgen-scanner> element with the accent color, CSS custom properties and shadow parts, or build a fully custom scanner UI on BarcodeScanner."
group: Features
order: 8
---

`<qrgen-scanner>` is designed to look right out of the box, and to be restyled without forking it. There are three levels of customization:

1. **Theme it**: accent color, font and corner radius through attributes and CSS custom properties.
2. **Restyle parts**: position and style the hint, toast, controls, viewfinder and video with `::part()`, or hide them.
3. **Build your own UI**: use `BarcodeScanner` with your own `<video>`, overlay and controls.

## Accent color

```html
<qrgen-scanner accent="#ff6b35"></qrgen-scanner>
```

The accent colors the code highlights, the laser line, the success flash on the viewfinder, the toast icon, buttons and the batch counter. Use a hex color (`#rgb` or `#rrggbb`); the overlay derives translucent fills from it. Text and icons on accent-colored surfaces use `--qrgen-accent-contrast`, so set that too when you pick a light or dark accent:

```css
qrgen-scanner {
  --qrgen-accent: #ffd60a;
  --qrgen-accent-contrast: #1c1c1e;
}
```

## CSS custom properties

| Property | Default | Controls |
| --- | --- | --- |
| `--qrgen-accent` | `#5cc9d6` | Highlights, laser, buttons, toast icon, counter |
| `--qrgen-accent-contrast` | `#062029` | Text and icons on accent surfaces |
| `--qrgen-radius` | `0px` | Corner radius of the scanner |
| `--qrgen-font` | system UI font stack | All text in the scanner |

```css
qrgen-scanner {
  --qrgen-accent: #6e56cf;
  --qrgen-accent-contrast: #ffffff;
  --qrgen-radius: 20px;
  --qrgen-font: "Inter", ui-sans-serif, system-ui, sans-serif;
  height: 520px;
  box-shadow: 0 20px 50px rgb(0 0 0 / 0.25);
}
```

Custom properties inherit, so you can set them once on `:root` or a theme class. The `accent` attribute is applied as an inline style and wins over stylesheet values.

## Shadow parts

| Part | What it is |
| --- | --- |
| `root` | The container that holds everything |
| `video` | The camera preview |
| `overlay` | The canvas with code highlights |
| `viewfinder` | The viewfinder frame or line box |
| `hint` | The instruction pill near the bottom |
| `toast` | The success toast at the top |
| `controls` | The top and bottom control bars |

```css
/* Move the hint to the top and make it larger */
qrgen-scanner::part(hint) {
  top: 72px;
  bottom: auto;
  font-size: 15px;
  padding: 10px 18px;
}

/* A square, flat toast */
qrgen-scanner::part(toast) {
  border-radius: 8px;
  background: rgb(0 0 0 / 0.85);
}

/* A slightly desaturated preview */
qrgen-scanner::part(video) {
  filter: saturate(0.85) contrast(1.05);
}

/* Hide the viewfinder outline but keep the automatic scan area */
qrgen-scanner::part(viewfinder) {
  visibility: hidden;
}
```

Hiding the `viewfinder` part keeps the decode region the viewfinder defines; `viewfinder="none"` instead scans the whole preview.

## Hint text

```html
<qrgen-scanner hint="Scan the QR code on your ticket"></qrgen-scanner>
<qrgen-scanner hint=""></qrgen-scanner> <!-- no hint -->
```

The default hint depends on the mode ("Point the camera at a barcode or QR code", or a batch-specific text). It fades out after the first successful scan.

## Hide controls and the toast

```html
<!-- No buttons, no counter, no "Scan again" button -->
<qrgen-scanner controls="none"></qrgen-scanner>

<!-- No success toast (the highlight and viewfinder flash remain) -->
<qrgen-scanner toast="false"></qrgen-scanner>
```

With `controls="none"`, provide your own buttons that call the element's methods: `pause()`, `resume()`, `toggleTorch()`, `switchCamera()`, `setZoom()`. In single mode, call `resume()` to scan again.

```html
<qrgen-scanner id="scanner" mode="single" controls="none" toast="false" style="height: 400px"></qrgen-scanner>
<div class="toolbar">
  <button id="torch">Flashlight</button>
  <button id="again" hidden>Scan next</button>
</div>

<script type="module">
  import "qrgen-sdk/elements";

  const scanner = document.getElementById("scanner");
  const again = document.getElementById("again");

  scanner.addEventListener("scan", ({ detail }) => {
    console.log(detail.barcode.data);
    again.hidden = false;
  });
  again.addEventListener("click", () => {
    again.hidden = true;
    scanner.resume();
  });
  document.getElementById("torch").addEventListener("click", () => scanner.toggleTorch());
</script>
```

## Build a fully custom UI

For complete control, skip the element and use `BarcodeScanner` with your own markup. The scanner reports every decoded frame through the `frame` event, with code corners in camera-frame pixels. To draw them over a preview that uses `object-fit: cover`, map each point from frame coordinates to element coordinates.

### The mapping

With `object-fit: cover`, the video is scaled uniformly until it covers the element, then centered, and the overflow is cropped:

```text
scale   = max(viewWidth / frameWidth, viewHeight / frameHeight)
offsetX = (viewWidth  - frameWidth  * scale) / 2     // <= 0: cropped on the left and right
offsetY = (viewHeight - frameHeight * scale) / 2     // <= 0: cropped at the top and bottom

viewX = offsetX + frameX * scale
viewY = offsetY + frameY * scale
```

If you mirror the preview for a front camera (`transform: scaleX(-1)`), mirror the x coordinate too: `viewX = viewWidth - viewX`.

The inverse maps a rectangle on screen (for example your own viewfinder) to a normalized `scanArea`:

```text
frameX = (viewX - offsetX) / scale
frameY = (viewY - offsetY) / scale
scanArea.x = frameX / frameWidth, scanArea.width = (frameX2 - frameX) / frameWidth, ...
```

### Complete example

```html
<div class="scanner">
  <video id="video"></video>
  <canvas id="overlay"></canvas>
  <div class="finder"></div>
  <div class="controls">
    <button id="start">Start</button>
    <button id="torch" hidden>Torch</button>
  </div>
  <output id="result"></output>
</div>

<style>
  .scanner { position: relative; height: 70vh; overflow: hidden; background: #000; color: #fff; font: 14px system-ui, sans-serif; }
  .scanner video, .scanner canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .scanner video { object-fit: cover; }
  .scanner video.mirror { transform: scaleX(-1); }
  .scanner canvas { pointer-events: none; }
  .finder { position: absolute; left: 10%; right: 10%; top: 35%; height: 30%; border: 2px dashed rgb(255 255 255 / 0.7); border-radius: 12px; pointer-events: none; }
  .controls { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
  #result { position: absolute; left: 12px; right: 12px; bottom: 12px; padding: 8px 12px; border-radius: 8px; background: rgb(0 0 0 / 0.6); }
  #result:empty { display: none; }
</style>

<script type="module" src="./custom-scanner.ts"></script>
```

```ts
// custom-scanner.ts
import { BarcodeScanner, type Barcode, type Point, type ScanArea, type Size } from "qrgen-sdk";

const root = document.querySelector<HTMLDivElement>(".scanner")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const finder = document.querySelector<HTMLDivElement>(".finder")!;
const result = document.querySelector<HTMLOutputElement>("#result")!;
const torchButton = document.querySelector<HTMLButtonElement>("#torch")!;
const ctx = canvas.getContext("2d")!;

const scanner = new BarcodeScanner({ video, symbologies: ["qr", "ean13", "code128"], maxResults: 4, beep: true });

interface Cover {
  scale: number;
  offsetX: number;
  offsetY: number;
  view: Size;
  frame: Size;
  mirror: boolean;
}

function cover(frame: Size): Cover {
  const view = { width: root.clientWidth, height: root.clientHeight };
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  return {
    scale,
    offsetX: (view.width - frame.width * scale) / 2,
    offsetY: (view.height - frame.height * scale) / 2,
    view,
    frame,
    mirror: scanner.camera.isFront,
  };
}

function toView(p: Point, c: Cover): Point {
  const x = c.offsetX + p.x * c.scale;
  return { x: c.mirror ? c.view.width - x : x, y: c.offsetY + p.y * c.scale };
}

function toScanArea(el: HTMLElement, c: Cover): ScanArea {
  const r = el.getBoundingClientRect();
  const base = root.getBoundingClientRect();
  let x0 = (r.left - base.left - c.offsetX) / c.scale;
  let x1 = (r.right - base.left - c.offsetX) / c.scale;
  if (c.mirror) [x0, x1] = [c.frame.width - x1, c.frame.width - x0];
  const y0 = (r.top - base.top - c.offsetY) / c.scale;
  const y1 = (r.bottom - base.top - c.offsetY) / c.scale;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(x0 / c.frame.width);
  const y = clamp(y0 / c.frame.height);
  return { x, y, width: clamp(x1 / c.frame.width) - x, height: clamp(y1 / c.frame.height) - y };
}

let lastCodes: Barcode[] = [];
let lastSeen = 0;

function draw(barcodes: Barcode[], frame: Size) {
  const now = performance.now();
  if (barcodes.length) {
    lastCodes = barcodes;
    lastSeen = now;
  } else if (now - lastSeen > 300) {
    lastCodes = []; // keep highlights briefly so they don't flicker between frames
  }

  const c = cover(frame);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(c.view.width * dpr) || canvas.height !== Math.round(c.view.height * dpr)) {
    canvas.width = Math.round(c.view.width * dpr);
    canvas.height = Math.round(c.view.height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.view.width, c.view.height);

  for (const b of lastCodes) {
    const { topLeft, topRight, bottomRight, bottomLeft } = b.location;
    const points = [topLeft, topRight, bottomRight, bottomLeft].map((p) => toView(p, c));
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#00e5a0";
    ctx.fillStyle = "rgb(0 229 160 / 0.2)";
    ctx.fill();
    ctx.stroke();
  }
}

function updateScanArea() {
  const { width, height } = scanner.camera.videoSize;
  if (width && height) scanner.setOptions({ scanArea: toScanArea(finder, cover({ width, height })) });
}

scanner.on("frame", ({ barcodes, frameSize }) => draw(barcodes, frameSize));

scanner.on("scan", ({ barcodes }) => {
  result.textContent = `${barcodes[0].symbologyName}: ${barcodes[0].data}`;
});

scanner.on("ready", ({ camera }) => {
  video.classList.toggle("mirror", camera.isFront);
  torchButton.hidden = !camera.capabilities.torch;
  updateScanArea();
});

scanner.on("error", (err) => {
  result.textContent = `${err.code}: ${err.message}`;
});

new ResizeObserver(updateScanArea).observe(root);

document.querySelector("#start")!.addEventListener("click", () => void scanner.start().catch(() => undefined));
torchButton.addEventListener("click", () => void scanner.toggleTorch());
```

This gives you the same behavior as the element: codes are only decoded inside your viewfinder, highlights are drawn where the codes are on screen, and the preview is mirrored for front cameras. From here you can add anything: animations, labels next to each code (`b.data`), sounds (`beep: false` plus your own audio), or batch-mode boxes from the `track` event.

`quadCenter(location)` and `quadBounds(location)` from `qrgen-sdk` return a code's center point and axis-aligned bounding box in frame pixels, handy for placing labels.
