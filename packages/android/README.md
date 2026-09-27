# QRGen for Android

Native Android SDK for [QRGen](https://github.com/Rockyljewell/QR-GEN), the open-source (MIT)
barcode, QR and ID scanning SDK. It follows the cross-platform contract in
[`docs/SPEC.md`](../../docs/SPEC.md): the same symbology ids, result shape, parsers, scanner
options and error codes as every other QRGen platform.

| Module | Artifact | What it is |
| --- | --- | --- |
| `qrgen-core` | `dev.qrgen:qrgen-core` | Pure Kotlin/JVM (no Android): symbologies, `Barcode` model + JSON, `ScannerOptions`, duplicate filter, batch tracker, GS1 / AAMVA / content parsers, generator (ZXing). Works on servers and desktop too. |
| `qrgen-android` | `dev.qrgen:qrgen-android` | CameraX + ML Kit scanner (`QRGenScanner`), drop-in `QRGenScannerView`, still-image scanning, beep/haptics, `Bitmap` rendering. Depends on `qrgen-core` (`api`). |
| `qrgen-compose` | `dev.qrgen:qrgen-compose` | Jetpack Compose `QRGenScanner(...)` composable. Depends on `qrgen-android` (`api`). |
| `sample` | not published | Small Compose app using all of the above. |

Requirements: minSdk 24, compileSdk 35+, Java 17, Kotlin 2.x.

## Installation

### JitPack

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io")
    }
}
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("com.github.Rockyljewell.QR-GEN:qrgen-android:<tag>")   // View / controller API
    implementation("com.github.Rockyljewell.QR-GEN:qrgen-compose:<tag>")   // + Compose (optional)
    // or everything at once: implementation("com.github.Rockyljewell:QR-GEN:<tag>")
    // or only the JVM core (parsers, generator): "com.github.Rockyljewell.QR-GEN:qrgen-core:<tag>"
}
```

`<tag>` is a git tag of this repository (for example `1.0.0`), a commit hash, or
`main-SNAPSHOT`. JitPack builds from the repository root using [`/jitpack.yml`](../../jitpack.yml),
which runs `./gradlew publishToMavenLocal` in `packages/android`. On JitPack the build publishes
under the group `com.github.Rockyljewell.QR-GEN` (outside JitPack the group is `dev.qrgen`).

### Local build (`includeBuild`)

Clone the repository next to your app and include the Gradle build. Gradle substitutes
`dev.qrgen:*` with the local projects automatically.

```kotlin
// your app's settings.gradle.kts
includeBuild("../QR-GEN/packages/android")
```

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("dev.qrgen:qrgen-android:1.0.0")
    implementation("dev.qrgen:qrgen-compose:1.0.0")
}
```

The Android modules are only part of that build when an Android SDK is found: set
`ANDROID_HOME`, or put `sdk.dir=...` in `packages/android/local.properties` (Android Studio
writes it the first time you open that folder). Without an SDK only `qrgen-core` is built.

Alternatively publish to `~/.m2` and use `mavenLocal()`:

```bash
cd packages/android && ./gradlew publishToMavenLocal
```

## Camera permission

`qrgen-android` merges `CAMERA` and `VIBRATE` into your manifest (with
`uses-feature ... android:required="false"`), so you do not need to declare them. `CAMERA` is a
runtime permission and must be requested before scanning:

```kotlin
class ScanActivity : AppCompatActivity() {
    private val requestCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scannerView.start() else showPermissionRationale()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // ...
        if (!QRGen.hasCameraPermission(this)) requestCamera.launch(QRGen.CAMERA_PERMISSION)
    }
}
```

If the permission is missing when the scanner starts, `onError` receives
`camera-permission-denied`; call `start()` again once it is granted.

## Quick start: Views

```xml
<!-- res/layout/activity_scan.xml -->
<dev.qrgen.android.QRGenScannerView xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/scanner"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    app:qrgen_symbologies="qr,retail"
    app:qrgen_mode="continuous"
    app:qrgen_accentColor="#2EC1CE" />
```

```kotlin
class ScanActivity : AppCompatActivity() {
    private lateinit var scannerView: QRGenScannerView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scan)
        scannerView = findViewById(R.id.scanner)
        scannerView.options = ScannerOptions(
            symbologies = Symbology.resolve("qr", "retail"),
            duplicateFilter = 1500,
        )
        scannerView
            .onScan { barcodes -> Log.i("QRGen", barcodes.first().toJson()) }
            .onError { error -> Log.w("QRGen", "${error.code.id}: ${error.message}") }
        scannerView.bind(this) // camera follows the Activity lifecycle
    }
}
```

All XML attributes are optional: `qrgen_accentColor`, `qrgen_viewfinder` (`auto|frame|line|none`),
`qrgen_symbologies`, `qrgen_mode` (`single|continuous|batch`), `qrgen_beep`, `qrgen_vibrate`,
`qrgen_showToast`, `qrgen_showHighlights`, `qrgen_dimBackground`.

The view draws a rounded corner-bracket viewfinder (or an aiming line when only 1D
symbologies are requested), outlines detected codes (frame coordinates mapped onto the
`FILL_CENTER` preview, front camera mirrored), and a success pill with the scanned text.

### Your own UI: `QRGenScanner`

`QRGenScanner` is the controller behind the view. Give it any `PreviewView` (or none, for
headless analysis):

```kotlin
val scanner = QRGenScanner(context, ScannerOptions(mode = ScannerOptions.Mode.SINGLE))
    .onScan { barcodes -> handle(barcodes.first()) }
    .onError { error -> show(error.message) }
    .onReady { torchButton.isVisible = true }
scanner.bind(viewLifecycleOwner, binding.previewView)

scanner.setTorch(true)      // false if the camera has no flash
scanner.switchCamera()
scanner.setZoomRatio(2f)
scanner.pause(); scanner.resume()
scanner.stop(); scanner.start()
```

Threading and lifecycle: call everything on the main thread; listeners are delivered on the
main thread. Frames are analysed on one background thread with CameraX
`STRATEGY_KEEP_ONLY_LATEST`; every `ImageProxy` is closed. When the bound lifecycle is
destroyed the scanner releases itself (camera, ML Kit client, executor, tone generator); call
`release()` to do it earlier.

## Quick start: Compose

```kotlin
@Composable
fun ScanScreen() {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(QRGen.hasCameraPermission(context)) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) permission.launch(QRGen.CAMERA_PERMISSION) }

    var result by remember { mutableStateOf<String?>(null) }
    val state = rememberQRGenScannerState()

    if (granted) {
        Box(Modifier.fillMaxSize()) {
            QRGenScanner(
                options = ScannerOptions(symbologies = Symbology.resolve("qr", "retail")),
                onScan = { barcodes -> result = barcodes.first().data },
                onError = { error -> result = "${error.code.id}: ${error.message}" },
                modifier = Modifier.fillMaxSize(),
                state = state,
            )
            TextButton(onClick = { state.setTorch(!state.isTorchOn) }, Modifier.align(Alignment.TopEnd)) {
                Text(if (state.isTorchOn) "Torch off" else "Torch on")
            }
            result?.let { Text(it, Modifier.align(Alignment.BottomCenter).padding(24.dp)) }
        }
    }
}
```

Options passed to the composable are applied live. `rememberQRGenScannerState()` exposes
`setTorch`, `pause`, `resume`, `switchCamera`, `setZoomRatio` and the underlying `scanner`.
The full example app is in [`sample/`](sample/src/main/kotlin/dev/qrgen/sample/MainActivity.kt).

## Scanning images

```kotlin
// From a Bitmap
val barcodes: List<Barcode> = QRGen.scanImage(context, bitmap, Symbology.resolve("qr", "pdf417"))

// From a gallery pick / content URI (EXIF rotation applied)
val pick = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
    if (uri != null) lifecycleScope.launch {
        val codes = QRGen.scanImage(this@MainActivity, uri)
        codes.forEach { Log.i("QRGen", "${it.symbology.id}: ${it.data}") }
    }
}
```

Java: `QRGen.scanImageAsync(context, bitmap, (barcodes, error) -> { ... })`.

## Generating codes

```kotlin
val code = Generator.generate("https://rockyljewell.github.io/QR-GEN/", Symbology.QR, GenerateOptions(ecLevel = "Q"))
imageView.setImageBitmap(code.toBitmap(scale = 10))  // Android
val svg: String = code.toSvg()                         // any JVM
val png: ByteArray = code.toPng(scale = 8)             // any JVM, no java.awt needed
val grid: Array<BooleanArray> = code.toBooleanGrid()   // or code.toBitMatrix() (ZXing)

// GS1-128 / GS1 DataMatrix / GS1 QR from HRI
Generator.generate("(01)09501101530003(17)250101(10)ABC123", Symbology.CODE128, GenerateOptions(gs1 = true, hrt = true))

// One-liners
QRGen.generateBitmap("hello", Symbology.AZTEC)
generateSvg("5901234123457", Symbology.EAN13)
```

Writable: `qr`, `data-matrix`, `aztec`, `pdf417`, `code128`, `code39`, `code93`, `codabar`,
`ean13`, `ean8`, `upca`, `upce`, `itf`, `itf14`, `isbn` (retail codes accept the number with or
without its check digit). Other ids throw `UnsupportedSymbologyException` (code `unsupported`);
use the QRGen REST API for them. `GenerateOptions`: `ecLevel` (QR `L/M/Q/H`, Aztec percent or
`L/M/Q/H`, PDF417 `0-8` or `L/M/Q/H`), `margin`, `quietZone`, `gs1`, `barHeight`, `scale`,
`foreground`, `background` (`transparent` allowed), `hrt`, `charset`.

## Parsers

Pure functions from `qrgen-core` (SPEC §3). They never throw.

```kotlin
when (val c = barcode.parse()) {            // or ContentParser.parse(text) / parseContent(text)
    is ParsedContent.Url -> open(c.url)
    is ParsedContent.Wifi -> connect(c.ssid, c.password, c.security)
    is ParsedContent.Contact -> addContact(c.name, c.phones, c.emails)
    is ParsedContent.Payment -> pay(c.scheme, c.iban ?: c.address, c.amount, c.currency)
    is ParsedContent.Product -> lookup(c.gtin)          // 14-digit GTIN, checksumValid
    is ParsedContent.Gs1 -> println(c.gs1.values)        // { "01": ..., "17": ... }
    is ParsedContent.Aamva -> verifyAge(c.aamva.isUnder21)
    else -> println(c.toJson())
}

val gs1 = GS1.parse("(01)09501101530003(17)250101(10)ABC123")!!
gs1.values            // {01=09501101530003, 17=250101, 10=ABC123}
gs1.element("17")?.date   // "2025-01-01"
gs1.element("17")?.title  // "USE BY or EXPIRY"
GS1.parse("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101")  // Digital Link
GS1.parse("]C10109501101530003" + "10ABC123" + GS1.GS + "17250101")    // raw with GS

val id = AAMVA.parse(pdf417Text)!!   // AAMVA.parse(text, today = CalendarDate(2025, 6, 1)) in tests
id.fullName; id.dateOfBirth; id.expiryDate; id.age; id.isExpired; id.isUnder21; id.fields["DAQ"]
```

Content types: `url`, `gs1-digital-link`, `email` (`mailto:`, `MATMSG:`), `phone`, `sms`
(`sms:`, `smsto:`), `wifi` (backslash escapes), `geo`, `contact` (vCard 2.1/3.0/4.0, MECARD),
`event` (VEVENT), `payment` (EPC "BCD", `bitcoin:`, `ethereum:`, `upi://pay`, other crypto),
`product` (GTIN check digit), `gs1`, `aamva`, `text`.

GS1 covers the AIs listed in SPEC and more (00–03, 10–22, 235, 240–243, 250–255, 30, all
310n–369n, 37, 390n–395n, 400–403, 410–417, 420–427, 4300–4326, 7001–7259, 8001–8200, 90–99),
with fixed/variable lengths, HRI input, GS input with `]C1`/`]d2`/`]Q3`/`]e0`/`]J1` prefixes,
Digital Link URLs on any domain, dates as ISO (day `00` = last day of month, GS1 century rule)
and `number` for decimal AIs. AAMVA handles versions 1–10, wrong subfile offsets, legacy
`DAA` names, `MMDDCCYY` (USA) vs `CCYYMMDD` (Canada, version 1) dates.

Every model has `toMap()` / `toJson()` producing the SPEC JSON shapes (useful for bridges).

## Batch mode

```kotlin
scannerView.options = ScannerOptions(mode = ScannerOptions.Mode.BATCH)   // maxResults defaults to 20
scannerView
    .onTrack { tracked -> counter.text = "${tracked.size} in view" }     // every frame
    .onScan { newCodes -> inventory += newCodes.map { it.data } }        // new tracks only
```

`BarcodeTracker` matches detections across frames by symbology + data, then by box overlap
(absorbing misreads), gives each track a stable `id` with `firstSeen`, `lastSeen` and `count`,
and drops tracks unseen for 500 ms. `TrackedBarcode.toJson()` is `Barcode & { id, firstSeen,
lastSeen, count }`. Both `BarcodeTracker` and `DuplicateFilter` are plain Kotlin classes you
can use with any engine.

## Options

`ScannerOptions` (SPEC §4). Kotlin: named arguments / `copy`; Java: `ScannerOptions.builder()`;
bridges: `ScannerOptions.fromMap(map)`.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `symbologies` | `Set<Symbology>` | all | `Symbology.resolve("qr", "retail", ...)`; ids that Android cannot read are skipped (`QRGen.supportedSymbologies()`) |
| `mode` | `SINGLE` / `CONTINUOUS` / `BATCH` | `CONTINUOUS` | `SINGLE` pauses analysis after the first scan (`resume()` to scan again) |
| `duplicateFilter` | `Long` ms | `1000` | same symbology+data is not reported again within the window after a report; `0` = every frame, `-1` = once per session (`start()` begins a session) |
| `beep` | `Boolean` | `true` | short tone (skipped in silent/vibrate ringer mode) |
| `vibrate` | `Boolean` | `true` | haptic click |
| `camera` | `BACK` / `FRONT` | `BACK` | camera facing |
| `cameraId` | `String?` | `null` | a specific Camera2 id; overrides `camera` |
| `torch` | `Boolean` | `false` | flashlight |
| `viewfinder` | `FRAME` / `LINE` / `NONE` / `null` | `null` | `null` = `LINE` when every symbology is 1D, else `FRAME` |
| `scanArea` | `ScanArea(x, y, width, height)` 0..1 | full | region of interest, normalized to the visible preview; codes whose center is outside are ignored |
| `maxResults` | `Int?` | `null` | codes per frame; `null` = 1, or 20 in batch mode (closest to the scan area center win) |

Error codes delivered to `onError` (`QRGenException.code`): `camera-permission-denied`,
`camera-not-found`, `camera-in-use`, `engine-load-failed`, `unsupported`, `unknown`
(`insecure-context` exists for web parity and is never raised on Android).

## Supported symbologies

Reading (ML Kit, bundled model): `qr`, `data-matrix`, `aztec`, `pdf417`, `ean13`, `ean8`,
`upca`, `upce`, `isbn`, `code128`, `code39`, `code93`, `codabar`, `itf`, `itf14`. UPC-A vs
EAN-13, ISBN and ITF-14 are disambiguated according to what you requested
(`Symbology.refine`). GS1 payloads (GS1-128, GS1 DataMatrix, GS1 QR) are detected and reported
in HRI form with `isGS1 = true` and `contentType = gs1`.

Not readable on Android (skipped silently): `micro-qr`, `rmqr`, `micro-pdf417`, `maxicode`,
`databar*`, `code32`, `pzn`, `telepen`, `dx-film-edge`.

## Building and testing

```bash
cd packages/android
./gradlew :qrgen-core:test                 # JVM only, no Android SDK needed
ANDROID_HOME=/path/to/sdk ./gradlew build  # everything: tests, lint, AARs, sample APK
./gradlew :qrgen-android:assembleRelease
./gradlew :sample:installDebug
```

## Status

What was verified for this version (1.0.0), in a Linux container with JDK 21, Gradle 8.14.3
(wrapper), Kotlin 2.2.21, AGP 8.13.2, Android SDK platform 35 and build-tools 35.0.0:

- `qrgen-core`: compiled; **127 JUnit 5 tests pass** (`./gradlew :qrgen-core:test`). They cover
  the SPEC GS1 and AAMVA test vectors, all symbology aliases and groups, the content parser
  types, `DuplicateFilter` and `BarcodeTracker` behaviour, coordinate mapping, JSON shapes, and
  generator round trips for all 15 writable symbologies plus GS1-128 / GS1 DataMatrix / GS1 QR
  (encode with ZXing, decode the rendered matrix with ZXing's `MultiFormatReader`, compare).
- `qrgen-android`: compiled with `./gradlew :qrgen-android:assembleRelease`; Android lint passes
  (only notice: compileSdk 36 is available); 3 JVM unit tests for the ML Kit format mapping pass.
- `qrgen-compose`: compiled (`assembleRelease`) and lint passes.
- `sample`: `assembleDebug` and a minified (R8) `assembleRelease` build succeed.
- Publishing: `publishToMavenLocal` produces `dev.qrgen:qrgen-core|qrgen-android|qrgen-compose:1.0.0`
  (jar/aar, sources, POM with MIT license and SCM). The JitPack build was simulated locally with
  `JITPACK=true GROUP=com.github.Rockyljewell ARTIFACT=QR-GEN VERSION=1.0.0`, which publishes
  `com.github.Rockyljewell.QR-GEN:*:1.0.0` with matching inter-module dependencies.

Not verified: live camera scanning on a device or emulator (none was available in the build
environment), and a real JitPack build. The camera, overlay and ML Kit code paths are compiled
and lint-checked but have not been exercised at runtime yet.

Implementation note: ZXing 3.5.4's minimal Data Matrix encoder can corrupt GS1 symbols (it
omits the C40/Text unlatch before padding once FNC1 is prepended), so GS1 DataMatrix is
encoded by QRGen directly (FNC1 + ASCII/digit-pair codewords, ZXing for error correction and
placement). The round-trip test guards this.

## License

MIT, see [LICENSE](../../LICENSE).
