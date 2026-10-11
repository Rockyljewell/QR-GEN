# Actual rebuilt WASM evaluation

`evaluate-rebuilt.mjs` is an artifact-only runner. It never builds an engine, installs packages, changes the SDK, or writes into the repository/review package. Use Node 24 and an existing built QR-GEN SDK for fixture generation. Missing files, unexpected fixture counts, or changed file/pixel hashes fail preparation.

Set these environment variables to absolute paths:

| Variable | Input |
| --- | --- |
| `QRGEN_REPRO_DEPENDENCY_ROOT` | QR-GEN checkout or its `packages/sdk` directory; nested SDK dependencies take precedence |
| `QRGEN_EAN_STUDY_CACHE_DIR` | Frozen `ean-linecount-study` cache, including `generated` and `uniform-negative` |
| `QRGEN_EAN_REVIEW_PACKAGE_DIR` | Mechanism `review-package` containing both frozen manifests; defaults to the sibling directory |
| `QRGEN_EAN_UNIFORM_PACKAGE_DIR` | Uniform-study `review-package` containing `negative-manifest.json` and `frozen-inputs.json.gz` |
| `QRGEN_EAN_CHROME_PNG` | Exact frozen `chrome-ean13-2-07-full.png` |
| `QRGEN_EAN_BASELINE_MODULE` / `QRGEN_EAN_CANDIDATE_MODULE` | Independent matching `dist/es/reader/index.js` wrapper paths |
| `QRGEN_EAN_BASELINE_WASM` / `QRGEN_EAN_CANDIDATE_WASM` | Matching rebuilt `zxing_reader.wasm` paths |
| `QRGEN_EAN_REBUILT_OUTPUT_DIR` | Fresh evidence directory outside the package and repository |

Each rebuilt artifact must retain its `matched-emscripten-glue.js` beside `dist`. The runner fingerprints every retained file under `dist/es`, the raw glue, WASM, and download provenance. It resolves released zxing-wasm 3.1.5 from the SDK, verifies the published WASM hash and pinned C++ metadata, and loads three independent wrapper instances.

Run `node evaluate-rebuilt.mjs`. Optional flags are `--prepare-only` (all inputs and plan, no decoder execution), `--sanity-only` (24 baseline profiles, no candidate), and `--baseline-only` (full baseline conformance, no candidate). `--harness-self-check` is explicitly labelled and permits distinct ES module instances of the same release wrapper; it is never candidate evidence.

All prepared rasters and profiles are frozen before decoder execution. Release-versus-rebuilt-baseline comparison completes first. Any engine error or normalized-result mismatch prevents candidate evaluation. Ordered differences are recorded separately. Candidate records retain complete normalized results, new text values, and lost expected payloads. The success exit criterion checks engine errors, lost baseline expected payloads, and newly introduced no-code output; it is not a production-approval gate and does not assert identical geometry, line support, or arbitrary option combinations.

| Arm | Scope | Profiles |
| --- | --- | ---: |
| Full frozen corpus | All 479 rasters: 157 original +157 derived +1 actual Chrome +144 thin positives +12 synthetic controls +8 real no-code. Fast/hard × downscale off/on; EAN13, max255, minLineCount2, Ignore addons, native inversion off | 1,916 |
| Focused limits/formats/addons | Five known original/derived/Chrome cases +8 generated leading-zero/UPC/EAN/addon/mixed fixtures. Fast/hard × downscale off/on × max1/2/255 × EAN13/UPCA/mixed/all × Ignore/Read/Require | 1,872 |
| Checksum-error semantics | One deliberately invalid EAN13 symbol; fast/hard × downscale off/on × max1/255 × returnErrors off/on | 16 |
| Broader no-code controls | Five predeclared fixed-seed noise/stripe/checker/gradient rasters; fast/hard × downscale off/on × EAN13/all | 40 |
| Generated multi-format matrix | QR, DataMatrix, PDF417, EAN13, Code128, DataBar × four rotations × normal/lower-contrast/inverted; raw engine and separately modelled SDK raster inversion | 144 |
| Total | 565 distinct prepared rasters; option cross product is focused, not exhaustive on every photo | 3,988 |

The inversion arm models the current SDK's bounded extra RGB inversion, native-inversion format exclusion, spatial deduplication, and inversion flag. It is not a run of the product SDK with the candidate dependency installed. Raw UPC-A text keeps upstream's leading zero; product normalization is separate. Expected-payload labels in the primary summary use text presence; the independent evidence summary also checks the output format family.

Timings are one warm call per profile and engine, with sequential release/baseline/candidate ordering. Loading and a small warmup are excluded. These descriptive measurements cannot establish a performance regression threshold or Scandit parity. Row rejection may change later global searches; the runner makes no general output-subset claim.

The frozen first actual run is `rebuilt-ean/actual-matrix-v1`. It executed Node v24.19.0 and compared candidate WASM `f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6` against rebuilt baseline/release `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`. Complete recorded normalized JSONL results and engine graph fingerprints are retained; no source/default changes were made by this runner.

## Recorded result fields

The JSONL files retain every evaluated profile and the evaluator's normalized result objects, not every property of upstream ReadResult. Captured fields are text, format, raw payload bytes (hex), contentType, lineCount, isValid, error, position, orientation, ecLevel, symbologyIdentifier, isMirrored, isInverted, and extra. Omitted upstream fields are bytesECI, symbology, rotation (the orientation alias is retained), hasECI, structured-append sequenceSize/sequenceIndex/sequenceId, symbol raster, and deprecated version/readerInit. Exact recorded error strings are preserved, including source-line drift. The matrix's raw arm means direct engine decoding without the modelled SDK inversion fallback; it does not imply all upstream object properties were captured.
