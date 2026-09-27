# React Native / Expo: qrgen-react-native

Two components with one API:

| Component | Engine | Setup | Use when |
| --- | --- | --- | --- |
| `QRGenScanner` | react-native-vision-camera 4 (ML Kit / AVFoundation) | development build (not Expo Go) | production, best speed |
| `QRGenWebScanner` | hosted QRGen scanner in react-native-webview | none, works in Expo Go | prototypes, every QRGen symbology |

Status: beta (logic unit tested; components not yet verified on devices).

## Install

The package lives in the repo at `packages/react-native` (npm name `qrgen-react-native`). Until it is
published, install the tarball built with the docs site or add it from a local checkout:

```bash
npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-react-native.tgz
# native scanner
npx expo install react-native-vision-camera@^4.7.3     # bare RN: npm install react-native-vision-camera@^4.7.3 && cd ios && pod install
# WebView scanner (optional)
npx expo install react-native-webview
```

Pin vision-camera 4 (v5 has a different API). Expo `app.json` plugin:

```json
{ "expo": { "plugins": [["react-native-vision-camera", { "cameraPermissionText": "$(PRODUCT_NAME) scans barcodes.", "enableCodeScanner": true }]] } }
```

Bare RN: `NSCameraUsageDescription` in Info.plist, `android.permission.CAMERA` (and `VIBRATE`) in the
manifest. Both components request the camera permission when they mount.

## Native scanner

```tsx
import { useIsFocused } from "@react-navigation/native";
import { QRGenScanner } from "qrgen-react-native";

export function ScanScreen() {
  const isFocused = useIsFocused();
  return (
    <QRGenScanner
      style={{ flex: 1 }}
      isActive={isFocused}
      symbologies={["qr", "ean13", "code128"]}
      mode="single"
      onScan={(barcodes) => console.log(barcodes[0].symbology, barcodes[0].data)}
      onError={(e) => console.warn(e.code, e.message)}
    />
  );
}
```

Props: `symbologies`, `mode`, `duplicateFilter`, `beep`, `vibrate`, `camera`, `torch`, `viewfinder`,
`scanArea`, `maxResults`, `isActive`, `onScan`, `onTrack`, `onError`, `onReady`, `accentColor`,
`showToast`, `showHighlights`, `fallback`, `children`, `style`. Ref (`QRGenScannerHandle`): `start`,
`stop`, `pause`, `resume`, `reset`, `setTorch`, `supportedSymbologies`. After a single-mode scan call
`ref.current?.start()` to scan again.

Beep: React Native has no built-in sound. Register one with `setBeepHandler(() => player.play())`
(expo-audio, react-native-sound…), otherwise it is silent.

## WebView scanner (zero native code)

```tsx
import { QRGenWebScanner } from "qrgen-react-native";
<QRGenWebScanner style={{ flex: 1 }} symbologies={["qr", "pdf417"]} mode="continuous" onScan={(b) => console.log(b)} />
```

Extra props: `embedUrl` (self-hosted copy, must be https), `webViewProps`. Ref: `start`, `stop`,
`pause`, `resume`, `setTorch`, `sendCommand`, `reload`.

## Parsing

`npm install qrgen-sdk`, then `import { parseContent, parseGS1, parseAAMVA } from "qrgen-sdk/parsers"`
(pure TypeScript, runs in Hermes).
