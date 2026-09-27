---
title: Barcode generation
description: "Generate QR codes and 25 other barcode types as SVG, PNG or data URLs with generate(), <qrgen-barcode>, the CLI and the REST API, including GS1 data."
group: Features
order: 5
---

QRGen generates all 26 supported symbologies, from QR codes and Data Matrix to EAN-13 and GS1-128. Output is a clean SVG (scalable, ideal for print and the web), a PNG, a module matrix or a text rendering. Generation runs locally in the browser or in Node.js; the generator engine (`zxing_writer.wasm`, about 340 KB gzipped) is only downloaded the first time you generate.

## generate()

```js
import { generate } from "qrgen-sdk";

const result = await generate("https://example.com", { symbology: "qr", ecLevel: "M", scale: 6 });

document.querySelector("#code").innerHTML = result.svg;
```

`generate(data, options?)` resolves with:

| Field | Type | Description |
| --- | --- | --- |
| `svg` | `string` | Standalone SVG markup with `width`, `height` and a `viewBox`, no XML declaration. |
| `png` | `Blob \| null` | PNG image, with colors applied (in Node.js when you import from `qrgen-sdk/node`). |
| `matrix` | `{ width, height, modules }` | The symbol's module grid. `modules[y * width + x]` is `1` for dark and `0` for light. |
| `text` | `string` | A text rendering with block characters, for terminals. |
| `symbology`, `data` | `string` | What was encoded. |

Shortcuts:

```js
import { generateSVG, generateDataURL } from "qrgen-sdk";

const svg = await generateSVG("hello");                    // just the SVG string
const src = await generateDataURL("hello", { scale: 8 });  // "data:image/svg+xml;charset=utf-8,..."
document.querySelector("img").src = src;
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `symbology` | `"qr"` | Symbology id or alias. Groups like `retail` are not accepted here. |
| `scale` | `4` | Module size in pixels (the width of the narrowest bar or one QR square). |
| `ecLevel` | encoder's choice | Error correction: `"L"`, `"M"`, `"Q"`, `"H"` for QR and Micro QR, or a percentage for Aztec and PDF417. |
| `gs1` | `false` | Encode as GS1. Pass the data in HRI form: `(01)09501101530003(10)ABC123`. |
| `hrt` | `false` | Print human-readable text under linear barcodes. |
| `margin` | `true` | Add the quiet zone (the blank border scanners need). |
| `foreground` | `"#000000"` | Bar and module color. |
| `background` | `"#ffffff"` | Background color, or `"transparent"`. |
| `rotate` | `0` | `0`, `90`, `180` or `270`. |
| `version` | automatic | Symbol size for 2D codes, for example QR version 1 to 40. |
| `extraOptions` | | Additional encoder options as a comma-separated string, passed through to the engine. |

Errors reject with a `QRGenError`: `bad-request` for an unknown symbology, empty data, or data the symbology can't encode (the message says why, for example `Cannot encode as EAN-13: Invalid check digit '8', expecting '7'`), and `engine-load-failed` if the generator wasm can't be loaded.

## SVG, PNG and downloads

SVG is the best format for screens and print: it stays sharp at any size. Set its size with CSS; the `viewBox` keeps the aspect ratio:

```js
const { svg } = await generate("https://example.com");
const box = document.querySelector("#qr");
box.innerHTML = svg;
box.querySelector("svg").style.width = "200px";
box.querySelector("svg").style.height = "auto";
```

Download buttons:

```js
import { generate } from "qrgen-sdk";

async function download(data, filename) {
  const { svg, png } = await generate(data, { scale: 10 });
  const blob = filename.endsWith(".png") && png ? png : new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

download("https://example.com", "qr.png");
```

For PNGs, choose `scale` for the pixel size you need: the PNG is exactly `modules x scale` pixels (plus the quiet zone). Don't resize PNGs of barcodes with smoothing; it blurs the edges.

## Colors and transparency

```js
const { svg } = await generate("https://example.com", { foreground: "#1d3557", background: "transparent" });
```

Keep strong contrast: dark bars on a light background. Most scanners can't read light-on-dark codes by default (QRGen's scanner does, but your users' apps may not), and low-contrast color pairs such as red on blue fail on many devices. With `background: "transparent"`, make sure whatever is behind the code is light.

In Node.js, import from `qrgen-sdk/node` (or use the CLI or REST API) and PNG output gets the same colors and transparency as the SVG.

## GS1 data

GS1 barcodes carry application identifiers (AIs) such as GTIN `(01)`, expiry date `(17)` and batch `(10)`. Pass the data in human-readable form and set `gs1: true`:

```js
import { generate, isValidCheckDigit } from "qrgen-sdk";

const gtin = "09501101530003";
if (!isValidCheckDigit(gtin)) throw new Error("Bad GTIN check digit");

const label = await generate(`(01)${gtin}(17)250101(10)ABC123`, { symbology: "code128", gs1: true, hrt: true });  // GS1-128
const pack = await generate(`(01)${gtin}(17)250101(10)ABC123(21)SN42`, { symbology: "data-matrix", gs1: true }); // GS1 DataMatrix
```

GS1 works with `code128`, `data-matrix` and `qr`. The GS1 DataBar family (`databar`, `databar-expanded`, `databar-limited`) always carries GS1 data, so `gs1: true` is optional there; pass the data in HRI form too, for example `(01)09521234543213(3103)000123` for DataBar Expanded.

The generator checks the element string's syntax but not every check digit, so validate GTINs with `isValidCheckDigit()` (or compute one with `computeCheckDigit()`) before printing. When scanned, GS1 codes come back with `isGS1: true` and `data` in the same HRI form, ready for [`parseGS1()`](../parsers/#parsegs1).

For GS1 Digital Link, encode the URL in a regular QR code: `generate("https://id.gs1.org/01/09501101530003/10/ABC123")`.

## What each symbology accepts

| Symbology | Data |
| --- | --- |
| `qr` | Any text (UTF-8), up to about 2,900 bytes at level L. |
| `micro-qr`, `rmqr` | Short text: up to 35 digits or about 20 characters for Micro QR; rMQR holds a bit more in a rectangle. |
| `data-matrix`, `aztec` | Any text. Data Matrix supports GS1. |
| `pdf417`, `micro-pdf417` | Any text. |
| `maxicode` | Up to about 90 characters. |
| `ean13` | 12 digits (the check digit is added) or 13 digits (the check digit is verified). |
| `ean8` | 7 or 8 digits. |
| `upca` | 11 or 12 digits. |
| `upce` | 7 or 8 digits, starting with number system `0` or `1`. |
| `isbn` | An ISBN-10 or ISBN-13 (9, 10 or 13 characters). |
| `code128` | Any text; GS1-128 with `gs1: true`. |
| `code39` | `A-Z`, `0-9`, space and `- . $ / + %` (lowercase is uppercased). |
| `code93` | ASCII text. |
| `codabar` | Digits and `- $ : / . +`, starting and ending with `A`, `B`, `C` or `D`. |
| `itf` | Digits; an odd count is padded with a leading zero. |
| `itf14` | 13 digits (check digit added) or 14 digits. |
| `databar`, `databar-limited` | A GTIN, optionally as `(01)...`. DataBar Limited needs a GTIN starting with 0 or 1. |
| `databar-expanded` | A GS1 element string in HRI form. |
| `code32` | 8 digits (the check digit is added). |
| `pzn` | 6 or 7 digits (the check digit is added). |
| `telepen` | ASCII text. |
| `dx-film-edge` | A DX number such as `77-4`, or up to four digits. |

Some symbologies transform the data: a scanned Code 32 is reported with its `A` prefix, a PZN with its `-` prefix and check digit, and a 13-digit ITF-14 with its computed check digit.

## Human-readable text

`hrt: true` prints the encoded value under linear barcodes, formatted the way the symbology expects (for EAN-13, the leading digit outside the bars). 2D codes ignore it. The text uses the OCR-B font when installed and falls back to monospace.

## The `<qrgen-barcode>` element

For UI, the [`<qrgen-barcode>` element](../web-components/#qrgen-barcode) renders and re-renders a barcode from attributes:

```html
<script type="module">
  import "qrgen-sdk/elements";
</script>

<qrgen-barcode value="https://example.com/tickets/8841" symbology="qr" ec-level="Q" style="width: 180px"></qrgen-barcode>
<qrgen-barcode value="5901234123457" symbology="ean13" hrt style="width: 240px"></qrgen-barcode>
```

React and Vue have `QRGenBarcode` components with the same options; see [React](../react/#qrgenbarcode) and [Vue](../vue/#qrgenbarcode).

## CLI and REST API

```bash
qrgen generate "https://example.com" -o qr.svg --ec M
qrgen generate "(01)09501101530003(10)ABC123" -t code128 --gs1 --hrt -o label.png --scale 3
```

```bash
curl -o qr.png "http://localhost:8080/v1/generate?data=https%3A%2F%2Fexample.com&format=png&scale=8"
```

See [CLI](../cli/#generate) and [REST API](../rest-api/#generate).

## Printing tips

- **Keep the quiet zone.** Leave `margin` on, and don't place text or borders right up to the code. Linear codes need about 10 modules of blank space on each side; QR codes 4 modules.
- **Print at whole modules.** For raster output, pick `scale` so one module is a whole number of printer dots. At 300 DPI, `scale: 4` gives modules of about 0.34 mm; at 203 DPI (common thermal label printers), `scale: 3` gives about 0.38 mm. Prefer SVG when your print pipeline supports it.
- **Minimum sizes.** Retail EAN-13 and UPC-A are nominally about 37 x 26 mm (0.33 mm modules) and shouldn't be printed below 80% of that. For QR codes read by phones, aim for at least 2 cm across for short URLs; more data or longer reading distance needs a larger code.
- **Error correction.** Level `M` suits most QR codes. Use `Q` or `H` for codes that may get scratched, dirty or partially covered, at the cost of a denser symbol.
- **Shorter data scans better.** A short URL makes a QR code with fewer, larger modules. Use a URL shortener or short paths for printed codes.
- **Test the output.** Scan the printed result with the devices your users have, in their lighting. You can also verify files in CI: `qrgen scan label.png` exits with code 2 if nothing is found.
