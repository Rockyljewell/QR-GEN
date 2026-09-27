---
title: Introduction
description: "QRGen is an open-source (MIT) SDK for scanning barcodes, QR codes and ID documents, and for generating and parsing barcodes, on the web, mobile, desktop and server."
group: Get started
order: 1
---

QRGen is an open-source barcode, QR code and ID scanning SDK. It gives you a ready-made camera scanner you can drop into a page, a lower-level scanning API for custom interfaces, parsers that turn scanned text into structured data, and a barcode generator. Decoding runs on the device in WebAssembly (or the platform's native engine on iOS and Android), so camera frames never leave the user's device.

The whole project is MIT licensed and free to use in commercial products. There are no license keys, usage limits or telemetry.

## What's in the box

| Piece | What it does | Start here |
| --- | --- | --- |
| Pre-built scanner UI | `<qrgen-scanner>` web component with viewfinder, highlights, torch, camera switch, zoom and success feedback. Wrappers for React and Vue. | [Web Components](../web-components/) |
| `BarcodeScanner` API | Camera scanning without UI: bring your own `<video>`, get `scan`, `frame` and `track` events. | [JavaScript](../javascript/) |
| Batch scanning | Track many codes at once with stable ids, tap to select, count items on a shelf. | [Batch scanning](../batch-scanning/) |
| ID scanning | Read the PDF417 on North American driver licenses and ID cards and parse it into name, birth date, expiry and address. | [ID scanning](../id-scanning/) |
| Image scanning | Decode codes in files, photos, canvases, clipboard images and URLs, several per image. | [Image scanning](../image-scanning/) |
| Generator | Create any of 26 symbologies as SVG, PNG or a data URL, including GS1 data. | [Barcode generation](../barcode-generation/) |
| Parsers | Understand what was scanned: URLs, Wi-Fi, contacts, events, payments, product codes, GS1 element strings, GS1 Digital Link and AAMVA. | [Parsers](../parsers/) |
| CLI and REST API | `qrgen scan`, `qrgen generate` and `qrgen serve`, plus a Docker image, so any language can scan and generate over HTTP. | [CLI](../cli/), [REST API & Docker](../rest-api/) |
| Native SDKs | Swift, Kotlin, React Native, Flutter, .NET and Python packages that share the same symbology ids, result shape and parsers. | [Platforms](#platforms) |
| Agent Skills | Instructions that teach coding agents (Claude Code and others) to integrate QRGen correctly. | [Agent Skills](../../agent-skills/) |

You can try the scanner in your browser on the [demo page](../../demo/).

## Platforms

Every package follows the same cross-platform contract: the same lowercase [symbology ids](../symbologies/), the same [result object](../concepts/#the-barcode-result), the same option names and the same error codes. Code and knowledge carry over between platforms.

| Platform | Package | How it scans | Guide |
| --- | --- | --- | --- |
| Web (vanilla JS / TypeScript) | `qrgen-sdk` (npm) | zxing-cpp in WebAssembly, in a Web Worker | [JavaScript](../javascript/), [Web Components](../web-components/), [Script tag & CDN](../cdn/) |
| React, Next.js | `qrgen-sdk/react` | Same web engine | [React](../react/), [Next.js](../nextjs/) |
| Vue, Nuxt | `qrgen-sdk/vue` | Same web engine | [Vue & Nuxt](../vue/) |
| Angular | `qrgen-sdk/elements` | Same web engine | [Angular](../angular/) |
| Svelte, SvelteKit | `qrgen-sdk/elements` | Same web engine | [Svelte & SvelteKit](../svelte/) |
| iOS, macOS | `QRGenKit` (Swift Package) | Native | [iOS](../ios/) |
| Android | `dev.qrgen:qrgen-android` | Native | [Android](../android/) |
| React Native | `qrgen-react-native` | Native camera, or the embed page in a WebView | [React Native](../react-native/) |
| Flutter | `qrgen_flutter` | See the guide | [Flutter](../flutter/) |
| .NET / MAUI | `QRGen.Net` | See the guide | [.NET](../dotnet/) |
| Capacitor, Ionic | `qrgen-sdk` | Web engine in the app's WebView | [Capacitor & Ionic](../capacitor/) |
| Cordova | `qrgen-sdk` | Web engine in the app's WebView | [Cordova](../cordova/) |
| Electron | `qrgen-sdk` | Web engine in the renderer, `qrgen-sdk/node` in the main process | [Electron](../electron/) |
| Tauri | `qrgen-sdk` | Web engine in the system WebView | [Tauri](../tauri/) |
| Titanium | Hosted embed page | WebView guide | [Titanium](../titanium/) |
| Node.js, Bun | `qrgen-sdk/node` | WebAssembly, loaded from `node_modules` | [Node.js](../nodejs/) |
| Command line | `qrgen` (npm bin) | Node.js | [CLI](../cli/) |
| Any language over HTTP | `qrgen serve`, Docker image | Node.js | [REST API & Docker](../rest-api/) |
| Python | `qrgen-sdk` (PyPI) | zxing-cpp, OpenCV for webcams | [Python](../python/) |
| Linux, Raspberry Pi | Any of the above | CLI, REST, Python or a kiosk browser | [Linux & Raspberry Pi](../linux/) |
| Any other WebView | Hosted embed page | Web engine, events over a message bridge | [Embed bridge](../embed-bridge/) |

## How it works

On the web, QRGen wraps [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp), a mature C++ barcode library, compiled to WebAssembly by [zxing-wasm](https://github.com/Sec-ant/zxing-wasm). The `BarcodeScanner` opens the camera with `getUserMedia`, crops each frame to the visible scan area, and decodes it in a Web Worker so the page stays responsive. Results go through a duplicate filter, trigger optional beep and vibration feedback, and arrive as plain JSON objects.

The decoder (`zxing_reader.wasm`, about 400 KB gzipped) is downloaded once and cached. By default it loads from jsDelivr; you can [self-host it](../installation/#self-host-the-webassembly-engine) for offline apps or strict networks. The generator uses a separate `zxing_writer.wasm` that is only fetched when you generate a barcode.

## Next steps

- [Quick start](../quick-start/): a working scanner in under 15 lines.
- [Installation](../installation/): package managers, CDN, self-hosting and Content Security Policy.
- [Core concepts](../concepts/): symbologies, scan modes, the result object and duplicate filtering.
