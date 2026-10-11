# Isolated EAN candidate: real Chromium and Web Worker checks

This bounded diagnostic runs each rebuilt reader with its **own matching ESM wrapper and WASM** in real Chromium, directly and in a real module Worker. It does not integrate the candidate into QR-GEN, use a camera stream, test a phone, compare Scandit, or establish broad accuracy or latency. Production code and historical comparison records are unchanged.

## Two preserved runs

The first protocol was frozen before decoding. It recorded 56 reads (14 cases × 2 builds × main/worker) at **2026-10-11 15:52:41 UTC**. Its strict output oracle passed 44 checks and failed 12: three UPC-A cases had incorrectly expected SDK-normalized 12-digit text rather than raw-reader HRI text. All raw reads completed; both readers returned the same leading-zero 13-digit UPC-A representation. The original protocol and results remain byte-for-byte unchanged.

After source confirmation, a **separate corrected protocol was frozen at 15:54:25 UTC**, before the fresh repeat at **15:55:41 UTC**. Only those UPC-A expected strings changed. All 56 corrected expected-output checks passed. Images, seven browser RGBA rasters, reader options, build assets, and all 56 full raw outputs are identical across the two runs. These are output-contract checks, **not 56 correct barcode recognitions**; some expectations deliberately reproduce a known false result. The runs are not combined into an accuracy score.

The raw UPC-A HRI output is `0798884816632` on the problematic frame and `0012345678905` on the clean UPC-A control. QR-GEN's existing `packages/sdk/src/engine/convert.ts:98` strips one leading zero from 13-digit UPC-A. That SDK conversion is not called here. The amendment retains source/file hashes and references to the first run.

## Observed behavior

| Case group | Baseline | Candidate |
|---|---|---|
| Known actual Chrome full-frame PNG, EAN13-only, tryInvert true/false × tryDownscale true/false (4 cases) | Wrong EAN13 `0798884816632`, lineCount 2 | Empty: suppression/miss, **not recovery** of truth `9780804816632` |
| Same PNG, UPC-A-only, downscale true/false (2) | Wrong raw UPCA `0798884816632` | Same wrong result; this scope deliberately bypasses the candidate EAN13 filter |
| Clean EAN13, QR and UPC-A (3) | Exact under raw representation contract | Same exact controls |
| Clean EAN13 under UPC-A-only scope (1) | Empty | Empty; scoped control, not universally code-free |
| Blank white frame (1) | Empty | Empty |
| Mixed clean EAN13 + QR (1) | Both exact | Both exact |
| Known actual PNG + clean QR, inversion true/false (2) | Wrong EAN13 + exact QR | Exact QR only; wrong EAN suppressed |

Every group was run on both main and actual Worker execution paths. Each run had 28 identical main/worker pairs, zero page/console errors, all Worker operations completed, both Workers terminated (zero retained), and browser/server closed. Start/end asset manifests are equal. Elapsed values are diagnostic timestamps only; no comparative performance inference is made.

## Artifact provenance

[Successful build run 38152527079](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152527079), diagnostic branch head `3cfe7298c1d92eb2d4ac56158a1bfcd51275f070`, built upstream zxing-wasm commit `b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54` and zxing-cpp `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`. Both report reader version 3.1.5. Chromium was 153.0.8010.12.

| Build | Artifact ID | Artifact ZIP SHA-256 | Reader WASM SHA-256 |
|---|---|---|---|
| Baseline |11707386971|5a977f4f3388d0f11b0e18ca52416ca1b9e28a1bf784d6ed1e0f4e732a7a0c6c|aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931|
| Candidate |11707446910|fda7d5c917c4dc2fc28092b64fc4f605bcbf126f2db9da043bcb2774f1b4283b|f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6|

Both ZIPs were checked against the GitHub artifact API digests. The baseline WASM is byte-identical to the released 3.1.5 reader. Each own ESM import graph, raw glue and WASM was hashed before and after. Actual loaded `reader/index.js`, `share.js` and WASM response bodies matched those hashes. Both main and Worker code verified the wrapper-declared WASM hash against the fetched binary before instantiation, and reported version/CPP commit. Worker metadata identifies `DedicatedWorkerGlobalScope`, with no window. The raw glue is retained in the upstream build artifact; the imported ESM wrapper contains its matching compiled glue.

`verified-run.json`, `verified-artifacts.json`, `build-metadata/` and the recorded result manifests retain exact IDs, compiler metadata, patch/source hashes and loaded assets. The patch metadata's original “not compiled yet” scope describes its pre-build creation stage; subsequent successful run/build records establish the actual compiled artifacts tested here. No WASM, upstream SDK/glue, keys or large frame corpus is copied into this package.

## Inputs and options

The captured PNG is reused from the earlier browser diagnostic: PNG SHA-256 `63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399`, decoded 640×480 RGBA SHA-256 `ec287e182dca32d86261e719e4a9525277023ba1872394ca6d4fa4e454fc7107`. It is a selected known failure derived from the pinned ZXing ean13-2/07 photograph, not an unseen sample. `camera-input-provenance.json` records the source, truth, prior image-to-Y4M geometry and captured raster. The historical 40+14 comparison is unchanged.

The three small generated control PNGs are included and hashed. EAN13 payload `5901234123457`, QR payload `QRGEN-RAW-READER-CONTROL-20261011`, UPC-A payload `012345678905` were generated once at scale 3. Replay copies those exact PNGs, without regenerating from a different writer. The mixed 640×480 canvases place QR at (24,20), and clean EAN at (100,300) or the existing full frame at (0,0), with no image resizing. Their browser pixel hashes were frozen before any reader decode.

All cases explicitly use tryHarder=true, minLineCount=2, maxNumberOfSymbols=255, LocalAverage, tryRotate=true, tryDenoise=false, isPure=false, downscaleFactor=3, downscaleThreshold=500, validateOptionalChecksum=false, returnErrors=false, add-on Ignore, HRI, characterSet Unknown and Code39-extended=true. Cases vary only the predeclared formats/inversion/downscale settings. Full options and outputs (including positions, bytes and lineCounts) are in both frozen protocols/results. Clean-control and blank cases do not bound untested false positives, recall or formats.

## Replay without modifying recorded evidence

Use Node, Playwright and installed Chromium. A QR-GEN checkout with its usual site dependencies can supply Playwright; no source build is needed. Obtain and preserve both original GitHub artifact ZIPs before expiry, then extract each into this layout:

```text
builds/
  ean-word-baseline.zip
  ean-word-candidate.zip
  baseline/dist/es/reader/index.js  (and the entire matching dist/es graph)
  baseline/zxing_reader.wasm       (and original remaining artifact files)
  candidate/dist/es/reader/index.js  (and the entire matching dist/es graph)
  candidate/zxing_reader.wasm       (and original remaining artifact files)
```

Set `QRGEN_EAN_REBUILT_DIR` to that builds directory and `QRGEN_COMPARISON_REPO` to the dependency-bearing checkout. Optionally set `CHROMIUM_PATH` and `QRGEN_EAN_BROWSER_PORT` (default 4344). The captured PNG defaults to sibling `../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png`, then the same path under the checkout's docs; `QRGEN_EAN_CHROME_PNG` overrides it. Its frozen hash is mandatory.

Set `QRGEN_EAN_BROWSER_OUTPUT_DIR` to a **new directory outside this package**, or let a new temporary directory be created. Run:

```text
node <package-directory>/replay.mjs
```

The runner verifies the retained API record, exact ZIP/WASM/wrapper hashes and entire extracted JS/glue/WASM graph against the frozen manifest, serves only allowlisted artifact files on localhost, recreates and verifies all seven pixel hashes, and performs the same 14 cases on main/Worker. A mismatch fails visibly. It records fresh observations without overwriting this package. The final packaged-runner validation, following an earlier packaging smoke, reproduced all 56 full raw outputs exactly; `portable-replay-validation.json` records that replay separately as portability verification, not an additional accuracy aggregate. `recorded-run.mjs` and `corrected/recorded-run.mjs` are immutable scripts used in the original artifact workspace, retained as records; use `replay.mjs` for portability.

## License and scope

Attribution: ZXing authors. The source photograph and previous captured derivative are Apache-2.0 licensed per the pinned ZXing repository's LICENSE, NOTICE and reuse metadata, retained in `licenses/`. [Pinned original photo](https://raw.githubusercontent.com/zxing/zxing/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox/ean13-2/07.png) and [exact companion truth](https://raw.githubusercontent.com/zxing/zxing/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox/ean13-2/07.txt) are recorded in the input provenance. The selected case and generated controls cannot establish general improvement, safety for untested labels, SDK/camera integration, phone behavior or Scandit parity. No API/default change is recommended from these bounded results.
