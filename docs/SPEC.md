# QRGen cross-platform specification

This is the contract every QRGen package follows (JavaScript, Python, iOS, Android,
React Native, Flutter, .NET). If you add a platform, match these names and shapes so
code, docs and agent skills stay interchangeable.

- Repository: `https://github.com/Rockyljewell/QR-GEN`
- Website / hosted assets: `https://rockyljewell.github.io/QR-GEN/`
- License: MIT

| Package | Registry name | Import |
| --- | --- | --- |
| JavaScript / TypeScript | `qrgen-sdk` (npm) | `import { ... } from "qrgen-sdk"` |
| Python | `qrgen-sdk` (PyPI) | `import qrgen_sdk` |
| iOS / macOS (Swift Package) | `QRGenKit` | `import QRGenKit` |
| Android (Kotlin) | `dev.qrgen:qrgen-android` | `import dev.qrgen.*` |
| React Native | `qrgen-react-native` (npm) | `import { QRGenScanner } from "qrgen-react-native"` |
| Flutter | `qrgen_flutter` (pub) | `import 'package:qrgen_flutter/qrgen_flutter.dart';` |
| .NET | `QRGen.Net` (NuGet) | `using QRGen;` |

## 1. Symbology ids

Every API accepts and returns these lowercase ids. Inputs are matched
case-insensitively after removing everything except `[a-z0-9]`, so `QRCode`,
`qr-code`, `QR` and `qr` all resolve to `qr`.

| id | Name | Aliases accepted | zxing-cpp formats | Apple Vision (`VNBarcodeSymbology`) | ML Kit (`Barcode.FORMAT_*`) |
| --- | --- | --- | --- | --- | --- |
| `qr` | QR Code | qrcode | QRCodeModel1, QRCodeModel2 | .qr | QR_CODE |
| `micro-qr` | Micro QR Code | microqrcode | MicroQRCode | .microQR | – |
| `rmqr` | rMQR Code | rmqrcode | RMQRCode | – | – |
| `data-matrix` | Data Matrix | datamatrix, dm | DataMatrix | .dataMatrix | DATA_MATRIX |
| `aztec` | Aztec | azteccode | AztecCode, AztecRune | .aztec | AZTEC |
| `pdf417` | PDF417 | compactpdf417 | PDF417, CompactPDF417 | .pdf417 | PDF417 |
| `micro-pdf417` | MicroPDF417 | micropdf417 | MicroPDF417 | .microPDF417 | – |
| `maxicode` | MaxiCode | | MaxiCode | – | – |
| `ean13` | EAN-13 | ean, jan, gtin13 | EAN13 | .ean13 | EAN_13 |
| `ean8` | EAN-8 | gtin8 | EAN8 | .ean8 | EAN_8 |
| `upca` | UPC-A | upc | UPCA | .ean13 (leading 0) | UPC_A |
| `upce` | UPC-E | | UPCE | .upce | UPC_E |
| `isbn` | ISBN | isbn13 | ISBN | .ean13 (978/979 prefix) | EAN_13 |
| `code128` | Code 128 | gs1128, ean128 | Code128 | .code128 | CODE_128 |
| `code39` | Code 39 | code3of9 | Code39, Code39Std, Code39Ext | .code39, .code39FullASCII | CODE_39 |
| `code93` | Code 93 | | Code93 | .code93 | CODE_93 |
| `codabar` | Codabar | nw7 | Codabar | .codabar | CODABAR |
| `itf` | Interleaved 2 of 5 | interleaved2of5, i2of5 | ITF | .itf14, .i2of5 | ITF |
| `itf14` | ITF-14 | | ITF14 | .itf14 | ITF |
| `databar` | GS1 DataBar | rss14, databaromni | DataBar, DataBarOmni, DataBarStk, DataBarStkOmni | .gs1DataBar | – |
| `databar-expanded` | GS1 DataBar Expanded | rssexpanded | DataBarExp, DataBarExpStk | .gs1DataBarExpanded | – |
| `databar-limited` | GS1 DataBar Limited | rsslimited | DataBarLtd | .gs1DataBarLimited | – |
| `code32` | Code 32 (Italian Pharmacode) | | Code32 | – | – |
| `pzn` | PZN | | PZN | – | – |
| `telepen` | Telepen | | Telepen, TelepenAlpha, TelepenNumeric | – | – |
| `dx-film-edge` | DX Film Edge | | DXFilmEdge | – | – |

Groups (accepted wherever a list of symbologies is accepted):

| group | expands to |
| --- | --- |
| `all` | every id above |
| `linear` / `1d` | ean13 ean8 upca upce isbn code128 code39 code93 codabar itf itf14 databar databar-expanded databar-limited code32 pzn telepen dx-film-edge |
| `matrix` / `2d` | qr micro-qr rmqr data-matrix aztec pdf417 micro-pdf417 maxicode |
| `retail` | ean13 ean8 upca upce isbn databar databar-expanded databar-limited |
| `industrial` | code128 code39 code93 codabar itf itf14 data-matrix |
| `gs1` | code128 data-matrix qr databar databar-expanded databar-limited |

The default symbology set, when none is given, is `all`. Platforms that cannot read
an id skip it silently and report what they support through `supportedSymbologies()`.

## 2. Barcode result

All platforms return this shape (JSON over bridges, native types elsewhere):

```jsonc
{
  "data": "https://example.com",      // decoded text (HRI form: GS1 as "(01)...(10)...")
  "symbology": "qr",                    // id from section 1
  "symbologyName": "QR Code",
  "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==", // base64 of raw payload bytes (may be "")
  "contentType": "text",                // text | binary | gs1 | iso15434 | mixed | unknown-eci
  "isGS1": false,
  "location": {                         // pixel coords in the source frame/image
    "topLeft": { "x": 10, "y": 10 },
    "topRight": { "x": 90, "y": 10 },
    "bottomRight": { "x": 90, "y": 90 },
    "bottomLeft": { "x": 10, "y": 90 }
  },
  "frameSize": { "width": 1280, "height": 720 },
  "orientation": 0,                     // degrees
  "ecLevel": "M",                       // error-correction level when known, else ""
  "symbologyIdentifier": "]Q1",         // AIM identifier when known
  "timestamp": 1735689600000            // ms since epoch
}
```

## 3. Parsers

Every SDK ships three pure parsers. They never throw; they return `null` (or
`{ type: "text" }`) when the input does not match.

### 3.1 `parseContent(data) -> ParsedContent`

`type` is one of:

| type | fields |
| --- | --- |
| `url` | `url` |
| `gs1-digital-link` | `url`, `gs1` (GS1 result below) |
| `email` | `to`, `subject?`, `body?` |
| `phone` | `number` |
| `sms` | `number`, `body?` |
| `wifi` | `ssid`, `password?`, `security` (`WPA`/`WEP`/`nopass`/…), `hidden` |
| `geo` | `latitude`, `longitude`, `altitude?`, `query?` |
| `contact` | `name?`, `organization?`, `title?`, `phones[]`, `emails[]`, `urls[]`, `address?`, `note?`, `format` (`vcard`/`mecard`) |
| `event` | `summary?`, `start?`, `end?`, `location?`, `description?` |
| `payment` | `scheme` (`epc`/`bitcoin`/`ethereum`/`upi`/`other`), `address?`, `name?`, `iban?`, `bic?`, `amount?` (number in JS/Swift/Kotlin; decimal string in Python/.NET to preserve precision), `currency?`, `reference?` |
| `product` | `gtin` (14-digit, zero padded), `kind` (`ean13`/`ean8`/`upca`/`upce`/`isbn`/`gtin14`), `checksumValid` |
| `gs1` | `gs1` (GS1 result below) |
| `aamva` | `aamva` (AAMVA result below) |
| `text` | `text` |

### 3.2 `parseGS1(data) -> { elements: [{ ai, title, description, value, date?, number?, iso?, checkDigitValid? }], values: { [ai]: value } } | null`

Accepts HRI form `(01)09501101530003(17)250101(10)ABC123`, raw form with ASCII
29 (GS) separators and an optional `]C1`/`]d2`/`]Q3`/`]e0` prefix, and GS1 Digital
Link URLs (`https://id.gs1.org/01/09501101530003/10/ABC123?17=250101`).
Dates (AIs 11, 13, 15, 16, 17) are also exposed as ISO `YYYY-MM-DD` on `element.date`
(day `00` means last day of month). Decimal AIs (310n–369n, 390n–395n) expose
`element.number`.

Test vector:

```
input:  (01)09501101530003(17)250101(10)ABC123
values: { "01": "09501101530003", "17": "250101", "10": "ABC123" }
titles: 01=GTIN, 17=USE BY or EXPIRY, 10=BATCH/LOT
date:   17 -> 2025-01-01
```

### 3.3 `parseAAMVA(data) -> AamvaResult | null`

Parses the PDF417 on the back of North American driver licenses and ID cards.

```jsonc
{
  "issuerId": "636014", "aamvaVersion": 10, "jurisdictionVersion": 0,
  "documentType": "DL",                 // DL | ID
  "firstName": "JANE", "middleName": "Q", "lastName": "SAMPLE", "suffix": "",
  "fullName": "JANE Q SAMPLE",
  "dateOfBirth": "1990-01-31", "issueDate": "2020-02-01", "expiryDate": "2028-01-31",
  "sex": "F",                           // M | F | X | ""
  "documentNumber": "D1234567",
  "street": "123 MAIN ST", "city": "SACRAMENTO", "state": "CA", "postalCode": "95814", "country": "USA",
  "eyeColor": "BRO", "height": "065 IN",
  "age": 35, "isExpired": false, "isUnder21": false,
  "fields": { "DAQ": "D1234567", "DCS": "SAMPLE", "...": "..." }
}
```

Dates: USA issuers encode `MMDDCCYY`, Canada `CCYYMMDD`; detect by `DCG` (country) or
by plausibility.

Test vector (fictional data; `\n` = LF, `\x1e` = RS, `\r` = CR):

```
@\n\x1e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r
```

expected: `firstName=JANE`, `lastName=SAMPLE`, `dateOfBirth=1990-01-31`,
`expiryDate=2028-01-31`, `sex=F`, `postalCode=95814`, `state=CA`.

## 4. Scanner options

Shared option names (camelCase in JS/Kotlin/Swift/Dart/C#, snake_case in Python):

| option | type | default | meaning |
| --- | --- | --- | --- |
| `symbologies` | string[] | `["all"]` | ids or groups from section 1 |
| `mode` | `single` \| `continuous` \| `batch` | `continuous` | `single` stops after the first scan; `batch` tracks many codes at once |
| `duplicateFilter` | ms | `1000` | ignore the same data+symbology within this window (`0` = report every frame, `-1` = report once per session) |
| `beep` | bool | `true` | play a short tone on scan |
| `vibrate` | bool | `true` | haptic feedback on scan |
| `camera` | `back` \| `front` \| device id | `back` | camera selection |
| `torch` | bool | `false` | flashlight |
| `viewfinder` | `frame` \| `line` \| `none` | `frame` (`line` for linear-only sets) | overlay style |
| `scanArea` | `{ x, y, width, height }` normalized 0..1 | full frame | region of interest |
| `maxResults` | int | `1` (`20` in batch) | codes per frame |

Events: `scan` (`{ barcodes: Barcode[] }`), `track` (batch only,
`{ tracked: TrackedBarcode[] }` where `TrackedBarcode = Barcode & { id, firstSeen, lastSeen, count }`;
`id` is stable for the lifetime of a track and is a number in JS/Swift/Kotlin and a string derived from
symbology + data in React Native, Flutter and Python; treat it as opaque),
`error` (`{ code, message }`), `ready`.

Error codes: `camera-permission-denied`, `camera-not-found`, `camera-in-use`,
`insecure-context`, `engine-load-failed`, `unsupported`, `bad-request` (invalid input such as an
unreadable image or data a symbology cannot encode), `unknown`.

## 5. Embed bridge (WebView platforms)

`https://rockyljewell.github.io/QR-GEN/embed/` is a full-screen hosted scanner for
any WebView (React Native, Flutter, .NET MAUI, Xamarin, Titanium, Cordova, Unity…).
Options come from the query string (section 4 names; lists comma-separated):

```
/embed/?symbologies=qr,ean13&mode=single&beep=1&vibrate=1&camera=back&viewfinder=frame
```

The page posts every event as a JSON **string** to every host channel it finds:

| host | channel |
| --- | --- |
| React Native (`react-native-webview`) | `window.ReactNativeWebView.postMessage(json)` |
| Flutter (`webview_flutter` JavaScriptChannel) | `window.QRGenBridge.postMessage(json)` |
| iOS WKWebView | `window.webkit.messageHandlers.qrgen.postMessage(json)` |
| Windows WebView2 / .NET MAUI | `window.chrome.webview.postMessage(json)` |
| Android `addJavascriptInterface` | `window.QRGenAndroid.postMessage(json)` |
| iframe / popup | `window.parent.postMessage(object, "*")` / `window.opener.postMessage(object, "*")` |

Message envelope:

```jsonc
{ "source": "qrgen", "version": 1, "type": "scan", "barcodes": [ /* section 2 */ ] }
{ "source": "qrgen", "version": 1, "type": "ready" }
{ "source": "qrgen", "version": 1, "type": "error", "code": "camera-permission-denied", "message": "…" }
{ "source": "qrgen", "version": 1, "type": "track", "tracked": [ /* batch */ ] }
```

Host → page commands: call `window.qrgen.command({ "type": "start" | "stop" | "pause" | "resume" | "torch", "value"?: true })`
through the WebView's JavaScript-evaluation API, or `postMessage({ source: "qrgen-host", ...command })`
into the page.

## 6. REST API (`qrgen serve`, Docker image)

Any language can use QRGen over HTTP. CORS is enabled for all origins.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/health` | | `{ "ok": true, "version": "…" }` |
| GET | `/v1/symbologies` | | `{ "read": [...], "write": [...] }` |
| POST | `/v1/scan` | raw image bytes (`image/png`, `image/jpeg`, …), or JSON `{ "image": "<base64 or data URL>", "symbologies": [...], "tryHarder": true }`; `?symbologies=qr,ean13` | `{ "barcodes": [ /* section 2, plus "parsed" */ ] }` |
| POST | `/v1/generate` | JSON `{ "data": "...", "symbology": "qr", "format": "svg" \| "png", "scale": 4, "ecLevel": "M", "gs1": false, "hrt": false, "margin": true }` | image bytes |
| GET | `/v1/generate` | same fields as query string | image bytes |
| POST | `/v1/parse` | JSON `{ "data": "..." }` | `ParsedContent` |

Errors: `{ "error": { "code": "bad-request", "message": "…" } }` with HTTP 4xx/5xx.

## 7. Generator

`generate(data, { symbology = "qr", format = "svg" | "png", scale, ecLevel, gs1, hrt, margin, foreground, background })`
returns an SVG string or PNG bytes. Writable ids: qr, micro-qr, rmqr, data-matrix,
aztec, pdf417, micro-pdf417, maxicode, ean13, ean8, upca, upce, isbn, code128, code39,
code93, codabar, itf, itf14, databar, databar-expanded, databar-limited, code32, pzn,
telepen, dx-film-edge (platform support varies; native iOS generates qr, pdf417,
aztec, code128 and delegates the rest to the REST API).
