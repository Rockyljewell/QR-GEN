---
title: "Vue & Nuxt"
description: "Use the QRGenScanner and QRGenBarcode Vue 3 components or QRGenPlugin, handle scan events, render on the client in Nuxt, and configure custom elements."
group: Web
order: 6
badge: TypeScript
status: stable
---

`qrgen-sdk/vue` provides Vue 3 components that wrap the [web components](../web-components/): `QRGenScanner` for camera scanning and `QRGenBarcode` for rendering barcodes, plus `QRGenPlugin` to register both globally. Requires Vue 3.3 or later.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

## Scan

```vue
<script setup lang="ts">
import { ref } from "vue";
import { QRGenScanner } from "qrgen-sdk/vue";
import type { Barcode } from "qrgen-sdk";

const last = ref<Barcode | null>(null);

function onScan({ barcode }: { barcodes: Barcode[]; barcode: Barcode }) {
  last.value = barcode;
}
</script>

<template>
  <QRGenScanner :symbologies="['qr', 'ean13', 'code128']" mode="continuous" :duplicate-filter="2000" style="height: 420px" @scan="onScan" @error="(e) => console.warn(e.code, e.message)" />
  <p v-if="last">{{ last.symbologyName }}: {{ last.data }}</p>
</template>
```

Camera access requires HTTPS or `http://localhost`.

## Register globally

```ts
// main.ts
import { createApp } from "vue";
import { QRGenPlugin } from "qrgen-sdk/vue";
import App from "./App.vue";

createApp(App).use(QRGenPlugin).mount("#app");
```

`QRGenPlugin` registers `QRGenScanner` and `QRGenBarcode`, so you can use them in any template without importing.

## Props

`QRGenScanner` accepts the same options as the [`<qrgen-scanner>` attributes](../web-components/#attributes-and-properties), in camelCase (or kebab-case in templates):

| Prop | Type | Default |
| --- | --- | --- |
| `symbologies` | `string[] \| string` | all |
| `mode` | `"single" \| "continuous" \| "batch"` | `"continuous"` |
| `duplicateFilter` | `number` | `1000` (`-1` in batch) |
| `beep` | `boolean` | `true` |
| `vibrate` | `boolean` | `true` |
| `camera` | `string` (`"back"`, `"front"` or a `deviceId`) | `"back"` |
| `torch` | `boolean` | `false` |
| `viewfinder` | `"frame" \| "line" \| "none"` | depends on symbologies |
| `scanArea` | `{ x, y, width, height }` | from the viewfinder |
| `maxResults` | `number` | `1` (`20` in batch) |
| `autostart` | `boolean` | `true` |
| `controls` | `"default" \| "none"` | `"default"` |
| `accent` | `string` (hex) | `#5cc9d6` |
| `hint` | `string` | mode-specific |
| `toast` | `boolean` | `true` |
| `tryHarder` | `boolean` | `false` |
| `resolution` | `"sd" \| "hd" \| "fhd" \| "4k"` | `"hd"` |

Props you don't set fall back to the element defaults.

## Events

The component emits the element's events with the same `detail` object as the payload:

| Event | Payload |
| --- | --- |
| `@scan` | `{ barcodes: Barcode[], barcode: Barcode }` |
| `@track` | `{ tracked, added, removed }` (`TrackedBarcode[]`) |
| `@select` | `{ barcode: TrackedBarcode \| null, selected: boolean, selection: TrackedBarcode[] }` |
| `@ready` | `{ engine: "worker" \| "main" }` |
| `@statechange` | `{ state: ScannerState }` |
| `@error` | `{ code: QRGenErrorCode, message: string }` |

## Template ref

The component exposes `start`, `stop`, `pause`, `resume`, `setTorch`, `toggleTorch`, `switchCamera`, `setZoom` and `element` (the underlying `<qrgen-scanner>`):

```vue
<script setup lang="ts">
import { ref } from "vue";
import { QRGenScanner } from "qrgen-sdk/vue";
import type { QRGenScannerElement } from "qrgen-sdk/elements";

// The members QRGenScanner exposes that this component uses
type ScannerRef = {
  resume(): void;
  toggleTorch(): Promise<boolean>;
  element: QRGenScannerElement | null;
};

const scanner = ref<ScannerRef | null>(null);
const code = ref("");
</script>

<template>
  <QRGenScanner ref="scanner" symbologies="qr" mode="single" controls="none" style="height: 360px" @scan="({ barcode }) => (code = barcode.data)" />
  <p>{{ code }}</p>
  <button @click="scanner?.resume()">Scan again</button>
  <button @click="scanner?.toggleTorch()">Torch</button>
  <button @click="scanner?.element?.clearSelection()">Clear selection</button>
</template>
```

## `QRGenBarcode`

```vue
<script setup lang="ts">
import { QRGenBarcode } from "qrgen-sdk/vue";
</script>

<template>
  <QRGenBarcode value="https://example.com" symbology="qr" ec-level="M" style="width: 160px" />
  <QRGenBarcode value="5901234123457" symbology="ean13" hrt style="width: 240px" />
</template>
```

Props: `value` (required), `symbology` (default `"qr"`), `scale`, `ecLevel`, `foreground`, `background`, `hrt`, `margin` (default `true`), `gs1`, `alt`. For rotation, use the [`<qrgen-barcode>` element](../web-components/#qrgen-barcode) directly with its `rotate` attribute.

## Using the elements directly

You can also use `<qrgen-scanner>` and `<qrgen-barcode>` in templates without the wrapper. Import `qrgen-sdk/elements` once, and tell the Vue compiler that tags starting with `qrgen-` are custom elements, otherwise it warns that it can't resolve them:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith("qrgen-"),
        },
      },
    }),
  ],
});
```

```vue
<script setup lang="ts">
import "qrgen-sdk/elements";
</script>

<template>
  <qrgen-scanner symbologies="qr,ean13" style="height: 420px" @scan="(e: CustomEvent) => console.log(e.detail.barcode.data)" />
</template>
```

You don't need `isCustomElement` when you use the `QRGenScanner` and `QRGenBarcode` components.

## Nuxt

The scanner needs the browser, so render it on the client. Wrap it in `<ClientOnly>`:

```vue
<!-- pages/scan.vue -->
<script setup lang="ts">
import { QRGenScanner } from "qrgen-sdk/vue";

const code = ref("");
</script>

<template>
  <main>
    <ClientOnly>
      <QRGenScanner symbologies="qr" mode="single" style="height: 420px" @scan="({ barcode }) => (code = barcode.data)" />
      <template #fallback>
        <div style="height: 420px; background: #05070a" />
      </template>
    </ClientOnly>
    <p>{{ code }}</p>
  </main>
</template>
```

To register the components globally, add a client-only plugin:

```ts
// plugins/qrgen.client.ts
import { QRGenPlugin } from "qrgen-sdk/vue";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(QRGenPlugin);
});
```

If you use the raw `<qrgen-scanner>` element in Nuxt templates, set the compiler option in `nuxt.config.ts`:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  vue: {
    compilerOptions: {
      isCustomElement: (tag) => tag.startsWith("qrgen-"),
    },
  },
});
```

To self-host the wasm in Nuxt, copy `node_modules/qrgen-sdk/dist/wasm/*.wasm` into `public/qrgen/` and call `configure({ wasmBaseUrl: "/qrgen/" })` in the client plugin. See [Installation](../installation/#self-host-the-webassembly-engine).
