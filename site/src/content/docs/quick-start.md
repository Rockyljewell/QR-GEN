---
title: Quick start
description: "Add a working barcode and QR code scanner to a web page in under 15 lines, with a script tag, npm and a web component, or React."
group: Get started
order: 2
---

Pick the path that matches your project. Each one gives you the full scanner UI: camera preview, viewfinder, highlights, torch and camera controls, and a success toast.

> **Note:** Browsers only allow camera access in a secure context: `https://` or `http://localhost`. Opening the file directly or using a LAN address like `http://192.168.1.20` will fail with an `insecure-context` error. For local testing, run a static server such as `npx serve .` and open `http://localhost:3000`.

## Script tag

No build step. The ESM bundle includes everything and registers the elements when it loads.

```html
<!doctype html>
<html lang="en">
  <body>
    <qrgen-scanner symbologies="qr,ean13,code128" mode="single" style="height: 420px"></qrgen-scanner>
    <p id="result">Point the camera at a code</p>
    <script type="module">
      import "https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js";
      document.querySelector("qrgen-scanner").addEventListener("scan", (event) => {
        document.querySelector("#result").textContent = event.detail.barcode.data;
      });
    </script>
  </body>
</html>
```

In `single` mode the scanner pauses after the first code and shows a **Scan again** button. Remove `mode="single"` to keep scanning continuously. See [Script tag & CDN](../cdn/) for the classic-script build and version notes.

## npm and a web component

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

```js
import "qrgen-sdk/elements";

const scanner = document.createElement("qrgen-scanner");
scanner.setAttribute("symbologies", "qr,ean13,code128");
scanner.style.height = "420px";
scanner.addEventListener("scan", (event) => {
  const { barcode } = event.detail;
  console.log(barcode.symbology, barcode.data);
});
document.body.append(scanner);
```

This works with any bundler (Vite, webpack, Parcel, esbuild). The element is framework-agnostic, so the same code runs in [Angular](../angular/), [Svelte](../svelte/) and plain HTML. Every attribute, property and event is listed in [Web Components](../web-components/).

## React

```tsx
import { useState } from "react";
import { QRGenScanner } from "qrgen-sdk/react";

export function Scanner() {
  const [code, setCode] = useState("");
  return (
    <div>
      <QRGenScanner symbologies={["qr", "ean13"]} mode="single" style={{ height: 420 }} onScan={(_, barcode) => setCode(barcode.data)} />
      <p>{code || "Point the camera at a code"}</p>
    </div>
  );
}
```

Using Next.js? Put this component in a file that starts with `"use client"`. See [Next.js](../nextjs/). For Vue, see [Vue & Nuxt](../vue/).

## No camera? Scan an image

`scanImage()` decodes codes in a file, blob, image, canvas or URL, and returns every code it finds:

```js
import { scanImage } from "qrgen-sdk";

document.querySelector("input[type=file]").addEventListener("change", async (event) => {
  const barcodes = await scanImage(event.target.files[0]);
  console.log(barcodes.map((b) => `${b.symbologyName}: ${b.data}`));
});
```

More in [Image scanning](../image-scanning/).

## Next steps

- Scan faster by [limiting symbologies](../barcode-scanning/#choose-symbologies) to the ones you need.
- Turn scanned text into data with [`parseContent()`](../parsers/): URLs, Wi-Fi credentials, contacts, product codes and GS1.
- Scan many codes at once with [batch scanning](../batch-scanning/).
- Match your brand with [UI customization](../ui-customization/).
- Using a coding agent? Install the [Agent Skills](../../agent-skills/) so it knows the API.
