# Low-level JavaScript API

Use this for a custom UI. The element is built on these classes.

```ts
import { BarcodeScanner, scanImage, generate, configure, resolveSymbologies, QRGenError } from "qrgen-sdk";
```

## BarcodeScanner

```ts
const video = document.querySelector("video")!;
const scanner = new BarcodeScanner({ video, symbologies: ["qr", "ean13"], mode: "continuous" });

scanner.on("scan", ({ barcodes }) => console.log(barcodes[0].data)); // new codes only
scanner.on("frame", ({ barcodes, frameSize, decodeMs }) => drawOverlay(barcodes, frameSize)); // every decode
scanner.on("track", ({ tracked, added, removed }) => {}); // batch mode
scanner.on("state", (state) => {}); // idle | starting | scanning | paused | stopped | error
scanner.on("error", (err) => console.warn(err.code, err.message));
scanner.on("ready", ({ engine }) => {}); // "worker" | "main"

await scanner.start(); // call from a click handler so iOS allows the beep
scanner.pause();
scanner.resume();
await scanner.toggleTorch();
await scanner.switchCamera();
await scanner.setZoom(2);
scanner.setOptions({ symbologies: ["retail"], scanArea: { x: 0.1, y: 0.3, width: 0.8, height: 0.4 } });
scanner.stop(); // releases the camera
scanner.destroy();
```

`scanner.stats` → `{ decodeMs, fps, engine }`. `scanner.camera` is a `Camera` (`capabilities`,
`isFront`, `isTorchOn`, `Camera.list()`).

Constructor options: every scanner option plus `video`, `maxDecodeSize` (default 1280),
`maxFps` (24), `tryInvert` (`"alternate"`), `worker` (true).

`location` coordinates are in video-frame pixels. With `object-fit: cover`, map a point to the element
like this: `scale = max(W/vw, H/vh)`, `x' = (W - vw*scale)/2 + x*scale`, same for y (mirror x for the
front camera).

## Images and files

```ts
const codes = await scanImage(fileOrBlobOrCanvasOrUrl, { symbologies: ["qr"], tryHarder: true, maxResults: 10 });
```

Accepts `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, `ImageData`, `HTMLImageElement`,
`HTMLCanvasElement`, `HTMLVideoElement`, `ImageBitmap`, `OffscreenCanvas` or a URL string.

## Errors

All async APIs reject with `QRGenError` (`err.code`): `camera-permission-denied`, `camera-not-found`,
`camera-in-use`, `insecure-context`, `engine-load-failed`, `unsupported`, `bad-request`, `unknown`.

## Utilities

`resolveSymbologies("qr, retail")`, `SYMBOLOGIES` (metadata), `WRITABLE_SYMBOLOGIES`,
`DuplicateFilter`, `BarcodeTracker`, `Feedback`, `configure({ wasmBaseUrl, worker })`, `VERSION`.
