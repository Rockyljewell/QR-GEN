# Apple still-image decoder observations

This diagnostic records the public QRGenKit decoder and a separate direct Apple Vision request on the same ImageIO image, using unchanged SDK sources. It does not run a camera, Simulator, preview renderer or Scandit benchmark. A successful workflow means observations were retained, not that recognition passed an accuracy target.

The first input is an unchanged PNG retained from a separate iOS Simulator capability run. Its SHA256 is `bdb3352f06392328c5c5f69369fbed5c2ebe06d4e3d37b0f39bae7672791c01c`; the expected payload is `qrgen-ios-native-highlight-capability-978214d`. The second input is one new PNG generated on this macOS host with the same payload, QR format, scale 8 and error correction M. Each available input receives exactly one public SDK call followed by one direct Vision call. The maximum is four decode calls; errors, unmatched observations, nil payloads and result multiplicity are preserved.

The direct request uses the default revision and full image, QR symbology and explicit upright orientation. Its raw observations, supported-symbology query, selected revision and geometry are recorded independently. SDK results are retained before any comparison. Geometry differences are derived only when both arms have one unique expected QR match. No derived geometry is delivered to any renderer.

The runner builds a fresh external Swift consumer with a local package reference to this exact event's checkout. It retains source and fixture hashes, compiler inputs, executable identity, framework information, logs, input images and pre/post closure checks. Build and execution timeouts remain failures. Output directories are never reused.

Both arms empty means no read on this macOS configuration. A discrepancy is candidate evidence requiring investigation, since the SDK creates a separate Vision request. A macOS read does not establish Simulator reading, native preview mapping, physical-camera reliability or Scandit parity. This branch is a diagnostic and is not intended for merging.

Apple documents the [barcode request and its observations](https://developer.apple.com/documentation/vision/vndetectbarcodesrequest) and the optional [raw payload data](https://developer.apple.com/documentation/vision/vnbarcodeobservation/payloaddata). These describe the direct control; the SDK's own implementation is bound separately in each run.
