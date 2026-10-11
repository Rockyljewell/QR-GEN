# Actual public SDK Node integration: isolated EAN candidate (portable report v3)

The staged candidate passes the recorded public Node integration gates while preserving the known limitations. This is an experiment using extracted diagnostic SDK archives; QR-GEN's production package, dependency, website and defaults were not changed. It is not a supported preview release or a complete fix for [issue32](https://github.com/Rockyljewell/QR-GEN/issues/32).

There are **1,162 option profiles across551 frozen rasters**, executed through four independent baseline/candidate × ESM/CommonJS processes: **4,648 public `scanImage` calls** on Node24.19.0. The551 rasters are inputs to those profiles, not an additional multiplier. Root's separate clean Node18/24 smoke cases, prior raw-WASM/native/browser matrices and this matrix are separate evidence; their counts are not combined here.

| Scoped check | Result |
| --- | --- |
| Lost baseline expected targets, target bytes or complete target records | 0 |
| New public data/symbology/rawBytes values | 0 |
| ESM/CommonJS public-output differences | 0 |
| SDK errors, input-buffer mutations, field/dimension/cap violations | 0 |
| Network attempts or unexpected WASM compilation hashes | 0 |
| Outputs on explicitly labelled no-code inputs | 0 |
| Saved72 generated format cases, fast and hard search | All144 profiles exact in each package/entry process |

The baseline compiled only reader SHA256`aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`; the candidate compiled only`f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6`. Interception was installed before each package import. Both packed writers retain SHA256`af26f895fe471d23cb2d742bc3eca0695dbecb4ea6bad9b92eba3763ec505941`, but this matrix performs no generation/writer calls. Package/source provenance and all shipped95-file/28-export inventories are retained under `staged-build/`; binaries and archives are omitted.

## What changed, and what did not

Ten profiles per entry format changed, all by suppressing the known wrong `/2/07` value on the derived and actual Chrome rasters. These are repeated options on two selected rasters, not ten independent photographs or a false-positive rate. All ten become empty: this is **suppression/miss, not recovery** of truth9780804816632. Four explicit UPC-A-only focus profiles still return wrong public data798884816632. The separate `/1/35` wrong value7034759003930 is unchanged in six wrong-present profiles. Fast-search misses and the other existing misses remain visible.

Eight companion-mismatch records (baseline/candidate observations on four other photos) remain: ean13-1-5, ean13-2-14, ean13-2-20 and ean13-2-24. They are labelled unreviewed mismatches or possible secondary visible barcodes, not automatically established false positives. The inherited photo manifests preserve the exact companion labels and licensing. This development corpus does not establish population accuracy, held-out performance or Scandit parity.

## Frozen inputs and public contract

`PROTOCOL.md` was prepared before decoding. Original public-plan SHA256 is`1e6042ae022e0e902410aaf8094918cef564c2e01d438a7932598d29fd497a65`; the inherited raw-plan SHA256 is`03eb911057351f594004eb3450f1a83b60e00360dbadefccda8d709e0403a4ab`. The core479 contains157 original EAN photographs,157 frozen derivatives, one actual Chrome frame,144 generated thin positives,12 generated no-code controls and eight real no-code rasters. Add the existing72 generated multi-format fixtures for551 unique rasters. No symbol regeneration or input tuning occurred.

502 existing PNG files were reused only after their decoded pixels matched the frozen RGBA hash.49 other frozen rasters used lossless RGBA PNG transport to make the public encoded-image path receive exactly those pixels. Source hash, frozen pixel hash, transport hash and dimensions are retained for every item. `independent-transport-verification.json` separately rechecks all551 identities against the original raw plan after the matrix, with zero failures and no SDK execution. `preparation-history.md` discloses the metadata-only predecode preparation failure; all measured matrix runs completed once.

Core479 uses EAN13-only, maxResults255, tryInvert true and fast/hard search (958 profiles). Saved72 uses each fixture's own public symbology and fast/hard (144 profiles). The five selected07/35 original/derived/Chrome rasters also vary EAN13/UPC-A/mixed scope and limits1/2 (60 profiles). These are only public API options. Downscale/add-on/minimum-line policies remain the SDK's unchanged defaults and are not claimed as independently controlled here.

Full recorded outputs retain all current enumerable public Barcode properties except top-level timestamp: data, symbology, symbologyName, rawBytes, contentType, isGS1, location, frameSize, orientation, ecLevel and symbologyIdentifier. Unknown enumerable properties would also be retained; symbol keys are rejected. This does not claim capture of hypothetical nonenumerable future fields. Undefined/nonfinite values are explicitly tagged rather than silently removed by JSON. UPC-A data uses the SDK's conventional12-digit representation, while rawBytes preserves the reader's original bytes; no equality between data and UTF8(rawBytes) is assumed. Comparison includes complete expected-target records, bytes, multiplicity and geometry, as well as ordered full outputs. `lostTargetEvents` means events, not unique profiles.

## Integrity and portable replay

Run `node verify-package.mjs` or `node replay.mjs --verify-only`. Both perform file/hash verification only, with no SDK or image decoder execution. The four gzip JSONL files under `results/` expand to **exact original recorded bytes**, including complete public outputs and diagnostic per-call timings. Their original uncompressed hashes are in the inventory. Timings came from overlapping independent processes and are not a comparative performance benchmark.

`portable-plan.json.gz`, `portable-summary.json`, the run summaries and staged provenance are explicitly derived documents: host paths are tokenized and replay hints are added. `original-evidence-hashes.json` records the original byte hashes; no portable derivative is claimed byte-identical to its original. Payload, options, image identities, geometry and public metadata are preserved. `freeze.json` is the original preparation freeze record and refers to the original plan, not the portable plan's bytes.

To replay actual SDK calls, obtain the exact extracted diagnostic baseline/candidate packages, the prior frozen EAN study input cache, saved72 prepared fixtures and the pinned PNGjs7.0.0/Sharp dependency environment. The source photograph download/preparation recipe and license are in the sibling ean-linecount-study package; the thin fixtures use its predeclared generated arm. The72 fixtures are the unchanged prepared-fixtures from the actual rebuilt-reader matrix. This compact report deliberately omits images, WASM, tarballs and node_modules. Missing inputs fail visibly; replay neither downloads nor regenerates barcode fixtures.

With Node24 (recorded24.19.0), set:

```powershell
$env:QRGEN_EAN_STUDY_CACHE_DIR = '<frozen EAN cache with images,derived,generated,uniform-negative>'
$env:QRGEN_EAN_PREPARED_FIXTURES_DIR = '<actual-matrix-v1/prepared-fixtures>'
$env:QRGEN_DEPENDENCY_ROOT = '<checkout or SDK package supplying pinned sharp/pngjs>'
$env:QRGEN_STAGED_BASELINE_ROOT = '<extracted baseline package>'
$env:QRGEN_STAGED_CANDIDATE_ROOT = '<extracted candidate package>'
$env:QRGEN_STAGED_MATRIX_OUTPUT_DIR = '<new external output directory>'
node ./replay.mjs
```

The derived replay runner checks the report inventory, verifies all frozen source hashes and pixel hashes, reconstructs only the lossless transport files when necessary, and verifies their exact hashes before any SDK call. It copies the original execution/summarization runners into the fresh external workspace, writes a separately identified resolved-path replay plan, then runs all four package/entry cases. Output cannot be inside this package, dependency checkout, frozen input caches or consumer package, including through existing symlinks/junctions; existing output is rejected. Leaving the output variable unset selects a new system temporary directory. Fresh replay observations are never substituted for historical records. The portable replay has been syntax/integrity checked, not rerun as a second measured matrix.

## Provenance and remaining gates

Product base is6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b. Matching candidate wrapper/WASM came from [run38152527079](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152527079), head3cfe7298c1d92eb2d4ac56158a1bfcd51275f070, zxing-wasm b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54 and C++2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4. Patch SHA256 isf80daf81fe49616e59b250fac96e25a6c5d73ee5e59e6511cec5b98dc2bd7fae. The official writer remains3.1.5. The diagnostic package versions and archive hashes are in the staged inventory; no npm publication occurred.

The loader experiment does not validate default upstream CDN selection, candidate identity in public capabilities, arbitrary custom/cross-paired binaries, a public preview asset URL, existing self-host/service-worker cache migration, physical phones, iOS/Android/Python patching, thermal/memory/field stability or a licensed matched Scandit comparison. The public capability version remains3.1.5 and is not a unique candidate identity. Actual browser/worker/offline integration is a separate study. Issue32 remains open because35 and UPC-A-only residuals are unresolved.

The photos and inherited derivatives are attributed to ZXing authors under the pinned source's Apache-2.0 license/NOTICE/reuse metadata, retained here with the exact source URLs and labels in `inherited-inputs/`. Generated controls are fixed synthetic diagnostic fixtures. QR-GEN runner code follows its Apache-2.0 license. No upstream wrapper/WASM implementation is redistributed in this report.

## Portable replay v2 provenance safeguard

The original32-file v1 package and measured records remain unchanged. Review found that v1 did not preflight caller-supplied consumer SDK files before loading them. This v2 adds a pre-import check of all95 historical SDK files and all28 export targets per consumer, exact ESM/CommonJS public-entry containment through real paths, expected reader/writer asset hashes, and the27 retained released-reader ES dependency files for baseline. It rejects missing, added, changed or escaping SDK files. Supply each extracted package root; optional entry variables must still equal its verified public Node export. Run `node replay.mjs --preflight-only` to perform only those checks, without SDK imports, image preparation or decoding.

The95-file inventory excludes external node_modules. The retained baseline ES graph is verified, but no complete historical external CJS/dependency tree inventory exists; other writer/codec/tooling dependencies remain an explicit replay requirement and integrity limit. The active reader bytes are additionally checked at compilation during a real replay. No arbitrary dependency or cross-pair compatibility is claimed. `portable-v2-derivation.json` records the prior package manifest and changed replay files. The portable provenance checks were exercised on retained consumers and a tampered-consumer rejection, with no SDK calls; the complete measured matrix was not repeated.

## Portable replay v3 output isolation

The v1/v2 report directories and all historical measured results remain unchanged. Read-only review found that v2 checked explicit output paths but did not apply the same check when selecting the system temporary directory. An environment such as TEMP/TMP pointing inside a protected tree could therefore create fresh replay files there. No historical SDK result changed.

This v3 calls the same file-only `planReplayWorkspace` guard for both choices **before any replay mkdir/mkdtemp**. It resolves existing parent paths for explicit outputs and resolves the system temp directory itself through any symlink/junction, then rejects package, dependency, frozen cache/prepared-input and both consumer trees. It returns canonical paths for creation. An ordinary external default temp directory remains accepted; existing explicit output remains rejected. Consumer preflight and the limits on external CJS/dependency integrity are unchanged.

`portable-v2-derivation.json` and `portable-v2-validation.json` retain their exact v2 bytes. `v2-package-manifest.json` is the archived prior manifest, not the active v3 inventory. `portable-v3-derivation.json` binds the prior manifest and the narrow guard-only change. `portable-v3-validation.json` records29passing file-only probes: direct/default and explicit paths through six mock protected roots, actual Windows junction aliases, ordinary external acceptance, existing-output rejection, and unchanged protected mock trees. There were zero SDK, WASM, fetch, browser or matrix calls. The first sandboxed probe setup could not create its mock junction; that EPERM setup failure is preserved separately in `v3-probe-setup-history.json`. A fresh authorized artifact-only probe tree completed all cases; no real package/input/consumer tree was written.

To repeat only the mock filesystem probes, use `node check-output-guards.mjs <new-external-probe-directory>`; on Windows this requires permission to create junctions inside that fresh directory. The probes never import an SDK or run the measured matrix. The full portable measured replay remains unexecuted.
