---
title: ID scanning
description: "Read the PDF417 barcode on North American driver licenses and ID cards and parse it with parseAAMVA: fields, age verification, privacy guidance and limitations."
group: Features
order: 3
---

Driver licenses and state ID cards in the United States and Canada carry a PDF417 barcode on the back, encoded according to the AAMVA DL/ID Card Design Standard. It contains the holder's name, date of birth, address, document number, expiry date and physical description. QRGen scans the PDF417 and `parseAAMVA()` turns its contents into a structured object, entirely on the device.

Typical uses: age checks at a counter, pre-filling a form, visitor check-in.

## Scan a license

```html
<qrgen-scanner id="id-scanner" symbologies="pdf417" mode="single" viewfinder="line" resolution="fhd" try-harder hint="Scan the barcode on the back of the card" style="height: 420px"></qrgen-scanner>
<pre id="out"></pre>

<script type="module">
  import "qrgen-sdk/elements";
  import { parseAAMVA } from "qrgen-sdk";

  const scanner = document.getElementById("id-scanner");
  scanner.addEventListener("scan", ({ detail }) => {
    const id = parseAAMVA(detail.barcode.data);
    if (!id) {
      document.getElementById("out").textContent = "This barcode is not a driver license or ID card.";
      scanner.resume();
      return;
    }
    document.getElementById("out").textContent = `${id.fullName}, born ${id.dateOfBirth}, expires ${id.expiryDate}`;
  });
</script>
```

Settings that help with license barcodes:

- `symbologies="pdf417"`: nothing else is on the back of the card that you want.
- `viewfinder="line"`: a wide box that matches the barcode's shape.
- `resolution="fhd"` and `try-harder`: PDF417 on licenses is dense, and older cards are worn.

Ask the user to lay the card flat, fill most of the viewfinder with the barcode, and avoid glare from overhead lights (tilt the card slightly). Turning on the torch helps in dim places but can cause glare on laminated cards.

AAMVA data separates its fields with control characters (line feed, record separator, carriage return). `barcode.data` keeps them as they were encoded, so you can pass it to `parseAAMVA()` directly; `fromBase64(barcode.rawBytes)` gives the exact bytes if you need them.

`parseContent()` also recognizes AAMVA data and returns `{ type: "aamva", aamva }`, so a general-purpose scanner can handle licenses without a separate code path.

## Result fields

`parseAAMVA(data, options?)` returns `null` when the input isn't AAMVA data. Otherwise:

| Field | Source element | Example | Notes |
| --- | --- | --- | --- |
| `firstName` | `DAC` | `JANE` | Falls back to legacy `DCT`/`DAA`. |
| `middleName` | `DAD` | `Q` | |
| `lastName` | `DCS` | `SAMPLE` | Falls back to legacy `DAB`/`DAA`. |
| `suffix` | `DCU` | `JR` | |
| `fullName` | computed | `JANE Q SAMPLE` | First, middle, last and suffix. |
| `dateOfBirth` | `DBB` | `1990-01-31` | ISO date, `""` when missing. |
| `issueDate` | `DBD` | `2020-02-01` | ISO date. |
| `expiryDate` | `DBA` | `2028-01-31` | ISO date. |
| `sex` | `DBC` | `F` | `M`, `F`, `X` or `""`. |
| `documentNumber` | `DAQ` | `D1234567` | License or ID number. |
| `documentDiscriminator` | `DCF` | | Identifies this particular card. |
| `documentType` | subfile type | `DL` | `DL` (driver license) or `ID` (identification card). |
| `street`, `street2` | `DAG`, `DAH` | `123 MAIN ST` | |
| `city` | `DAI` | `SACRAMENTO` | |
| `state` | `DAJ` | `CA` | State or province code. |
| `postalCode` | `DAK` | `95814` | ZIP+4 is formatted `95814-1234`; a `0000` extension is dropped. |
| `country` | `DCG` | `USA` | `USA` or `CAN`; inferred from the issuer when missing. |
| `eyeColor`, `hairColor` | `DAY`, `DAZ` | `BRO` | AAMVA color codes. |
| `height` | `DAU` | `065 IN` | As encoded (inches or centimeters). |
| `weight` | `DAW` or `DAX` | | Pounds or kilograms, as encoded. |
| `vehicleClass`, `restrictions`, `endorsements` | `DCA`, `DCB`, `DCD` | | Jurisdiction-specific codes. |
| `issuerId` | header | `636014` | Issuer Identification Number of the jurisdiction. |
| `aamvaVersion`, `jurisdictionVersion` | header | `10`, `0` | Standard version the card follows. |
| `age` | computed | `36` | Whole years, or `null` without a birth date. |
| `isExpired` | computed | `false` | `null` without an expiry date. |
| `isUnder21`, `isUnder18` | computed | `false` | `null` without a birth date. |
| `fields` | all elements | `{ "DAQ": "D1234567", ... }` | Every element by its three-letter code, including jurisdiction-specific `Z..` elements. |

Dates are converted from the card's format: US issuers use `MMDDCCYY`, Canadian issuers `CCYYMMDD`. Values such as `NONE` or `UNAVL` become `""`. `AAMVA_FIELDS` maps element codes to readable labels, for example `AAMVA_FIELDS.DAQ` is `"Customer ID number"`.

`age`, `isExpired`, `isUnder21` and `isUnder18` are computed against the current date. Pass `{ now }` to compute them for another date, which is also how you write deterministic tests:

```js
parseAAMVA(data, { now: new Date("2026-06-01T00:00:00Z") });
```

## Age verification

```js
import { parseAAMVA } from "qrgen-sdk";

export function checkAge(data, minimumAge = 21) {
  const id = parseAAMVA(data);
  if (!id) return { ok: false, reason: "Not a driver license or ID card" };
  if (id.age === null) return { ok: false, reason: "No date of birth on the card" };
  if (id.isExpired !== false) return { ok: false, reason: "The card is expired or has no expiry date" };
  if (id.age < minimumAge) return { ok: false, reason: `Under ${minimumAge}` };
  return { ok: true, age: id.age };
}
```

For the common case of 21, `id.isUnder21` is available directly. Show the staff member the result together with the name and photo on the physical card: the barcode doesn't prove that the person in front of you is the card holder.

## Privacy

License data is personal data, and in many places regulated. Handle it with care:

- **Process on the device.** QRGen decodes and parses locally; nothing is uploaded unless your code sends it.
- **Keep only what you need.** For an age check, keep the yes/no result and discard the parsed object. Don't log `data`, `rawBytes` or `fields`.
- **Don't store it by default.** If you must store data (for example for a visitor log), store the minimum fields, tell the user, encrypt it at rest and delete it on a schedule.
- **Check local law.** Several US states and Canadian provinces restrict when businesses may scan licenses and how long they may keep the data.
- **Don't treat the barcode as proof of authenticity.** Anyone can print a PDF417 with arbitrary data. Parsing a license verifies its format, not that the card is genuine.

## Limitations

- **North America only.** The AAMVA PDF417 is used on US and Canadian driver licenses and ID cards. Licenses and ID cards from other regions use other formats.
- **No MRZ or OCR.** Passports, passport cards and many national ID cards carry a machine-readable zone (MRZ): printed text that needs optical character recognition. QRGen reads barcodes only; it doesn't include OCR, so it can't read an MRZ or the printed front of a card.
- **No authenticity checks.** No security features (holograms, UV, microprint) are verified.
- **Jurisdiction quirks.** Some issuers deviate from the standard. Unknown and jurisdiction-specific elements are kept in `fields`, so you can read them even when there is no named property.

## Test without a real license

Don't use a real person's license during development. The [cross-platform spec](https://github.com/Rockyljewell/QR-GEN/blob/main/docs/SPEC.md) includes a fictional AAMVA test vector. Render it as a PDF417 on your screen and scan it with your phone:

```html
<qrgen-barcode id="test-license" symbology="pdf417" scale="3" style="width: 480px"></qrgen-barcode>

<script type="module">
  import "qrgen-sdk/elements";

  document.getElementById("test-license").value =
    "@\n\x1e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";
</script>
```

Or test the parser directly:

```js
import { parseAAMVA } from "qrgen-sdk";

const sample =
  "@\n\x1e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";

const id = parseAAMVA(sample, { now: new Date("2026-06-01T00:00:00Z") });
console.log(id.fullName, id.dateOfBirth, id.expiryDate, id.postalCode, id.age); // JANE Q SAMPLE 1990-01-31 2028-01-31 95814 36
```
