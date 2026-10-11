This is a separate v3 preparation package. The frozen v1 and v2 directories remain unchanged; their exact manifests, plans and file inventories are retained in the provenance records.

The first v2 instrumented C++ build failed before recognition. At `MultiFormatReader.cpp:95:82`, the new `reader-discard-error` trace hook called `r[qi].position()` although `Reader::read` returns `BarcodesData` and `BarcodeData::position` is a field. V3 changes that hook to `r[qi].position`. The exact failed log is retained as a gzip with its original decompressed hash in `build-failure-provenance.json`. Parent supplied the run/job/head identities; this preparation did not query GitHub independently. The baseline build outcome is retained and bound separately by parent.

The audit distinguishes the raw `r` vector from the wrapped `res` vector in `MultiFormatReader`: the final sorted results are `Barcodes` and correctly use `.position()`, `.format()` and `.lineCount()`. `ReadBarcode` calls `MultiFormatReader::read`, so its results are also wrapped `Barcodes`; `ODReader` uses raw `BarcodeData` and its new hooks correctly use fields. Pinned API declarations and exact source locations are recorded in `accessor-audit.json`. An independent read-only review reached the same conclusion. This source audit is not a successful compilation claim.

The only change across the eight instrumented C++ files is the accessor correction. There is no change to a recognition expression, return value, condition, threshold, loop, coordinate transform, trace schema or trace bounds. The runner, protocol, 15 exact input definitions and 90 exact profiles remain identical to v2. Existing format-security warnings are preserved in the failed log and remain outside this correction.

V2's transport validation remains intact: schema/event types, call-begin dimensions/caps and exact call-end priorBytes are checked. Any public-output mismatch, reader failure, mutation or incomplete trace stops further recognition and explicitly prohibits interpretation. New file-only patch-application, source-difference, plan-identity and synthetic transport checks accompany v3. No SDK/reader import, recognition call or C++ compilation occurs while creating this preparation package. A new successful compiled-build binding is required before the paired runner may execute.

Original v2 manifest SHA256: `f85b909911989b1aa99e478277e5a5c051b6aa66fd7edbf10c5a36b45d806e07`.

Original v2 plan SHA256: `86647c0b8e45fa3535b8a12f8a8d2a1212e91e37d2af49912d3f50ae3b8c8287`.

Original v1/v2 C++ patch SHA256: `6156e3c8e8ba373e41c05c7610fa4b2fed08850c9d39bbc084d75d28ef954912`.
