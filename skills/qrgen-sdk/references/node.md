# Node.js, serverless and the CLI

`qrgen-sdk/node` loads the WebAssembly engine from `node_modules`, so no network access is needed.
Works on Node 18+, Bun and Deno (npm specifier).

```ts
import { scanFile, scan, generateToFile, generatePNG, generate, parseContent } from "qrgen-sdk/node";

const codes = await scanFile("label.jpg", { symbologies: ["qr", "code128"] });
const fromBuffer = await scan(buffer); // Buffer | Uint8Array | ArrayBuffer | path
await generateToFile("https://example.com", "qr.svg", { symbology: "qr", ecLevel: "M" });
const png: Buffer = await generatePNG("5901234123457", { symbology: "ean13", hrt: true });
```

PNG/JPEG/GIF/BMP/PNM inputs are decoded natively. Convert PDF pages or SVG to PNG first (e.g. with
`pdftoppm`, `sharp` or `resvg`).

## CLI

```bash
npx qrgen scan photo.jpg --json          # exits 2 when nothing is found
npx qrgen scan - < photo.png              # stdin
npx qrgen generate "https://example.com" -o qr.png
npx qrgen generate "(01)09501101530003(10)ABC" --symbology data-matrix --gs1 -o dm.svg
npx qrgen parse "WIFI:S:Home;T:WPA;P:secret;;"
npx qrgen serve --port 8080               # REST API
npx qrgen symbologies
```

## Mount the REST API in an existing server

```ts
import express from "express";
import { createHandler } from "qrgen-sdk/server";
const app = express();
app.use("/qrgen", createHandler({ maxBodyBytes: 10 * 1024 * 1024 }));
```

Note: `createHandler` matches paths from the URL it receives. When mounting under a prefix, make sure the
framework strips the prefix (Express `app.use` does).
