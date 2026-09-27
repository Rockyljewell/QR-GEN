---
title: Installation
description: "Install QRGen from npm, a tarball or the CDN, self-host the WebAssembly engine, configure Content Security Policy and bundlers, and check browser support."
group: Get started
order: 3
---

QRGen ships as one npm package, `qrgen-sdk`, with separate entry points for the core API, the web components, framework wrappers, parsers, Node.js helpers, the REST server and the embed bridge. It has a single runtime dependency, `zxing-wasm`, pinned to an exact version.

## Package managers

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

The package works the same with other package managers:

```bash
pnpm add qrgen-sdk
yarn add qrgen-sdk
bun add qrgen-sdk
```

The tarball URL works with all of them (`pnpm add https://...`, `yarn add https://...`, `bun add https://...`). Pin a copy of the tarball in your repository if you need reproducible builds before the npm release.

React (17 or later) and Vue (3.3 or later) are optional peer dependencies. You only need them if you import `qrgen-sdk/react` or `qrgen-sdk/vue`. Node.js 18.17 or later is required for the Node entry points and the CLI.

## Entry points

| Import | Contents | Environment |
| --- | --- | --- |
| `qrgen-sdk` | `BarcodeScanner`, `scanImage`, `generate`, parsers, symbology helpers, `configure`, errors | Browser (and Node, see below) |
| `qrgen-sdk/elements` | Registers `<qrgen-scanner>` and `<qrgen-barcode>` | Browser |
| `qrgen-sdk/react` | `QRGenScanner`, `QRGenBarcode` components | React 17+ |
| `qrgen-sdk/vue` | `QRGenScanner`, `QRGenBarcode`, `QRGenPlugin` | Vue 3.3+ |
| `qrgen-sdk/parsers` | `parseContent`, `parseGS1`, `parseAAMVA` and helpers only | Anywhere |
| `qrgen-sdk/node` | Everything in `qrgen-sdk`, plus `scanFile`, `scan`, `generatePNG`, `generateToFile`, with the engine loaded from `node_modules` | Node.js, Bun |
| `qrgen-sdk/server` | `createServer`, `createHandler` (REST API) | Node.js |
| `qrgen-sdk/bridge` | `connectBridge`, `parseBridgeMessage` and helpers for WebView and iframe hosts | Browser |
| `qrgen-sdk/browser` | The standalone ESM bundle (everything, elements registered) | Browser |
| `qrgen-sdk/wasm/reader.wasm` | `zxing_reader.wasm`, for self-hosting | Static file |
| `qrgen-sdk/wasm/writer.wasm` | `zxing_writer.wasm`, for self-hosting | Static file |

The package also installs the `qrgen` [CLI](../cli/). The module entry points ship ESM, CommonJS and TypeScript declarations; `qrgen-sdk/browser` is a single ES module.

> **Tip:** In Node.js, import from `qrgen-sdk/node`, not `qrgen-sdk`. The Node entry reads the engine from `node_modules`, so it never touches the network. See [Node.js](../nodejs/).

## CDN

Two prebuilt bundles are hosted with this site. Both contain the whole SDK (scanner, elements, generator, parsers and bridge) and register the custom elements when they load.

| File | Format | Use |
| --- | --- | --- |
| `https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js` | ES module | `<script type="module">` or `import` from a URL |
| `https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js` | Classic script | `<script src>`; exposes the global `QRGen` |

```html
<script type="module">
  import { scanImage, generate } from "https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js";
</script>

<script src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js"></script>
<script>
  QRGen.generate("https://example.com").then(({ svg }) => document.body.insertAdjacentHTML("beforeend", svg));
</script>
```

The bundle is about 60 KB gzipped. See [Script tag & CDN](../cdn/) for details.

## Self-host the WebAssembly engine

The decoder (`zxing_reader.wasm`, about 400 KB gzipped) and the generator (`zxing_writer.wasm`, about 340 KB gzipped) are fetched at runtime the first time you scan or generate. By default they load from jsDelivr, pinned to the exact engine version the SDK was built with (`ENGINE_VERSION`):

```text
https://cdn.jsdelivr.net/npm/zxing-wasm@<ENGINE_VERSION>/dist/reader/zxing_reader.wasm
https://cdn.jsdelivr.net/npm/zxing-wasm@<ENGINE_VERSION>/dist/writer/zxing_writer.wasm
```

Self-host them when your app must work offline, your network blocks third-party CDNs, or you don't want a third-party request.

1. Copy the two files from the package to a folder your web server serves. They live in `node_modules/qrgen-sdk/dist/wasm/`:

   ```bash
   mkdir -p public/qrgen
   cp node_modules/qrgen-sdk/dist/wasm/*.wasm public/qrgen/
   ```

2. Point the SDK at that folder before the first scan:

   ```js
   import { configure } from "qrgen-sdk";

   configure({ wasmBaseUrl: "/qrgen/" });
   ```

The folder must contain `zxing_reader.wasm` and `zxing_writer.wasm` under those names. Relative URLs resolve against the page's base URL.

If you load the SDK from a script tag and can't call `configure()` first, set a global before the script runs:

```html
<script>
  globalThis.QRGEN_WASM_BASE = "/qrgen/";
</script>
<script src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.iife.js"></script>
```

A copy of both files is also hosted at `https://rockyljewell.github.io/QR-GEN/sdk/wasm/zxing_reader.wasm` and `https://rockyljewell.github.io/QR-GEN/sdk/wasm/zxing_writer.wasm`, matching the CDN bundle.

`configure()` accepts these options:

| Option | Type | Meaning |
| --- | --- | --- |
| `wasmBaseUrl` | `string` | Folder containing both wasm files. |
| `readerWasmUrl` | `string` | Exact URL of `zxing_reader.wasm`. Takes precedence over `wasmBaseUrl`. |
| `writerWasmUrl` | `string` | Exact URL of `zxing_writer.wasm`. Takes precedence over `wasmBaseUrl`. |
| `readerWasmBinary` | `ArrayBuffer \| Uint8Array` | The reader wasm bytes, for environments without `fetch` access to a URL. |
| `writerWasmBinary` | `ArrayBuffer \| Uint8Array` | The writer wasm bytes. |
| `worker` | `boolean` | Decode camera frames in a Web Worker. Default `true`. |

> **Warning:** The wasm files must match the SDK version. When you self-host, copy them again every time you upgrade `qrgen-sdk`, for example in a `postinstall` script: `"postinstall": "mkdir -p public/qrgen && cp node_modules/qrgen-sdk/dist/wasm/*.wasm public/qrgen/"`.

> **Tip:** Serve `.wasm` files with `Content-Type: application/wasm` so the browser can compile them while downloading. With another type the engine still loads, but logs a "wasm streaming compile failed" message and falls back to a slower path.

## Content Security Policy

If your site sends a `Content-Security-Policy` header, allow the following:

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'wasm-unsafe-eval'` | Compiling WebAssembly. Add `https://rockyljewell.github.io` if you load the CDN bundle. |
| `worker-src` | `blob:` | The decoder worker is started from a Blob URL. |
| `connect-src` | `https://cdn.jsdelivr.net` (default), or `'self'` when self-hosting | Fetching the wasm files. Also any image URLs you pass to `scanImage()`. |
| `style-src` | nothing extra | The elements style their shadow DOM with constructable stylesheets, which CSP doesn't restrict. Only browsers without them (Safari before 16.4) fall back to an inline `<style>` and need `'unsafe-inline'`. |
| `img-src` | `data: blob:` | Only if you show `generateDataURL()` output in an `<img>`, or generate colored PNGs in the browser. |

A complete policy for a self-hosted setup:

```text
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; style-src 'self'; img-src 'self' data: blob:
```

Without `worker-src blob:` scanning still works: the SDK logs `[qrgen] decoding on the main thread: ...` and decodes on the main thread instead, which is slower on low-end phones.

Camera access is also controlled by the `Permissions-Policy` header. If you send one, it must allow the camera for your origin, for example `Permissions-Policy: camera=(self)`. A scanner inside an `<iframe>` also needs `allow="camera"` on the iframe element. Camera streams are attached with `srcObject`, so `media-src` does not affect them.

## Bundlers

The decoder worker is inlined in the JavaScript as a string and started from a Blob URL, and the wasm files are fetched at runtime. There is no worker file or wasm import for your bundler to handle, so QRGen works without plugins in Vite, webpack, Rollup, esbuild, Parcel, Rspack and Turbopack. The notes below only matter when you self-host the wasm.

### Vite

Import the wasm files as asset URLs. Vite copies them into the build with a content hash:

```ts
import { configure } from "qrgen-sdk";
import readerWasmUrl from "qrgen-sdk/wasm/reader.wasm?url";
import writerWasmUrl from "qrgen-sdk/wasm/writer.wasm?url";

configure({ readerWasmUrl, writerWasmUrl });
```

### webpack

Copy the files with [copy-webpack-plugin](https://github.com/webpack-contrib/copy-webpack-plugin) (a separate package), then set `wasmBaseUrl`:

```js
// webpack.config.js
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  // ...
  plugins: [new CopyPlugin({ patterns: [{ from: "node_modules/qrgen-sdk/dist/wasm", to: "qrgen" }] })],
};
```

```js
import { configure } from "qrgen-sdk";

configure({ wasmBaseUrl: "/qrgen/" });
```

### Next.js

Copy the files into `public/qrgen/` (the `postinstall` script above works) and call `configure({ wasmBaseUrl: "/qrgen/" })` in a client component. Scanner components must render on the client. See [Next.js](../nextjs/).

## Browser support

Camera scanning needs `getUserMedia` and WebAssembly. Image scanning and generation only need WebAssembly.

| Browser | Supported |
| --- | --- |
| Chrome, Edge (desktop and Android) | Current versions |
| Firefox (desktop and Android) | Current versions |
| Samsung Internet | Current versions |
| Safari on macOS | Current versions |
| Safari on iOS and iPadOS | 14.5 and later |
| iOS in-app WebViews (`WKWebView`) | iOS 14.5 and later, with camera permission in the host app |
| Android WebView | With a `WebChromeClient` that grants camera requests. See [Embed bridge](../embed-bridge/). |

The SDK uses `requestVideoFrameCallback`, `OffscreenCanvas` and Web Workers when they are available and falls back when they are not. Vibration feedback uses the Vibration API, which iOS Safari does not support. On iOS, the beep only plays after the user has tapped something on the page (see [Core concepts](../concepts/#feedback)).

All camera features require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): HTTPS, `http://localhost` or `http://127.0.0.1`.
