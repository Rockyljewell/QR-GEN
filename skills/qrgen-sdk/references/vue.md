# Vue 3 and Nuxt

```bash
npm install qrgen-sdk
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { QRGenScanner } from "qrgen-sdk/vue";
const code = ref("");
function onScan(detail: { barcode: { data: string } }) {
  code.value = detail.barcode.data;
}
</script>

<template>
  <QRGenScanner :symbologies="['qr', 'ean13']" mode="single" style="height: 420px" @scan="onScan" @error="(e) => console.warn(e.code)" />
  <p v-if="code">{{ code }}</p>
</template>
```

Events receive the element's `detail` object: `@scan` → `{ barcodes, barcode }`, `@track`, `@select`,
`@error` → `{ code, message }`, `@ready`, `@statechange`. Props match the React component
(camelCase). Template ref methods: `start`, `stop`, `pause`, `resume`, `setTorch`, `toggleTorch`,
`switchCamera`, `setZoom`.

Register globally with `app.use(QRGenPlugin)` (`import { QRGenPlugin } from "qrgen-sdk/vue"`).
`QRGenBarcode` renders codes: `<QRGenBarcode value="https://example.com" symbology="qr" />`.

If you use the raw `<qrgen-scanner>` element in templates instead of the wrapper, tell Vue it is a custom
element: `compilerOptions.isCustomElement = (tag) => tag.startsWith("qrgen-")` (Vite:
`vue({ template: { compilerOptions: { isCustomElement: … } } })`).

## Nuxt

Wrap the scanner in `<ClientOnly>` (or name the component `Scanner.client.vue`):

```vue
<template>
  <ClientOnly>
    <QRGenScanner mode="single" style="height: 420px" @scan="({ barcode }) => (code = barcode.data)" />
  </ClientOnly>
</template>
```
