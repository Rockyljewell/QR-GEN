# Local receiving workflow

Open `/receiving/` on the QRGen site. The route uses the existing site layout, design tokens and scanner component.

1. Create a named delivery and add barcode values, product names and expected quantities. Alternatively try the sample delivery and its QR labels.
2. Scan with the camera, upload an image, or choose an expected product from the table. Choose an observed barcode or a result in the scanner's accessible list.
3. Confirm the quantity received now. A confirmation adds that quantity to the saved total. Repeated camera frames, selected highlights and leaving/re-entering view never add quantities.
4. Add unknown barcodes as unexpected products before confirming their quantities. The table shows remaining, complete, over and unexpected states in text.
5. To correct a total, enter the replacement total and a reason. Another tab's intervening change rejects an edited correction; review the refreshed totals before explicitly retrying.
6. Export a JSON receiving record. Past deliveries remain available in the saved-delivery selector.

## Storage and confirmation semantics

Confirmed deliveries and their complete action history are stored in IndexedDB on this browser/site origin. Saves are acknowledged after transaction completion; a failed transaction retains the previous saved totals. The camera and image decoder run on the device. There is no inventory service or cloud synchronization. Export a backup before clearing browser data, moving to another browser or changing the site address.

Each confirmation has a unique action ID. Applying the same ID and canonical content again returns the same revision; reusing that ID for different content is rejected. A transaction reads, validates and updates one delivery atomically, so simultaneous confirmations from tabs add to the latest committed total. Absolute corrections require the displayed revision and retain their reason in history. Refresh notifications received during a save are queued; exports read a committed snapshot directly from storage.

Saved totals are checked by replaying the bounded history, including quantity and revision constraints. Unreadable saved deliveries are left untouched and reported separately; other valid deliveries can still be opened. No history is silently trimmed. Limits per delivery are 500 different barcode values and 10,000 actions, with integer quantities up to 1,000,000. Start a new delivery after exporting if a limit is reached. Only the latest 100 actions are displayed; exports include all actions.

## Export contract

The JSON schema is `qrgen-receiving-v1`. It includes `sessionId`, `revision`, `delivery`, timestamps, product quantities/differences and the complete command history. `exportId` is `sessionId:revision`. Repeating an export of an unchanged revision produces identical bytes and the same ID; there is no fresh export timestamp. A downstream inventory integration must persist/deduplicate this ID before applying a record. Downloading a record does not update an external inventory system.

An `add` action for a product added from a scan also carries `gtin`: the scanned GTIN-14, or `null` when the scan carried none. Typed `add` actions have no `gtin`; their GTIN follows from their digits. Deliveries saved before this field open and export unchanged.

## Barcode matching

Retail barcodes match by product number (GTIN). With every symbology enabled, the decoder reports an EAN-13 printed `0012345678905` as UPC-A `012345678905`. Both are GTIN `00012345678905`, so the scan finds the row typed from the printed digits instead of offering an unknown product.

- A scanned barcode carries a GTIN only when it is an EAN-13, EAN-8, UPC-A, UPC-E (expanded to its UPC-A) or ITF-14 (a 14-digit Interleaved 2 of 5) with a valid check digit; GS1 data with AI (01), such as GS1-128, GS1 DataBar or a GS1 Data Matrix; or a GS1 Digital Link URL with AI (01).
- A typed value is a GTIN only when it is exactly 8, 12, 13 or 14 digits with a valid check digit. It is not trimmed. To match a UPC-E by number, type its 12-digit UPC-A; its 8 printed digits read as an EAN-8 and match the UPC-E scan only exactly.
- Every other value matches exactly, including whitespace inside or around a nonblank value, case and leading zeros. An exact value matches in any symbology. The same digits in a non-retail symbology, such as a plain Code 128 or QR code, are not a product number, and a value with a wrong check digit is not a GTIN.

A scan that matches a row by GTIN confirms into that row, and the history records the row's own value. A delivery has one row per product: adding a value whose GTIN already has a row is rejected. Deliveries saved before this rule can contain two such rows; they still open, and a scan chooses the row with its exact value, otherwise the first row with its GTIN. Product names and correction reasons are trimmed. Counts concern confirmed quantities per product row, not distinct physical instances.

## Validation and remaining gates

Pure-source model tests cover command retries/conflicts, quantity bounds, stale corrections, malformed saved state, full history limits, stable exports and GTIN equivalence, including invalid check digits, non-retail symbologies and older deliveries with equivalent rows. Real Chromium checks exercise IndexedDB, camera/image identification (including an EAN-13 decoded as UPC-A), repeated-frame behavior, reload, saved deliveries, cross-tab confirmations, correction conflicts and transaction aborts. These use generated images and a desktop fake camera; they are not physical-phone or Scandit comparison evidence.

This implements the receiving session portion of [roadmap #6](https://github.com/Rockyljewell/QR-GEN/issues/6). The separate [target-product finder](TARGET-PRODUCT-FINDER.md) locates a target barcode, with the same matching rules, without changing receiving quantities. Persistent physical-instance identity, authoritative price/expiry services, representative field UX studies and a licensed matched-device Scandit benchmark remain separate work.
