# Actual EAN13 ambiguity candidate comparison

This is evidence for an isolated diagnostic candidate, with no SDK dependency/default change. Build run [38152527079](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152527079) completed successfully at commit `3cfe7298c1d92eb2d4ac56158a1bfcd51275f070`; download ZIP digests were verified. Rebuilt baseline WASM is byte-identical to released zxing-wasm 3.1.5. Full retained ES-wrapper graph and raw-glue digests are in the graph/engine files; the graphs retain all files, not merely reader/index.js.

The actual Node v24.19.0 evaluation used 565 rasters, 3,988 profiles, and 12,108 timed reader calls across three independent module instances. All 3,988 released-versus-rebuilt-baseline normalized and ordered outputs matched before candidate comparison. Candidate results had no engine error, no new text/format/bytes value, no lost expected payload/family/bytes, and no lost expected detection count/geometry in this matrix. The family review explicitly accepts the observed QRCodeModel1/2 input to QRCode output-family alias on 24 matrix profiles; it does not claim QR subtype equality.

There are 86 changed profiles: 76 remove the known wrong07 value; 2 retain correct ean13-3-23 value/geometry but reduce lineCount 8 to 7; 8 return the same invalid checksum result with error diagnostic source line 289 moved to 380. Exact recorded error strings are preserved, including source-line drift. They are classified as source-location drift only in supplementary analysis.

The wrong07 value remains in 24 focused UPCA-only profiles, matching the candidate's explicit UPC-A bypass. It is absent from the tested EAN13/mixed/all focus profiles after filtering. The known wrong35 value is unchanged in 52 profiles (4 full-corpus +48 focused). These are development-case counts, not independent samples or field failure rates.

Raw multi-format outputs retain 56/72 expected payloads for both engines. The separately modelled SDK raster inversion arm reaches 72/72 for both. This models the bounded inversion helper; it is not product-SDK/browser execution with a replaced dependency. Five additional synthetic adversarial no-code rasters and the inherited 20 no-code rasters produce zero valid outputs in their tested profiles (120 profiles total).

One warm timed call per profile/engine gives baseline/candidate p50 0.749/0.770 ms and p95 4.292/4.406 ms. These sequential descriptive timings are not an unbiased performance benchmark. Plan-freeze to final file-write was about 26.67 seconds, excluding fixture preparation; this is a filesystem-time approximation. The primary summary timestamp is baseline-phase completion, not final completion.

## Integrity and portability

Run `node verify-package.mjs` with Node 24. It checks every retained file and exact gunzipped recorded normalized-result digest. `portable-evaluation-plan.json.gz` is a derived plan whose absolute host paths are input tokens. Its original frozen-plan SHA256 is `03eb911057351f594004eb3450f1a83b60e00360dbadefccda8d709e0403a4ab`, preserved alongside all original evidence digests. Do not claim the portable plan has the original byte hash. Binary fixtures, build archives, WASM binaries, and C++ source are deliberately omitted from this report package.

The two complete recorded normalized JSONL gzip files preserve exact original uncompressed bytes, with every evaluated profile. Captured result fields are text, format, raw payload bytes (hex), contentType, lineCount, isValid, error, position, orientation, ecLevel, symbologyIdentifier, isMirrored, isInverted, and extra. Omitted upstream fields are bytesECI, symbology, rotation (the orientation alias is retained), hasECI, structured-append sequenceSize/sequenceIndex/sequenceId, symbol raster, and deprecated version/readerInit. Thus baseline agreement refers to recorded fields, not an all-property upstream-object comparison.

Build/run/ZIP evidence is under provenance. Expected file/pixel hashes and identities are frozen in the portable plan and input manifests. Obtain the same source-port review package/cache and matching baseline/candidate build artifacts to rerun. Fixture preparation never silently skips missing inputs. The original 479 frozen inputs are hash checked; compare a replay's 86 freshly generated fixture hashes with the portable plan before treating it as the same matrix.

## Replay commands

Use Node 24, the existing built QR-GEN SDK, the frozen raster cache, and the matching downloaded artifacts. No install or rebuild is performed by this runner. Set the environment variables listed in EVALUATION-MATRIX.md. A PowerShell template is:

~~~powershell
$env:QRGEN_REPRO_DEPENDENCY_ROOT = '<existing QR-GEN checkout>'
$env:QRGEN_EAN_STUDY_CACHE_DIR = '<frozen raster cache>'
$env:QRGEN_EAN_REVIEW_PACKAGE_DIR = Join-Path (Get-Location) 'inputs/mechanism'
$env:QRGEN_EAN_UNIFORM_PACKAGE_DIR = Join-Path (Get-Location) 'inputs/uniform'
$env:QRGEN_EAN_CHROME_PNG = '<exact frozen Chrome PNG>'
$env:QRGEN_EAN_BASELINE_MODULE = '<baseline artifact>/dist/es/reader/index.js'
$env:QRGEN_EAN_BASELINE_WASM = '<baseline artifact>/zxing_reader.wasm'
$env:QRGEN_EAN_CANDIDATE_MODULE = '<candidate artifact>/dist/es/reader/index.js'
$env:QRGEN_EAN_CANDIDATE_WASM = '<candidate artifact>/zxing_reader.wasm'
$env:QRGEN_EAN_REBUILT_OUTPUT_DIR = '<fresh output outside this package and repository>'
node ./evaluate-rebuilt.mjs --sanity-only
# Use another fresh output for the complete comparison:
$env:QRGEN_EAN_REBUILT_OUTPUT_DIR = '<another fresh output directory>'
node ./evaluate-rebuilt.mjs
~~~

The frozen evaluator's summary gates payload retention and new no-code output; independent supplements check family, bytes, counts, geometry, new values, and diagnostic-only changes. The retained independent replay scripts describe their original source-layout inputs and are audit code, not a self-contained decoder replay from these compressed portable files.

No held-out corpus, phone/browser/worker integration, native memory-safety, arbitrary minLineCount policy, field deployment, or Scandit comparison is established here. Rejection can change subsequent global scheduling/searches. The observed line-support reduction is relevant to untested larger thresholds. This package records evidence and unresolved cases; it does not approve production use.
