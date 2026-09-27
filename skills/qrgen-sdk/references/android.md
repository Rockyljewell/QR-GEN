# Android: qrgen-android (Kotlin, Views and Compose)

CameraX + ML Kit scanner. minSdk 24, compileSdk 35. Modules: `qrgen-core` (pure JVM: symbologies,
parsers, generator, tracker), `qrgen-android` (camera, `QRGenScannerView`), `qrgen-compose`
(`QRGenScanner` composable). Status: beta (compiles, 127 JVM tests pass; not yet verified on devices).

## Install (JitPack)

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories { google(); mavenCentral(); maven("https://jitpack.io") }
}
// app/build.gradle.kts
dependencies {
    implementation("com.github.Rockyljewell.QR-GEN:qrgen-android:main-SNAPSHOT") // Views
    implementation("com.github.Rockyljewell.QR-GEN:qrgen-compose:main-SNAPSHOT") // Compose (optional)
}
```

Use a git tag or commit instead of `main-SNAPSHOT` for reproducible builds. Local alternative:
`includeBuild("../QR-GEN/packages/android")` and depend on `dev.qrgen:qrgen-android:1.0.0`.

The library merges `CAMERA` and `VIBRATE` into the manifest. **Request `CAMERA` at runtime** before
scanning (`QRGen.hasCameraPermission(context)`, `QRGen.CAMERA_PERMISSION`), otherwise `onError` receives
`camera-permission-denied`.

## Compose

```kotlin
import dev.qrgen.ScannerOptions
import dev.qrgen.Symbology
import dev.qrgen.compose.QRGenScanner

@Composable
fun ScanScreen(onCode: (String) -> Unit) {
    QRGenScanner(
        options = ScannerOptions(symbologies = Symbology.resolve("qr", "retail"), mode = ScannerOptions.Mode.SINGLE),
        onScan = { barcodes -> onCode(barcodes.first().data) },
        onError = { error -> Log.w("QRGen", "${error.code.id}: ${error.message}") },
        modifier = Modifier.fillMaxSize(),
    )
}
```

Optional parameters: `onTrack` (batch), `state = rememberQRGenScannerState()` (torch, pause, zoom),
`accentColor`, `showToast`. The camera follows `LocalLifecycleOwner`.

## Views

```xml
<dev.qrgen.android.QRGenScannerView
    android:id="@+id/scanner"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    app:qrgen_symbologies="qr,retail"
    app:qrgen_mode="continuous" />
```

```kotlin
scannerView.options = ScannerOptions(symbologies = Symbology.resolve("qr", "retail"), duplicateFilter = 1500)
scannerView
    .onScan { barcodes -> Log.i("QRGen", barcodes.first().toJson()) }
    .onError { error -> Log.w("QRGen", error.code.id) }
scannerView.bind(this) // lifecycle owner
```

Controls: `start`, `stop`, `pause`, `resume`, `setTorch`, `switchCamera`, `setZoomRatio`, `release`.
`QRGenScanner(context, options)` is the headless controller for your own `PreviewView`.

## Images, generation, parsers

```kotlin
val codes = QRGen.scanImage(context, bitmap, Symbology.resolve("qr"))   // suspend (scanImageAsync for Java)
val svg = generateSvg("https://example.com", Symbology.QR)            // qrgen-core
val bmp = Generator.generate("5901234123457", Symbology.EAN13).toBitmap()
val gs1 = parseGS1("(01)09501101530003(17)250101(10)ABC123")
val id = parseAAMVA(pdf417Text)
val content = parseContent(barcode.data)
```

Symbologies via ML Kit: qr, data-matrix, aztec, pdf417, ean13, ean8, upca, upce, isbn, code128,
code39, code93, codabar, itf, itf14. Others are skipped silently (`QRGen.supportedSymbologies()`).
Test on a physical device. Emulators have only a virtual scene camera.
