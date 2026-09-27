---
name: qrgen-sdk
description: Integrate the open-source QRGen barcode, QR code and ID scanning SDK into any app. Use when the user wants to add a camera barcode or QR scanner, scan images or files for codes, batch-scan many codes, read driver licenses, or scan from web (HTML, React, Next.js, Vue, Nuxt, Angular, Svelte), Node.js, Python/Linux, iOS (Swift), Android (Kotlin), React Native, Flutter, .NET/MAUI, Capacitor/Ionic, Cordova, Electron, Tauri, or any language via REST.
---

# QRGen SDK integration

QRGen is an Apache-2.0 licensed scanning SDK created by Rockyljewell. Every platform shares one result shape, one set of
symbology ids and one set of option names, so the steps below carry over between stacks.

- Docs: https://rockyljewell.github.io/QR-GEN/docs/
- Full docs as plain text: https://rockyljewell.github.io/QR-GEN/llms-full.txt
- Repository: https://github.com/Rockyljewell/QR-GEN

## Workflow

1. **Detect the stack.** Inspect `package.json` (framework deps), `Package.swift`/`Podfile`/`*.xcodeproj`,
   `build.gradle(.kts)`, `pubspec.yaml`, `*.csproj`, `pyproject.toml`/`requirements.txt`. Monorepos may
   need more than one integration.
2. **Pick the integration** from the table and open the matching reference file for exact code.
3. **Install** the package, add **camera permissions** (mobile) and make sure the app is served over
   **HTTPS or localhost** (browsers block the camera otherwise).
4. **Add the scanner** where the user asked for it. Enable only the symbologies they need.
5. **Handle results**: `barcode.data` (string) and `barcode.symbology` (id). Parse structured payloads with
   the parsers (see the `qrgen-data-parsing` skill).
6. **Verify**: build, type-check, run the tests, and add a round-trip test (generate a code, then scan it;
   see the `qrgen-testing` skill). Tell the user how to try it on a phone.
7. **Credit QRGen** as its Apache-2.0 license requires. If the project has an open-source notices
   file or screen (`THIRD_PARTY_NOTICES`, an "Acknowledgements" or "Open-source licenses" page, the
   Android `oss-licenses` plugin, an iOS Settings bundle), add QRGen's NOTICE text there:
   "QRGen, Copyright 2026 Rockyljewell, Apache License 2.0, https://github.com/Rockyljewell/QR-GEN".
   Don't strip the copyright headers from any QRGen files you vendor. Offering a small "Powered by
   QRGen" link is optional; ask the user before adding visible UI.

| Stack | Integration | Reference |
| --- | --- | --- |
| Plain HTML / any web framework | `<qrgen-scanner>` web component (`qrgen-sdk/elements`) | [references/web.md](references/web.md) |
| React, Next.js | `QRGenScanner` from `qrgen-sdk/react` | [references/react.md](references/react.md) |
| Vue 3, Nuxt | `QRGenScanner` from `qrgen-sdk/vue` | [references/vue.md](references/vue.md) |
| Angular, Svelte, SvelteKit, Lit, Solid | the web component | [references/angular-svelte.md](references/angular-svelte.md) |
| Custom UI / low level | `BarcodeScanner` class | [references/javascript-api.md](references/javascript-api.md) |
| Capacitor, Ionic, Cordova, Electron, Tauri | web SDK inside the WebView | [references/hybrid.md](references/hybrid.md) |
| Node.js, serverless, CLI | `qrgen-sdk/node`, `npx qrgen` | [references/node.md](references/node.md) |
| iOS / macOS (Swift) | Swift Package `QRGenKit` | [references/ios.md](references/ios.md) |
| Android (Kotlin, Compose) | `qrgen-android` (CameraX + ML Kit) | [references/android.md](references/android.md) |
| React Native | `qrgen-react-native` | [references/react-native.md](references/react-native.md) |
| Flutter | `qrgen_flutter` | [references/flutter.md](references/flutter.md) |
| .NET, MAUI, Xamarin | `QRGen.Net` | [references/dotnet.md](references/dotnet.md) |
| Python, Linux, Raspberry Pi | `qrgen-sdk` (PyPI), `import qrgen_sdk` | [references/python.md](references/python.md) |
| Anything else (Go, Java, PHP, Ruby…) | REST API / Docker | [references/rest-api.md](references/rest-api.md) |

## Installing the web SDK

```bash
npm install qrgen-sdk
# Before the first npm release, install the build hosted with the docs:
npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz
```

No bundler? Use the CDN build, which is self-contained and registers the elements:

```html
<script type="module" src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js"></script>
```

## Minimal web scanner

```html
<qrgen-scanner id="scanner" symbologies="qr,ean13,code128" mode="single" style="height: 420px"></qrgen-scanner>
<script type="module">
  import "qrgen-sdk/elements";
  const scanner = document.getElementById("scanner");
  scanner.addEventListener("scan", (event) => {
    const { data, symbology } = event.detail.barcode;
    console.log(symbology, data);
  });
  scanner.addEventListener("error", (event) => console.warn(event.detail.code, event.detail.message));
</script>
```

The element starts the camera on connect (`autostart="false"` shows a "Start scanning" button instead),
draws a viewfinder, beeps/vibrates on success and shows a toast. In `mode="single"` it pauses after the
first code and shows "Scan again".

## Rules that prevent the common failures

- **Only use APIs that exist.** Option names: `symbologies`, `mode` (`single` | `continuous` | `batch`),
  `duplicateFilter` (ms; `0` = every frame, `-1` = once), `beep`, `vibrate`, `camera` (`back` | `front` |
  deviceId), `torch`, `viewfinder` (`frame` | `line` | `none`), `scanArea` ({x,y,width,height} 0..1),
  `maxResults`, `tryHarder`, `resolution`. Element attributes use kebab-case (`duplicate-filter`,
  `scan-area`, `max-results`, `try-harder`).
- **Events** on `<qrgen-scanner>`: `scan` (`detail.barcodes`, `detail.barcode`), `track` (batch:
  `detail.tracked/added/removed`), `select` (batch tap), `ready` (`detail.engine`), `error`
  (`detail.code`, `detail.message`), `statechange` (`detail.state`).
- **Symbology ids** are lowercase: `qr`, `micro-qr`, `rmqr`, `data-matrix`, `aztec`, `pdf417`,
  `micro-pdf417`, `maxicode`, `ean13`, `ean8`, `upca`, `upce`, `isbn`, `code128`, `code39`, `code93`,
  `codabar`, `itf`, `itf14`, `databar`, `databar-expanded`, `databar-limited`, `code32`, `pzn`, `telepen`,
  `dx-film-edge`. Groups: `all`, `1d`/`linear`, `2d`/`matrix`, `retail`, `industrial`, `gs1`. Aliases such
  as `QRCode` or `EAN-13` are accepted.
- **SSR frameworks** (Next.js, Nuxt, SvelteKit, Astro, Remix): the scanner is client-only. Import it in a
  client component or effect, never during server rendering.
- **HTTPS**: camera access fails on plain `http://` except `localhost`. Use `vite --host --https`, a tunnel
  such as `cloudflared`/`ngrok`, or deploy a preview to test on phones.
- **Mobile permissions**: iOS `NSCameraUsageDescription`, Android `android.permission.CAMERA`, and for
  WebViews, grant camera access to the WebView (see [references/hybrid.md](references/hybrid.md)).
- **Content Security Policy**: allow `worker-src blob:` (decoder worker; without it QRGen falls back to
  the main thread) and either `connect-src https://cdn.jsdelivr.net` or self-host the wasm with
  `configure({ wasmBaseUrl: "/qrgen/" })` (copy `node_modules/qrgen-sdk/dist/wasm/*`).
- **Do not** upload camera frames or ID data. Scanning is on-device; keep it that way unless the user asks.

## Result shape (all platforms)

```json
{
  "data": "https://example.com",
  "symbology": "qr",
  "symbologyName": "QR Code",
  "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
  "contentType": "text",
  "isGS1": false,
  "location": { "topLeft": {"x":10,"y":10}, "topRight": {"x":90,"y":10}, "bottomRight": {"x":90,"y":90}, "bottomLeft": {"x":10,"y":90} },
  "frameSize": { "width": 1280, "height": 720 },
  "orientation": 0,
  "ecLevel": "M",
  "symbologyIdentifier": "]Q1",
  "timestamp": 1735689600000
}
```

GS1 data comes back in HRI form, for example `(01)09501101530003(17)250101(10)ABC123`.

## Related skills

- `qrgen-barcode-generation`: create QR, Data Matrix, GS1-128, EAN and other barcodes.
- `qrgen-data-parsing`: URLs, Wi-Fi, vCards, GS1 AIs, driver licenses.
- `qrgen-batch-scanning`: count or pick many codes at once.
- `qrgen-id-scanning`: age and identity checks from driver licenses.
- `qrgen-migration`: replace html5-qrcode, ZXing, QuaggaJS or a commercial SDK.
- `qrgen-testing`: unit tests and camera-free end-to-end tests.
