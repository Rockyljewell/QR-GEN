# iOS / macOS: QRGenKit (Swift)

AVFoundation + Apple Vision scanner with SwiftUI and UIKit views. iOS 15+ / macOS 12+, Xcode 15+.
Status: beta (platform-independent code is unit tested; camera/UI code needs device verification).

## Install

Xcode: **File > Add Package Dependencies...** → `https://github.com/Rockyljewell/QR-GEN` → add the
**QRGenKit** library. `Package.swift`:

```swift
.package(url: "https://github.com/Rockyljewell/QR-GEN", branch: "main"),
// target: .product(name: "QRGenKit", package: "QR-GEN")
```

CocoaPods: `pod 'QRGenKit', :git => 'https://github.com/Rockyljewell/QR-GEN.git'`

**Info.plist** (required, or the app crashes on camera access):

```xml
<key>NSCameraUsageDescription</key>
<string>The camera is used to scan barcodes and QR codes.</string>
```

## SwiftUI

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

Modifiers: `.onError`, `.onTrack` (batch), `.onClose`, `.scannerAccentColor(_:)`,
`.scannerControls(torchButton:toast:)`. Apply them before generic modifiers.

## UIKit

```swift
let scanner = QRGenScannerViewController(options: ScannerOptions(symbologies: ["qr", "code128"], mode: .single))
scanner.onScan = { [weak scanner] barcodes in
    print(barcodes[0].symbologyName, barcodes[0].data)
    scanner?.dismiss(animated: true)
}
scanner.onError = { error in print(error.code) }
present(scanner, animated: true)
```

After a single-mode scan call `resumeScanning()` to scan again.

## Headless engine

```swift
let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["2d"], mode: .continuous))
scanner.onScan = { barcodes in print(barcodes.map(\.data)) }
let preview = AVCaptureVideoPreviewLayer(session: scanner.captureSession)
scanner.start()
```

Also: `pause()`, `resume()`, `stop()`, `setTorch(_:)`, `setZoom(_:)`, `switchCamera()`,
`update(options:)`, delegate `BarcodeScannerDelegate`, `onDetections` (every frame), and
`previewLayer.layerPoints(for: barcode)` to map corners onto the preview.

## Images, generation, parsers

```swift
let found = try await QRGen.scan(image: uiImage, symbologies: ["qr"])
let qr = try QRGen.generate("https://example.com")                 // CGImage; qr, pdf417, aztec, code128
let png = try QRGen.generatePNG("Ticket 42", symbology: .aztec)
let gs1 = QRGen.parseGS1("(01)09501101530003(17)250101(10)ABC123")
let license = QRGen.parseAAMVA(pdf417Text)
let parsed = QRGen.parseContent(barcode.data, symbology: barcode.symbology)
```

Other symbologies can be generated through the REST API (`QRGen.generateRemotely`).

## Symbologies on Apple platforms

Readable: qr, micro-qr, data-matrix, aztec, pdf417, micro-pdf417, ean13, ean8, upca, upce, isbn,
code128, code39, code93, codabar, itf, itf14, databar, databar-expanded, databar-limited. Not available
through Vision (skipped silently): rmqr, maxicode, code32, pzn, telepen, dx-film-edge.

The simulator has no camera, so test on a device. Use `QRGen.scan(image:)` in unit tests.
