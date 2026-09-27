---
title: "Script tag & CDN"
description: "Use QRGen without a build step: load the ES module or classic-script bundle from the CDN, use the elements and the global QRGen object, and self-host the files."
group: Web
order: 3
---

QRGen publishes two standalone bundles that contain the entire SDK: the scanner and generator, both custom elements, the parsers and the embed bridge. Both register `<qrgen-scanner>` and `<qrgen-barcode>` as soon as they load. Use them for static sites, CMS pages, prototypes, or anywhere you can't run a bundler.

| URL | Format | Size |
| --- | --- | --- |
| `https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js` | ES module | about 60 KB gzipped |
| `https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js` | Classic script, global `QRGen` | about 60 KB gzipped |

The decoder wasm (about 400 KB gzipped) is fetched separately the first time you scan and cached by the browser.

## ES module

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scanner</title>
  </head>
  <body>
    <qrgen-scanner symbologies="qr,ean13" style="height: 70vh"></qrgen-scanner>
    <pre id="out"></pre>

    <script type="module">
      import { parseContent } from "https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js";

      document.querySelector("qrgen-scanner").addEventListener("scan", ({ detail }) => {
        const parsed = parseContent(detail.barcode.data, { symbology: detail.barcode.symbology });
        document.querySelector("#out").textContent = JSON.stringify(parsed, null, 2);
      });
    </script>
  </body>
</html>
```

Everything exported by `qrgen-sdk`, `qrgen-sdk/elements` and `qrgen-sdk/bridge` is available as a named export, plus a default export with the `QRGen` namespace object.

## Classic script

The IIFE build defines a global `QRGen` that holds every export:

```html
<qrgen-scanner id="scanner" mode="single" style="height: 420px"></qrgen-scanner>
<div id="qr"></div>

<script src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js"></script>
<script>
  document.getElementById("scanner").addEventListener("scan", function (event) {
    console.log(event.detail.barcode.data);
  });

  QRGen.generateSVG("https://example.com", { symbology: "qr" }).then(function (svg) {
    document.getElementById("qr").innerHTML = svg;
  });

  console.log(QRGen.version, QRGen.parseContent("WIFI:T:WPA;S:Guest;P:welcome1;;"));
</script>
```

Commonly used members of the global:

| Member | Description |
| --- | --- |
| `QRGen.BarcodeScanner` | Camera scanning class. `QRGen.createScanner(options)` is a shortcut. |
| `QRGen.scanImage(input, options)` | Decode images. |
| `QRGen.generate(data, options)`, `QRGen.generateSVG`, `QRGen.generateDataURL` | Generate barcodes. |
| `QRGen.parseContent`, `QRGen.parseGS1`, `QRGen.parseAAMVA` | Parsers. |
| `QRGen.configure(config)` | Engine configuration (wasm location, worker). |
| `QRGen.supportedSymbologies()` | `{ read: [...], write: [...] }` |
| `QRGen.connectBridge`, `QRGen.parseBridgeMessage` | Embed bridge helpers. |
| `QRGen.version`, `QRGen.engineVersion` | SDK and engine versions. |

The global has the same members as the ES module's named exports; see the [API reference](../api/).

## Scanning without the element

The bundle includes the low-level API too:

```html
<video id="preview" style="width: 100%"></video>
<button id="go">Scan</button>

<script type="module">
  import { BarcodeScanner } from "https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js";

  const scanner = new BarcodeScanner({ video: document.querySelector("#preview"), mode: "single" });
  scanner.on("scan", ({ barcodes }) => alert(barcodes[0].data));
  document.querySelector("#go").addEventListener("click", () => scanner.start());
</script>
```

## Self-hosting the bundle

To avoid a third-party script, copy the bundle into your site. After `npm install qrgen-sdk` it is in `node_modules/qrgen-sdk/dist/browser/` (`qrgen.js`, `qrgen.iife.js` and source maps).

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`. Copy the wasm files too and point the engine at them with a global set before the bundle loads:

```html
<script>
  globalThis.QRGEN_WASM_BASE = "/vendor/qrgen/wasm/";
</script>
<script src="/vendor/qrgen/qrgen.iife.js"></script>
```

With the folder layout:

```text
/vendor/qrgen/qrgen.iife.js
/vendor/qrgen/wasm/zxing_reader.wasm
/vendor/qrgen/wasm/zxing_writer.wasm
```

The wasm files are in `node_modules/qrgen-sdk/dist/wasm/`. With the ES module you can call `configure({ wasmBaseUrl: "/vendor/qrgen/wasm/" })` instead of setting the global. Always copy the bundle and the wasm files from the same SDK version.

## Versions

The URLs above always serve the latest build from the main branch. For production, self-host a copy (above) so an update can't change your page unexpectedly. Once `qrgen-sdk` is published to npm, the same files are also available from npm CDNs with a pinned version, for example `https://cdn.jsdelivr.net/npm/qrgen-sdk@1.0.0/dist/browser/qrgen.js`, which you can combine with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity).

## Content Security Policy

If your page has a CSP, allow the bundle's origin in `script-src`, plus `'wasm-unsafe-eval'`, `worker-src blob:` and `connect-src https://cdn.jsdelivr.net` (or your self-hosted wasm origin). The full list is in [Installation](../installation/#content-security-policy).
