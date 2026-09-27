# Flutter: qrgen_flutter

| Widget | Engine | Use when |
| --- | --- | --- |
| `QRGenScanner` | mobile_scanner 5.1+/6/7 (ML Kit, Apple Vision) | production, best speed |
| `QRGenWebScanner` | hosted QRGen scanner in webview_flutter | every QRGen symbology, no camera plugin setup |

Status: beta (unit and widget tests pass against fake platforms; not yet verified on devices).

## Install

Until it is on pub.dev, depend on the Git repository:

```yaml
dependencies:
  qrgen_flutter:
    git:
      url: https://github.com/Rockyljewell/QR-GEN.git
      path: packages/flutter
```

iOS `ios/Runner/Info.plist`: `NSCameraUsageDescription`. Android manifest:
`<uses-permission android:name="android.permission.CAMERA" />`. mobile_scanner 7 needs `minSdk 23`,
webview_flutter_android 4 needs `minSdk 24`, and mobile_scanner 6 needs iOS 15.5.

## Native scanner

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

`QRGenScanner` parameters: `options`, `onScan`, `onTrack`, `onError`, `onReady`, `controller`
(`QRGenScannerController`: `start`, `stop`, `pause`, `resume`, `reset`, `setTorch`, `switchCamera`),
`isActive`, `accentColor`, `showToast`, `showHighlights`, `onBeep`, `errorBuilder`, `child`.

## WebView scanner

```dart
QRGenWebScanner(
  options: const QRGenScannerOptions(symbologies: ['all'], mode: QRGenScanMode.continuous),
  requestCameraPermission: () async => (await Permission.camera.request()).isGranted, // permission_handler
  onScan: (barcodes) => debugPrint(barcodes.first.data),
)
```

On Android the app must hold the camera permission before the page opens the camera (pass
`requestCameraPermission`). Controller: `QRGenWebScannerController` (`start`, `stop`, `pause`, `resume`,
`setTorch`, `send`, `reload`).

Results are `QRGenBarcode` objects (`data`, `symbology`, `symbologyName`, `location`, `isGS1`, …,
`toJson()` matching the SPEC). Batch mode gives `QRGenTrackedBarcode`s through `onTrack`.
