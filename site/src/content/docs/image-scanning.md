---
title: Image scanning
description: "Decode barcodes and QR codes in images with scanImage: file inputs, drag and drop, clipboard paste, URLs, canvases and video frames, multiple codes per image, and tryHarder."
group: Features
order: 4
---

`scanImage()` decodes every barcode in a still image. It runs entirely in the browser (or in Node with [`qrgen-sdk/node`](../nodejs/)), needs no camera and no permission, and works in any context, including plain `http://` pages.

```js
import { scanImage } from "qrgen-sdk";

const barcodes = await scanImage(input, { symbologies: ["qr", "ean13"] });
```

It resolves with an array of [Barcode](../concepts/#the-barcode-result) results, empty when nothing was found. It rejects with a `QRGenError` (`bad-request`) when the input can't be read, for example a URL that returns 404.

## Inputs

| Input | Notes |
| --- | --- |
| `File`, `Blob` | From `<input type="file">`, drag and drop, the clipboard or `fetch()`. PNG, JPEG, GIF and BMP are decoded by the engine. |
| `ArrayBuffer`, `Uint8Array` | Image file bytes (PNG, JPEG, GIF, BMP). |
| `HTMLImageElement` | Waits for the image to load. Cross-origin images need CORS. |
| `HTMLCanvasElement`, `OffscreenCanvas` | The current canvas contents. |
| `HTMLVideoElement` | The current frame. |
| `ImageBitmap` | Any format the browser can decode. |
| `ImageData` | Raw RGBA pixels. |
| `string` | A URL (absolute, relative or `blob:`) or a `data:` URL. Fetched with `fetch()`, so CORS applies. |

### Formats the engine can't read

`File`, `Blob`, byte and URL inputs are decoded by the engine, which reads PNG, JPEG, GIF and BMP. For WebP, AVIF, HEIC (on Safari) or any other format the browser itself can display, let the browser decode it first:

```js
const bitmap = await createImageBitmap(file);
const barcodes = await scanImage(bitmap);
bitmap.close();
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `symbologies` | all | Ids, aliases or groups. Fewer is faster and avoids false reads. |
| `maxResults` | `255` | Maximum number of codes to return (1 to 255). |
| `tryHarder` | `true` | Extra passes for small, damaged or low-contrast codes. Set `false` for speed on clean images. |

Rotated and inverted (white on black) codes are always searched, and large images are also tried downscaled.

## File input

```html
<input type="file" id="file" accept="image/*" />
<ul id="results"></ul>

<script type="module">
  import { scanImage } from "qrgen-sdk";

  document.getElementById("file").addEventListener("change", async (event) => {
    const list = document.getElementById("results");
    list.replaceChildren();
    for (const file of event.target.files) {
      const bitmap = await createImageBitmap(file); // works for every format the browser supports
      const barcodes = await scanImage(bitmap);
      bitmap.close();
      for (const b of barcodes) {
        list.append(Object.assign(document.createElement("li"), { textContent: `${file.name}: ${b.symbologyName} ${b.data}` }));
      }
      if (!barcodes.length) list.append(Object.assign(document.createElement("li"), { textContent: `${file.name}: no code found` }));
    }
  });
</script>
```

On phones, `accept="image/*"` offers the camera as a source too. Add `capture="environment"` to open the camera directly. This takes a full-resolution photo, which can read codes that are too small for the live scanner.

## Drag and drop

```js
import { scanImage } from "qrgen-sdk";

const zone = document.getElementById("drop-zone");

zone.addEventListener("dragover", (event) => {
  event.preventDefault();
  zone.classList.add("over");
});
zone.addEventListener("dragleave", () => zone.classList.remove("over"));
zone.addEventListener("drop", async (event) => {
  event.preventDefault();
  zone.classList.remove("over");
  const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
  for (const file of files) {
    const barcodes = await scanImage(await createImageBitmap(file));
    console.log(file.name, barcodes.map((b) => b.data));
  }
});
```

## Paste from the clipboard

Screenshots are the most common source: a QR code in a chat, a boarding pass in an email.

```js
import { scanImage } from "qrgen-sdk";

document.addEventListener("paste", async (event) => {
  const item = [...event.clipboardData.items].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  const barcodes = await scanImage(item.getAsFile());
  console.log(barcodes.length ? barcodes[0].data : "No code in the pasted image");
});
```

To read the clipboard from a button instead of a paste event (this prompts for permission in some browsers):

```js
async function scanClipboard() {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return scanImage(await item.getType(type));
  }
  return [];
}
```

## URLs

```js
const fromUrl = await scanImage("https://example.com/images/label.png");
const fromDataUrl = await scanImage("data:image/png;base64,iVBORw0KGgo...");
```

The URL is fetched with `fetch()`, so a cross-origin image must be served with CORS headers (`Access-Control-Allow-Origin`), and your Content Security Policy's `connect-src` must allow it. Otherwise fetch it on your server, or use the [REST API](../rest-api/).

## Canvas and video frames

Scan something you drew or rendered, for example a PDF page rendered with [PDF.js](https://mozilla.github.io/pdf.js/) (a separate library):

```js
import { scanImage } from "qrgen-sdk";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export async function scanPdf(url) {
  const pdf = await pdfjs.getDocument(url).promise;
  const results = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 3 }); // about 216 DPI; small codes need resolution
    const canvas = Object.assign(document.createElement("canvas"), { width: viewport.width, height: viewport.height });
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    for (const b of await scanImage(canvas)) results.push({ page: n, ...b });
  }
  return results;
}
```

A `<video>` element is scanned at its current frame, which is handy for scanning a paused video file:

```js
const barcodes = await scanImage(document.querySelector("video"));
```

For live camera scanning, use [`BarcodeScanner`](../javascript/) instead: it is optimized for many frames per second.

## Multiple codes

`scanImage()` returns every code it finds, up to `maxResults`:

```js
const barcodes = await scanImage(photoOfShelf, { symbologies: "retail" });
console.log(`${barcodes.length} codes`);

// Sort top to bottom, then left to right, using each code's position in the image
barcodes.sort((a, b) => a.location.topLeft.y - b.location.topLeft.y || a.location.topLeft.x - b.location.topLeft.x);
```

`location` gives the four corners of each code in image pixels, and `frameSize` the image size, so you can draw boxes over a preview. `quadCenter()` and `quadBounds()` return the center point and the axis-aligned bounding box of a `location`.

## tryHarder

`tryHarder` is on by default for images, because a single image is worth the extra effort. Turn it off when you scan many clean, computer-generated images (labels, screenshots) and want speed:

```js
const barcodes = await scanImage(bytes, { symbologies: ["code128"], tryHarder: false });
```

If a code isn't found:

- Make sure its symbology is in `symbologies`.
- Check the resolution: each module (the smallest bar or square) needs at least 2 to 3 pixels. Photos of small codes taken from far away often don't have that.
- Crop to the code. Large photos with a small code are downscaled in some passes.
- Avoid heavy JPEG compression, blur and glare.

`scanImage()` decodes on the main thread. For batches of large images, run it inside a Web Worker of your own, or process them on a server with [`qrgen-sdk/node`](../nodejs/) or the [REST API](../rest-api/).
