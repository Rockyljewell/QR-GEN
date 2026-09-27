---
title: Tauri
description: "Scan barcodes in Tauri 2 apps with the QRGen web SDK: camera permissions in the system WebView on macOS, Windows and Linux (WebKitGTK), CSP and offline wasm."
group: "Mobile & desktop"
order: 8
status: stable
---

Tauri renders your UI in the operating system's WebView: WKWebView on macOS and iOS, WebView2 on Windows, WebKitGTK on Linux and the Android System WebView on Android. QRGen's web SDK runs in all of them, so you use `<qrgen-scanner>` or `BarcodeScanner` from your frontend as in a browser. What differs per OS is how camera permission is granted to the WebView.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

Then follow the guide for your frontend framework: [React](../react/), [Vue](../vue/), [Svelte](../svelte/), [Angular](../angular/) or [Web Components](../web-components/).

Tauri 2 serves the app from `tauri://localhost` (macOS, iOS, Linux) or `http://tauri.localhost` (Windows, Android), and from `http://localhost` during `tauri dev`. All of these are secure contexts, so `getUserMedia` is available.

## Content Security Policy

If `app.security.csp` is set in `tauri.conf.json`, Tauri enforces it. Allow the engine:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:"
    }
  }
}
```

This assumes the wasm is bundled with the app (below). To load it from jsDelivr instead, add `https://cdn.jsdelivr.net` to `connect-src`.

## Bundle the wasm

Desktop apps should work offline. Copy the wasm files into your frontend's static folder (`public/` for Vite) so they are embedded in the app:

```bash
mkdir -p public/qrgen && cp node_modules/qrgen-sdk/dist/wasm/*.wasm public/qrgen/
```

```ts
import { configure } from "qrgen-sdk";

configure({ wasmBaseUrl: "/qrgen/" });
```

## macOS

WKWebView needs the app to declare camera usage. Tauri 2 merges an `Info.plist` placed next to `tauri.conf.json` into the bundle:

```xml
<!-- src-tauri/Info.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>NSCameraUsageDescription</key>
    <string>The camera is used to scan barcodes and QR codes.</string>
  </dict>
</plist>
```

Without this key, macOS terminates the app when the page requests the camera. If you sign with the hardened runtime or enable the App Sandbox, also add the `com.apple.security.device.camera` entitlement (`bundle.macOS.entitlements` in `tauri.conf.json`).

The first time, the user sees the macOS camera prompt. WKWebView may also show its own per-site prompt.

> **Tip:** If camera access fails or the app quits when the scanner starts during `tauri dev`, test with a bundled build (`tauri build --debug`) and run the generated `.app`, which always carries the merged `Info.plist`.

## Windows

WebView2 shows a permission prompt the first time the page asks for the camera and remembers the answer. The user must also allow desktop apps to use the camera under **Settings > Privacy & security > Camera**. No configuration is needed.

## Linux

On Linux, Tauri uses WebKitGTK. Camera support there depends on the WebKitGTK build and on GStreamer:

- Install GStreamer plugins so WebKitGTK can open V4L2 cameras. On Debian and Ubuntu: `sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad`.
- WebKitGTK disables media streams by default and denies permission requests unless the app handles them. Enable them and allow camera requests from Rust in your setup hook:

```rust
// src-tauri/src/lib.rs
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let window = app.get_webview_window("main").expect("main window");
                window.with_webview(|webview| {
                    use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
                    let view = webview.inner();
                    if let Some(settings) = WebViewExt::settings(&view) {
                        settings.set_enable_media_stream(true);
                    }
                    view.connect_permission_request(|_, request| {
                        request.allow();
                        true
                    });
                })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Add the matching dependency, using the `webkit2gtk` version your Tauri release depends on (check `cargo tree -i webkit2gtk`):

```toml
# src-tauri/Cargo.toml
[target.'cfg(target_os = "linux")'.dependencies]
webkit2gtk = "2.0"
```

Treat this as a starting point: the `webkit2gtk` crate gates some APIs behind version features, and names can change between releases, so check the crate documentation for the version in your lockfile. This handler allows every permission request from your own UI. Narrow it (for example by checking for a `UserMediaPermissionRequest`) if your app loads remote content.

The user running the app needs access to `/dev/video*`, which usually means being in the `video` group. See [Linux & Raspberry Pi](../linux/) for webcam tips.

## iOS and Android

Tauri 2 mobile apps use WKWebView and the Android WebView:

- **iOS**: add `NSCameraUsageDescription` to the iOS `Info.plist` generated under `src-tauri/gen/apple/`.
- **Android**: add `<uses-permission android:name="android.permission.CAMERA" />` to `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. The app must hold the runtime permission, and the WebView must grant the page's camera request; if the scanner reports `camera-permission-denied`, handle `onPermissionRequest` in the activity's `WebChromeClient`.

## Scanning files without the camera

For images the user picks or drops, `scanImage()` decodes them in the WebView, with no native code:

```ts
import { scanImage } from "qrgen-sdk";

const barcodes = await scanImage(file); // a File from <input type="file"> or a drop event
```

See [Image scanning](../image-scanning/).
