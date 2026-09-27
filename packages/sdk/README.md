# qrgen-sdk

Open-source (MIT) barcode, QR code and ID scanning for the web and Node.js: a drop-in scanner UI,
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

MIT License.
