---
title: Electron
description: "Scan barcodes in Electron apps: camera permission handlers, macOS camera access and NSCameraUsageDescription, offline wasm, and file scanning in the main process."
group: "Mobile & desktop"
order: 7
status: stable
---

In Electron, the renderer is Chromium, so the web SDK (`<qrgen-scanner>` or `BarcodeScanner`) works as in a browser. The main process is Node.js, so it can decode image files with `qrgen-sdk/node`. This page covers camera permissions on each OS, packaging the camera usage description on macOS, loading the engine offline, and scanning files from the main process.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

In the renderer, use the SDK like in any web app: see [Web Components](../web-components/), [React](../react/) or [Vue](../vue/). Pages loaded with `loadFile()`, from `http://localhost`, or from a privileged custom scheme (below) are secure contexts, so `getUserMedia` is available.

## Permission handler

Electron approves permission requests by default. Restrict that to camera access from your own pages:

```js
// main.js
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

function allowCamera() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const ownPage = details.requestingUrl.startsWith("app://") || details.requestingUrl.startsWith("file://");
    const videoOnly = permission === "media" && (details.mediaTypes ?? []).every((type) => type === "video");
    callback(ownPage && videoOnly);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "media" && (requestingOrigin.startsWith("app://") || requestingOrigin.startsWith("file://"));
  });
}

app.whenReady().then(() => {
  allowCamera();
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
});
```

Adjust the origin checks to match how you load your UI (for example `http://localhost:5173` in development). The permission check handler also controls whether `enumerateDevices()` returns camera labels, which the camera switch button uses.

## macOS camera access

macOS asks the user before any app can use the camera. Ask from the main process before the renderer starts scanning, so the system prompt appears at a sensible time:

```js
const { systemPreferences, shell } = require("electron");

async function ensureCameraAccess() {
  if (process.platform !== "darwin") return true;
  const status = systemPreferences.getMediaAccessStatus("camera");
  if (status === "granted") return true;
  if (status === "not-determined") return systemPreferences.askForMediaAccess("camera");
  // "denied" or "restricted": only the user can change it
  await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera");
  return false;
}
```

Call `await ensureCameraAccess()` in `app.whenReady()` or from an IPC handler when the user opens the scanner.

### NSCameraUsageDescription

A packaged macOS app must declare why it uses the camera, or macOS terminates it on first camera access. With the hardened runtime (required for notarization) it also needs the camera entitlement.

electron-builder (`electron-builder.yml`):

```yaml
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSCameraUsageDescription: The camera is used to scan barcodes and QR codes.
```

`build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
  </dict>
</plist>
```

Keep any other entitlements your app already uses. With Electron Forge, set `packagerConfig.extendInfo: { NSCameraUsageDescription: "..." }` and pass the entitlements file through `packagerConfig.osxSign`.

Windows and Linux have no per-app camera declaration. On Windows, the user can block desktop apps from the camera under **Settings > Privacy & security > Camera**; the scanner then reports `camera-permission-denied` or `camera-in-use`.

## Offline engine

By default the decoder wasm is downloaded from jsDelivr on first use. Chromium can't `fetch()` `file://` URLs, so to bundle the wasm with your app, serve the renderer from a privileged custom scheme:

```js
// main.js
const { app, BrowserWindow, net, protocol } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  const root = path.join(__dirname, "renderer");
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    return net.fetch(pathToFileURL(path.join(root, decodeURIComponent(pathname))).toString());
  });

  const win = new BrowserWindow({ width: 900, height: 700 });
  win.loadURL("app://bundle/index.html");
});
```

Copy `node_modules/qrgen-sdk/dist/wasm/*.wasm` into `renderer/qrgen/` as part of your build, and configure the engine in the renderer:

```js
import { configure } from "qrgen-sdk";

configure({ wasmBaseUrl: "/qrgen/" }); // resolves to app://bundle/qrgen/
```

`registerSchemesAsPrivileged` must run before the `ready` event. `protocol.handle` needs Electron 25 or later.

## Scan files in the main process

`qrgen-sdk/node` decodes PNG, JPEG, GIF and BMP files in the main process, with the engine read from `node_modules` (it works inside `app.asar`). Expose it to the renderer over IPC:

```js
// main.js
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { scanFile, parseContent } = require("qrgen-sdk/node");

ipcMain.handle("scanner:scan-files", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "bmp"] }],
  });
  if (canceled) return [];

  const results = [];
  for (const file of filePaths) {
    const barcodes = await scanFile(file, { symbologies: ["qr", "data-matrix", "code128", "ean13"] });
    results.push({ file, barcodes: barcodes.map((b) => ({ ...b, parsed: parseContent(b.data, { symbology: b.symbology }) })) });
  }
  return results;
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { preload: path.join(__dirname, "preload.js") } });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
});
```

```js
// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scanner", {
  scanFiles: () => ipcRenderer.invoke("scanner:scan-files"),
});
```

```js
// renderer
const results = await window.scanner.scanFiles();
for (const { file, barcodes } of results) console.log(file, barcodes.map((b) => b.data));
```

For images already in the renderer (drag and drop, paste), `scanImage()` from `qrgen-sdk` decodes them without a round trip. See [Image scanning](../image-scanning/). The main process can also generate barcode files with `generateToFile()`; see [Node.js](../nodejs/).

## Tips

- USB and built-in webcams usually have fixed focus and no torch, so the torch and zoom buttons don't appear. For small codes, raise `resolution` to `fhd`.
- Laptop webcams face the user. `camera="back"` falls back to whatever camera exists, and the element mirrors the preview when the camera reports that it faces the user.
- To pick a specific webcam, list them with `Camera.list()` and pass the `deviceId` as `camera`.
