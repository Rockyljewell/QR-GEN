---
title: Parsers
description: "Turn scanned text into structured data with parseContent (URLs, Wi-Fi, contacts, events, payments, product codes, GS1, driver licenses), parseGS1 and parseAAMVA."
group: Features
order: 6
---

A barcode's `data` is just text. QRGen's parsers tell you what it means: a URL, Wi-Fi credentials, a contact card, a product GTIN, a GS1 element string with expiry date and batch, or a driver license. They are pure functions: no engine, no network, no DOM. They never throw; when the input doesn't match, they return `{ type: "text" }` or `null`.

```js
import { parseContent, parseGS1, parseAAMVA } from "qrgen-sdk";
```

If you only need the parsers (for example on a server that receives scan results), import them from `qrgen-sdk/parsers`, which doesn't include the scanning engine. The same parsers, with the same output shapes, exist in every QRGen SDK.

## parseContent

`parseContent(data, options?)` detects the kind of content and returns an object with a `type` field:

```js
parseContent("WIFI:T:WPA;S:Office;P:correct horse;;");
// { type: "wifi", ssid: "Office", password: "correct horse", security: "WPA", hidden: false }
```

| `type` | Fields | Recognized input |
| --- | --- | --- |
| `url` | `url` | `http://` and `https://` URLs; `www.` hosts get `https://` prepended |
| `gs1-digital-link` | `url`, `gs1` | URLs with a GS1 primary key path such as `/01/<GTIN>` |
| `email` | `to`, `subject?`, `body?` | `mailto:`, `MATMSG:`, bare addresses |
| `phone` | `number` | `tel:`, or a bare number starting with `+` |
| `sms` | `number`, `body?` | `SMSTO:`, `sms:`, `mmsto:` |
| `wifi` | `ssid`, `password?`, `security`, `hidden` | `WIFI:` (with backslash escapes) |
| `geo` | `latitude`, `longitude`, `altitude?`, `query?` | `geo:` URIs |
| `contact` | `format`, `name?`, `organization?`, `title?`, `phones`, `emails`, `urls`, `address?`, `note?` | vCard (`BEGIN:VCARD`) and `MECARD:` |
| `event` | `summary?`, `start?`, `end?`, `location?`, `description?` | iCalendar `BEGIN:VEVENT` or `BEGIN:VCALENDAR` |
| `payment` | `scheme`, `address?`, `name?`, `iban?`, `bic?`, `amount?`, `currency?`, `reference?` | EPC/SEPA (`BCD`), `bitcoin:`, `ethereum:`, other coin URIs, `upi://pay` |
| `product` | `gtin`, `kind`, `checksumValid` | 8, 12, 13 and 14 digit product codes |
| `gs1` | `gs1` | GS1 element strings (HRI or raw) |
| `aamva` | `aamva` | North American driver license and ID card data |
| `text` | `text` | Anything else |

### Options

| Option | Description |
| --- | --- |
| `symbology` | The symbology the data came from. Pass `barcode.symbology`: it lets the parser read 8 digits from a UPC-E as UPC-E, and stops it from treating digits inside a QR code as a product number. |
| `now` | Reference `Date` for the age and expiry fields of `aamva` results. |

```js
scanner.addEventListener("scan", ({ detail: { barcode } }) => {
  const content = parseContent(barcode.data, { symbology: barcode.symbology });
});
```

In TypeScript, `ParsedContent` is a discriminated union, so checking `type` narrows the fields:

```ts
import { parseContent, type ParsedContent } from "qrgen-sdk";

function describe(content: ParsedContent): string {
  switch (content.type) {
    case "url":
      return `Link to ${new URL(content.url).hostname}`;
    case "wifi":
      return `Wi-Fi network ${content.ssid}`;
    case "product":
      return `Product ${content.gtin}${content.checksumValid ? "" : " (bad check digit)"}`;
    default:
      return content.type;
  }
}
```

### Examples

**URLs and GS1 Digital Link**

```js
parseContent("https://example.com");
// { type: "url", url: "https://example.com" }

parseContent("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101");
// { type: "gs1-digital-link", url: "https://id.gs1.org/...", gs1: { values: { "01": "09501101530003", "10": "ABC123", "17": "250101" }, elements: [...] } }
```

**Email, phone and SMS**

```js
parseContent("mailto:hi@example.com?subject=Hello");
// { type: "email", to: "hi@example.com", subject: "Hello" }

parseContent("tel:+15551234567");
// { type: "phone", number: "+15551234567" }

parseContent("SMSTO:+15551234567:On my way");
// { type: "sms", number: "+15551234567", body: "On my way" }
```

**Wi-Fi**

```js
parseContent("WIFI:T:WPA;S:Office;P:correct horse;;");
// { type: "wifi", ssid: "Office", password: "correct horse", security: "WPA", hidden: false }

parseContent("WIFI:S:Guest;;");
// { type: "wifi", ssid: "Guest", security: "nopass", hidden: false }
```

**Location**

```js
parseContent("geo:40.7128,-74.0060?q=New%20York");
// { type: "geo", latitude: 40.7128, longitude: -74.006, query: "New York" }
```

**Contacts**

```js
parseContent("BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nORG:Example Inc.\nTEL:+15550100\nEMAIL:jane@example.com\nEND:VCARD");
// { type: "contact", format: "vcard", name: "Jane Doe", organization: "Example Inc.", phones: ["+15550100"], emails: ["jane@example.com"], urls: [] }

parseContent("MECARD:N:Doe,Jane;TEL:5550100;EMAIL:jane@example.com;;");
// { type: "contact", format: "mecard", name: "Jane Doe", phones: ["5550100"], emails: ["jane@example.com"], urls: [] }
```

**Calendar events**

```js
parseContent("BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261001T170000Z\nDTEND:20261001T180000Z\nLOCATION:Online\nEND:VEVENT");
// { type: "event", summary: "Launch", start: "2026-10-01T17:00:00Z", end: "2026-10-01T18:00:00Z", location: "Online" }
```

Dates are converted to ISO 8601; all-day dates become `YYYY-MM-DD`.

**Payments**

```js
parseContent("BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross\nBE72000000001616\nEUR12.30\n\n\nDonation");
// { type: "payment", scheme: "epc", bic: "BPOTBEB1", name: "Red Cross", iban: "BE72000000001616", currency: "EUR", amount: 12.3, reference: "Donation" }

parseContent("bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01&label=Tip");
// { type: "payment", scheme: "bitcoin", address: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", amount: 0.01, name: "Tip", currency: "BTC" }

parseContent("upi://pay?pa=shop@upi&pn=Shop&am=10");
// { type: "payment", scheme: "upi", address: "shop@upi", name: "Shop", amount: 10, currency: "INR" }
```

For `ethereum:` URIs, `amount` is the raw `value` parameter (in wei). Other coin schemes (`litecoin:`, `dogecoin:`, `bitcoincash:`) return `scheme: "other"`.

### Product codes

Numeric data of 8, 12, 13 or 14 digits is returned as a product with its GTIN padded to 14 digits and a check digit test:

```js
parseContent("5901234123457");
// { type: "product", kind: "ean13", gtin: "05901234123457", checksumValid: true }

parseContent("9780306406157");
// { type: "product", kind: "isbn", gtin: "09780306406157", checksumValid: true }

parseContent("036000291452", { symbology: "upca" });
// { type: "product", kind: "upca", gtin: "00036000291452", checksumValid: true }

parseContent("01234565", { symbology: "upce" });
// { type: "product", kind: "upce", gtin: "00012345000065", checksumValid: true }
```

`kind` is `ean13`, `ean8`, `upca`, `upce`, `isbn` (13 digits starting with 978 or 979) or `gtin14`. A UPC-E is expanded to its UPC-A form before padding, so the GTIN matches what your product database stores. Because every UPC-A is also a valid EAN-13 with a leading zero, both forms produce the same `gtin`: use `gtin` as your lookup key.

**GS1 and driver licenses**

```js
parseContent("(01)09501101530003(17)250101(10)ABC123");
// { type: "gs1", gs1: { values: { "01": "09501101530003", "17": "250101", "10": "ABC123" }, elements: [...] } }
```

AAMVA data returns `{ type: "aamva", aamva }` with the same object as `parseAAMVA()` below.

## parseGS1

`parseGS1(input)` parses GS1 element strings in three forms and returns `null` for anything else:

```js
import { parseGS1 } from "qrgen-sdk";

// 1. Human-readable (HRI) form, as QRGen scanners return GS1 data
parseGS1("(01)09501101530003(17)250101(10)ABC123");

// 2. Raw form with GS (ASCII 29) separators and an optional symbology prefix (]C1, ]d2, ]Q3, ]e0)
parseGS1("]C101095011015300031725010110ABC123\u001d21SN-42");

// 3. GS1 Digital Link URLs
parseGS1("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101");
```

The result:

```json
{
  "elements": [
    { "ai": "01", "title": "GTIN", "description": "Global Trade Item Number", "value": "09501101530003", "checkDigitValid": true },
    { "ai": "17", "title": "USE BY or EXPIRY", "description": "Expiration date", "value": "250101", "date": "2025-01-01" },
    { "ai": "10", "title": "BATCH/LOT", "description": "Batch or lot number", "value": "ABC123" }
  ],
  "values": { "01": "09501101530003", "17": "250101", "10": "ABC123" }
}
```

| Field | Description |
| --- | --- |
| `elements` | Every element in order: `ai`, `title` (the GS1 data title), `description`, `value`, plus the fields below when they apply. |
| `values` | AI to value map for quick lookups. The first occurrence wins. |
| `digitalLink` | The original URL, for Digital Link input. |

Per-element extras:

| Field | When | Example |
| --- | --- | --- |
| `date` | Date AIs 11, 12, 13, 15, 16, 17 (and 7250) | `"250101"` becomes `"2025-01-01"`. Day `00` means the last day of the month: `"261200"` becomes `"2026-12-31"`. Two-digit years use the GS1 sliding century rule. |
| `number` | Decimal AIs such as 310n to 369n (measures) and 390n to 395n (amounts) | `(3103)001250` is 1.250 kg, `number: 1.25`. The last AI digit is the number of decimals. |
| `iso` | AIs that start with an ISO currency or country code (391n, 393n, 421, ...) | `(3913)978550` is `iso: "978"` (EUR), `number: 0.55` |
| `checkDigitValid` | AIs with a mod-10 check digit (GTIN, SSCC, GLN, ...) | `true` or `false` |

```js
const gs1 = parseGS1("(01)09501101530003(3103)001250(3922)1999(15)261200");
const weight = gs1.elements.find((e) => e.ai === "3103").number; // 1.25
const price = gs1.elements.find((e) => e.ai === "3922").number;  // 19.99
const bestBefore = gs1.elements.find((e) => e.ai === "15").date; // "2026-12-31"
```

The AI table covers the identifiers used on products, logistics labels and healthcare packs. In HRI input, a parenthesized number that isn't a known AI is kept as part of the previous element's value. `GS1_AIS` exposes the table (`GS1_AIS["17"]` is `{ title: "USE BY or EXPIRY", fixed: 6, numeric: true, date: true, ... }`).

Raw numeric strings without a separator are ambiguous, so `parseGS1` only accepts them when they start with an AI of predefined length (such as `01` or `00`) or contain a separator. Plain numbers like `12345` return `null`.

### GS1 helpers

```js
import { computeCheckDigit, formatGS1, gs1Date, isValidCheckDigit, parseDigitalLink } from "qrgen-sdk";

isValidCheckDigit("09501101530003"); // true (works for GTIN-8/12/13/14, SSCC, GLN)
computeCheckDigit("0950110153000");  // 3
gs1Date("261200");                   // "2026-12-31"
formatGS1(parseGS1("https://id.gs1.org/01/9501101530003/10/ABC123")); // "(01)09501101530003(10)ABC123"
parseDigitalLink("https://example.com/01/09501101530003"); // Digital Link only; null for other input
```

In Digital Link URLs, GTINs shorter than 14 digits are zero padded, and both numeric AIs (`/01/`) and short names (`/gtin/`, `/lot/`, `/ser/`, `?exp=`) are understood.

## parseAAMVA

`parseAAMVA(data, options?)` parses the PDF417 on the back of US and Canadian driver licenses and ID cards:

```js
import { parseAAMVA } from "qrgen-sdk";

const id = parseAAMVA(licenseData);
if (id) console.log(id.fullName, id.dateOfBirth, id.expiryDate, id.isUnder21);
```

It returns `null` for other input. The full field list, age verification and privacy guidance are in [ID scanning](../id-scanning/#result-fields). `parseAamvaDate(value, canadian)` converts a single AAMVA date, and `AAMVA_FIELDS` maps element codes such as `DAQ` to labels.
