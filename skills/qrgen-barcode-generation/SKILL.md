---
name: qrgen-barcode-generation
description: Generate barcodes and QR codes with QRGen as SVG or PNG (QR, Micro QR, Data Matrix, Aztec, PDF417, MaxiCode, EAN-13/8, UPC-A/E, ISBN, Code 128, GS1-128, Code 39/93, Codabar, ITF/ITF-14, GS1 DataBar). Use for shipping labels, product labels, tickets, Wi-Fi or vCard QR codes, GS1 element strings, printing, or when the user asks to create, render or download a barcode in a web page, Node.js script, CLI, Python, Swift or a REST call.
---

# Generating barcodes with QRGen

## Pick the entry point

| Where | API |
| --- | --- |
| Browser / any bundler | `import { generate, generateSVG, generateDataURL } from "qrgen-sdk"` |
| HTML without JS | `<qrgen-barcode value="…" symbology="qr">` (import `qrgen-sdk/elements` or the CDN build) |
| React / Vue | `QRGenBarcode` from `qrgen-sdk/react` or `qrgen-sdk/vue` |
| Node.js | `import { generateToFile, generatePNG, generate } from "qrgen-sdk/node"` |
| Shell | `npx qrgen generate "<data>" -o out.svg` |
| Python | `qrgen_sdk.generate(data, symbology="qr", format="svg")` / `qrgen_sdk.save(data, "out.png")` |
| Swift | `QRGen.generate(_:symbology:)` (qr, pdf417, aztec, code128) |
| Anything else | `GET /v1/generate?data=…&symbology=qr&format=png` on the REST server |

## JavaScript

```ts
import { generate } from "qrgen-sdk";

const { svg, png, matrix, text } = await generate("https://example.com", {
  symbology: "qr",        // default "qr"
  ecLevel: "M",           // L | M | Q | H (QR); percentages for Aztec/PDF417
  scale: 4,               // pixels per module
  margin: true,           // quiet zone (keep it for printing)
  foreground: "#111111",
  background: "#ffffff",  // or "transparent"
});
container.innerHTML = svg;     // standalone <svg> with a viewBox, scales cleanly with CSS
// png: Blob (browser/Node). matrix: { width, height, modules } (1 = dark). text: terminal rendering.
```

Other options: `hrt` (human-readable text under linear codes), `gs1` (encode GS1), `rotate`
(0/90/180/270), `version` (QR version), `extraOptions` (raw zxing-cpp creator options, e.g. `"columns=6"`).

Errors are thrown as `QRGenError` with `code: "bad-request"` and a readable message, e.g. EAN-13 with
letters, or `"unsupported"` for non-writable symbologies. Validate user input and show the message.

## GS1 data

Pass the element string in HRI form and set `gs1: true`:

```ts
await generate("(01)09501101530003(17)271231(10)LOT4815", { symbology: "data-matrix", gs1: true });
await generate("(00)095011015300000018(420)10001", { symbology: "code128", gs1: true, hrt: true });
```

Use `computeCheckDigit("0950110153000")` from `qrgen-sdk/parsers` to complete GTINs and SSCCs.

## Common payloads (QR)

| Payload | Format |
| --- | --- |
| URL | `https://example.com/path` |
| Wi-Fi | `WIFI:T:WPA;S:<ssid>;P:<password>;;` (escape `;,:\` with `\`) |
| Contact | `BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane;;;\nFN:Jane Doe\nTEL:+15550100\nEMAIL:jane@example.com\nEND:VCARD` |
| Email | `mailto:a@example.com?subject=Hi&body=Hello` |
| Phone / SMS | `tel:+15550100`, `SMSTO:+15550100:Hello` |
| Location | `geo:37.7749,-122.4194` |
| SEPA payment (EPC) | `BCD\n002\n1\nSCT\n<BIC>\n<Name>\n<IBAN>\nEUR12.30\n\n\n<Reference>` |

## Printing guidance

- Keep the quiet zone (`margin: true`). Linear codes need about 10 modules on each side.
- Print at a whole number of printer dots per module. For 203 dpi label printers use `scale` 2–4.
- EAN/UPC: 0.33 mm module (100 % size) is nominal. Don't shrink below 80 %.
- High-contrast colors only: dark bars on a light background. Inverted codes scan less reliably.
- Prefer SVG for print pipelines and PDF generation. It is vector, with no resampling blur.

## Node / CLI / REST

```ts
import { generateToFile } from "qrgen-sdk/node";
await generateToFile("5901234123457", "ean.png", { symbology: "ean13", hrt: true, scale: 3 });
```

```bash
npx qrgen generate "5901234123457" --symbology ean13 --hrt -o ean.svg
curl "http://localhost:8080/v1/generate?data=5901234123457&symbology=ean13&format=png&hrt=true" -o ean.png
```

## Verify

Scan the output back in a test to prove it is valid:

```ts
import { generatePNG, scan } from "qrgen-sdk/node";
const [code] = await scan(await generatePNG("hello", { symbology: "qr" }));
assert.equal(code.data, "hello");
```
