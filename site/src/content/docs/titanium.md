---
title: Titanium
description: "A WebView-based guide for Titanium apps: load the hosted QRGen embed page in Ti.UI.WebView and receive scan events through an injected bridge or polling."
group: "Mobile & desktop"
order: 9
status: guide
---

There is no native QRGen module for Titanium. This guide shows a WebView-based integration: the app loads QRGen's hosted [embed page](../embed-bridge/) in a `Ti.UI.WebView`, the page does the scanning, and scan events are passed back to your Titanium code. It uses only public Titanium APIs, but it is a guide, not a supported package: test it on your Titanium SDK version and target devices.

Requirements: Titanium SDK 8 or later (WKWebView on iOS, asynchronous `evalJS`), iOS 14.5 or later, and an Android System WebView recent enough to support `getUserMedia`.

## How it works

1. A `Ti.UI.WebView` loads `https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single`. The page is served over HTTPS, so it is a secure context and may use the camera.
2. The embed page posts every event (`ready`, `scan`, `error`, ...) to any host channel it finds in the page. Titanium doesn't provide one of the standard channels, so the app injects one.
3. The app reads the messages and sends commands back with `evalJS`.

## Camera permission

Declare the permission in `tiapp.xml`:

```xml
<ti:app xmlns:ti="http://ti.tidev.io">
  <ios>
    <plist>
      <dict>
        <key>NSCameraUsageDescription</key>
        <string>The camera is used to scan barcodes and QR codes.</string>
      </dict>
    </plist>
  </ios>
  <android xmlns:android="http://schemas.android.com/apk/res/android">
    <manifest>
      <uses-permission android:name="android.permission.CAMERA" />
    </manifest>
  </android>
</ti:app>
```

Request the runtime permission before opening the scanner:

```js
function withCameraPermission(callback) {
  if (Ti.Media.hasCameraPermissions()) return callback(true);
  Ti.Media.requestCameraPermissions((e) => callback(e.success));
}
```

## Open the scanner

```js
// app/lib/qrgen-scanner.js (Alloy) or Resources/qrgen-scanner.js (classic)
const EMBED_URL = "https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13,code128&mode=single";

// Defines window.QRGenBridge inside the page. The embed page posts every event to it.
const BRIDGE = `
  (function () {
    if (window.QRGenBridge) return;
    window.__qrgenQueue = [];
    window.QRGenBridge = {
      postMessage: function (json) {
        if (window.Ti && Ti.App && Ti.App.fireEvent) Ti.App.fireEvent("qrgen:message", { json: json });
        else window.__qrgenQueue.push(json);
      }
    };
  })();
`;

function openScanner(onMessage) {
  const win = Ti.UI.createWindow({ backgroundColor: "#000", title: "Scan" });
  const webView = Ti.UI.createWebView({
    url: EMBED_URL,
    allowsInlineMediaPlayback: true, // iOS: keep the camera preview inline
  });
  win.add(webView);

  const handle = (json) => {
    try {
      onMessage(JSON.parse(json), webView, win);
    } catch (err) {
      Ti.API.warn(`qrgen: bad message ${json}`);
    }
  };

  // Local pages can call Ti.App.fireEvent directly.
  const onFire = (e) => handle(e.json);
  Ti.App.addEventListener("qrgen:message", onFire);

  // The hosted page can't see Ti, so drain the queue by polling.
  let timer = null;
  webView.addEventListener("load", () => {
    webView.evalJS(BRIDGE, () => {});
    if (!timer) {
      timer = setInterval(() => {
        webView.evalJS("JSON.stringify((window.__qrgenQueue || []).splice(0))", (result) => {
          if (!result) return;
          for (const json of JSON.parse(result)) handle(json);
        });
      }, 200);
    }
  });

  win.addEventListener("close", () => {
    clearInterval(timer);
    Ti.App.removeEventListener("qrgen:message", onFire);
  });

  win.open();
  return { win, webView };
}

module.exports = { openScanner };
```

Use it:

```js
const { openScanner } = require("qrgen-scanner");

withCameraPermission((granted) => {
  if (!granted) return alert("Camera permission is required to scan.");

  openScanner((message, webView, win) => {
    if (message.type === "scan") {
      const barcode = message.barcodes[0];
      Ti.API.info(`${barcode.symbology}: ${barcode.data}`);
      win.close();
    } else if (message.type === "error") {
      alert(`${message.code}: ${message.message}`);
    }
  });
});
```

Messages use the [embed envelope](../embed-bridge/#message-envelope): `{ source: "qrgen", version: 1, type, ... }` with `barcodes` for `scan` and `code` and `message` for `error`. Each barcode has the standard [result shape](../concepts/#the-barcode-result).

`Ti.App.fireEvent` is only available to web content that Titanium injects its bridge into, which in practice means local HTML files, and a local page loaded from the file system is not a secure context. With the hosted HTTPS page, the polling path is what delivers messages. The polling interval adds up to 200 ms of latency, which is fine for scanning.

Messages the page posts before the `load` event (and the injection) are lost. In practice that is at most the first `state` message; the `ready` event arrives after the camera starts.

### iOS: script message handler

On iOS, the embed page also posts to `window.webkit.messageHandlers.qrgen`. Titanium SDK 8 and later can register that handler on the WebView, which delivers messages without polling. Check the `Ti.UI.WebView` documentation for your SDK version. Add this inside `openScanner()`, after `handle` is defined:

```js
const isIOS = Ti.Platform.osname === "iphone" || Ti.Platform.osname === "ipad";
if (isIOS) {
  webView.addScriptMessageHandler("qrgen");
  webView.addEventListener("message", (e) => {
    if (e.name === "qrgen") handle(e.body);
  });
}
```

If you use this, skip the `BRIDGE` injection on iOS, otherwise each message arrives twice.

## Send commands

Call `window.qrgen.command()` in the page with `evalJS`:

```js
function command(webView, cmd) {
  webView.evalJS(`window.qrgen && window.qrgen.command(${JSON.stringify(cmd)})`, () => {});
}

command(webView, { type: "pause" });
command(webView, { type: "resume" });
command(webView, { type: "torch", value: true });
command(webView, { type: "switchCamera" });
```

The full command list is in [Embed bridge](../embed-bridge/#host-to-page-commands).

## Limitations

- **Android camera grants.** The app holding the `CAMERA` permission is necessary but not always sufficient: the WebView must also grant the page's camera request. If the page reports `camera-permission-denied` on Android although the app has the permission, your Titanium SDK's WebView doesn't grant web camera requests, and you need a native module that does.
- **Network.** The hosted page and the decoder are loaded from the internet on first use (and then cached). For offline use, host your own copy of the embed page on an HTTPS origin you control; see [self-hosting the embed page](../embed-bridge/#self-host-the-embed-page).
- **Performance.** Scanning runs in the WebView with WebAssembly. It handles everyday QR and retail barcodes well, but a native scanner is faster on low-end devices.
