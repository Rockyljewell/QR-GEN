---
title: Cordova
description: "Scan barcodes in Apache Cordova apps with the QRGen web SDK: Android runtime camera permission, NSCameraUsageDescription via config.xml, WKWebView settings and offline wasm."
group: "Mobile & desktop"
order: 6
status: stable
---

Cordova apps run your web code in the platform WebView, so QRGen's web SDK works without a Cordova plugin of its own. You need to declare camera permission for each platform, make sure Android grants it at runtime, and let iOS play the camera preview inline.

Requirements: cordova-android 10 or later (the app is served from `https://localhost`, a secure context) and cordova-ios 6 or later (WKWebView, with the app served from a custom scheme). With older versions the app runs from `file://`, where `getUserMedia` is unavailable.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

Cordova doesn't bundle JavaScript, so either use your own bundler to build `www/`, or copy the standalone bundle and wasm into `www/` and load them with a script tag:

```bash
mkdir -p www/vendor/qrgen/wasm
cp node_modules/qrgen-sdk/dist/browser/qrgen.iife.js www/vendor/qrgen/
cp node_modules/qrgen-sdk/dist/wasm/*.wasm www/vendor/qrgen/wasm/
```

## config.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<widget id="com.example.scanner" version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:android="http://schemas.android.com/apk/res/android">
  <name>Scanner</name>
  <content src="index.html" />

  <platform name="android">
    <config-file target="AndroidManifest.xml" parent="/manifest">
      <uses-permission android:name="android.permission.CAMERA" />
    </config-file>
  </platform>

  <platform name="ios">
    <edit-config target="NSCameraUsageDescription" file="*-Info.plist" mode="merge">
      <string>The camera is used to scan barcodes and QR codes.</string>
    </edit-config>
    <preference name="AllowInlineMediaPlayback" value="true" />
    <preference name="scheme" value="app" />
    <preference name="hostname" value="localhost" />
  </platform>
</widget>
```

- `NSCameraUsageDescription` is required on iOS; without it the app is terminated when the page requests the camera.
- `AllowInlineMediaPlayback` lets WKWebView play the camera preview inline instead of switching to full-screen video, which would hide the scanner UI.
- `scheme` and `hostname` serve the iOS app from `app://localhost` through WKWebView's URL scheme handler instead of `file://`. `file://` is not a secure context.
- The `xmlns:android` declaration on `<widget>` is required for the `android:` attribute.

## Android runtime permission

Declaring `CAMERA` in the manifest is not enough on Android 6 and later: the app must also hold the runtime permission before the WebView can open the camera. Request it before starting the scanner, for example with [cordova-plugin-android-permissions](https://github.com/NeoLSN/cordova-plugin-android-permissions) (a third-party plugin):

```bash
cordova plugin add cordova-plugin-android-permissions
```

```html
<!-- www/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <style>
      html, body { margin: 0; height: 100%; background: #000; }
      qrgen-scanner { height: 100%; }
    </style>
  </head>
  <body>
    <qrgen-scanner id="scanner" autostart="false" symbologies="qr,ean13,code128"></qrgen-scanner>

    <script>
      window.QRGEN_WASM_BASE = "vendor/qrgen/wasm/";
    </script>
    <script src="vendor/qrgen/qrgen.iife.js"></script>
    <script src="cordova.js"></script>
    <script>
      var scanner = document.getElementById("scanner");

      scanner.addEventListener("scan", function (event) {
        console.log(event.detail.barcode.data);
      });

      function startScanner() {
        scanner.start().catch(function (err) {
          console.warn(err.code, err.message);
        });
      }

      document.addEventListener("deviceready", function () {
        var permissions = window.cordova && cordova.plugins && cordova.plugins.permissions;
        if (!permissions) return startScanner(); // iOS: WKWebView shows its own prompt

        permissions.requestPermission(
          permissions.CAMERA,
          function (status) {
            if (status.hasPermission) startScanner();
            else console.warn("Camera permission denied");
          },
          function () {
            console.warn("Could not request camera permission");
          }
        );
      });
    </script>
  </body>
</html>
```

`autostart="false"` keeps the element from opening the camera before the permission is granted.

Why request it yourself: cordova-android grants the WebView's own camera request, but whether it also shows the Android runtime permission prompt depends on the cordova-android version. Without the runtime permission, `getUserMedia` fails and the scanner reports `camera-permission-denied` or `camera-in-use`. Requesting the permission before `start()` works on every version. If you write native code instead, request `Manifest.permission.CAMERA` in your activity and grant `RESOURCE_VIDEO_CAPTURE` in a custom `WebChromeClient.onPermissionRequest`.

## iOS notes

- With the `scheme` preference set, the app is served from `app://localhost`, which WKWebView treats as a secure context. If the app is loaded from `file://` instead, the camera is unavailable.
- WKWebView asks for camera permission with its own prompt, in addition to the iOS system prompt the first time. This is standard WKWebView behavior.
- The Vibration API is not supported in iOS WebViews, so `vibrate` has no effect there.

## Content Security Policy

Cordova templates include a CSP `<meta>` tag. Extend it so the engine can compile and run:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self' data: gap: https://ssl.gstatic.com; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src *"
/>
```

With the wasm bundled in `www/` (as above), `connect-src 'self'` is enough. If you load it from jsDelivr instead, add `https://cdn.jsdelivr.net`. The inline `<script>` blocks in the example above also need `'unsafe-inline'` in `script-src`; move them into a `.js` file to avoid that.

## Troubleshooting

- **`insecure-context`**: the app runs from `file://`. Upgrade to cordova-android 10+ and cordova-ios 6+, and set the iOS `scheme` preference.
- **`camera-permission-denied` on Android**: the runtime permission wasn't granted before starting. Request it first, as shown above.
- **Black preview on iOS, or video opens full screen**: set `AllowInlineMediaPlayback` to `true`.

More in [Troubleshooting](../troubleshooting/).
