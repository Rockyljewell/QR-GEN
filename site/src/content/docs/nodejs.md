---
title: Node.js
description: "Decode barcodes in image files and buffers and generate barcode PNG and SVG files in Node.js with qrgen-sdk/node, including serverless deployment notes."
group: "Server & Linux"
order: 1
badge: TypeScript
status: stable
---

`qrgen-sdk/node` is the Node.js entry point. It loads the WebAssembly engine from `node_modules` (no network access, no native addons) and adds helpers for files and buffers. Use it for batch jobs, upload handlers, label printing and tests. It also runs in Bun.

Requires Node.js 18.17 or later.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

```js
// ESM
import { scanFile, generateToFile } from "qrgen-sdk/node";

// CommonJS
const { scanFile, generateToFile } = require("qrgen-sdk/node");
```

`qrgen-sdk/node` re-exports everything from `qrgen-sdk` (`generate`, `scanImage`, `parseContent`, `parseGS1`, `parseAAMVA`, symbology helpers, types), so one import is enough.

> **Warning:** Import from `qrgen-sdk/node`, not `qrgen-sdk`. The browser entry doesn't know where `node_modules` is and would download the engine from jsDelivr at runtime.

## Scan files

```js
import { scanFile } from "qrgen-sdk/node";

const barcodes = await scanFile("label.jpg");
for (const b of barcodes) {
  console.log(b.symbologyName, b.data);
}
```

`scanFile(path, options?)` reads a PNG, JPEG, GIF or BMP file and resolves with every code found (an empty array when there is none). Options:

| Option | Default | Description |
| --- | --- | --- |
| `symbologies` | all | Ids, aliases or groups, as an array or a comma-separated string. Limiting them is faster and avoids false reads. |
| `maxResults` | `255` | Maximum codes to return. |
| `tryHarder` | `true` | Extra effort for small, damaged or rotated codes. Set `false` for speed on clean images. |

Scan a whole folder:

```js
import { readdir } from "node:fs/promises";
import path from "node:path";
import { scanFile } from "qrgen-sdk/node";

const dir = process.argv[2] ?? ".";
for (const name of await readdir(dir)) {
  if (!/\.(png|jpe?g|gif|bmp)$/i.test(name)) continue;
  const barcodes = await scanFile(path.join(dir, name), { symbologies: ["qr", "code128", "data-matrix"] });
  console.log(`${name}: ${barcodes.map((b) => b.data).join(", ") || "(none)"}`);
}
```

## Scan buffers

`scan(input, options?)` accepts a file path, a `Buffer`, a `Uint8Array` or an `ArrayBuffer` of image file bytes. Use it for uploads and data that never touches the disk:

```js
import express from "express";
import { scan, parseContent } from "qrgen-sdk/node";

const app = express();

app.post("/scan", express.raw({ type: "image/*", limit: "10mb" }), async (req, res) => {
  const barcodes = await scan(req.body, { symbologies: ["qr", "ean13", "code128"] });
  res.json(barcodes.map((b) => ({ data: b.data, symbology: b.symbology, parsed: parseContent(b.data, { symbology: b.symbology }) })));
});

app.listen(3000);
```

```bash
curl --data-binary @photo.jpg -H "content-type: image/jpeg" http://localhost:3000/scan
```

For a ready-made HTTP API with multipart and base64 support, use the built-in [REST server](../rest-api/).

`scanImage()` also works in Node when you pass image file bytes (`Uint8Array`, `ArrayBuffer`). Use `scanFile()` or `scan()` for paths; `scanImage()` treats strings as URLs.

### Other formats: PDF, WebP, HEIC, TIFF

The engine decodes PNG, JPEG, GIF and BMP. Convert anything else first. These tools are not part of QRGen:

- **WebP, AVIF, TIFF, HEIC**: with [sharp](https://sharp.pixelplumbing.com/), convert to PNG in memory (HEIC needs a libvips build with HEIF support):

  ```js
  import sharp from "sharp";
  import { scan } from "qrgen-sdk/node";

  const png = await sharp("photo.webp").png().toBuffer();
  const barcodes = await scan(png);
  ```

- **PDF**: render each page to PNG, for example with `pdftoppm` from Poppler (`apt install poppler-utils`, `brew install poppler`), then scan the pages. Use at least 200 DPI for small barcodes:

  ```bash
  pdftoppm -r 300 -png invoice.pdf page
  npx qrgen scan page-*.png --json
  ```

Very large photos decode more slowly. Downscaling to about 2000 px on the long side (with sharp's `resize`) usually keeps codes readable and speeds things up.

## Generate barcodes

```js
import { generateToFile, generatePNG, generate } from "qrgen-sdk/node";

// SVG, PNG or text, chosen by the file extension
await generateToFile("https://example.com", "qr.svg", { ecLevel: "M" });
await generateToFile("(01)09501101530003(17)250101(10)ABC123", "label.png", { symbology: "code128", gs1: true, hrt: true, scale: 3 });
await generateToFile("hello", "hello.txt"); // terminal-style text rendering

// PNG bytes as a Buffer, for HTTP responses or PDFs
const png = await generatePNG("5901234123457", { symbology: "ean13", hrt: true });

// Everything: svg, png (Blob), module matrix, text
const { svg, matrix } = await generate("hello", { symbology: "data-matrix" });
console.log(`${matrix.width}x${matrix.height} modules`);
```

| Function | Returns | Notes |
| --- | --- | --- |
| `generateToFile(data, path, options?)` | `Promise<GeneratedBarcode>` | `.png` writes PNG, `.txt` writes the text rendering, anything else writes SVG with an XML declaration. |
| `generatePNG(data, options?)` | `Promise<Buffer>` | PNG bytes. |
| `generate(data, options?)` | `Promise<GeneratedBarcode>` | `{ symbology, data, svg, png, matrix, text }`. |

Imported from `qrgen-sdk/node`, PNG output honours `foreground` and `background` (including `transparent`), the same as the SVG. All generator options are in [Barcode generation](../barcode-generation/).

## Parse

The parsers are plain functions and have no engine dependency:

```js
import { parseContent, parseGS1 } from "qrgen-sdk/node";

console.log(parseContent("WIFI:T:WPA;S:Office;P:correct horse;;"));
console.log(parseGS1("(01)09501101530003(17)250101(10)ABC123").values);
```

If you only need parsing, `qrgen-sdk/parsers` has them without the engine. See [Parsers](../parsers/).

## Engine loading

The engine binaries are read from `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` and `.../writer/zxing_writer.wasm` when `qrgen-sdk/node` is imported, and compiled on the first scan and the first generate call. Keep one import per process (module scope) so the compiled engine is reused.

`useLocalEngine()` performs this setup. It runs automatically on import and in every helper; you only need it if you import `scanImage` or `generate` from somewhere else and want to make sure the local engine is used. To provide the binaries yourself (for example from a bundle), call `configure()` from `qrgen-sdk` before importing `qrgen-sdk/node`:

```js
import { readFileSync } from "node:fs";
import { configure } from "qrgen-sdk";

configure({
  readerWasmBinary: readFileSync("./wasm/zxing_reader.wasm"),
  writerWasmBinary: readFileSync("./wasm/zxing_writer.wasm"),
  worker: false,
});

const { scanFile } = await import("qrgen-sdk/node");
```

Decoding runs synchronously inside the wasm module, so a large image occupies the event loop while it decodes (typically tens of milliseconds, more for big photos with `tryHarder`). For high-throughput services, run scans in a pool of [worker threads](https://nodejs.org/api/worker_threads.html); each worker loads its own engine.

## Serverless

The engine is loaded from files in `node_modules`, so the deployment must include them:

- **Keep the packages external.** If your bundler inlines dependencies, mark `qrgen-sdk` and `zxing-wasm` as external and ship them in `node_modules`, so the `.wasm` files stay where the code expects them.
- **AWS Lambda** with esbuild (SAM, CDK `NodejsFunction`, Serverless Framework): with CDK, `bundling: { nodeModules: ["qrgen-sdk", "zxing-wasm"] }` installs them next to the bundle. With plain esbuild, use `--external:qrgen-sdk --external:zxing-wasm` and include `node_modules` in the zip, or use a Lambda layer.
- **Vercel** Node.js functions: file tracing usually picks the files up. If a function fails with `ENOENT ... zxing_reader.wasm`, add them with `includeFiles` in `vercel.json` (`"functions": { "api/scan.js": { "includeFiles": "node_modules/zxing-wasm/dist/**/*.wasm" } }`). For Next.js route handlers, see [Next.js](../nextjs/#scan-uploads-on-the-server).
- **Edge runtimes** (Vercel Edge, Cloudflare Workers) have no file system, so `qrgen-sdk/node` doesn't run there. Use the Node.js runtime, or the [REST API](../rest-api/).

The first request after a cold start pays for reading and compiling the engine (about 1.6 MB of wasm). Warm invocations reuse it. Give functions that decode large photos at least 512 MB of memory.

## TypeScript

Types are included. The Node helpers are typed as:

```ts
function scanFile(path: string, options?: ScanImageOptions): Promise<Barcode[]>;
function scan(input: string | Uint8Array | ArrayBuffer, options?: ScanImageOptions): Promise<Barcode[]>;
function generatePNG(data: string, options?: GenerateOptions): Promise<Buffer>;
function generateToFile(data: string, path: string, options?: GenerateOptions): Promise<GeneratedBarcode>;
function useLocalEngine(): void;
```
