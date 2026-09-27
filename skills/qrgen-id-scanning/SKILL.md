---
name: qrgen-id-scanning
description: Scan and parse North American driver licenses and ID cards (AAMVA PDF417 barcodes) with QRGen for age verification (21+/18+), check-in, KYC prefill or form autofill. Covers the scanner setup, parseAAMVA fields, expiry checks, privacy rules and testing with a synthetic license. Use when the user mentions ID scanning, driver license, age check, verify age, AAMVA or PDF417 on IDs.
---

# ID scanning (AAMVA driver licenses)

US and Canadian driver licenses and ID cards carry a PDF417 barcode on the back with AAMVA-formatted
data. QRGen reads it on-device and `parseAAMVA` turns it into fields.

## Scanner setup

```html
<qrgen-scanner id="id" symbologies="pdf417" mode="single" viewfinder="line"
  hint="Scan the barcode on the back of the license" style="height: 60vh"></qrgen-scanner>
<script type="module">
  import "qrgen-sdk/elements";
  import { parseAAMVA } from "qrgen-sdk/parsers";
  const el = document.getElementById("id");
  el.addEventListener("scan", (e) => {
    const id = parseAAMVA(e.detail.barcode.data);
    if (!id) return alert("That barcode is not a driver license.");
    if (id.isExpired) return alert("This license has expired.");
    alert(id.isUnder21 ? "Under 21" : `21+ verified (${id.age})`);
  });
</script>
```

PDF417 on licenses is dense. Use `resolution="fhd"` if phones struggle, keep the torch available for
dim venues, and ask users to fill the wide viewfinder with the barcode.

## Result fields

`firstName`, `middleName`, `lastName`, `suffix`, `fullName`, `dateOfBirth`, `issueDate`, `expiryDate`
(ISO dates), `sex` (`M`/`F`/`X`), `documentNumber`, `documentDiscriminator`, `street`, `street2`, `city`,
`state`, `postalCode` (ZIP+4 is shortened when the extension is `0000`), `country` (`USA`/`CAN`),
`eyeColor`, `hairColor`, `height`, `weight`, `vehicleClass`, `restrictions`, `endorsements`, `age`,
`isExpired`, `isUnder21`, `isUnder18`, `issuerId` (IIN), `aamvaVersion`, `documentType` (`DL`/`ID`), and
`fields` (every raw element, e.g. `fields.DAQ`). Pass `{ now }` for deterministic tests.

## Privacy and compliance (tell the user)

- Process on-device. Don't send the raw barcode or images to a server unless the feature needs it,
  and never log them.
- Store the minimum: for age checks keep only "verified 21+ at <time>", not the name or date of birth.
- Show users what is read and why. Some jurisdictions regulate license scanning (e.g. retention limits
  for bars and retailers), so point the user to legal review for production.
- The barcode proves only what is printed. It does not authenticate the card. For fraud-sensitive flows
  combine it with visual checks or a verification provider.

## Limits

- Passports and many non-US IDs use an MRZ (OCR text), not a barcode. QRGen does not include OCR.
- Very old (pre-2000) or damaged licenses may fail to parse. Fall back to manual entry.

## Testing without a real license

Generate a synthetic license with the SPEC test vector (fictional data):

```ts
import { generatePNG, scan, parseAAMVA } from "qrgen-sdk/node";
const SAMPLE = "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";
const [code] = await scan(await generatePNG(SAMPLE, { symbology: "pdf417", scale: 2 }));
const id = parseAAMVA(code.data, { now: new Date("2026-06-01") });
// id.fullName === "JANE Q SAMPLE", id.age === 36, id.isUnder21 === false
```

The demo at https://rockyljewell.github.io/QR-GEN/demo/#image has a "Driver license (sample)" button.
