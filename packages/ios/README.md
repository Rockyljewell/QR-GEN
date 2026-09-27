# QRGenKit (iOS / macOS)

Native Swift package of **QRGen**, the open-source (MIT) barcode, QR and ID scanning SDK.

- **Camera scanning** with AVFoundation + Apple Vision: single, continuous and batch (multi-code tracking) modes,
  duplicate filter, region of interest, torch, zoom, camera switching, beep and haptics.
- **Ready-made UI**: `QRGenScannerViewController` (UIKit) and `QRGenScannerView` (SwiftUI) with a dark camera
  screen, corner-bracket or laser-line viewfinder, animated highlights on detected codes, torch and close
  buttons and a success toast.
- **Still images**: `QRGen.scan(image:)` for `CGImage`, `UIImage`, `NSImage`, image data and files.
- **Generation**: QR, PDF417, Aztec and Code 128 with Core Image (crisp nearest-neighbour scaling); everything
  else through the QRGen REST API.
- **Parsers** (pure Swift, also on Linux): GS1 element strings and Digital Link, AAMVA driver licenses / ID cards,
  and QR payloads (URL, Wi-Fi, vCard, MECARD, e-mail, SMS, geo, calendar events, EPC/SEPA, bitcoin, ethereum,
  UPI, GTIN check digits).

Results, symbology ids, options and error codes follow the cross-platform contract in
[`docs/SPEC.md`](../../docs/SPEC.md), so code and JSON are interchangeable with the JavaScript, Python,
Android, React Native, Flutter and .NET packages.

## Requirements

- iOS 15+ or macOS 12+ (the scanner UI is iOS / iPadOS / Mac Catalyst; the engine, image scanning,
  generation and parsers also work on macOS)
- Xcode 15+ (Swift 5.9+)

## Installation

### Swift Package Manager

In Xcode: **File > Add Package Dependencies...**, enter

```
https://github.com/Rockyljewell/QR-GEN
```

and add the **QRGenKit** library to your app target. The package manifest lives at the repository root.

In a `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/Rockyljewell/QR-GEN", from: "1.0.0"),
    // or, before a release tag exists: .package(url: "https://github.com/Rockyljewell/QR-GEN", branch: "main"),
],
targets: [
    .target(name: "MyApp", dependencies: [.product(name: "QRGenKit", package: "QR-GEN")]),
]
```

### CocoaPods

```ruby
pod 'QRGenKit', :git => 'https://github.com/Rockyljewell/QR-GEN.git'
```

### Camera permission

Add a camera usage description to your app's Info.plist (Xcode: target > Info > "Privacy - Camera Usage
Description"):

```xml
<key>NSCameraUsageDescription</key>
<string>The camera is used to scan barcodes and QR codes.</string>
```

The scanner asks for access the first time it starts. If access is denied it reports
`QRGenError.cameraPermissionDenied` (code `camera-permission-denied`) and the built-in UI shows an
"Open Settings" prompt. On macOS, sandboxed apps also need the **Camera** entitlement
(`com.apple.security.device.camera`).

## Quick start: SwiftUI

```swift
import QRGenKit
import SwiftUI

struct ScanScreen: View {
    @State private var isScanning = false
    @State private var code: String?

    var body: some View {
        Button("Scan") { isScanning = true }
            .fullScreenCover(isPresented: $isScanning) {
                QRGenScannerView(options: .init(symbologies: ["qr", "ean13"], mode: .single)) { barcodes in
                    code = barcodes.first?.data
                    isScanning = false
                }
                .onError { error in print(error.code, error.message) }
                .onClose { isScanning = false }
                .ignoresSafeArea()
            }
    }
}
```

Modifiers: `.onError { }`, `.onTrack { }` (batch mode), `.onClose { }` (shows the close button),
`.scannerAccentColor(_:)` (`Color` or `UIColor`, default teal `#2EC1CE`) and
`.scannerControls(torchButton:toast:)`. Apply them before generic modifiers such as `.ignoresSafeArea()`.
Changing `options` while the view is on screen updates the running scanner.

## Quick start: UIKit

```swift
import QRGenKit
import UIKit

final class HomeViewController: UIViewController {
    @objc func scan() {
        let scanner = QRGenScannerViewController(
            options: ScannerOptions(symbologies: ["qr", "ean13", "code128"], mode: .single),
            accentColor: QRGenScannerViewController.defaultAccentColor
        )
        scanner.onScan = { [weak scanner] barcodes in
            print(barcodes[0].symbologyName, barcodes[0].data)
            scanner?.dismiss(animated: true)
        }
        scanner.onError = { error in print(error.code) }
        present(scanner, animated: true)   // full screen; the close button dismisses it
    }
}
```

`QRGenScannerViewController` starts the camera in `viewWillAppear` and stops it in `viewDidDisappear`. After a
single-mode scan the preview keeps running; call `resumeScanning()` to scan again. `scanner.scanner` is the
underlying `BarcodeScanner` (torch, zoom, pause, delegate).

## Headless engine: `BarcodeScanner`

Use the engine directly with your own UI (iOS and macOS):

```swift
let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["2d"], mode: .continuous))
scanner.onReady = { print("camera running") }
scanner.onScan = { barcodes in print(barcodes.map(\.data)) }
scanner.onError = { error in print(error.code) }

let preview = AVCaptureVideoPreviewLayer(session: scanner.captureSession)
preview.videoGravity = .resizeAspectFill
preview.frame = view.bounds
view.layer.addSublayer(preview)

scanner.start()          // asks for camera permission if needed
scanner.setTorch(true)
scanner.setZoom(2)       // 1 = natural field of view, < 1 = ultra-wide when available
scanner.switchCamera()   // back <-> front
scanner.pause(); scanner.resume(); scanner.stop()
```

You can also set `scanner.delegate` to a `BarcodeScannerDelegate` (all methods optional, main actor):
`barcodeScannerDidBecomeReady`, `barcodeScanner(_:didScan:)`, `barcodeScanner(_:didTrack:)`,
`barcodeScanner(_:didFailWithError:)`. Closures and delegate are both called. `onDetections` receives every
detection of every processed frame (before the duplicate filter), which is handy for overlays.

**Coordinates.** For camera frames, `Barcode.location` is in pixels of the camera buffer in the sensor's
native orientation (landscape on iPhone), exactly as Vision saw it. Map it onto a preview layer with

```swift
let corners: [CGPoint] = previewLayer.layerPoints(for: barcode)   // handles aspect fill, rotation, mirroring
```

To restrict scanning to part of your preview, pass a capture-device rect:
`scanner.setRegionOfInterest(previewLayer.metadataOutputRectConverted(fromLayerRect: rectInLayer))`.
(`QRGenScannerViewController` does this for you from `options.scanArea`.)

## Scanning still images

```swift
let barcodes = try await QRGen.scan(image: cgImage, symbologies: ["qr", "ean13"])
let fromUIImage = try await QRGen.scan(image: uiImage)            // honours imageOrientation
let fromFile = try await QRGen.scan(contentsOf: fileURL)          // PNG, JPEG, HEIC...; honours EXIF orientation
let fromData = try await QRGen.scan(imageData: data)
```

For images, `location` is in pixels of the upright image.

## Generating codes

```swift
let cgImage = try QRGen.generate("https://example.com")                          // QR, scale 8, EC level M
let uiImage = try QRGen.generateImage("HELLO-123", symbology: .code128, scale: 4) // UIImage / NSImage
let png = try QRGen.generatePNG("PDF417 payload", symbology: .pdf417)
let aztec = try QRGen.generate("Ticket 42", symbology: .aztec, ecLevel: "33")     // Aztec EC percentage
```

Core Image can render **qr, pdf417, aztec and code128** (`QRGen.writableSymbologies()`). Every other symbology
throws `QRGenError.unsupported`. For those, run the QRGen REST server (`qrgen serve` or the Docker image, see
SPEC section 6) and call `GET /v1/generate`, for example:

```swift
let server = URL(string: "http://localhost:8080")!   // wherever `qrgen serve` listens
let ean = try await QRGen.generateRemotely("5901234123457", symbology: .ean13, server: server, format: .png)
```

## Parsers

Pure Swift, no camera needed, never throw (SPEC section 3):

```swift
QRGen.parseGS1("(01)09501101530003(17)250101(10)ABC123")
// values ["01": "09501101530003", "17": "250101", "10": "ABC123"], element("17")?.date == "2025-01-01"
QRGen.parseGS1("]C1010950110153000310ABC123\u{1D}21XYZ")                       // raw with GS separators
QRGen.parseGS1("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101")    // GS1 Digital Link

let id = QRGen.parseAAMVA(pdf417Text)   // AAMVAResult: names, dates (ISO), address, age, isExpired, isUnder21, fields

switch QRGen.parseContent(barcode.data, symbology: barcode.symbology) {   // or barcode.parsed
case .wifi(let wifi): print(wifi.ssid, wifi.password ?? "", wifi.security)
case .url(let url): print(url)
case .contact(let card): print(card.name ?? "", card.phones)
case .product(let product): print(product.gtin, product.checksumValid)
case .aamva(let license): print(license.fullName)
default: break
}
```

`ParsedContent` cases: `url`, `gs1DigitalLink`, `email`, `phone`, `sms`, `wifi`, `geo`, `contact`, `event`,
`payment`, `product`, `gs1`, `aamva`, `text`. `.type` gives the SPEC type string and `toJSON()` the
cross-platform JSON (`{"type":"wifi","ssid":...}`).

## Batch mode

Batch mode tracks many codes at once. Tracks keep a stable `id` while a code stays in view (matched by symbology
+ data, then by bounding-box overlap) and are dropped after 500 ms without a sighting.

```swift
let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["retail", "code128"], mode: .batch))
scanner.onTrack = { tracked in
    for code in tracked {
        print(code.id, code.data, code.count, code.lastSeen - code.firstSeen)   // Barcode fields via dynamic member lookup
    }
}
scanner.onScan = { newCodes in print("new:", newCodes.map(\.data)) }        // duplicate filter applies
```

`QRGenScannerView(...).onTrack { }` and `QRGenScannerViewController.onTrack` work the same way and draw a
highlight on every tracked code.

## Options (`ScannerOptions`)

| option | type | default | meaning |
| --- | --- | --- | --- |
| `symbologies` | `[String]` (or `[Symbology]`) | `["all"]` | ids, aliases or groups (`all`, `1d`/`linear`, `2d`/`matrix`, `retail`, `industrial`, `gs1`) |
| `mode` | `.single` / `.continuous` / `.batch` | `.continuous` | `single` pauses after the first scan; `batch` tracks many codes |
| `duplicateFilter` | `Int` (ms) | `1000` | same symbology + data is not reported again within the window; `0` = every frame, `-1` = once per session |
| `beep` | `Bool` | `true` | system sound 1057 on scan |
| `vibrate` | `Bool` | `true` | success haptic on scan |
| `camera` | `.back` / `.front` / `.device(id:)` | `.back` | camera selection (`AVCaptureDevice.uniqueID` for `.device`) |
| `torch` | `Bool` | `false` | turn the flashlight on at start |
| `viewfinder` | `.frame` / `.line` / `.none` / `nil` | `nil` = `.frame`, or `.line` for linear-only sets | overlay style |
| `scanArea` | `CGRect?`, normalized 0...1, origin top-left | `nil` (full visible frame) | region of interest |
| `maxResults` | `Int?` | `nil` = 1 (20 in batch) | codes per frame (closest to the centre first) |

Errors (`QRGenError`, `.code`): `camera-permission-denied`, `camera-not-found`, `camera-in-use`,
`insecure-context` (web only), `engine-load-failed`, `unsupported`, `unknown`.

## Symbology support on Apple platforms

`QRGen.supportedSymbologies()` returns what the running OS can read. With Apple Vision (iOS 15+ / macOS 12+):

| Read | ids |
| --- | --- |
| yes | `qr`, `micro-qr`, `data-matrix`, `aztec`, `pdf417`, `micro-pdf417`, `ean13`, `ean8`, `upca`, `upce`, `isbn`, `code128`, `code39`, `code93`, `codabar`, `itf`, `itf14`, `databar`, `databar-expanded`, `databar-limited` |
| no (skipped silently) | `rmqr`, `maxicode`, `code32`, `pzn`, `telepen`, `dx-film-edge` |

Vision reports UPC-A as EAN-13 with a leading `0` and ISBN as EAN-13 with a `978`/`979` prefix. When you ask for
`upca` or `isbn`, QRGenKit reports those ids (UPC-A data is shortened to 12 digits); otherwise such codes are
reported as `ean13`. GS1 DataBar data (and, on iOS 17+, any code Vision flags as a GS1 carrier) is converted to
the human readable `(01)...` form with `isGS1 == true`. `rawBytes` holds Vision's raw payload on iOS 17+ and the
UTF-8 of the text before that.

## Example app

[`Example/`](Example) contains a minimal SwiftUI app (`QRGenExampleApp.swift`, `ContentView.swift`): a scan
button, a full-screen single-mode scanner and a result sheet with the parsed content and JSON. There is no
Xcode project; to run it:

1. In Xcode, **File > New > Project... > iOS > App** (Interface: SwiftUI, Language: Swift).
2. Delete the generated `ContentView.swift` and `<Name>App.swift`, then drag both files from `Example/` into
   the project (tick "Copy items if needed").
3. **File > Add Package Dependencies...**, enter `https://github.com/Rockyljewell/QR-GEN` (or **Add Local...**
   and pick your checkout of this repository), and add **QRGenKit** to the app target.
4. Target > Info: add **Privacy - Camera Usage Description** with any text.
5. Run on a real iPhone or iPad (the simulator has no camera).

## Tests

```
swift test
```

from the repository root. The parser, symbology, JSON and tracker tests are platform independent and also run on
Linux; the camera, Vision, Core Image and UIKit code is compiled only on Apple platforms.

## Status

What has and has not been verified for this release, stated plainly:

- **Compiled and tested:** the platform-independent code (`Symbology` and `resolve`, `Barcode` /
  `TrackedBarcode` / `ParsedContent` JSON, `ScannerOptions`, `QRGenError`, the GS1, AAMVA and content parsers,
  the duplicate filter and the batch tracker) was built and tested on **Linux with Swift 5.10.1**:
  `swift build` and `swift test` pass (39 XCTest cases, including the GS1 and AAMVA test vectors from the SPEC),
  with no compiler warnings.
- **Written, syntax-checked only:** the Apple-only files (`BarcodeScanner`, `VisionBarcodeMapper`,
  `ImageScanner`, `Generator`, `Feedback`, `QRGenScannerViewController`, `QRGenScannerView`) and the example
  app. The Linux compiler parses them (inactive `#if` blocks are syntax-checked), but they have **not yet been
  type-checked against the iOS / macOS SDKs, built in Xcode, or run on a device**. `pod lib lint` has not been
  run either.
- **Needs on-device verification:** camera start / permission flow, highlight placement (especially with the
  front camera and in landscape), region-of-interest mapping, torch and zoom on multi-camera iPhones, and batch
  tracking performance.

Please open an issue or a pull request if something does not build with your Xcode version.

## License

MIT, see [LICENSE](../../LICENSE).
