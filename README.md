<div align="center">

# QRGEN

**Open-source barcode, QR code and ID scanning for every platform, with Agent Skills that get your coding agent to working code in minutes.**

[Website](https://rockyljewell.github.io/QR-GEN/) · [Live demo](https://rockyljewell.github.io/QR-GEN/demo/) · [Docs](https://rockyljewell.github.io/QR-GEN/docs/) · [Agent Skills](https://rockyljewell.github.io/QR-GEN/agent-skills/) · [SDK & Frameworks](https://rockyljewell.github.io/QR-GEN/sdk/)

[![CI](https://github.com/Rockyljewell/QR-GEN/actions/workflows/ci.yml/badge.svg)](https://github.com/Rockyljewell/QR-GEN/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-5cc9d6.svg)](LICENSE)

Created by [Rockyljewell](https://github.com/Rockyljewell)

</div>

QRGen is a free, open-source (Apache-2.0) alternative to commercial scanning SDKs. It reads 26 symbologies
(QR, Data Matrix, PDF417, Aztec, EAN/UPC, Code 128, GS1 DataBar…), ships a polished pre-built
scanner UI, tracks many codes at once, parses GS1 data and North American driver licenses, and
generates print-ready barcodes. It runs on the web, iOS, Android, React Native, Flutter, .NET, Node.js,
Python and any language through a REST API. Camera frames never leave the device.

## Agent Skills

Give your coding agent (Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini CLI…) the knowledge to
integrate QRGen correctly:

```bash
# Install it with one command:
npx skills add https://github.com/Rockyljewell/QR-GEN

# Or install as a Claude Code plugin:
## 1. Install Rockyljewell/QR-GEN marketplace
/plugin marketplace add Rockyljewell/QR-GEN

## 2. Install plugin
/plugin install qrgen-sdk@qrgen-plugins
```

Then ask: *"Add a QR scanner to the checkout page"*. No skills support? Paste the
[agent prompt](https://rockyljewell.github.io/QR-GEN/agent-prompt.txt) into any assistant.

| Skill | What it teaches |
| --- | --- |
| [`qrgen-sdk`](skills/qrgen-sdk/SKILL.md) | Adding a scanner on any stack, with a reference file per platform |
| [`qrgen-barcode-generation`](skills/qrgen-barcode-generation/SKILL.md) | QR, Data Matrix, GS1-128, EAN… as SVG/PNG, printing tips |
| [`qrgen-data-parsing`](skills/qrgen-data-parsing/SKILL.md) | URLs, Wi-Fi, vCards, payments, GS1 AIs, driver licenses |
| [`qrgen-batch-scanning`](skills/qrgen-batch-scanning/SKILL.md) | Counting and picking many codes at once |
| [`qrgen-id-scanning`](skills/qrgen-id-scanning/SKILL.md) | Age verification from AAMVA PDF417, with privacy guidance |
| [`qrgen-migration`](skills/qrgen-migration/SKILL.md) | Replacing html5-qrcode, ZXing, QuaggaJS, BarcodeDetector or a commercial SDK |
| [`qrgen-testing`](skills/qrgen-testing/SKILL.md) | Round-trip unit tests and camera-free Playwright tests |

## Quick start (web)

```html
<script type="module" src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js"></script>

<qrgen-scanner symbologies="qr,ean13,code128" mode="single" style="height: 420px"></qrgen-scanner>

<script type="module">
  document.querySelector("qrgen-scanner").addEventListener("scan", (e) => {
    console.log(e.detail.barcode.symbology, e.detail.barcode.data);
  });
</script>
```

With a bundler:

```bash
npm install qrgen-sdk
# until the first npm release: npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz
```

```tsx
import { QRGenScanner } from "qrgen-sdk/react";

<QRGenScanner symbologies={["qr", "ean13"]} mode="single" onScan={(codes) => console.log(codes[0].data)} />;
```

Camera access needs HTTPS or `localhost`.

## Platforms

| Platform | Package | Status | Guide |
| --- | --- | --- | --- |
| Web: HTML, React, Next.js, Vue, Nuxt, Angular, Svelte | [`packages/sdk`](packages/sdk) · `qrgen-sdk` | stable | [docs](https://rockyljewell.github.io/QR-GEN/docs/javascript/) |
| Node.js, CLI, REST API, Docker | [`packages/sdk`](packages/sdk) · `qrgen`, `ghcr.io/rockyljewell/qr-gen` | stable | [docs](https://rockyljewell.github.io/QR-GEN/docs/rest-api/) |
| iOS / macOS (Swift, SwiftUI, UIKit) | [`packages/ios`](packages/ios) · `QRGenKit` (SPM, CocoaPods) | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/ios/) |
| Android (Kotlin, Views, Compose) | [`packages/android`](packages/android) · JitPack | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/android/) |
| React Native / Expo | [`packages/react-native`](packages/react-native) · `qrgen-react-native` | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/react-native/) |
| Flutter | [`packages/flutter`](packages/flutter) · `qrgen_flutter` | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/flutter/) |
| .NET, MAUI, Xamarin | [`packages/dotnet`](packages/dotnet) · `QRGen.Net` | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/dotnet/) |
| Python, Linux, Raspberry Pi | [`packages/python`](packages/python) · `qrgen-sdk` | beta | [docs](https://rockyljewell.github.io/QR-GEN/docs/python/) |
| Capacitor, Ionic, Cordova, Electron, Tauri, Titanium | web SDK / [embed bridge](https://rockyljewell.github.io/QR-GEN/docs/embed-bridge/) | guides | [docs](https://rockyljewell.github.io/QR-GEN/docs/) |

**Stable** means tested in CI in real browsers (Chromium with a fake camera) and Node. **Beta**
means the logic is unit tested and the package builds, but it has not yet been verified on physical
devices. Please report what you find.

Every package follows one [cross-platform specification](docs/SPEC.md): the same symbology ids,
options, result JSON, parsers, embed bridge and REST API.

## What's inside

- **Pre-built scanner UI**: `<qrgen-scanner>`, SwiftUI/UIKit views, Android View + Compose, React
  Native and Flutter widgets. Viewfinder, highlights, success toast, torch, zoom, camera switching,
  beep and haptics.
- **Scan modes**: `single`, `continuous` and `batch` (multi-code tracking with tap-to-select).
- **Engines**: [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) compiled to WebAssembly (in a Web
  Worker) on the web, Node and Python; Apple Vision on iOS; ML Kit on Android.
- **Parsers**: GS1 element strings and Digital Link (750+ AIs), AAMVA driver licenses, and QR content
  (URL, Wi-Fi, vCard/MECARD, events, payments, GTIN).
- **Generator**: 26 formats as SVG/PNG with GS1 encoding, colors and human-readable text.
- **Everywhere else**: a CLI (`npx qrgen scan photo.jpg`), a REST API with Docker image, and a hosted
  embed page for any WebView.

## Repository layout

```
packages/sdk            qrgen-sdk: web SDK, web components, React/Vue, Node, CLI, REST server
packages/ios            QRGenKit Swift package (manifest at /Package.swift, /QRGenKit.podspec)
packages/android        Kotlin: qrgen-core (JVM), qrgen-android, qrgen-compose, sample app
packages/react-native   qrgen-react-native
packages/flutter        qrgen_flutter
packages/dotnet         QRGen.Net (+ MAUI sample)
packages/python         qrgen-sdk for Python (qrgen_sdk)
skills/                 Agent Skills (SKILL.md) for the skills CLI and Claude Code
.claude-plugin/         Claude Code plugin marketplace manifest
site/                   Website, live demo and docs (Astro), deployed to GitHub Pages
docs/SPEC.md            Cross-platform contract
```

## Development

```bash
npm ci                       # installs the SDK and website workspaces
npm test                     # SDK unit tests (vitest)
npm run build                # SDK + website
npm run dev                  # website at http://localhost:4321/QR-GEN/
npm run test:e2e             # Playwright end-to-end tests with fake camera videos
node scripts/validate-skills.mjs
```

Per-platform commands are in each package's README and in [CONTRIBUTING.md](CONTRIBUTING.md).

## Deploying the website

The site deploys to GitHub Pages from `main` via [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
Enable it once under **Settings → Pages → Source: GitHub Actions**. To host elsewhere, build with
`SITE=https://your.domain BASE=/ npm run build`.

## Credit

QRGen was created by [Rockyljewell](https://github.com/Rockyljewell). It's free to use, including in
commercial and closed-source products. If you ship it, the license asks for three things:

- Keep the copyright and license headers in the source files you use.
- Include the [NOTICE](NOTICE) file, or its text, wherever your product lists open-source credits
  (an "Acknowledgements" or "Open-source licenses" screen, your docs, or your README).
- Mark files you changed as changed.

A visible "Powered by QRGen" link is optional, but appreciated. Copy-paste snippets and a badge are on
the [credit page](https://rockyljewell.github.io/QR-GEN/docs/credit/). To cite QRGen in a paper or
article, use GitHub's "Cite this repository" button (from [CITATION.cff](CITATION.cff)).

Forks are welcome under a different name: see [TRADEMARKS.md](TRADEMARKS.md).

## License and disclaimer

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 Rockyljewell.
QRGen is an independent open-source project and is not affiliated with,
endorsed by or connected to Scandit AG or any other commercial scanning vendor. Product names are
trademarks of their respective owners.
