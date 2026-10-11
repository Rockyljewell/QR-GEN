# Isolated staged SDK browser validation — 2026-10-11

This is evidence for two **nonproduction diagnostic SDK copies** based on QR-GEN `6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b`. The actual public `scanImage`, `generate` and `BarcodeScanner` APIs ran in Chromium153.0.8010.12. Camera cases used static fake-camera Y4M inputs and the SDK's actual embedded classic Web Worker. The stable repository, package, defaults and deployment were unchanged.

The candidate suppresses the known `/07` EAN-13 wrong output in this bounded integration study. It **does not recover the target**, still returns the wrong value in UPC-A-only scope, and still reports the extra `/35` value. This is not evidence of general accuracy improvement, phone readiness, latency equivalence or Scandit parity. No Scandit SDK or demo was used in this study.

## Observed outputs

| Frozen input / public format scope | Baseline | Candidate |
| --- | --- | --- |
| Actual Chrome `/07`, EAN-13; ImageData, inversion-enabled ImageData, normalized Blob, main camera and actual Worker camera | Wrong `0798884816632` | Empty: suppression and target miss |
| Actual Chrome `/07`, UPC-A only; ImageData and both camera engines | Wrong `798884816632` | Same wrong output |
| `/35` original, synthetic derived, and separately captured actual camera pixels, EAN-13 | Target `5030159003930` plus extra `7034759003930` | Same target plus extra |
| Clean QR, EAN-13 and UPC-A; clean mixed formats | Exact controls | Exact controls |
| White no-code image | No outputs observed | No outputs observed |
| Mixed actual `/07` plus QR image | Exact QR plus wrong EAN-13 | Exact QR, EAN-13 target missed |

The SDK normalizes UPC-A public `data` to12digits; preserved `rawBytes` may retain the reader's13digit HRI representation. This study uses the public SDK representation contract. The source corpus's sidecar truth is a reference output, not proof that every image contains precisely one physical symbol.

The original run remains `run-01/`:28fresh-context sessions consisting of24public image cases,16camera cases with10frame events each, and10transport sessions. The positive transport cameras contribute60additional clean-control frame events, reported separately from the160core camera frame events. Four proposed opposite-variant URL/binary assets were rejected by the **diagnostic inventory guard before SDK calls**; these are not SDK authentication tests.

All16core camera cases reached the explicitly requested main/Worker engine, matched preflight pixels exactly, and completed10frames. The clean mixed cases paused after5frames, stayed at5during250ms, and resumed. All positive sessions had zero page/console/scanner errors. Every completed camera case stopped its tracks and detached its owned video. A healthy shared Worker remained intentionally cached until its context closed; there was at most one per context, and none after context close.

Relative self-hosted WASM URLs, padded `Uint8Array` binary subviews, and **preload-then-offline operation in the same already-loaded context** worked for both variants. Public QR/EAN writer SVG, matrix and PNG hashes were identical across variants. This does not test an offline reload, installation, service worker, cache persistence or cold app startup. Cold reader URL loads while offline, and deliberately corrupt non-WASM reader URLs, returned `engine-load-failed`, with no ready/frame/scan success. Their expected engine/network console errors are retained separately; the official writer still generated under corrupt-reader configuration.

## Frozen protocols and separate supplements

- `original-protocol.json` was frozen before any staged SDK decode. Its bytes are unchanged. `predecode-amendment.json` accurately permits the candidate's version-metadata import overlay, the released baseline dependency graph, and the absence of an esbuild metafile. `assets-and-inputs.json` binds the actual assets and browser inputs before decoding.
- `late-cleanup-01/` is a separately frozen4session cleanup supplement. The original failed-start records observed cleanup before native camera permission promises had settled. In the supplement all four native promises actually resolved after failed start; the late-acquired tracks were ended, videos detached with null streams, and Workers/context/browser/server closed. Its protocol is `cleanup-supplement-protocol.json`; these are not additional accuracy cases.
- `iife-01/` is a separately frozen2context classic-script supplement. `window.QRGen` public generate/scanImage produced exact clean QR/EAN controls, baseline wrong `/07` versus candidate empty, identical writer hashes, and zero page/console errors. No camera or Worker started. See `iife-supplement-protocol.json`.
- `verification-first.json` preserves the first offline verifier's954checks and2failed telemetry assertions. The original runner sampled `offlineAtResponse` **after awaiting response.body()**, so it actually means offline status at body-hash completion. The writer preload completed before the browser's offline transition, although its asynchronous evidence hash completed later. `verification-correction.json` explains the invalid oracle. No observations were overwritten. The corrected offline evidence verifier records954checks with zero failures in `verification.json`; these validate provenance/integration and faithful known defects, not954correct recognitions.
- `portable-replay-01/` is a separately predeclared2context T03replay validating the portable launcher and synchronous request-start telemetry. Both variants made zero HTTP requests after the offline transition, generated/round-tripped QR, and returned exact mixed-camera controls through the actual Worker. Its29mechanical assertions pass in `portable-replay-verification.json`. Original matrices are unchanged. See `portable-replay-protocol.json`.

## Asset and input provenance

Baseline uses the official released3.1.5reader graph; its WASM is byte-identical to the rebuilt baseline from the isolated diagnostic workflow. Candidate uses the entire matching candidate ESreader/share graph for main decoding, inversion and embedded Worker. Candidate `config.ts` changes only the version-metadata import; version remains3.1.5 and its default CDN remains the released engine. Explicit matching assets are mandatory here. No config logic or public options changed. There is **no retained esbuild metafile**; the source/dependency graph inventories, generated Worker string and built consumer hashes are the available proof.

| Asset | SHA-256 |
| --- | --- |
| Baseline reader WASM | `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931` |
| Candidate reader WASM | `f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6` |
| Unchanged official writer WASM | `af26f895fe471d23cb2d742bc3eca0695dbecb4ea6bad9b92eba3763ec505941` |
| Baseline public ESM bundle | `173d505011791797f5ceb6d4744b7a47b94d2029f872331864363e2a359d18a1` |
| Candidate public ESM bundle | `5d8ce71c0c644e4d1254bf3d1bc28c2f4c056c26f4cf836b979d0df630202543` |

The reader builds are from [isolated workflow38152527079](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152527079), head`3cfe7298`, artifacts11707386971/11707446910. That provenance does not imply the staged SDK itself was published. Exact SDK IIFE, Worker source, supplied binary/init bytes and loaded JS/WASM response hashes are in the binding and per-session records. `ENGINE_VERSION=3.1.5` alone cannot distinguish the candidate. The public SDK accepts configured valid same-ABI binaries and does not authenticate their SHA-256. Deliberately corrupt bytes exercise compilation failure; a valid-but-wrong reader could execute. No such authentication claim is made.

Actual `/07` Chrome PNG is SHA`63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399`, RGBA`ec287e182dca32d86261e719e4a9525277023ba1872394ca6d4fa4e454fc7107`. The new actual `/35` camera raster is RGBA`d541c968327263f312d61784910da4307e1b1eb263171251286080c65d7e309a`; it differs from the earlier synthetic derived35raster and is kept distinct. Bare camera preflight imported no SDK and ran no decoder. Worker telemetry hashes every posted frame before its buffer transfers; main-camera evidence hashes the actual ready-frame pixels. All Y4Ms repeat static frames.

Photo sources and sidecar truth are pinned to [ZXing commit5bdcab8035f6d26107cfad32d1aa2a85455efbc5](https://github.com/zxing/zxing/tree/5bdcab8035f6d26107cfad32d1aa2a85455efbc5), under Apache-2.0. `/07` and `/35` metadata are in `source-and-license-receipts.json`; licensed upstream photos are not duplicated here. Keep `ZXING-LICENSE.txt`, `ZXING-NOTICE.txt`, `ZXING-REUSE-dep5.txt`, `QRGEN-LICENSE.txt` and `QRGEN-NOTICE.txt` with this package. The camera conversion is documented by the frozen preparation script/helper fingerprint and prior browser diagnostic package. No downloaded corpus, SDK glue, WASM, large frame PNG or Y4M is included here.

## Portable replay

Recorded JSON files and archived scripts are immutable evidence. `archived/` scripts describe the original local run; their original common-module hash is retained rather than shipping its host-specific defaults. The **derived** `replay.mjs` and `replay/` scripts use environment paths, add accurate synchronous request telemetry, and write only into a new external directory. They reject output inside this package, a checkout, staged assets or fixture inputs, and reject every existing output directory. Five rejection probes and one input-only check pass in `portable-path-guard-checks.json`.

Requirements: Node with the checkout's Playwright/Sharp dependencies, matching Chromium153if exact recorded pixel hashes are expected, both matching staged consumer packages, and an externally prepared fixture directory. `assets-and-inputs.json` lists every required PNG/Y4M filename, byte count and SHA. The launcher checks every fixture and SDK asset **before any decoder is called**; it does not download or regenerate arbitrary replacements. The original artifact study retains these inputs. Fresh camera setup with different pixels is inconclusive, not a decode failure.

Set `QRGEN_DIAGNOSTIC_REPO` to the dependency checkout, `QRGEN_STAGED_SDK_ROOT` to the external directory containing `consumers/baseline/package` and `consumers/candidate/package`, `QRGEN_STAGED_INPUT_DIR` to the frozen external `fixtures` directory, and `QRGEN_CHROMIUM` to the installed Chromium executable. Optional `QRGEN_DIAGNOSTIC_PORT` defaults to4352. Commands below are run from this package directory:

```text
node verify-records.mjs .
node replay.mjs <new-external-directory> check-inputs
node replay.mjs <different-new-external-directory> offline-smoke
node replay.mjs <different-new-external-directory> all
node replay.mjs <different-new-external-directory> cleanup
```

`check-inputs` runs no decoder and writes nothing. `all` replays the28ESM sessions; `offline-smoke` replays only the twoT03contexts; `cleanup` replays only the four late-camera failure sessions. All fresh outputs remain separate from recorded evidence. The archived IIFE runner records its classic entrypoint protocol; a new IIFE replay requires explicitly binding a fresh external work directory rather than executing an archived runner in this package.
