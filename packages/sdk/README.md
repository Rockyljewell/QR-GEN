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

## Plan a QR code for print

```ts
import { buildUrlPayload, buildWifiPayload, planQRCode } from "qrgen-sdk";

const data = buildUrlPayload("https://example.com/menu");
const plan = await planQRCode(data, { widthMm: 30, dpi: 203 });
if (plan.suitable) {
  // Standalone SVG with physical mm dimensions. Print at 100%, without rescaling.
  saveSvg(plan.printSvg);
  console.log(plan.geometry.widthMm, plan.geometry.dotsPerModule, plan.ecLevel);
} else {
  console.log(plan.diagnostics); // includes the minimum required width
}
const wifi = buildWifiPayload({ ssid: "Café", authentication: "WPA", password: "example-password" });
```

`saveSvg` is your application's download/file helper. The planner uses the real encoder, keeps a four-module quiet zone, and selects whole printer dots. Automatic correction starts at M, prioritizes larger modules, then stronger correction among ties. `minDotsPerModule` defaults to 3 as an illustrative profile; geometry does not prove physical scan reliability. Output is bounded to 2048 pixels per side. Invalid inputs throw; valid content that does not fit returns `suitable: false`. Leading Unicode BOM is rejected because the current string encoder drops it. Text is never silently shortened or rewritten.

`barcode.svg` and `barcode.png` retain pixel dimensions. Use `printSvg` for physical-size SVG; PNG consumers must apply the reported width/DPI. Wi-Fi helpers escape delimiters and quote hex-looking text names/passwords according to the common WIFI convention; existing `parseContent` retains those quote wrappers. Phone support and router credentials still need testing. These new planning APIs are available in the JavaScript/browser and Node entries.

## Capability diagnostics and adaptive capture

`getRuntimeCapabilities()` reads declared formats, camera prerequisites, worker/detector API presence and engine asset routing without requesting permissions or loading assets. It leaves offline readiness `unverified`. `checkSymbologies("qr,unknown")` keeps unknown and unsupported requests visible.

Adaptive capture is an opt-in experiment: `new BarcodeScanner({ adaptive: true })`, `<qrgen-scanner adaptive>`, or the boolean `adaptive` prop in React/Vue. It changes bounded full-frame decoder input size, periodically checks a larger frame after misses, and resets learned state on lifecycle/settings or intrinsic camera-size changes. `scanner.stats.adaptive` reports actual input dimensions, phase and decoder-only timing; ordinary `frame.decodeMs` includes capture as before. Discovery currently depends on frames with no decoded codes: an easy code can prevent discovery of a smaller neighboring code. Use fixed capture when every visible item matters, including inventory/batch workflows. Fixed capture remains the default. See the repository's [experiment notes](../../docs/FRONTIER-EXPERIMENTS.md) for evidence, limitations and physical-device gates.

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
