---
title: Next.js
description: "Add a QRGen barcode scanner to a Next.js App Router or Pages Router app with a client component, next/dynamic, self-hosted wasm and server-side scanning in route handlers."
group: Web
order: 5
badge: TypeScript
status: stable
---

QRGen's React components run in the browser, so in the Next.js App Router they belong in Client Components. This page shows the App Router setup, optional lazy loading with `next/dynamic`, self-hosting the wasm from `public/`, and scanning uploaded images in a route handler.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## App Router

Create a Client Component. The `"use client"` directive is required because `QRGenScanner` uses hooks and the camera:

```tsx
// app/scan/scanner.tsx
"use client";

import { useState } from "react";
import { QRGenScanner } from "qrgen-sdk/react";
import { parseContent, type ParsedContent } from "qrgen-sdk";

export default function Scanner() {
  const [result, setResult] = useState<ParsedContent | null>(null);

  return (
    <div>
      <QRGenScanner
        symbologies={["qr", "ean13", "code128"]}
        mode="single"
        style={{ height: 420, borderRadius: 12, overflow: "hidden" }}
        onScan={(_, barcode) => setResult(parseContent(barcode.data, { symbology: barcode.symbology }))}
      />
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
```

Use it from a Server Component page:

```tsx
// app/scan/page.tsx
import Scanner from "./scanner";

export const metadata = { title: "Scan" };

export default function ScanPage() {
  return (
    <main>
      <h1>Scan a code</h1>
      <Scanner />
    </main>
  );
}
```

During server rendering, the component outputs an empty `<qrgen-scanner>` tag. The element registers and opens the camera after the page loads in the browser.

> **Note:** The camera only works on HTTPS or `http://localhost`. `next dev` serves `http://localhost:3000`, which works. To test on a phone, use `next dev --experimental-https` or a tunnel, because a LAN address like `http://192.168.1.20:3000` is not a secure context.

## Load the scanner lazily

To keep the SDK out of the initial bundle and skip server rendering entirely, load the component with `next/dynamic` and `ssr: false`. In the App Router, `ssr: false` is only allowed inside a Client Component, so wrap it:

```tsx
// app/scan/lazy-scanner.tsx
"use client";

import dynamic from "next/dynamic";

const Scanner = dynamic(() => import("./scanner"), {
  ssr: false,
  loading: () => <div style={{ height: 420, background: "#05070a", borderRadius: 12 }} />,
});

export default function LazyScanner() {
  return <Scanner />;
}
```

Then render `<LazyScanner />` from `page.tsx` instead of `<Scanner />`.

## Pages Router

In the Pages Router, pages are rendered on the server and hydrated on the client. The component works as is; use `next/dynamic` with `ssr: false` if you want to skip the server render:

```tsx
// pages/scan.tsx
import dynamic from "next/dynamic";

const Scanner = dynamic(() => import("../components/scanner"), { ssr: false });

export default function ScanPage() {
  return <Scanner />;
}
```

`components/scanner.tsx` is the same component as above (the `"use client"` line is harmless in the Pages Router).

## Self-host the wasm

By default the engine loads from jsDelivr. To serve it from your own domain, copy the files into `public/` on install:

```json
{
  "scripts": {
    "postinstall": "mkdir -p public/qrgen && cp node_modules/qrgen-sdk/dist/wasm/*.wasm public/qrgen/"
  }
}
```

Then configure the engine once in client code, before the first scan. A module-level call in the scanner component works:

```tsx
// app/scan/scanner.tsx
"use client";

import { configure } from "qrgen-sdk";

configure({ wasmBaseUrl: "/qrgen/" });

// ...component as above
```

If your app uses a `basePath`, include it: `configure({ wasmBaseUrl: "/my-base/qrgen/" })`. Add `public/qrgen/` to `.gitignore` if it's generated on install.

## Content Security Policy

If you set a CSP in `next.config.js` headers or middleware, allow `'wasm-unsafe-eval'` in `script-src`, `blob:` in `worker-src` and the wasm origin in `connect-src`. See [Installation](../installation/#content-security-policy).

## Scan uploads on the server

Route handlers run in Node.js, so you can decode uploaded images with `qrgen-sdk/node`. It reads the engine from `node_modules`, with no network access:

```ts
// app/api/scan/route.ts
import { scan, parseContent } from "qrgen-sdk/node";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof Blob)) return Response.json({ error: "Send an image field" }, { status: 400 });

  const barcodes = await scan(new Uint8Array(await file.arrayBuffer()), { symbologies: ["qr", "ean13", "code128"] });
  return Response.json({ barcodes: barcodes.map((b) => ({ ...b, parsed: parseContent(b.data, { symbology: b.symbology }) })) });
}
```

Keep the SDK out of the server bundle so the wasm files stay next to the code that reads them:

```js
// next.config.js
/** @type {import('next').NextConfig} */
module.exports = {
  serverExternalPackages: ["qrgen-sdk", "zxing-wasm"],
};
```

`serverExternalPackages` is the Next.js 15 name; in Next.js 14 use `experimental.serverComponentsExternalPackages`. The server can decode PNG, JPEG, GIF and BMP. More in [Node.js](../nodejs/#serverless).

## Troubleshooting

- **"useRef only works in Client Components"** or similar hook errors: the file that imports `QRGenScanner` is missing `"use client"`.
- **`window is not defined`**: code that calls `BarcodeScanner`, `scanImage` or `navigator` runs during server rendering. Move it into `useEffect` or an event handler.
- **Blank scanner with an `engine-load-failed` error**: a CSP or network filter blocks the wasm download. Self-host it as shown above.

More in [Troubleshooting](../troubleshooting/).
