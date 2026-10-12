# Target-product finder

Open `/picking/` on the QRGen site to find one exact barcode among other decoded
observations. The page uses the existing site layout, controls, design tokens and
scanner renderer.

1. Enter the target barcode value and optionally a product name. Barcode values
   retain their case, spaces and leading zeros.
2. Start the camera or upload an image. Review matching and other recently decoded
   barcodes as text; choose a match through the scanner's existing selection UI.
3. Set a different target or clear the observations to begin another search.

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
The model suite checks exact matching, expiry and ownership. The browser suite
uses the public scanner with generated images and a fake camera, exercises stale
completions and lifecycle changes, and checks keyboard use, narrow layouts and the
existing design tokens. These tests validate application behavior, not physical
item counting or camera performance on a phone.
