# EAN ambiguity candidate: public SDK integration study

The isolated candidate also suppresses the identified wrong-value mechanism through QR-GEN's public SDK. **It is not installed in the released SDK or live scanner.** Main continues using released zxing-wasm 3.1.5. [Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) remains open: the separate `/1/35` wrong value and explicit UPC-A-only behavior remain unresolved. No physical-phone, held-out accuracy or Scandit parity claim follows from this study.

## Build and public package boundary

The [build/package report](ean-sdk-builds-2026-10-11/README.md) stages the exact SDK source from `6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b` into separate external baseline/candidate packages. Only the candidate's reader imports, version-only reader import, Node asset bootstrap, reader postbuild copy and matching test mock boundary change. Scanner, tracking, image conversion and inversion policy remain unchanged. Both diagnostic packages build, typecheck and pass all 358 SDK tests.

The candidate uses the matching compiled reader graph/WASM from [the previous compiled study](EAN-CANDIDATE-VALIDATION-2026-10-11.md). Its reader SHA256 is `f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6`. Both writers remain released 3.1.5, SHA256 `af26f895fe471d23cb2d742bc3eca0695dbecb4ea6bad9b92eba3763ec505941`. Each packed archive has 95 files and 28 public export leaf targets; file existence does not establish runtime coverage of every optional framework/export.

Eight extracted-package smoke scenarios cover Node 18.17.0/24.19.0, ESM/CommonJS and both variants. Each generates/scans the same three clean QR/EAN/UPC identities and observes the exact expected reader/writer bytes at WebAssembly instantiation. The original Node18 Windows-path harness failure and corrected runner remain separately identified. These repeated clean executions are not independent accuracy samples.

## Actual public image comparison

The [Node matrix](ean-sdk-node-2026-10-11/README.md) executes **1,162 profiles across 551 frozen rasters**, repeated across four package/entry processes for **4,648 public `scanImage` calls**. It uses the 479-raster photographic/generated/negative core and 72 saved generated format fixtures. Public options vary search effort, format scope and selected result limits, with `tryInvert:true` throughout; private raw-reader options are not substituted for SDK behavior.

Every input is verified against its frozen source/pixel identity. Of 551 rasters, 502 reuse exact PNG bytes and 49 use a verified lossless PNG transport for the already frozen pixels. This is fixed transport normalization, not a selected image enhancement. Padded input views and their backing buffers remain unchanged.

Candidate versus baseline shows no lost expected baseline target record, payload bytes or target detection multiplicity, no new values, no no-code outputs and no engine errors. ESM/CommonJS results agree. All current enumerable public Barcode fields are retained except timestamp, whose finiteness is checked. The [independent review](ean-sdk-independent-node-review-2026-10-11/README.md) reconstructs every profile and verifies all 551 transports using a separate image decoder, with no SDK calls.

Ten option profiles change per entry format: six EAN-13 wrong `/2/07` results and four mixed-format public UPC aliases become empty. Empty output is suppression, not recovery. Four explicit UPC-A-only wrong-result profiles remain. `/1/35` still contains the wrong value in six profiles. Eight companion-mismatch records correspond to four other photos and remain unreviewed/possible secondary labels; they are not newly proven false readings. The saved 72-case matrix passes in both fast/hard profiles for every package/entry combination.

## Actual browser and camera boundary

The [browser report](ean-sdk-browser-2026-10-11/README.md) executes public `scanImage` and `BarcodeScanner` with each extracted standalone SDK. Its original 28 fresh-context sessions include 24 image calls, 16 camera cases and 10 transport sessions. Camera cases distinguish main execution from actual embedded workers through public engine diagnostics and observed worker messages; startup fallback is not counted as worker success. Each completed camera case releases live camera tracks and detaches its video. Shared workers may remain available inside a context and are gone when that context closes.

The candidate suppresses the actual Chrome `/2/07` frame through ImageData/encoded input, main camera and embedded worker. Clean controls retain exact public values. Explicit UPC-A-only scanning still returns the known wrong public value; `/1/35` still returns its target plus the wrong value. Actual camera pixels are separately frozen, including the new `/1/35` capture; synthetic derivatives are not passed off as camera captures.

A separate classic-script IIFE supplement also verifies clean QR/EAN generation and scanning, the baseline wrong `/2/07` value and candidate suppression. It exercises the public global namespace rather than inferring that path from a successful module build.

Configured URL, relative self-hosted base and supplied binary transports retain the expected assets. Preload-then-offline operation is tested in an already loaded context; it does not establish service-worker installation, reload, cold offline startup or arbitrary application offline readiness. Cold unavailable/corrupt reader cases fail with `engine-load-failed` and no decoded frames. A separate four-session cleanup supplement waits for the underlying camera requests to settle after rejected startup and confirms the late-acquired tracks end. Expected load-failure console errors are distinguished from positive-case errors.

The SDK does not authenticate arbitrary user-supplied binaries. Harness mismatch guards prove the study refuses incorrect asset pairs, not that the product rejects every valid-but-wrong WASM. Default CDN selection, capability build identity and cache migration are still production gates.

## Remaining wrong-value mechanism

The [physical-conflict feasibility report](ean-physical-conflict-2026-10-11/README.md) reuses 479 recorded baseline profiles and 24 result-limit profiles, with nine new generated-control reader calls. Projection overlap associates the conflicting `/1/35` readings, but also associates five legitimate two-code controls. Returned scanline-support envelopes therefore cannot safely establish one physical symbol. No new grouping threshold, winning payload or production filter is selected.

In the retained raw-reader experiment, `maxNumberOfSymbols:1` is not equivalent to truncating the larger-budget output. The budget changes the observed acquisition/aggregation result; the complete attempted-row schedule remains unobserved. A bounded instrumentation-only study of attempted/rejected rows and collector transitions is the supported next investigation, with unchanged public-output equivalence checked first.

Before a supported decoder distribution change, preserve matching loader/assets, a distinct reader identity, explicit self-host/cache migration, public default loading and a held-out corpus. Physical-phone rows in [PHONE-VALIDATION.md](PHONE-VALIDATION.md) remain unexecuted; the licensed matched Scandit workflow in [issue #6](https://github.com/Rockyljewell/QR-GEN/issues/6) remains open.
