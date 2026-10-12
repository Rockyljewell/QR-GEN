# Target-product finder

Open `/picking/` on the QRGen site to find one target barcode among other decoded
observations. The page uses the existing site layout, controls, design tokens and
scanner renderer.

1. Enter the target barcode value and optionally a product name. Retail product
   numbers match in any printed form; other values retain their case, spaces and
   leading zeros.
2. Start the camera or upload an image. Review matching and other recently decoded
   barcodes as text; choose a match through the scanner's existing selection UI.
3. Set a different target or clear the observations to begin another search.

## Matching

Retail barcodes match by product number (GTIN). With every symbology enabled, the
decoder reports an EAN-13 printed `0012345678905` as UPC-A `012345678905`; both are
GTIN `00012345678905`, so that scan matches a target typed from the printed digits.
The match list shows the value and symbology as decoded, marked "same product
number" when they differ from the target.

- A target is a GTIN only when it is exactly 8, 12, 13 or 14 digits with a valid
  check digit. It is not trimmed.
- A decoded barcode carries a GTIN only when it is an EAN-13, EAN-8, UPC-A, UPC-E
  (expanded to its UPC-A) or ITF-14 (a 14-digit Interleaved 2 of 5) with a valid
  check digit; GS1 data with AI (01), such as GS1-128, GS1 DataBar or a GS1 Data
  Matrix; or a GS1 Digital Link URL with AI (01).
- Every other value matches only exactly, including spaces, line breaks, case and
  leading zeros, in any symbology. The same digits in a non-retail symbology, such
  as a plain Code 128 or QR code, are not a product number, and a value with a
  wrong check digit is not a GTIN. To match a UPC-E by number, enter its 12-digit
  UPC-A; its 8 printed digits read as an EAN-8 and match the UPC-E scan only
  exactly.

The [receiving workflow](RECEIVING-WORKFLOW.md) uses the same rules.

## Observations

Camera observations expire. An image result describes the uploaded image, not
the camera view. A selected barcode retained by the scanner after leaving view
does not become a recent match again. Changing the target or source, stopping or
resetting invalidates pending work so an older completion cannot restore a match.

Track IDs identify short-lived decoded observations. Repeated frames and multiple
tracks with the same value do not establish physical product quantities. This
finder does not change the [receiving record](RECEIVING-WORKFLOW.md), confirm an
order, query inventory, or provide authoritative price or expiry information.

The target and observations stay in the current page. Nothing is uploaded to a
server or saved as inventory. Real shelf recall, handset performance and a
matched comparison against Scandit require separate device testing.

## Validation

After the SDK and site build, run `npm run test:picking -w qrgen-site`.
The model suite checks exact and GTIN matching, expiry and ownership. The browser
suite uses the public scanner with generated images and a fake camera, including
an EAN-13 decoded as UPC-A beside the same digits in Code 128, exercises stale
completions and lifecycle changes, and checks keyboard use, narrow layouts and the
existing design tokens. These tests validate application behavior, not physical
item counting or camera performance on a phone.
