import { SITE_URL, TARBALL_URL } from "./site";

/** Install commands shown in the terminal box (mirrors the Agent Skills README). */
export const SKILLS_INSTALL = `# Install it with one command:
npx skills add https://github.com/Rockyljewell/QR-GEN

# Or install as a Claude Code plugin:
## 1. Install Rockyljewell/QR-GEN marketplace
/plugin marketplace add Rockyljewell/QR-GEN

## 2. Install plugin
/plugin install qrgen-sdk@qrgen-plugins`;

/**
 * The prompt a developer pastes into any coding agent (Claude Code, Cursor, Codex,
 * Copilot, Windsurf, Gemini CLI…) to integrate QRGen. Also served at /agent-prompt.txt.
 */
export const AGENT_PROMPT = `Add barcode and QR code scanning to this project with QRGen, an open-source (MIT) scanning SDK.

Docs: ${SITE_URL}docs/
Full docs as plain text (read this first): ${SITE_URL}llms-full.txt

1. Detect the stack from the repo (package.json, Package.swift/Podfile, build.gradle(.kts), pubspec.yaml, *.csproj, pyproject.toml/requirements.txt) and pick the matching integration:
   - Web, any framework: npm install qrgen-sdk
     (if the package is not on npm yet: npm install ${TARBALL_URL})
     - React / Next.js: import { QRGenScanner } from "qrgen-sdk/react" (client component; Next.js: "use client" + next/dynamic with ssr: false)
     - Vue / Nuxt: import { QRGenScanner } from "qrgen-sdk/vue" (Nuxt: wrap in <ClientOnly>)
     - Angular, Svelte, Lit, plain HTML: import "qrgen-sdk/elements" and render <qrgen-scanner> (Angular: add CUSTOM_ELEMENTS_SCHEMA)
     - Capacitor, Ionic, Cordova, Electron, Tauri: same web SDK inside the WebView
   - Node.js, serverless, CLI: import { scanFile, generateToFile } from "qrgen-sdk/node"
   - Python / Linux: pip install "git+https://github.com/Rockyljewell/QR-GEN.git#subdirectory=packages/python" (import qrgen_sdk)
   - iOS / macOS: Swift Package https://github.com/Rockyljewell/QR-GEN, product QRGenKit (SwiftUI QRGenScannerView)
   - Android: JitPack, see ${SITE_URL}docs/android/ (QRGenScannerView / Compose QRGenScanner)
   - React Native: qrgen-react-native (see ${SITE_URL}docs/react-native/)
   - Flutter: qrgen_flutter (see ${SITE_URL}docs/flutter/)
   - .NET / MAUI / Xamarin: QRGen.Net (see ${SITE_URL}docs/dotnet/)
   - Anything else: the REST API, docker run -p 8080:8080 ghcr.io/rockyljewell/qr-gen, then POST an image to /v1/scan
2. Add a scanner where the user needs it. Web example:
   <qrgen-scanner symbologies="qr,ean13,code128" mode="single"></qrgen-scanner>
   element.addEventListener("scan", (e) => handle(e.detail.barcode.data, e.detail.barcode.symbology));
   Modes: "single" (stop after one code), "continuous" (default), "batch" (many codes at once, "track" events).
3. Only enable the symbologies the app needs (faster and fewer false reads). Ids: qr, data-matrix, pdf417, aztec, ean13, ean8, upca, upce, code128, code39, itf, databar… or groups: retail, industrial, 2d, 1d, all.
4. Camera access needs HTTPS or localhost. On mobile add the camera permission (iOS NSCameraUsageDescription, Android android.permission.CAMERA).
5. For structured data use the parsers: import { parseContent, parseGS1, parseAAMVA } from "qrgen-sdk/parsers" (URLs, Wi-Fi, contacts, GS1 AIs, driver licenses).
6. Verify: build, start the dev server, open the scanner page on a phone or laptop, and scan the sample codes at ${SITE_URL}demo/. Add a unit test that feeds a generated code image to scanImage()/scanFile().

Use only the APIs in the docs above and do not invent options. If something is unclear, fetch ${SITE_URL}llms-full.txt.`;
