---
title: "Capacitor & Ionic"
description: "Scan barcodes in Capacitor and Ionic apps with the QRGen web SDK: camera permissions on iOS and Android, secure contexts, live reload over HTTPS and offline wasm."
group: "Mobile & desktop"
order: 5
status: stable
---

Capacitor apps run your web code in the system WebView (WKWebView on iOS, Android System WebView on Android), so the regular web SDK works without a native plugin. You use `<qrgen-scanner>` or `BarcodeScanner` exactly as in a browser; the only native work is declaring camera permission.

This works with any framework on top of Capacitor: Ionic with Angular, React or Vue, or plain Capacitor.

## Install

```bash
npm install qrgen-sdk
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

Then follow the guide for your framework: [React](../react/), [Vue](../vue/), [Angular](../angular/) or [Web Components](../web-components/). An Ionic page is a regular component:

```tsx
// src/pages/Scan.tsx (Ionic React)
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";
import { QRGenScanner } from "qrgen-sdk/react";

export default function Scan() {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Scan</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <QRGenScanner symbologies={["qr", "ean13", "code128"]} style={{ height: "100%" }} onScan={(_, barcode) => console.log(barcode.data)} />
      </IonContent>
    </IonPage>
  );
}
```

## Camera permission

### iOS

Add a camera usage description to `ios/App/App/Info.plist`. Without it, iOS terminates the app the first time the page asks for the camera:

```xml
<key>NSCameraUsageDescription</key>
<string>The camera is used to scan barcodes and QR codes.</string>
```

The user sees the iOS permission prompt the first time the scanner starts. WKWebView supports `getUserMedia` from iOS 14.3; QRGen supports iOS 14.5 and later.

### Android

Declare the permission in `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

When the page calls `getUserMedia`, Capacitor's WebView asks the user for the Android runtime permission and passes the result to the page. If the user denies it, the scanner reports `camera-permission-denied`; the user has to allow it again in the system settings.

## Secure context

`getUserMedia` only works in a secure context. Capacitor's default origins are secure:

| Platform | Default origin | Secure |
| --- | --- | --- |
| iOS | `capacitor://localhost` (`server.iosScheme`, default `capacitor`) | Yes |
| Android | `https://localhost` (`server.androidScheme`, default `https` in Capacitor 6+) | Yes |

If you changed `androidScheme` to `http`, camera access fails with `insecure-context`. Keep the defaults, or set them explicitly:

```ts
// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.scanner",
  appName: "Scanner",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
};

export default config;
```

## Live reload

Live reload (`npx cap run ios --livereload --external`) points the WebView at your dev server's LAN address, such as `http://192.168.1.20:5173`. That is not a secure context, so the camera is blocked.

Serve the dev server over HTTPS instead and point Capacitor at it:

1. Create a certificate the device trusts, for example with [mkcert](https://github.com/FiloSottile/mkcert) (an external tool). Install mkcert's root CA on the device: on iOS, install the profile and enable it under **Settings > General > About > Certificate Trust Settings**; on Android, install it under **Settings > Security > Encryption & credentials**. Android apps only trust user CAs when the app's network security config allows it, so add a debug-only `network_security_config.xml` that trusts user certificates.
2. Run the dev server with that certificate (for Vite: `server.https` with the mkcert key and cert, and `server.host: true`).
3. Set the URL in `capacitor.config.ts` while developing, then `npx cap run`:

```ts
// capacitor.config.ts (development only)
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.scanner",
  appName: "Scanner",
  webDir: "dist",
  server: {
    url: "https://192.168.1.20:5173",
    cleartext: false,
  },
};

export default config;
```

Remove `server.url` before building for release. Alternatively, rebuild and run without live reload (`npm run build && npx cap run android`), which always uses the secure bundled origin.

## Offline apps

By default the decoder wasm is downloaded from jsDelivr on first use and cached by the WebView. To work offline from the first launch, bundle it with your web assets:

```bash
mkdir -p public/qrgen && cp node_modules/qrgen-sdk/dist/wasm/*.wasm public/qrgen/
```

```ts
import { configure } from "qrgen-sdk";

configure({ wasmBaseUrl: "/qrgen/" });
```

The files end up in `webDir` and are served from `capacitor://localhost/qrgen/` or `https://localhost/qrgen/`.

## Tips

- Give the scanner the full height of the page (`IonContent` with `style={{ height: "100%" }}` on the scanner) and set `viewport-fit=cover` in your viewport meta tag so the preview extends under the notch.
- Stop the camera when the app goes to the background. With `@capacitor/app`: `App.addListener("pause", () => scanner.stop())` and `App.addListener("resume", () => scanner.start())`.
- Vibration works on Android. iOS WebViews don't support the Vibration API; for haptics on iOS, call `@capacitor/haptics` from your `scan` handler and set `vibrate={false}`.
- For a native camera pipeline instead of the WebView, see the [iOS](../ios/) and [Android](../android/) SDKs.
