# Photographic and no-code demo observations, 2026-10-11

The original run used 20 frozen ZXing blackbox images: 16 positive cases across QR, Data Matrix, PDF417, EAN-13 and Code 128, plus four visually reviewed no-code controls. QR-GEN showed the exact expected payload in 13 positive cases; Scandit showed it in 15. QR-GEN had no exact visible result for EAN-13 cases -01, -07 and -21; Scandit had none for -01. Both demos showed no visible results for all four no-code controls. All 40 observations had live video and no page or console errors. Scandit no-code outcomes mean no visible outputs observed; live video and public controls do not prove that its internal decoder remained active or establish a false-positive-free result.

These are observations of two demo workflows with identical camera files. They do not establish decoder, latency, stability or phone parity. QR-GEN continuous mode derives an aiming region from its viewfinder; Scandit's internal scan region is not inspected. Selected formats were matched where the public UI permits, but Scandit combines EAN-13/UPC-A. QR-GEN's default inversion setting alternates frames; Scandit's Color Inverted option remained off. No result is classified as a proprietary decoder defect.

A separate, predefined follow-up repeats the three EAN-13 inputs and all four no-code controls once in both demos. It observes a full 20 seconds after readiness, retains the original settings, and records QR-GEN's effective options, scan region and preview geometry. The original aggregate remains unchanged. Sampled QR-GEN EAN-13 settings were continuous mode, tryHarder=false, maxDecodeSize=1280, maxFps=24, alternate inversion and a line viewfinder. Its effective normalized region was x=0.03511625,y=0.314,width=0.9297675,height=0.372 on a 640x480 feed; the preview measured 650.65625x560. The separate follow-up reproduced the same outcomes: Scandit read EAN-13 -07/-21 and showed no exact result for -01; QR-GEN showed no exact result for all three. Both again showed no visible outputs for the four controls. All 14 follow-up observations had no page or console errors.

| Original format | QR-GEN exact payload | Scandit exact payload |
| --- | ---: | ---: |
| QR | 4/4 | 4/4 |
| Data Matrix | 3/3 | 3/3 |
| PDF417 | 3/3 | 3/3 |
| EAN-13 | 0/3 | 2/3 |
| Code 128 | 3/3 | 3/3 |

`photographic-comparison-2026-10-11.json` retains all 40 original and 14 follow-up observations separately. Repeated diagnostics and loaded assets are stored once in hash-addressed maps; each observation references its exact start/end diagnostics and loaded asset set. `verification.json` records the final input, settings, readiness, output and asset consistency checks.

## Inputs and provenance

- ZXing source: `5bdcab8035f6d26107cfad32d1aa2a85455efbc5`.
- Selection frozen before any decoder run at `2026-10-11T14:14:25.147Z`; selection digest `22667937525331487eb722f9544b33f723c4b30c07418b43d5a88c89d976a6ce`.
- Exact UTF-8 companion `.txt` contents supply positive payloads without trimming. Family Java test classes supply expected formats. Universal `MultiFormatReader` negative test classes and visual inspection support the no-code oracle. Upstream negative suites permit some false positives; these controls are not a population false-positive-rate estimate.
- Original image, companion answer, test class and generated camera SHA256 values are retained in `corpus-manifest.json` and `fixture-preparation.json`. Images with multiple complete codes but only one supplied answer were excluded before decoding.
- Most selected cases are camera photos with tilt, curved surfaces, shadows, dense symbols or soft edges. QR small-code case -6/1 and PDF417 -2/25 look rendered and are explicitly controls. Condition labels based only on visual review are identified as inferences.
- This is an external upstream regression corpus, not an independent or statistically held-out dataset for QR-GEN's ZXing-derived engine. Sixteen positive cases contain repeated payloads; no population success estimate is intended.

The camera converter preserves original pixels when they fit, downsizes only oversized inputs with Lanczos3, and centers them in a 640x480 grayscale YUV420 frame. It adds no blur, crop, contrast change or upscaling. Luma is the recorded BT.601 limited-range formula, chroma is neutral, padding Y is 200, and 30 identical frames are written at 30 fps. QR -6/1 is the only resized input (500x500 to 480x480). The test concerns these transformed camera inputs, not direct decoding of the original PNGs.

## Application provenance

QR-GEN was freshly built from `37185d8c87bc5827942733e8e5716bc4a128af0a` after verifying that revision and clean web inputs. A local preview served that unchanged build while newer commits landed elsewhere. Each case records SHA256 of the actual loaded JavaScript chunks and WASM. The standalone `sdk/qrgen.js` file is retained as build metadata but the demo imports compiled `_astro` chunks; it is not used as a substitute for hashing actual loaded code.

Scandit's ordinary public demo displayed `v.8.6.1` in every case. Its public preset/settings UI selected formats, Color Inverted remained off, and Extended Symbol Counts remained off. No proprietary bundle, license key or hidden SDK state was extracted. The runner used Start Scanner, Start Scanning, Settings, Expand list, Clear List and Resume Scanning through ordinary accessible UI controls. Scandit's live video and configured scanner UI are a readiness proxy; its internal decoder activity and scan region are not inspected. Resume Scanning can remain visible in the public result-list UI even when no item is listed.

The first aborted setup report used an incorrect assumption about the QR-GEN asset URL and stopped before a QR-GEN observation. It is retained outside this compact package and excluded from all totals. The corrected original runner hashed actual loaded chunks and WASM. Portable runner copies add environment-based paths and richer QR-GEN diagnostics without changing original UI settings or payload selection.

## Reproduce

Use Node 24 and a separate clean QR-GEN checkout at the pinned application commit. Install its lockfile dependencies, build it, and install Playwright's Chromium if needed. Do not build a newer checkout over the pinned assets during the run.

```powershell
npm ci
npm run build
npx playwright install chromium
$env:QRGEN_COMPARISON_REPO = (Get-Location).Path
$env:QRGEN_COMPARISON_OUTPUT = Join-Path $env:TEMP 'qrgen-photo-evidence'
node <evidence-package>/prepare-photo-corpus.mjs
node <evidence-package>/public-photo-comparison.mjs
node <evidence-package>/public-photo-readiness-followup.mjs
node <evidence-package>/make-summary.mjs
```

`<evidence-package>` is the directory containing this README. `CHROMIUM_PATH` may name a specific Chromium executable; otherwise Playwright uses its installed browser. `QRGEN_COMPARISON_URL` may select an already-running preview, but loaded files must still match the saved build proof. Default preview port is 4347. Output and downloaded images stay in `QRGEN_COMPARISON_OUTPUT`; large PNG/Y4M frames are not part of this package.

The preparation step downloads only pinned public files, checks source/answer hashes and exact answer text, regenerates every Y4M hash, and checks the build against the pinned proof. It makes zero decoder calls. `--fixtures-only` skips the local build proof check. A mismatch, public UI blocker or timeout is reported distinctly; a vendor setup blocker stops further unchanged attempts for that vendor. The full run creates raw JSON, then the predefined follow-up creates separate raw JSON. Public demo UI/version changes may prevent reproduction; do not silently update a version or input and combine it with this run.

Static replay does not cover motion, autofocus, changing glare, rolling shutter, phone heat, native SDKs, physical inventory or field reliability. A repeated Qty count for one static label is not evidence of multiple physical items. Physical phone validation remains unexecuted.

## License and primary sources

ZXing declares the test corpus under Apache-2.0 through its [repository license](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/LICENSE) and [REUSE declaration](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/.reuse/dep5). Copyright 2007-2020, ZXing authors. `ZXING-LICENSE.txt`, `ZXING-NOTICE.txt`, `ZXING-REUSE-dep5.txt` and the blackbox README are retained with their source hashes. Downloaded images are unmodified originals; the deterministic grayscale camera conversion is described above.

The [blackbox corpus](https://github.com/zxing/zxing/tree/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox), [positive test base](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/java/com/google/zxing/common/AbstractBlackBoxTestCase.java), [negative test base](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/java/com/google/zxing/common/AbstractNegativeBlackBoxTestCase.java), [Scandit fake-camera guidance](https://docs.scandit.com/sdks/web/testing/) and [public demo](https://websdk.demos.scandit.com/) are the primary references. Family test-class URLs and hashes are recorded per selected case.
