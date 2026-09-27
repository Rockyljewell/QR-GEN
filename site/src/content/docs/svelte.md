---
title: "Svelte & SvelteKit"
description: "Use the <qrgen-scanner> element in Svelte 5 and Svelte 4, handle scan events, and load the SDK on the client in SvelteKit."
group: Web
order: 8
badge: TypeScript
status: stable
---

Svelte renders custom elements natively, so you use QRGen's [web components](../web-components/) directly. The examples below cover Svelte 5 (runes) and Svelte 4, and loading the SDK on the client in SvelteKit.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## Svelte 5

Event attributes on custom elements use the lowercase event name: `onscan`, `ontrack`, `onselect`, `onready`, `onstatechange`, `onerror`.

```svelte
<script lang="ts">
  import "qrgen-sdk/elements";
  import type { Barcode } from "qrgen-sdk";

  let last = $state<Barcode | null>(null);

  function handleScan(event: Event) {
    last = (event as CustomEvent<{ barcode: Barcode }>).detail.barcode;
  }
</script>

<qrgen-scanner symbologies="qr,ean13,code128" duplicate-filter="2000" style="height: 420px" onscan={handleScan}></qrgen-scanner>

{#if last}
  <p>{last.symbologyName}: {last.data}</p>
{/if}
```

## Svelte 4

Use `on:` directives:

```svelte
<script lang="ts">
  import "qrgen-sdk/elements";
  import type { Barcode } from "qrgen-sdk";

  let last: Barcode | null = null;
</script>

<qrgen-scanner symbologies="qr,ean13" style="height: 420px" on:scan={(e) => (last = e.detail.barcode)}></qrgen-scanner>

{#if last}
  <p>{last.data}</p>
{/if}
```

## Pass typed values

Svelte sets properties on custom elements when the element has one with that name, so you can pass arrays and objects directly:

```svelte
<script lang="ts">
  import "qrgen-sdk/elements";

  let symbologies = $state(["qr", "data-matrix"]);
  const scanArea = { x: 0.1, y: 0.3, width: 0.8, height: 0.4 };
</script>

<qrgen-scanner {symbologies} {scanArea} beep={false} style="height: 420px"></qrgen-scanner>
```

Pass booleans as expressions (`beep={false}`), not as strings. The element has properties for `symbologies`, `mode`, `duplicateFilter`, `beep`, `vibrate`, `camera`, `torch`, `viewfinder`, `scanArea`, `maxResults` and `autostart`; the other options (`controls`, `accent`, `hint`, `toast`, `try-harder`, `resolution`, `worker`) are plain attributes.

## Control the scanner

Bind the element and call its methods:

```svelte
<script lang="ts">
  import "qrgen-sdk/elements";
  import type { QRGenScannerElement } from "qrgen-sdk/elements";

  let scanner = $state<QRGenScannerElement>();
  let code = $state("");
</script>

<qrgen-scanner bind:this={scanner} symbologies="qr" mode="single" controls="none" style="height: 360px" onscan={(e: Event) => (code = (e as CustomEvent).detail.barcode.data)}></qrgen-scanner>

<p>{code}</p>
<button onclick={() => scanner?.resume()}>Scan again</button>
<button onclick={() => scanner?.toggleTorch()}>Torch</button>
```

Removing the element (for example with `{#if}`) stops the camera automatically.

## SvelteKit

Importing `qrgen-sdk/elements` during server rendering is safe: registration is skipped on the server and the tag renders as plain HTML. The element starts when the page hydrates. Camera access requires HTTPS or `http://localhost`.

To keep the SDK out of the server bundle and load it only when the page is shown, import it in `onMount`:

```svelte
<!-- src/routes/scan/+page.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Barcode } from "qrgen-sdk";

  let ready = $state(false);
  let last = $state<Barcode | null>(null);

  onMount(async () => {
    const { configure } = await import("qrgen-sdk");
    await import("qrgen-sdk/elements");
    configure({ wasmBaseUrl: "/qrgen/" }); // optional: self-hosted wasm in static/qrgen/
    ready = true;
  });
</script>

{#if ready}
  <qrgen-scanner symbologies="qr,ean13" style="height: 420px" onscan={(e: Event) => (last = (e as CustomEvent).detail.barcode)}></qrgen-scanner>
{:else}
  <div style="height: 420px; background: #05070a"></div>
{/if}

{#if last}<p>{last.data}</p>{/if}
```

Remove the `configure()` call to load the engine from jsDelivr instead. To self-host, copy `node_modules/qrgen-sdk/dist/wasm/*.wasm` into `static/qrgen/`. You can also disable server rendering for the route with `export const ssr = false;` in `+page.ts`.

## TypeScript

If `svelte-check` reports unknown attributes or events on the QRGen elements, declare the tags in `src/app.d.ts`. This types `bind:this` as the element class and accepts any attribute:

```ts
// src/app.d.ts
import type { HTMLAttributes } from "svelte/elements";
import type { QRGenBarcodeElement, QRGenScannerElement } from "qrgen-sdk/elements";

declare module "svelte/elements" {
  export interface SvelteHTMLElements {
    "qrgen-scanner": HTMLAttributes<QRGenScannerElement> & Record<string, unknown>;
    "qrgen-barcode": HTMLAttributes<QRGenBarcodeElement> & Record<string, unknown>;
  }
}

export {};
```
