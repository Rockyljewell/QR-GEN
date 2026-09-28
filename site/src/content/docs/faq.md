---
title: FAQ
description: "Answers to common questions about QRGen: licensing, privacy, offline use, browser and platform support, bundle size, ID documents and commercial SDKs."
group: Reference
order: 5
---

## Is QRGen free for commercial use?

Yes. QRGen is licensed under the Apache License 2.0: use it in commercial and closed-source products, modify it, and redistribute it. When you ship it, keep the license, the copyright headers and the NOTICE text (see [Credit and attribution](../credit/)). There are no license keys, per-device fees, usage limits or telemetry. The decoding engine is [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (Apache-2.0), compiled to WebAssembly by [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT).

## Do I have to credit QRGen?

If you ship it, yes: include the license, keep the copyright headers and put the NOTICE text wherever your product lists open-source credits. A visible "Powered by QRGen" link is optional. See [Credit and attribution](../credit/) for the text to copy and where it goes on each platform.

## Are camera images uploaded anywhere?

No. Decoding runs on the device, in WebAssembly in the browser or with the native engine on iOS and Android. Frames and images never leave the device unless your own code sends them, and QRGen collects no analytics. The browser SDK's only network requests are the engine download (from jsDelivr unless you self-host it) and image URLs you pass to `scanImage()`. See [privacy](../concepts/#privacy).

## Does it work offline?

Yes, once the engine is available. Browsers cache the wasm after the first download. For guaranteed offline use (installed PWAs, kiosks, desktop and mobile app shells), [self-host the wasm](../installation/#self-host-the-webassembly-engine) and bundle it with your app. The Node.js package reads it from `node_modules` and never needs the network.

## Which browsers are supported?

Current Chrome, Edge, Firefox, Samsung Internet and Safari, on desktop and mobile, with iOS Safari 14.5 or later. Camera scanning needs `getUserMedia` and a secure context (HTTPS or localhost). See [browser support](../installation/#browser-support).

## Why doesn't the camera work on my phone when it works on my laptop?

Almost always because the phone loads the dev server over a LAN address like `http://192.168.1.20:5173`, which isn't a secure context. Use HTTPS or a tunnel. See [Troubleshooting](../troubleshooting/#the-camera-does-not-start).

## How big is it?

The JavaScript is about 60 KB gzipped for the full bundle (less with tree shaking if you only import what you use). The decoder wasm is about 400 KB gzipped and is downloaded once, when scanning starts. The generator wasm (about 340 KB gzipped) is only downloaded if you generate barcodes.

## Which barcode types are supported?

26 symbologies, including QR Code, Micro QR, rMQR, Data Matrix, Aztec, PDF417, MaxiCode, EAN/UPC, Code 128 (including GS1-128), Code 39, Code 93, Codabar, ITF, GS1 DataBar and several pharmaceutical codes. All of them can also be generated. See [Symbologies](../symbologies/).

## Can it scan several barcodes at once?

Yes. [Batch mode](../batch-scanning/) tracks up to 20 codes per frame with stable ids and lets users tap to select. `scanImage()` returns every code in an image.

## Can it read driver licenses and passports?

It reads the PDF417 barcode on US and Canadian driver licenses and ID cards, and `parseAAMVA()` extracts the name, birth date, address and expiry. Passports and most other national ID documents use an MRZ (printed text), which needs OCR; QRGen doesn't include OCR. See [ID scanning](../id-scanning/).

## Does it work in React Native, Flutter, Ionic or Electron?

Yes. Capacitor, Ionic, Cordova, Electron and Tauri run the web SDK in their WebView. React Native and Flutter have their own packages, and any other WebView can load the hosted [embed page](../embed-bridge/). See the [platform list](../introduction/#platforms).

## Can I use it on a server or from another language?

Yes. Use [`qrgen-sdk/node`](../nodejs/) in Node.js, the [`qrgen` CLI](../cli/) in scripts, the [Python package](../python/), or run the [REST API](../rest-api/) (also as a Docker image) and call it from any language.

## Do I need QRGen if I have a hardware barcode scanner?

USB and Bluetooth scanners usually act as keyboards and type the code into the focused field, so you don't need a camera SDK to read them. You can still use QRGen's [parsers](../parsers/) on the typed text, for example to extract the GTIN, batch and expiry from a GS1 DataMatrix, or to parse a driver license read by a 2D scanner. To generate labels for them to scan, use the [generator](../barcode-generation/).

## Can I change the look of the scanner?

Yes: accent color, font and corner radius through CSS custom properties, individual pieces through `::part()`, hidden controls with `controls="none"`, or a completely custom UI on `BarcodeScanner`. See [UI customization](../ui-customization/).

## Can I change the beep?

Turn it off with `beep="false"` and play your own sound in the `scan` handler, or tune the built-in tone through `scanner.feedback.options` (`frequency`, `duration`, `volume`). See [feedback](../barcode-scanning/#feedback).

## Why is my ISBN reported as EAN-13?

An ISBN barcode is an EAN-13 that starts with 978 or 979, and an ITF-14 is a 14-digit Interleaved 2 of 5. When the parent symbology is enabled too (as with the default `all`), the result uses the parent id: `ean13` or `itf`. Enable `isbn` without `ean13` to get `isbn`. `parseContent()` reports `kind: "isbn"` either way. See [related symbologies](../symbologies/#related-symbologies).

## How does QRGen compare to Scandit and other commercial SDKs?

QRGen is an independent open-source project and is not affiliated with Scandit or any other vendor. It covers the common needs (fast QR and retail scanning, batch tracking, a pre-built UI, parsers) at no cost and with no lock-in. Commercial SDKs can still outperform it on badly damaged codes, very small or distant codes, and difficult lighting, and they offer features QRGen doesn't have, such as OCR, MRZ reading, AR overlays and vendor support. Test with your own codes and devices. For a concept-by-concept mapping, see [Migrating from other SDKs](../migration/).

## Can coding agents use QRGen?

Yes. The [Agent Skills](../../agent-skills/) teach agents such as Claude Code how to integrate QRGen correctly. Install them with `npx skills add https://github.com/Rockyljewell/QR-GEN`, or in Claude Code with `/plugin marketplace add Rockyljewell/QR-GEN` followed by `/plugin install qrgen-sdk@qrgen-plugins`.

## How do I report a bug or ask for a feature?

Open an issue on [GitHub](https://github.com/Rockyljewell/QR-GEN/issues). Include the platform, browser or OS version, the error code, and if possible a photo of a code that fails (without personal data). Contributions are welcome.
