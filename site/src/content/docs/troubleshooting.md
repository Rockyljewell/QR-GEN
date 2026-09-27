---
title: Troubleshooting
description: "Fix common QRGen problems: the camera does not start, black video on iOS, slow scanning, codes not found, CSP warnings, blocked wasm and SSR errors."
group: Reference
order: 4
---

Start with the error code, if there is one. The element shows it on its error screen, the `error` event carries it, and `start()` rejects with it. The [error code table](../options-events/#error-codes) lists causes for each. The sections below cover the problems that come up most often.

## The camera does not start

Work through these in order:

1. **Secure context.** The page must be served over HTTPS, or from `http://localhost` / `http://127.0.0.1`. A LAN address such as `http://192.168.1.20:5173` is not secure, which is why scanning works on your laptop but not on your phone. Check `window.isSecureContext` in the console. For phone testing, use HTTPS on your dev server (Vite: `@vitejs/plugin-basic-ssl`; Next.js: `next dev --experimental-https`; Angular: `ng serve --ssl`) or a tunnel. Error code: `insecure-context`.
2. **Permission.** If the user blocked the camera once, the browser remembers and won't ask again. They have to allow it in the site settings (the icon next to the address bar on desktop; **Settings > Safari > Camera** or the **aA** menu on iOS; site settings in Chrome on Android). The OS can also block the browser: check **System Settings > Privacy & Security > Camera** on macOS and **Settings > Privacy & security > Camera** on Windows. Error code: `camera-permission-denied`.
3. **Camera in use.** Another app (a video call, the OS camera app) or another tab may hold the camera. On Windows, only one app can use a camera at a time. Close the other app and retry. Error code: `camera-in-use`.
4. **Iframes.** A scanner inside an `<iframe>` needs `allow="camera"` on the iframe, and the parent page must be a secure context too. Without it the error is `camera-permission-denied` with no prompt.
5. **Permissions-Policy.** A `Permissions-Policy` response header that doesn't include `camera` (for example `camera=()`) blocks the camera for the page.
6. **In-app browsers and WebViews.** Some in-app browsers (social and messaging apps) don't support `getUserMedia`, and app WebViews only get the camera if the app grants it. Test in the system browser; for your own apps, see [Capacitor](../capacitor/), [Cordova](../cordova/) or the [embed bridge host examples](../embed-bridge/#host-examples).
7. **No camera.** Desktops without a webcam report `camera-not-found`. Offer [image upload](../image-scanning/) as a fallback.

A quick check in the browser console:

```js
console.log(window.isSecureContext, !!navigator.mediaDevices?.getUserMedia);
navigator.mediaDevices.getUserMedia({ video: true }).then((s) => (s.getTracks().forEach((t) => t.stop()), "camera OK"), (e) => e.name);
```

## Black video on iOS

- **Inline playback.** iOS plays video full screen, or not at all, unless the element has `playsinline` and `muted`. QRGen sets both on the video it uses, including a `video` you pass to `BarcodeScanner`. If you create your own `<video>` for another purpose, add `playsinline muted autoplay`.
- **WKWebView apps.** In a native app, the WebView needs inline media playback enabled: `allowsInlineMediaPlayback = true` on `WKWebViewConfiguration` (Cordova: `<preference name="AllowInlineMediaPlayback" value="true" />`).
- **Hidden or detached video.** Give the preview a size and keep it in the page. A `video` with `display: none`, or one that was never added to the DOM, may never deliver frames on iOS.
- **One camera stream at a time.** iOS Safari allows a single active camera stream. Starting a second scanner (or another page or tab using the camera) turns the first preview black. Call `stop()` or `destroy()` on scanners you no longer show.
- **After switching apps.** iOS suspends the camera when Safari goes to the background. If the preview is black after coming back, restart it on `visibilitychange` (see [JavaScript](../javascript/#clean-up)).
- **Old iOS.** QRGen supports iOS 14.5 and later.

## Scanning is slow

Measure first: `scanner.stats` (on `BarcodeScanner`, or `el.scanner.stats` on the element) shows `decodeMs` per frame, decodes per second (`fps`) and the `engine`.

- **Limit symbologies.** Scanning for all 26 is the biggest cost. Enable only what you need (`symbologies="qr"` or `"retail"`). See [recommended sets](../barcode-scanning/#choose-symbologies).
- **Use the worker.** If `engine` is `"main"`, decoding competes with your UI. See [the worker warning](#decoding-on-the-main-thread-warning).
- **Lower the resolution.** `resolution="sd"` (640x480) is enough for most QR codes and retail barcodes at normal distance.
- **Decode smaller images.** On `BarcodeScanner`, `maxDecodeSize` (default 1280) caps the size handed to the decoder. `960` or `800` is noticeably faster on older phones. On the element: `el.scanner.setOptions({ maxDecodeSize: 960 })` after `ready`.
- **Turn off extra passes.** Leave `try-harder` off for camera scanning, and set `tryInvert: false` on `BarcodeScanner` if you never scan white-on-black codes.
- **Keep the scan area small.** The element decodes only the viewfinder region; with `viewfinder="none"` or batch mode it decodes everything visible. With `BarcodeScanner`, set `scanArea`.
- **Batch mode.** Lower `max-results` if you never have 20 codes in view.
- **Heat.** Phones throttle the CPU when they get hot. Stop the scanner when it's not on screen.

## Codes are not found

- **Is the symbology enabled?** A Code 39 label won't be found with `symbologies="qr"`. Try without `symbologies` once to see what the code is.
- **Is the code inside the viewfinder?** The element only decodes the viewfinder region (plus a small margin). Aim so the whole code is inside it.
- **Distance and focus.** Phones can't focus closer than about 10 cm. Move the phone back until the code is sharp, then use the zoom button (or `setZoom(2)`) for small codes. Fixed-focus webcams need the code further away.
- **Small or dense codes.** Each module needs a few pixels. Use `resolution="fhd"`, zoom in, or take a photo and use `scanImage()`, which works at full resolution.
- **Glare and lighting.** Reflections on glossy labels, screens and laminated cards hide parts of the code: tilt the code or the phone slightly. In the dark, turn on the torch.
- **Motion blur.** Hold still for a moment, especially in low light.
- **Damaged or low-contrast codes.** Turn on `try-harder`. For images, `tryHarder` is already on.
- **Inverted codes.** White-on-black codes are tried on every other frame by default. With `BarcodeScanner`, set `tryInvert: true` to try every frame.
- **Screens.** Codes on monitors can show moire patterns. Lower the screen's brightness, or move closer and zoom less.
- **Reported as a different type.** A book barcode comes back as `ean13` and an ITF-14 as `itf` when the parent symbology is enabled too. See [related symbologies](../symbologies/#related-symbologies).

To separate camera problems from decoding problems, take a photo of the code and try it with `scanImage()` or `qrgen scan photo.jpg`.

## "decoding on the main thread" warning

```text
[qrgen] decoding on the main thread: <reason>
```

The decoder worker couldn't start, so frames are decoded on the main thread. Scanning still works but can make the page less responsive. Common reasons:

- **CSP.** The policy doesn't allow Blob URL workers. Add `blob:` to `worker-src` (or to `script-src` if you have no `worker-src`).
- **The worker couldn't load the engine**, for example because `connect-src` blocks the wasm URL inside the worker. The reason in the message says which.
- **No Worker support** in the environment.

If you prefer the main thread on purpose, set `worker: false` (or `worker="false"` on the element) and the warning goes away.

## The engine fails to load

Error code `engine-load-failed`, with a message like `The barcode engine failed to load (...). Check network access to https://cdn.jsdelivr.net/... or self-host the wasm with configure({ wasmBaseUrl }).`

- **Network filters.** Corporate proxies, firewalls, ad blockers and some countries' networks block or throttle `cdn.jsdelivr.net`. [Self-host the wasm](../installation/#self-host-the-webassembly-engine) on your own origin.
- **CSP.** Check the console for `Refused to connect` (add the origin to `connect-src`) or `Refused to compile or instantiate WebAssembly` (add `'wasm-unsafe-eval'` to `script-src`).
- **Wrong self-hosted path.** Open the URL from the error message in a new tab. A 404 means `wasmBaseUrl` doesn't point at the folder with `zxing_reader.wasm`. Relative URLs resolve against the page, so prefer absolute paths like `/qrgen/`.
- **Version mismatch.** After upgrading `qrgen-sdk`, copy the wasm files again. Old files with new JavaScript fail to instantiate.
- **Offline apps.** An app that must work offline on first launch has to bundle the wasm; see [Capacitor](../capacitor/#offline-apps) or [Electron](../electron/#offline-engine).
- **Serverless.** `ENOENT ... zxing_reader.wasm` in Node means the wasm files weren't deployed. See [Node.js serverless notes](../nodejs/#serverless).

## Server-side rendering errors

QRGen's modules are safe to import on the server: nothing touches `window`, `document` or the camera at import time, and the elements only register in the browser. Errors during SSR usually come from calling browser APIs in render code:

- **`window is not defined`, `document is not defined`, `navigator is not defined`**: code that creates a `BarcodeScanner`, calls `scanImage()` or reads `navigator.mediaDevices` runs on the server. Move it into `useEffect`, `onMounted`, `onMount` or an event handler.
- **Next.js: hook errors such as "useRef only works in Client Components"**: the file that renders `QRGenScanner` needs `"use client"`. See [Next.js](../nextjs/).
- **Nuxt and SvelteKit**: wrap the scanner in `<ClientOnly>` (Nuxt) or import the SDK in `onMount` (SvelteKit) if you want to skip server rendering entirely. See [Vue & Nuxt](../vue/#nuxt) and [Svelte & SvelteKit](../svelte/#sveltekit).
- **Vue warning "Failed to resolve component: qrgen-scanner"**: set `compilerOptions.isCustomElement` when you use the raw element in templates. See [Vue](../vue/#using-the-elements-directly).

## No beep or vibration

- **iOS beep.** Audio only plays after a user gesture. Start the scanner from a tap (`autostart="false"` shows a **Start scanning** button), or accept silence until the first tap.
- **Silent mode.** On iPhone, the ring/silent switch mutes web audio.
- **Vibration.** iOS Safari and iOS WebViews don't support the Vibration API. Android Chrome does, unless the phone is in a mode that disables vibration.
- **Kiosks.** Chromium blocks audio without a gesture; start it with `--autoplay-policy=no-user-gesture-required` (see [Linux kiosk](../linux/#chromium-kiosk)).

## Still stuck?

Search or open an issue on [GitHub](https://github.com/Rockyljewell/QR-GEN/issues) with the browser and OS versions, the error code and message, and `scanner.stats`. For decoding problems, attach a photo of the code if it doesn't contain personal data.
