# Capacitor, Ionic, Cordova, Electron and Tauri

The web SDK runs unchanged inside these WebViews. What changes per platform is camera permission.

## Capacitor / Ionic

1. `npm install qrgen-sdk` and use the element or framework wrapper as on the web.
2. iOS `ios/App/App/Info.plist`: add `NSCameraUsageDescription`.
3. Android `android/app/src/main/AndroidManifest.xml`: `<uses-permission android:name="android.permission.CAMERA" />`.
   Capacitor's BridgeWebChromeClient grants WebView camera requests once the app has the permission, and
   the first `getUserMedia` call triggers the system prompt.
4. `capacitor://localhost` (iOS) and `https://localhost` (Android) are secure contexts. For live reload
   from a dev server, serve it over HTTPS.

## Cordova

- iOS: add the usage description in `config.xml`:
  ```xml
  <edit-config target="NSCameraUsageDescription" file="*-Info.plist" mode="merge">
    <string>Scan barcodes</string>
  </edit-config>
  ```
  and use the WKWebView engine (default in cordova-ios 6+).
- Android: add `<uses-permission android:name="android.permission.CAMERA" />` via `config.xml`
  `<config-file>`, and request it at runtime (e.g. cordova-plugin-android-permissions) before starting
  the scanner.

## Electron

```js
// main.js
const { app, session, systemPreferences } = require("electron");
app.whenReady().then(async () => {
  if (process.platform === "darwin") await systemPreferences.askForMediaAccess("camera");
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === "media"));
});
```

macOS builds need `NSCameraUsageDescription` (electron-builder: `mac.extendInfo`). Scan files in the main
process with `qrgen-sdk/node` (see [node.md](node.md)).

## Tauri

The scanner runs in the system WebView. macOS: add `NSCameraUsageDescription` to `Info.plist`
(`bundle.macOS.infoPlist`). Windows (WebView2) prompts automatically. Linux WebKitGTK needs
GStreamer camera plugins, and camera support in WebKitGTK varies, so test it or fall back to the REST API.

## Other WebView hosts (React Native, Flutter, .NET MAUI, Titanium, Unity)

Load the hosted scanner page and read results through the embed bridge:

```
https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single
```

It posts JSON messages `{ source: "qrgen", version: 1, type: "scan", barcodes: [...] }` to
`window.ReactNativeWebView`, `window.QRGenBridge` (Flutter JavaScriptChannel),
`window.webkit.messageHandlers.qrgen`, `window.chrome.webview`, `window.QRGenAndroid`, and to `parent`
for iframes. Send commands with `window.qrgen.command({ type: "pause" | "resume" | "torch" | "stop" | "start" })`.
