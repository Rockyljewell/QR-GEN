# EAN-13 ambiguity candidate: compiled validation

The isolated candidate suppresses one confirmed wrong-value mechanism without losing a target read in the recorded development corpus. It is **not installed in QR-GEN**: production continues to use released zxing-wasm 3.1.5. [Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) remains open because the separate `/1/35` wrong value and explicit UPC-A-only behavior remain unresolved. This is not physical-phone, population-accuracy or Scandit parity evidence.

## Mechanism and source review

The [frozen source study](ean-source-mechanism-2026-10-11/README.md) identifies equal best digit matches that admit two different complete EAN-13 words, both satisfying parity and checksum. The candidate rejects an already accepted EAN-13 row when that ambiguity exists; it neither chooses the known truth nor constructs a replacement payload. The earlier source-port report is a historical snapshot prepared before compilation. The compiled validation below is separate evidence.

The reviewed patch SHA-256 is `f80daf81fe49616e59b250fac96e25a6c5d73ee5e59e6511cec5b98dc2bd7fae`, against ZXing-C++ `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`. Independent review checks fixed-array bounds, parity/checksum counting and float matching; 942 shared source-port profiles match actual baseline and candidate text, supporting-line counts and positions.

## Reproducible build and actual reader comparison

The successful [isolated WASM build](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152527079), head `3cfe7298c1d92eb2d4ac56158a1bfcd51275f070`, builds separate baseline and candidate readers with their own matching wrappers. The baseline WASM is byte-for-byte identical to the released engine. Both downloaded artifact ZIP digests were verified.

| Reader | WASM SHA-256 | Artifact |
| --- | --- | --- |
| Baseline/released 3.1.5 | `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931` | `11707386971` |
| Candidate | `f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6` | `11707446910` |

The [actual rebuilt-reader package](ean-rebuilt-validation-2026-10-11/README.md) preserves a frozen plan, full recorded normalized outputs, portable replay and all retained wrapper-graph hashes. It covers **3,988 profiles, 565 rasters and 12,108 measured reader calls** across released, rebuilt baseline and candidate engines. The 479-raster core includes 157 original EAN photos, their frozen derivatives, the captured Chrome frame, 144 thin generated positives, 12 generated controls and eight real no-code rasters. Additional fixtures exercise aliases, add-ons, mixed formats, invalid checksums, synthetic negatives and the generated 72-case format matrix. Recorded fields include payload bytes, validity/errors, positions and support; the package lists omitted upstream metadata fields explicitly.

Released and rebuilt baseline recorded outputs agree on every profile, including order. Independent inspection finds no lost expected text/format-family/bytes, no newly appearing text/format pairs and no new valid no-code results. There are 86 changed profiles: 76 suppress the known `/2/07` false value, two reduce one correct target's supporting-line count from eight to seven, and eight change only an invalid checksum diagnostic's source line after code insertion. These are repeated option profiles, not 76 independent photographs or a measured false-positive rate.

The focused matrix varies scan limits 1/2/255, downscaling, search effort, EAN/UPC/mixed/all formats and add-on Ignore/Read/Require. The complete cross product is not applied to every photo. The raw 72-case matrix remains 56/72; separately modelling the SDK's bounded inversion policy yields 72/72 for both engines. That arm does not execute a product SDK with a replaced dependency. Sequential warm timings are descriptive, not an unbiased performance benchmark.

## Native and browser checks

The [native package](ean-native-validation-2026-10-11/README.md) preserves the successful [native run](https://github.com/Rockyljewell/QR-GEN/actions/runs/38153092445), head `d9aec2cabf211181f9792ff73b65f8583afdb121`. Both variants pass the upstream suite: 312 GoogleTests and the separate C API CTest entry. Candidate adds 14 tests, for 326 passing GoogleTests. Those added tests compile the exact private helper bodies in a test-only translation unit; the full patched library also runs the unchanged upstream suite. They do not export a new production API.

The [Chromium package](ean-browser-rebuild-2026-10-11/README.md) records real main-thread and module-worker execution with each reader's matching wrapper/WASM. The corrected raw-representation protocol passes 56/56 expected outputs, with 28 identical main/worker pairs, no page/console/worker errors and both workers terminated. An earlier 56-read run is retained separately: 12 expectations incorrectly used the SDK's 12-digit UPC-A representation for raw HRI results. All raw outputs are identical across repeats; only the expected raw UPC-A representation was corrected. The two runs are not combined into a larger pass count.

The actual Chrome EAN frame's wrong value is suppressed under EAN-13 in both downscale and inversion settings. Empty output is a miss, not correct recovery. Clean and mixed controls remain exact. Explicit UPC-A-only scanning still returns the same wrong value; `/1/35` remains unresolved in the broader matrix.

## Public SDK integration follow-up

The separate [public SDK study](EAN-SDK-INTEGRATION-2026-10-11.md) builds and packs
isolated SDK copies, executes 4,648 public image calls, checks extracted Node
18/24 ESM/CommonJS entries and real browser camera workers, and preserves
expected load-failure cleanup. It validates explicitly matching assets without
installing the candidate in production. Public defaults, asset identity/cache
migration, the remaining false readings and physical field gates stay open.

## Production and field gates

Changing the packaged decoder still requires a maintainable matching-wrapper/WASM distribution, version and provenance reporting, public SDK/Node/worker/self-host/offline validation and review against current main and concurrent work. The current audit does not silently replace the dependency or its defaults.

The separately [verified retail deployment](retail-state-postdeploy-2026-10-11/README.md) confirms merged camera/batch fixes at `6d3728f` against its actual Pages artifact. Physical-phone rows in [PHONE-VALIDATION.md](PHONE-VALIDATION.md) remain unexecuted, and the matched licensed Scandit workflow in [#6](https://github.com/Rockyljewell/QR-GEN/issues/6) remains open.
