# qrgen-react-native

Barcode, QR and ID scanning for React Native, part of [QRGen](https://github.com/Rockyljewell/QR-GEN)
(MIT). Two scanning back ends share one API:

| Component | Engine | Native setup | Best for |
| --- | --- | --- | --- |
| `QRGenScanner` | [react-native-vision-camera](https://react-native-vision-camera.com) 4 (ML Kit on Android, AVFoundation on iOS) | Development build (not Expo Go) | Production apps, best speed |
| `QRGenWebScanner` | Hosted QRGen embed page in [react-native-webview](https://github.com/react-native-webview/react-native-webview) | None (works in Expo Go) | Prototypes, every QRGen symbology, zero native code |

Both use the QRGen symbology ids, result shape, options and error codes from the
[cross-platform specification](../../docs/SPEC.md), so the results look the same as
in the JavaScript, iOS, Android, Flutter and Python SDKs.

## Install

```sh
npm install qrgen-react-native
```

### Expo

`QRGenScanner` needs a [development build](https://docs.expo.dev/develop/development-builds/introduction/)
because vision-camera ships native code:

```sh
npx expo install react-native-vision-camera@^4.7.3
```

Pin major version 4: vision-camera 5 has a different API and is not supported yet.

Add the config plugin to `app.json` / `app.config.js`. It writes the iOS camera
permission text and the Android `CAMERA` permission. `enableCodeScanner` bundles the
ML Kit barcode model (about 2.4 MB) so scanning works the first time the app is
opened, even offline:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-vision-camera",
        {
          "cameraPermissionText": "$(PRODUCT_NAME) uses the camera to scan barcodes and QR codes.",
          "enableCodeScanner": true
        }
      ]
    ],
    "android": {
      "permissions": ["android.permission.VIBRATE"]
    }
  }
}
```

Then run `npx expo prebuild` (or `eas build`).

For `QRGenWebScanner`, which also works in Expo Go:

```sh
npx expo install react-native-webview
```

### Bare React Native

```sh
npm install react-native-vision-camera@^4.7.3   # for QRGenScanner
npm install react-native-webview                # for QRGenWebScanner (optional)
cd ios && pod install
```

iOS `ios/<App>/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>$(PRODUCT_NAME) uses the camera to scan barcodes and QR codes.</string>
```

Android `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<!-- Only for vibrate on scan: -->
<uses-permission android:name="android.permission.VIBRATE" />
```

To bundle the ML Kit model on Android instead of downloading it through Google Play
services on first use, add to `android/gradle.properties`:

```properties
VisionCamera_enableCodeScanner=true
```

Both components ask for the camera permission themselves when they mount.

## QRGenScanner (vision-camera)

```tsx
import { useIsFocused } from '@react-navigation/native';
import { QRGenScanner } from 'qrgen-react-native';

export function ScanScreen() {
  const isFocused = useIsFocused();
  return (
    <QRGenScanner
      style={{ flex: 1 }}
      isActive={isFocused}
      symbologies={['qr', 'ean13', 'code128']}
      mode="single"
      onScan={(barcodes) => console.log(barcodes[0].symbology, barcodes[0].data)}
      onError={(e) => console.warn(e.code, e.message)}
    />
  );
}
```

The component:

- resolves SPEC ids, aliases and groups (`QRCode`, `ean-13`, `retail`, `2d`, ...) and maps
  them to vision-camera code types, dropping the ones the platform cannot read
  (see `supportedSymbologies()`);
- refines results so they match the other QRGen SDKs: on iOS, UPC-A arrives as EAN-13 with
  a leading `0` and is reported as a 12 digit `upca`, EAN-13 starting with `978`/`979` is
  reported as `isbn`, and a 14 digit ITF as `itf14`, whenever those ids were requested;
- stops the camera while the app is in the background; pass `isActive={false}` (for example
  from `useIsFocused()`) when the screen is not visible;
- draws a rounded corner-bracket viewfinder (or a scan line for linear-only sets), highlight
  frames around detected codes and a success toast pill, in the QRGen accent `#2EC1CE`.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `symbologies` | `string[]` | `['all']` | SPEC ids, aliases or groups |
| `mode` | `'single' \| 'continuous' \| 'batch'` | `'continuous'` | `single` stops the camera after the first scan (call `ref.start()` to scan again); `batch` tracks many codes |
| `duplicateFilter` | `number` (ms) | `1000` | Ignore the same symbology + data inside this window. `0` reports every frame, `-1` once per session |
| `beep` | `boolean \| () => void` | `true` | Sound on scan, see [Beep](#beep) |
| `vibrate` | `boolean` | `true` | `Vibration.vibrate(50)` on scan |
| `camera` | `'back' \| 'front' \| deviceId` | `'back'` | Unknown device ids fall back to the back camera |
| `torch` | `boolean` | `false` | Flashlight (ignored with an `unsupported` error when the camera has none) |
| `viewfinder` | `'frame' \| 'line' \| 'none'` | `'frame'` (`'line'` for linear-only sets) | Overlay style |
| `scanArea` | `{ x, y, width, height }` (0..1 of the frame) | full frame | Codes whose center is outside are ignored; the viewfinder is drawn there |
| `maxResults` | `number` | `1` (`20` in batch) | Codes per frame; the ones closest to the center win |
| `isActive` | `boolean` | `true` | Run the camera |
| `onScan` | `(barcodes: Barcode[]) => void` | | New codes (after the duplicate filter) |
| `onTrack` | `(tracked: TrackedBarcode[]) => void` | | Batch mode: every tracked code, whenever the set changes |
| `onError` | `(error: { code, message }) => void` | | SPEC error codes |
| `onReady` | `() => void` | | Camera initialized |
| `accentColor` | `string` | `'#2EC1CE'` | Viewfinder, highlight and toast color |
| `showToast` | `boolean` | `true` | Success toast pill |
| `showHighlights` | `boolean` | `true` | Highlight frames around detected codes |
| `fallback` | `ReactNode` | built-in message | Shown when the camera cannot run |
| `children` | `ReactNode` | | Rendered on top (buttons, hints) |
| `style` | `ViewStyle` | | Container style (give it a size, for example `flex: 1`) |

### Ref

```tsx
const ref = useRef<QRGenScannerHandle>(null);
<QRGenScanner ref={ref} mode="single" onScan={...} />;
ref.current?.start(); // scan again after a single-mode result
```

| Method | Description |
| --- | --- |
| `start()` / `resume()` | Run again after `stop()`, `pause()` or a single-mode scan |
| `stop()` | Stop the camera |
| `pause()` | Keep the preview running but ignore codes |
| `reset()` | Clear duplicate history and tracked codes, and resume |
| `setTorch(on)` | Flashlight on or off (until the `torch` prop changes) |
| `supportedSymbologies()` | Ids this back end reads on this device |

### Beep

React Native cannot play a sound without a library, and QRGen does not force one on
you. `beep` (default `true`) plays whatever you register once with `setBeepHandler`,
and is silent until you do. You can also pass a function as the `beep` prop.

```ts
import { createAudioPlayer } from 'expo-audio';
import { setBeepHandler } from 'qrgen-react-native';

const player = createAudioPlayer(require('./assets/beep.mp3'));
setBeepHandler(() => {
  player.seekTo(0);
  player.play();
});
```

`react-native-sound`, `expo-av` or any other player works the same way.

## QRGenWebScanner (WebView, zero native setup)

Loads the hosted page `https://rockyljewell.github.io/QR-GEN/embed/` with the options in
the query string (SPEC section 5) and forwards its events. It reads every QRGen
symbology (the page runs the QRGen WebAssembly engine), beeps from the page and vibrates
natively.

```tsx
import { useRef } from 'react';
import { QRGenWebScanner, type QRGenWebScannerHandle } from 'qrgen-react-native';

export function WebScanScreen() {
  const ref = useRef<QRGenWebScannerHandle>(null);
  return (
    <QRGenWebScanner
      ref={ref}
      style={{ flex: 1 }}
      symbologies={['qr', 'pdf417']}
      mode="continuous"
      onReady={() => console.log('ready')}
      onScan={(barcodes) => console.log(barcodes)}
      onError={(e) => console.warn(e.code, e.message)}
    />
  );
}
```

It accepts the same scanner options as `QRGenScanner` (`symbologies`, `mode`,
`duplicateFilter`, `beep`, `vibrate`, `camera`, `torch`, `viewfinder`, `scanArea`,
`maxResults`) plus:

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `embedUrl` | `string` | hosted page | Self-hosted copy of the embed page (must be `https`) |
| `isActive` | `boolean` | `true` | Sends `start` / `stop` to the page; the page is also stopped while the app is in the background |
| `onScan`, `onTrack`, `onError`, `onReady` | | | Same as above, from the page's `scan`, `track`, `error` and `ready` messages |
| `fallback` | `ReactNode` | built-in message | Shown when the WebView cannot run |
| `webViewProps` | `object` | | Extra props for the underlying `<WebView>` |

Ref methods: `start()`, `stop()`, `pause()`, `resume()`, `setTorch(on)`, `sendCommand(command)`,
`reload()`. They call `injectJavaScript("window.qrgen && window.qrgen.command({...}); true;")`,
and commands sent before the page reports `ready` are queued.

The WebView is configured with `mediaPlaybackRequiresUserAction={false}`,
`allowsInlineMediaPlayback`, and `mediaCapturePermissionGrantType="grant"` (iOS 15+, so the
page does not ask a second time). On Android the component requests the `CAMERA` runtime
permission before it mounts the WebView; react-native-webview then grants the page's
`getUserMedia` request. On iOS the page's camera request uses your app's
`NSCameraUsageDescription`.

## Results

`onScan` receives SPEC section 2 objects:

```ts
interface Barcode {
  data: string;               // decoded text
  symbology: SymbologyId;     // 'qr', 'ean13', ...
  symbologyName: string;      // 'QR Code'
  rawBytes: string;           // base64, '' when the engine does not expose bytes (vision-camera)
  contentType: 'text' | 'binary' | 'gs1' | 'iso15434' | 'mixed' | 'unknown-eci';
  isGS1: boolean;
  location: { topLeft; topRight; bottomRight; bottomLeft }; // pixels of the upright frame
  frameSize: { width: number; height: number };            // the upright frame
  orientation: number;
  ecLevel: string;
  symbologyIdentifier: string;
  timestamp: number;          // ms since epoch
}
```

With `QRGenScanner`, `location` and `frameSize` describe the camera frame as it appears
upright on screen (the sensor's landscape size is swapped for portrait views);
`contentType` is `text` except for GS1 DataBar, which is reported in HRI form
(`(01)...`). Batch mode adds `TrackedBarcode` fields: `id` (stable, derived from symbology
and data), `firstSeen`, `lastSeen` and `count`; codes are dropped after 500 ms unseen.

Errors are `{ code, message }` with `code` one of `camera-permission-denied`,
`camera-not-found`, `camera-in-use`, `insecure-context`, `engine-load-failed`,
`unsupported`, `unknown`.

## Parsing the content

The core JavaScript SDK exposes pure parsers that run in React Native (no DOM, no
WebAssembly). Install `qrgen-sdk` next to this package if you need them:

```ts
import { parseContent, parseGS1, parseAAMVA } from 'qrgen-sdk/parsers';

const parsed = parseContent(barcode.data); // url, wifi, contact, payment, product, gs1, aamva, ...
const gs1 = parseGS1('(01)09501101530003(17)250101(10)ABC123');
const license = parseAAMVA(pdf417Barcode.data); // driver license / ID card back side
```

## Utilities

Pure helpers, also usable in Node and tests:

- `resolveSymbologies(input)`, `resolveSymbology(id)`, `symbologyName(id)`, `SYMBOLOGIES`, `SYMBOLOGY_GROUPS`
- `toVisionCameraCodeTypes(ids, { os, version })`, `fromVisionCameraCode(type, value, requested)`,
  `visionCameraSupportedSymbologies(platform)`
- `DuplicateFilter`, `BarcodeTracker`, `trackingId`, `ScanSession`
- `buildEmbedUrl(url, options)`, `parseEmbedMessage(json)`, `buildCommandScript(command)`
- `frameToViewTransform`, `uprightFrameSize`, `quadrilateralToView` (map `location` to screen points)
- `isVisionCameraAvailable()`, `isWebViewAvailable()`: pick a back end at runtime

`QRGenScanner` loads vision-camera lazily, so importing this package in Expo Go (where
the native module is missing) does not crash. `QRGenScanner` then reports
`engine-load-failed` and you can fall back to `QRGenWebScanner`:

```tsx
{isVisionCameraAvailable() ? <QRGenScanner {...props} /> : <QRGenWebScanner {...props} />}
```

## Example

[`example/App.tsx`](example/App.tsx) is a small screen with a mode switch, a torch toggle,
a back end switch and a result list.

## Status

- **Tested:** `npm test` runs Jest unit tests (ts-jest, Node) for symbology resolution
  (ids, aliases, groups), the vision-camera mapping in both directions per platform, the
  duplicate filter, the batch tracker, the scan session state machine (single, continuous,
  batch), the frame-to-view math (aspect-fill crop, mirroring), code conversion, the embed
  URL builder, embed message parsing and commands, error mapping, and an import test of the
  entry point against a mocked `react-native`. `npx tsc --noEmit` type-checks all sources,
  tests and the example against react-native 0.87, react-native-vision-camera 4.7.3 and
  react-native-webview 14.
- **Not tested yet:** the components have not been run on a device or simulator. The
  coordinate handling follows the vision-camera 4.7 native sources (iOS multiplies
  preview-oriented normalized coordinates by the landscape sensor size; Android reports
  ML Kit coordinates in the rotated image), and highlight placement, especially with the
  front camera, still needs checking on hardware. `QRGenWebScanner` depends on the hosted
  embed page implementing SPEC section 5.

## License

MIT, see [LICENSE](LICENSE).
