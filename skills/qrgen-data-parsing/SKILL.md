---
name: qrgen-data-parsing
description: Parse the text of scanned barcodes with QRGen's parsers. Detect URLs, Wi-Fi credentials, vCard/MECARD contacts, calendar events, email/SMS/phone, geo locations, payments (SEPA EPC, bitcoin, UPI), product GTINs with check digits, GS1 Application Identifiers (GTIN, expiry, lot, serial, weights, SSCC) including GS1 Digital Link URLs, and AAMVA driver license PDF417 data. Use when the user needs structured data, expiry dates, lot numbers, age checks or validation from scan results.
---

# Parsing scan results

All QRGen SDKs ship the same three pure parsers. They never throw. They return `null`, or
`{ type: "text" }` for content parsing.

```ts
import { parseContent, parseGS1, parseAAMVA } from "qrgen-sdk/parsers"; // no DOM, works in Node/React Native
```

Python: `qrgen_sdk.parse_content / parse_gs1 / parse_aamva`. Swift: `QRGen.parseContent / parseGS1 / parseAAMVA`.
Kotlin: `ContentParser.parse`, `GS1.parse`, `AAMVA.parse`. REST: `POST /v1/parse { "data": "…" }`.

## parseContent(data, { symbology? })

Pass the symbology when you have it (it disambiguates numeric data such as UPC-E):

```ts
scanner.addEventListener("scan", (e) => {
  const b = e.detail.barcode;
  const content = parseContent(b.data, { symbology: b.symbology });
  switch (content.type) {
    case "url": return openUrl(content.url);              // validate/allow-list before opening
    case "wifi": return join(content.ssid, content.password, content.security);
    case "product": return lookup(content.gtin);           // 14-digit GTIN, content.checksumValid
    case "gs1": return receive(content.gs1.values["01"], content.gs1.values["10"]);
    case "aamva": return verifyAge(content.aamva);
    default: return showText(b.data);
  }
});
```

| type | fields |
| --- | --- |
| `url` | `url` |
| `gs1-digital-link` | `url`, `gs1` |
| `email` | `to`, `subject?`, `body?` |
| `phone` | `number` |
| `sms` | `number`, `body?` |
| `wifi` | `ssid`, `password?`, `security`, `hidden` |
| `geo` | `latitude`, `longitude`, `altitude?`, `query?` |
| `contact` | `format` (`vcard`/`mecard`), `name?`, `organization?`, `title?`, `phones[]`, `emails[]`, `urls[]`, `address?`, `note?` |
| `event` | `summary?`, `start?`, `end?`, `location?`, `description?` |
| `payment` | `scheme` (`epc`/`bitcoin`/`ethereum`/`upi`/`other`), `address?`, `name?`, `iban?`, `bic?`, `amount?`, `currency?`, `reference?` |
| `product` | `gtin`, `kind` (`ean13`/`ean8`/`upca`/`upce`/`isbn`/`gtin14`), `checksumValid` |
| `gs1` | `gs1` (see below) |
| `aamva` | `aamva` (see below) |
| `text` | `text` |

Treat scanned URLs as untrusted input: show the domain before opening and never auto-execute.

## parseGS1(data)

Accepts HRI (`(01)09501101530003(17)250101(10)ABC123`), raw strings with ASCII 29 separators and
symbology prefixes (`]C1`, `]d2`, `]Q3`, `]e0`), and GS1 Digital Link URLs.

```ts
const gs1 = parseGS1("(01)09501101530003(17)250101(10)ABC123(3103)001250")!;
gs1.values["01"];                               // "09501101530003"
gs1.elements.find((e) => e.ai === "17")!.date;  // "2025-01-01" (day 00 = last day of month)
gs1.elements.find((e) => e.ai === "3103")!.number; // 1.25 (kg, decimals from the AI)
gs1.elements[0].checkDigitValid;                // true for GTIN/SSCC/GLN with valid mod-10
```

Each element has `ai`, `title` (GS1 data title such as `BATCH/LOT`), `description`, `value`, and when
relevant `date`, `number`, `iso` (currency/country) and `checkDigitValid`. Helpers: `formatGS1`,
`isValidCheckDigit`, `computeCheckDigit`, `gs1Date`, `GS1_AIS` (the AI table).

Scanners return GS1 barcodes (GS1-128, GS1 Data Matrix, GS1 QR, DataBar) with `barcode.isGS1 === true`
and `data` already in HRI form.

## parseAAMVA(data, { now? })

For the PDF417 on North American driver licenses. See the `qrgen-id-scanning` skill for a full flow.

```ts
const id = parseAAMVA(barcode.data);
if (id) console.log(id.fullName, id.dateOfBirth, id.age, id.isUnder21, id.expiryDate, id.isExpired, id.state);
```

Fields: `firstName`, `middleName`, `lastName`, `suffix`, `fullName`, `dateOfBirth`, `issueDate`,
`expiryDate` (ISO), `sex` (`M`/`F`/`X`), `documentNumber`, `documentDiscriminator`, `street`, `street2`,
`city`, `state`, `postalCode`, `country`, `eyeColor`, `hairColor`, `height`, `weight`, `vehicleClass`,
`restrictions`, `endorsements`, `age`, `isExpired`, `isUnder21`, `isUnder18`, `issuerId`,
`aamvaVersion`, `documentType` (`DL`/`ID`), `fields` (raw element map).
