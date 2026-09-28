# qrgen_flutter

Barcode, QR and ID scanning for Flutter, part of [QRGen](https://github.com/Rockyljewell/QR-GEN)
(Apache-2.0). Two widgets share one API:

| Widget | Engine | Best for |
| --- | --- | --- |
| `QRGenScanner` | [`mobile_scanner`](https://pub.dev/packages/mobile_scanner) 5.1+, 6 or 7 (ML Kit on Android; ML Kit on iOS up to 6, Apple Vision from 7) | Production apps, best speed |
| `QRGenWebScanner` | Hosted QRGen embed page in [`webview_flutter`](https://pub.dev/packages/webview_flutter) | Every QRGen symbology, no camera plugin setup |

Both use the QRGen symbology ids, result shape (`QRGenBarcode`), options and error codes
from the [cross-platform specification](../../docs/SPEC.md), so results look the same as
in the JavaScript, iOS, Android, React Native and Python SDKs.

## Install

```yaml
dependencies:
  qrgen_flutter: ^0.1.0
```

Requires Dart 3.3 and Flutter 3.19 or later (newer `mobile_scanner` and `webview_flutter`
releases are picked automatically on newer Flutter versions).

### iOS

`ios/Runner/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>This app uses the camera to scan barcodes and QR codes.</string>
```

`mobile_scanner` 6 needs iOS 15.5 (`platform :ios, '15.5'` in `ios/Podfile`); 5 and 7
work from iOS 12. The WebView scanner needs iOS 14.3+ for camera access in `WKWebView`.

### Android

`android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

`mobile_scanner` 7 needs `minSdk 23`, `webview_flutter_android` 4 needs `minSdk 24`.
`QRGenScanner` asks for the camera permission itself (through `mobile_scanner`).
For `QRGenWebScanner` the app must hold the permission before the page opens the camera,
see [below](#android-camera-permission-for-the-webview).

To bundle the ML Kit model instead of downloading it through Google Play services, see the
`mobile_scanner` README (`dev.steenbakker.mobile_scanner.useUnbundled`).

## QRGenScanner (mobile_scanner)

```dart
import 'package:qrgen_flutter/qrgen_flutter.dart';

class ScanPage extends StatelessWidget {
  const ScanPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: QRGenScanner(
        options: const QRGenScannerOptions(
          symbologies: ['qr', 'ean13', 'code128'],
          mode: QRGenScanMode.single,
        ),
        onScan: (barcodes) => Navigator.pop(context, barcodes.first.data),
        onError: (error) => debugPrint('${error.code.value}: ${error.message}'),
      ),
    );
  }
}
```

The widget:

- resolves SPEC ids, aliases and groups (`QRCode`, `ean-13`, `retail`, `2d`, ...) and maps them
  to the `BarcodeFormat`s of the installed `mobile_scanner` version, dropping the ones the
  platform cannot read (see `qrgenSupportedSymbologies()`);
- refines results so they match the other QRGen SDKs: UPC-A read as EAN-13 with a leading `0`
  (Apple Vision) is reported as a 12 digit `upca`, EAN-13 starting with `978`/`979` as
  `isbn`, and a 14 digit ITF as `itf14`, whenever those ids were requested;
- stops the camera while the app is in the background, while `isActive` is `false`, and while
  its route is covered by another full-screen route, and disposes its `mobile_scanner`
  controller;
- draws a rounded corner-bracket viewfinder (or a scan line for linear-only sets), outlines
  detected codes when `mobile_scanner` reports corners, and shows a success toast pill, in the
  QRGen accent `Color(0xFF2EC1CE)`;
- gives haptic feedback (`HapticFeedback.mediumImpact`) and a short system click on scan. Pass
  `onBeep` to play a real beep with your audio package.

| Parameter | Default | Description |
| --- | --- | --- |
| `options` | `QRGenScannerOptions()` | SPEC options, see below |
| `onScan` | | `void Function(List<QRGenBarcode>)`: new codes after the duplicate filter |
| `onTrack` | | `void Function(List<QRGenTrackedBarcode>)`: batch mode, every tracked code whenever the set changes |
| `onError` | | `void Function(QRGenError)` |
| `onReady` | | The camera started |
| `controller` | | `QRGenScannerController` for `start`, `stop`, `pause`, `resume`, `reset`, `setTorch`, `switchCamera` |
| `isActive` | `true` | Run the camera |
| `accentColor` | `Color(0xFF2EC1CE)` | Viewfinder, outline and toast color |
| `showToast` / `showHighlights` | `true` | Overlay parts |
| `onBeep` | system click | Scan sound |
| `errorBuilder` | built-in message | `Widget Function(BuildContext, QRGenError)` |
| `child` | | Drawn on top (buttons, hints) |

Give the scanner a bounded size (`Expanded`, `SizedBox`, `AspectRatio`, or a `Scaffold` body).

### Options

`QRGenScannerOptions` is shared by both widgets:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `symbologies` | `List<String>` | `['all']` | SPEC ids or groups |
| `mode` | `QRGenScanMode` | `continuous` | `single` stops the camera after the first scan (call `controller.start()` to scan again); `batch` tracks many codes |
| `duplicateFilter` | `int` (ms) | `1000` | Ignore the same symbology + data within this window. `0` reports every frame, `-1` once per session |
| `beep` | `bool` | `true` | Sound on scan |
| `vibrate` | `bool` | `true` | Haptic feedback on scan |
| `camera` | `QRGenCameraFacing` | `back` | `back` or `front` |
| `torch` | `bool` | `false` | Flashlight |
| `viewfinder` | `QRGenViewfinder?` | `frame` (`line` for linear-only sets) | `frame`, `line` or `none` |
| `scanArea` | `QRGenScanArea?` | full frame | Normalized region of interest; codes whose center is outside are ignored |
| `maxResults` | `int?` | `1` (`20` in batch) | Codes per frame, closest to the center first |

## QRGenWebScanner (webview_flutter)

Loads `https://rockyljewell.github.io/QR-GEN/embed/` with the options in the query string,
registers the `QRGenBridge` JavaScript channel and parses the SPEC section 5 messages. It reads
every QRGen symbology because the page runs the QRGen WebAssembly engine.

```dart
final controller = QRGenWebScannerController();

QRGenWebScanner(
  controller: controller,
  options: const QRGenScannerOptions(symbologies: ['qr', 'pdf417']),
  onReady: () => debugPrint('ready'),
  onScan: (barcodes) => debugPrint(barcodes.first.data),
  onError: (error) => debugPrint(error.message),
);

// Later:
await controller.setTorch(true);
await controller.pause();
```

- iOS: the controller is created with `WebKitWebViewControllerCreationParams(allowsInlineMediaPlayback: true, mediaTypesRequiringUserAction: {})`
  and the page's camera request is granted (iOS 15+), so the user only sees the app-level
  permission prompt.
- Android: `setMediaPlaybackRequiresUserGesture(false)` and `setOnPlatformPermissionRequest`
  grant the page's camera request.
- Controller commands (`start`, `stop`, `pause`, `resume`, `setTorch`, `send`) call
  `runJavaScript("window.qrgen && window.qrgen.command({...});")`. Commands sent before the page
  reports `ready` are queued.
- `isActive: false`, a covered route and the app going to the background send `stop`; coming
  back sends `start`. Changing `torch` sends a command, changing other options reloads the page.
- Haptics run natively; the page gets `vibrate=0`. The page plays the beep.
- `embedUrl` points to a self-hosted copy of the page (it must be `https`).

### Android camera permission for the WebView

Android WebViews can only grant camera access the app already holds. Request it first, for
example with [`permission_handler`](https://pub.dev/packages/permission_handler):

```dart
QRGenWebScanner(
  requestCameraPermission: () async => (await Permission.camera.request()).isGranted,
  onScan: (barcodes) {},
);
```

When `requestCameraPermission` returns `false`, the page is not loaded and
`camera-permission-denied` is reported. Without it, a missing permission is reported by the
page as `camera-permission-denied`.

## Results

`QRGenBarcode` follows SPEC section 2 and round-trips through `toJson()` / `fromJson()`:

| Field | Type | Notes |
| --- | --- | --- |
| `data` | `String` | Decoded text; GS1 DataBar in HRI form `(01)...` |
| `symbology` | `QRGenSymbology` | `.id` is the SPEC id, for example `ean13` |
| `symbologyName` | `String` | `EAN-13` |
| `rawBytes` | `String` | Base64 of the raw bytes, `''` when unavailable |
| `contentType` | `QRGenContentType` | `text`, or `binary` for byte-only codes |
| `isGS1` | `bool` | |
| `location` | `QRGenQuadrilateral` | Corners in pixels of `frameSize` (the upright camera frame) |
| `frameSize` | `QRGenSize` | |
| `orientation`, `ecLevel`, `symbologyIdentifier` | | `0` / `''` when unknown |
| `timestamp` | `DateTime` | JSON: ms since epoch |

`QRGenTrackedBarcode` adds `id` (stable, derived from symbology and data, identical to the
React Native package), `firstSeen`, `lastSeen` and `count`; codes are dropped after 500 ms
unseen. Errors are `QRGenError` with a `QRGenErrorCode` (`camera-permission-denied`,
`camera-not-found`, `camera-in-use`, `insecure-context`, `engine-load-failed`, `unsupported`,
`unknown`).

## Utilities

Pure Dart helpers (no Flutter needed): `resolveSymbologies`, `QRGenSymbology.tryParse`,
`qrgenSymbologyGroups`, `mobileScannerFormatNames`, `fromMobileScannerFormat`,
`QRGenDuplicateFilter`, `QRGenBarcodeTracker`, `qrgenTrackingId`, `QRGenScanSession`,
`buildEmbedUri`, `parseBridgeMessage`, `QRGenBridgeCommand`, `QRGenFrameTransform` (map
`location` to widget coordinates with the `BoxFit.cover` crop), `QRGenScannerOverlay` (reuse the
overlay with your own camera widget).

## Example

[`example/lib/main.dart`](example/lib/main.dart): a scanner screen with a mode switch, a torch
toggle, a back end switch and a result list. Run `flutter create .` inside `example/` to
generate the platform folders, then add the permissions above.

## Status

- **Tested:** 111 tests pass with `flutter test` (Flutter 3.47.5, mobile_scanner 7.4.2,
  webview_flutter 4.14.1). 97 of them are pure Dart tests for symbology resolution, the
  mobile_scanner mapping for versions 5/6, 7.0-7.2 and 7.3+, JSON round trips, the duplicate filter,
  the tracker, the scan session, geometry and bridge parsing. They also pass with `dart test` in
  a Flutter-free package. Widget tests drive `QRGenScanner` against a fake `mobile_scanner`
  platform (formats, start and stop, single, batch, duplicate filter, torch, `isActive`, error
  mapping) and `QRGenWebScanner` against a fake `webview_flutter` platform (URL, `QRGenBridge`
  channel, message dispatch, command queueing, permission grants). `flutter analyze` reports no
  issues for the package and the example. `lib/` also analyzes cleanly against the lowest
  allowed dependencies (mobile_scanner 5.1.0, webview_flutter 4.4.0, webview_flutter_android
  3.12.0, webview_flutter_wkwebview 3.9.0) and against mobile_scanner 6.0.10 and 7.0.0. The
  tracking ids are checked to be the same on the Dart VM, in dart2js output and in the React
  Native package.
- **Not tested yet:** nothing has run on a real device or simulator. Camera behavior, highlight
  placement (especially with the front camera, which is not mirrored in the overlay) and the
  hosted embed page inside real WebViews still need checking on hardware. The widget tests use
  the mobile_scanner 7 platform interface, so they need mobile_scanner 7 to compile.

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Created by [Rockyljewell](https://github.com/Rockyljewell).
