---
title: Symbologies
description: "All 26 barcode symbologies QRGen reads and writes, with ids, aliases, groups, and per-platform support for the web, Node.js, Python, iOS (Apple Vision) and Android (ML Kit)."
group: Reference
order: 2
---

QRGen identifies barcode types with the same lowercase ids on every platform. Use them in `symbologies` options, in `generate({ symbology })`, and to read `barcode.symbology` in results.

## Matching rules

Inputs are matched case-insensitively after removing everything except letters and digits, so `QRCode`, `qr-code`, `QR` and `qr` all resolve to `qr`. Display names (`EAN-13`, `Data Matrix`) and the aliases below work too. Unknown names are ignored.

Where a list is expected, you can pass an array or a string separated by commas, spaces, semicolons or pipes, and mix ids with [groups](#groups):

```js
import { resolveSymbologies, toSymbology } from "qrgen-sdk";

resolveSymbologies("retail, qr");  // ["ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited", "qr"]
toSymbology("GS1-128");            // "code128"
toSymbology("Interleaved 2 of 5"); // "itf"
```

## All symbologies

| id | Name | Type | Aliases | Read | Write | Apple Vision | ML Kit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `qr` | QR Code | 2D | `qrcode` | Yes | Yes | Yes | Yes |
| `micro-qr` | Micro QR Code | 2D | `microqrcode` | Yes | Yes | Yes | No |
| `rmqr` | rMQR Code | 2D | `rmqrcode` | Yes | Yes | No | No |
| `data-matrix` | Data Matrix | 2D | `datamatrix`, `dm` | Yes | Yes | Yes | Yes |
| `aztec` | Aztec | 2D | `azteccode`, `aztecrune` | Yes | Yes | Yes | Yes |
| `pdf417` | PDF417 | 2D | `compactpdf417`, `pdf` | Yes | Yes | Yes | Yes |
| `micro-pdf417` | MicroPDF417 | 2D | `micropdf417`, `micropdf` | Yes | Yes | Yes | No |
| `maxicode` | MaxiCode | 2D | | Yes | Yes | No | No |
| `ean13` | EAN-13 | Linear | `ean`, `jan`, `gtin13` | Yes | Yes | Yes | Yes |
| `ean8` | EAN-8 | Linear | `gtin8` | Yes | Yes | Yes | Yes |
| `upca` | UPC-A | Linear | `upc`, `gtin12` | Yes | Yes | Yes (as EAN-13 with a leading 0) | Yes |
| `upce` | UPC-E | Linear | | Yes | Yes | Yes | Yes |
| `isbn` | ISBN | Linear | `isbn13`, `bookland` | Yes | Yes | Yes (as EAN-13 with a 978/979 prefix) | Yes (as EAN-13) |
| `code128` | Code 128 | Linear | `gs1128`, `ean128`, `ucc128` | Yes | Yes | Yes | Yes |
| `code39` | Code 39 | Linear | `code3of9`, `code39std`, `code39ext`, `code39extended` | Yes | Yes | Yes | Yes |
| `code93` | Code 93 | Linear | | Yes | Yes | Yes | Yes |
| `codabar` | Codabar | Linear | `nw7`, `code2of7` | Yes | Yes | Yes | Yes |
| `itf` | Interleaved 2 of 5 | Linear | `interleaved2of5`, `i2of5`, `i25` | Yes | Yes | Yes | Yes |
| `itf14` | ITF-14 | Linear | `gtin14` | Yes | Yes | Yes | Yes (as ITF) |
| `databar` | GS1 DataBar | Linear | `rss14`, `databaromni`, `gs1databar`, `rss` | Yes | Yes | Yes | No |
| `databar-expanded` | GS1 DataBar Expanded | Linear | `rssexpanded`, `databarexp`, `gs1databarexpanded` | Yes | Yes | Yes | No |
| `databar-limited` | GS1 DataBar Limited | Linear | `rsslimited`, `databarltd`, `gs1databarlimited` | Yes | Yes | Yes | No |
| `code32` | Code 32 (Italian Pharmacode) | Linear | `italianpharmacode`, `pharmacode32` | Yes | Yes | No | No |
| `pzn` | PZN (Pharmazentralnummer) | Linear | `pharmazentralnummer` | Yes | Yes | No | No |
| `telepen` | Telepen | Linear | `telepenalpha`, `telepennumeric` | Yes | Yes | No | No |
| `dx-film-edge` | DX Film Edge | Linear | `dxfilmedge` | Yes | Yes | No | No |

**Read** and **Write** refer to the JavaScript SDK (web and Node.js), which reads and writes all 26. The Apple Vision and ML Kit columns show which ids the native [iOS](../ios/) and [Android](../android/) scanners can read; see [platform support](#platform-support).

In results, `symbologyName` holds the display name and `symbologyIdentifier` the AIM identifier when the engine reports one (for example `]Q1` for QR, `]C1` for GS1-128, `]E0` for EAN-13).

## Groups

| Group | Expands to |
| --- | --- |
| `all` (also `any`, `everything`) | Every symbology. The default when none is given. |
| `linear` or `1d` | `ean13` `ean8` `upca` `upce` `isbn` `code128` `code39` `code93` `codabar` `itf` `itf14` `databar` `databar-expanded` `databar-limited` `code32` `pzn` `telepen` `dx-film-edge` |
| `matrix` or `2d` | `qr` `micro-qr` `rmqr` `data-matrix` `aztec` `pdf417` `micro-pdf417` `maxicode` |
| `retail` | `ean13` `ean8` `upca` `upce` `isbn` `databar` `databar-expanded` `databar-limited` |
| `industrial` | `code128` `code39` `code93` `codabar` `itf` `itf14` `data-matrix` |
| `gs1` | `code128` `data-matrix` `qr` `databar` `databar-expanded` `databar-limited` |

Groups work wherever a list of symbologies is accepted (scanner options, `scanImage`, the element's `symbologies` attribute, the CLI's `--symbologies`, the REST API). They are not accepted by `generate()`, which needs exactly one symbology.

`SYMBOLOGY_GROUPS` exports this table, and `resolveSymbologies()` expands groups in code.

## Related symbologies

Some symbologies are subsets of others:

- A **UPC-A** is an EAN-13 whose first digit is `0`. An **ISBN** barcode is an EAN-13 that starts with `978` or `979`. **ITF-14** is a 14-digit Interleaved 2 of 5.
- **UPC-A** codes are reported as `upca` with 12 digits whenever `upca` is enabled. If you enable `ean13` without `upca`, they are reported as `ean13` with 13 digits (`0036000291452`).
- **ISBN** and **ITF-14** codes are reported with the parent id (`ean13`, `itf`) when the parent is enabled too, which includes the default `all` and the `retail` and `industrial` groups. Enable `isbn` without `ean13`, or `itf14` without `itf`, to get the specific id.
- Whatever id you get, `parseContent(data, { symbology })` returns the same 14-digit `gtin`, so use that for product lookups. For books, `parseContent` reports `kind: "isbn"` for 13-digit data starting with 978 or 979.

## Platform support

| Platform | Engine | Reads | Writes |
| --- | --- | --- | --- |
| Web (`qrgen-sdk`) | zxing-cpp (WebAssembly) | All 26 | All 26 |
| Node.js (`qrgen-sdk/node`), CLI, REST API | zxing-cpp (WebAssembly) | All 26 | All 26 |
| Python (`qrgen-sdk` on PyPI) | zxing-cpp | All 26 | All 26 |
| iOS and macOS (`QRGenKit`) | Apple Vision | The subset in the Apple Vision column | `qr`, `pdf417`, `aztec`, `code128`; others through the REST API |
| Android (`dev.qrgen:qrgen-android`) | Google ML Kit | The subset in the ML Kit column | See the [Android guide](../android/) |
| WebView platforms (embed page) | zxing-cpp (WebAssembly) | All 26 | Not applicable (scanning only) |

React Native, Flutter and .NET depend on the back end they use; see the [React Native](../react-native/), [Flutter](../flutter/) and [.NET](../dotnet/) guides. Platforms skip ids they can't read, without an error, and report what they support at runtime:

```js
import QRGen from "qrgen-sdk";

QRGen.supportedSymbologies(); // { read: [...26 ids], write: [...26 ids] }
```

The CLI prints the same table with `qrgen symbologies`, and the REST API returns it from `GET /v1/symbologies`.

## Choosing symbologies

Enabling fewer symbologies makes scanning faster and reduces false reads. Recommended sets for common use cases are in [Barcode scanning](../barcode-scanning/#choose-symbologies).
