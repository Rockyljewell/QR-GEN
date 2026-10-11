# qrgen-sdk

Open-source (Apache-2.0) barcode, QR code and ID scanning for the web and Node.js: a drop-in scanner UI,
batch (multi-code) tracking, image scanning, a barcode generator, GS1 and AAMVA driver license
parsers, a CLI and a REST server. Part of [QRGen](https://github.com/Rockyljewell/QR-GEN).

- Docs: https://rockyljewell.github.io/QR-GEN/docs/
- Live demo: https://rockyljewell.github.io/QR-GEN/demo/

```bash
npm install qrgen-sdk
```

## Scanner UI (any framework)

```html
<qrgen-scanner symbologies="qr,ean13,code128" mode="single" style="height: 420px"></qrgen-scanner>
<script type="module">
  import "qrgen-sdk/elements";
  document.querySelector("qrgen-scanner").addEventListener("scan", (e) => console.log(e.detail.barcode.data));
</script>
```

React: `import { QRGenScanner } from "qrgen-sdk/react"`. Vue: `import { QRGenScanner } from "qrgen-sdk/vue"`.

## API

```ts
import { BarcodeScanner, scanImage, generate, parseContent, parseGS1, parseAAMVA, configure } from "qrgen-sdk";

const codes = await scanImage(file, { symbologies: ["qr", "retail"] });
const { svg, png } = await generate("https://example.com", { symbology: "qr" });
```

## Node.js, CLI and REST

```ts
import { scanFile, generateToFile } from "qrgen-sdk/node";
```

```bash
npx qrgen scan photo.jpg --json
npx qrgen generate "hello" -o hello.svg
npx qrgen serve --port 8080
```

## Entry points

| Import | Contents |
| --- | --- |
| `qrgen-sdk` | scanning, camera, generator, parsers, symbologies, configuration |
| `qrgen-sdk/elements` | registers `<qrgen-scanner>` and `<qrgen-barcode>` |
| `qrgen-sdk/react`, `qrgen-sdk/vue` | framework components |
| `qrgen-sdk/parsers` | pure parsers (no DOM, works in React Native) |
| `qrgen-sdk/node` | Node helpers with a local engine |
| `qrgen-sdk/server` | REST API handler |
| `qrgen-sdk/bridge` | WebView/iframe embed bridge |
| `qrgen-sdk/browser` | single-file ESM build |
| `qrgen-sdk/wasm/reader.wasm`, `qrgen-sdk/wasm/writer.wasm` | engine binaries for self-hosting |

Camera scanning requires HTTPS or localhost. The engine is [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp)
via [zxing-wasm](https://github.com/Sec-ant/zxing-wasm), and it loads from jsDelivr unless you call
`configure({ wasmBaseUrl })`.

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Created by [Rockyljewell](https://github.com/Rockyljewell).

### Reversed-reflectance image scanning

`scanImage(input, { tryInvert: true })` (the default) searches reversed-reflectance
codes as well as normal codes, including mixed-polarity images. When capacity
remains, formats without upstream inversion support use one extra decode pass.
`tryInvert: false` disables that work. The combined `maxResults` limit applies to
both passes, and identical payloads in separate positions remain separate results.

Browser image decoding applies EXIF orientation once and composites transparency
on white. The Node entry lazily loads PNG/JPEG/GIF/BMP decoders for its inversion
fallback (first frame for GIF); PNM/PSD retain the upstream normal decode but do
not gain a Node inversion fallback. Convert those formats to PNG when inversion
is needed. Codec expansion is limited to 64 megapixels; the fallback preserves
normal-pass results when a raster decoder is unavailable. Codecs are excluded
from browser and worker bundles and support the package's Node 18.17 minimum.
