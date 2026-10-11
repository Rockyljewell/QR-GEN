# Uniform EAN binarizer and contrast exploration

No tested policy provides a validated general improvement. None recovers the correct EAN from the actual Chrome -07 camera frame. Some suppress its wrong read, but lose many correct photo reads or introduce other wrong values. No product source, API, default, build, browser session or historical vendor-comparison observation was changed.

The plan and every transformed input hash were frozen before decoding. Protocol SHA-256: `892ca93257d004e53edbdd9bacc19fce86e9f7446eac835acd876b45f1108138`; pixel manifest frozen at 2026-10-11 15:18:30 UTC. The run made **6,706 reads with zero exceptions**, using clean QR-GEN source `ded21a897cbfc33ac87f423a6f640613b95dfd5f`, local zxing-wasm 3.1.5 / C++ `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`, reader WASM SHA-256 `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`. One read per policy/profile/raster was made; execution timestamps are provenance, not latency measurements or stability repetitions.

All policies apply uniformly to all 157 original EAN photos and their 157 frozen grayscale camera derivatives, the separately retained actual Chrome -07 raster, all 144 thin generated positives, 12 generated no-code patterns and four visually reviewed real no-code photos in original/derived form. The final 479 rasters each receive seven policies × two search profiles. No truth-dependent crop, payload allowlist, successful-image exclusion or winning-per-image setting is used. These are upstream ZXing test images and known difficult cases, not an independent held-out population or a phone/Scandit test.

## Predeclared policies

1. Identity pixels + LocalAverage.
2. Identity pixels + GlobalHistogram.
3. Identity pixels + FixedThreshold (127).
4. Identity pixels + BoolCast (0; raw nonbinary photographs deliberately demonstrate its limits).
5. Full-image integer-luma min→max stretch + LocalAverage.
6. Full-image 1st→99th percentile luma stretch + LocalAverage.
7. Full-image Otsu binary threshold + BoolCast, with the earliest threshold selected on equal scores.

Luma is `(306R + 601G + 117B + 512) >> 10`. Stretches round and clamp to 0–255, preserve constant luma when the endpoints coincide, and include padding in the histogram. There is no spatial crop. Each uses EAN13 only, minLineCount 2, maxSymbols 255, rotate/downscale true, invert false, HRI, Ignore add-on, returnErrors false, and both tryHarder false/true. This is raw matching-engine diagnosis, not a changed public scanner configuration. A predeclared analytical intersection policy accepts only payloads returned by both identity-LocalAverage and percentile-LocalAverage within the same profile.

The pinned implementation delegates LocalAverage's 1D row extraction directly to GlobalHistogram; these are not distinct EAN algorithms in this build. [Pinned HybridBinarizer source](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/HybridBinarizer.cpp#L28-L42). The other binarizer thresholds and supporting-line option are documented in the [pinned reader options](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/ReaderOptions.h#L17-L28).

## Results

Values below are original / derived counts out of 157 for each pipeline. “Exact only” means the companion target is present and no different payload was returned. “Other output” includes mixed target+other and mismatch-only cases; it does not by itself establish a false positive.

| Uniform policy | Fast exact only | Hard exact only | Hard cases with other output |
| --- | --- | --- | --- |
| Identity LocalAverage | 99 / 45 | 114 / 63 | 4 / 2 |
| Identity GlobalHistogram | 99 / 45 | 114 / 63 | 4 / 2 |
| Identity FixedThreshold | 30 / 31 | 36 / 37 | 0 / 0 |
| Identity BoolCast | 0 / 0 | 0 / 0 | 0 / 0 |
| Min→max + LocalAverage | 95 / 45 | 109 / 63 | 7 / 3 |
| Percentile + LocalAverage | 96 / 44 | 109 / 55 | 5 / 3 |
| Otsu + BoolCast | 75 / 27 | 90 / 34 | 1 / 1 |

The 139 photos with explicit upstream EAN13 test classes and the 18 folder-inferred suite-5 cases remain separately counted in `quality-report.json`; no scope was changed after decoding. All 958 LocalAverage/GlobalHistogram output pairs were identical, including returned positions and supporting-line counts. All 630 identity photo/supplement baseline results exactly matched the earlier minimum-line-count study.

The actual Chrome -07 frame never returns the correct target `9780804816632` under any policy/profile. Identity LocalAverage, GlobalHistogram and percentile stretch return wrong `0798884816632` with hard search. Fixed threshold, raw BoolCast, min→max stretch and Otsu turn that wrong value into an empty result. All fast profiles remain empty. Suppression is not recovery.

On ean13-1/35, fixed threshold removes wrong `7034759003930` and reads the correct `5030159003930` in original and derived frames, but its whole-corpus recall losses are substantial. Otsu also removes the hard-search false value in this case, while introducing the same wrong value into the previously exact fast original result. Min→max and percentile retain that known false value under hard search.

Contrast changes introduce additional wrong-strip candidates. Post-hoc visual review confirms one complete visible EAN13 (book cases may also show a five-digit add-on) on these sources: min→max/percentile on ean13-1/5 adds `6412012010412` to printed `8410054010412`; Otsu on derived ean13-1/33 returns `4785551604971` for printed `9781558604971`; min→max on derived ean13-3/01 adds `1790761544200` to printed `9780764544200`; min→max on original ean13-4/12 returns wrong `5780407014989` in fast mode and both that value and correct `9780441014989` in hard mode. These are not explained by a separate visible EAN13. Existing book cases ean13-2/14, /20, /24 and the newly read lower code in /21 retain secondary-code ambiguity; their other values must not be labeled false positives. Annotations change neither inclusion nor truth.

All 280 no-code reads remain empty. Every policy preserves generated thin-label recall of 120/144 per search profile (height-one cases still miss); there are no generated wrong outputs. This bounded control result is not a population false-positive-rate estimate. The analytical identity∩percentile policy still retains the wrong Chrome -07 value and reduces hard exact-only counts to 108 original / 55 derived, so that simple agreement rule does not solve the problem either.

## Interpretation and retained evidence

A uniform fixed threshold improves one known false-read case but rejects many correct photographs. Global stretching can change row patterns enough to create new checksum-valid wrong values, and Otsu has similar tradeoffs. No policy should replace the current default from this evidence. A future candidate would need an independently specified acceptance rule, a separate validation corpus and physical-camera testing; selecting the best known answer among these results is not a deployable rule.

`recorded-protocol.json` records the frozen scope, source/runner hashes and uniform algorithms; `frozen-inputs.json.gz` records every baseline/transformed pixel hash and transform parameters. `recorded-results.json.gz` retains every payload, format, lineCount, validity and position. `recorded-summary.json.gz` retains all classifications and baseline transitions. `quality-report.json` includes the 157/139 scopes and explicit gained/lost exact cases. `validation.json` records baseline equivalence, controls, thin results and intersection-policy totals. `visual-annotations.json` preserves ambiguity and post-hoc inspection details.

The portable runner is `run.mjs`. Gzip archives preserve the original complete UTF-8 JSON bytes, including pre-decode hashes; Node's built-in zlib reads them without extra dependencies. `recorded-runner.txt` archives the exact original script named by the frozen protocol hash; it is for inspection. The portable runner uses the same algorithms and verifies every archived baseline/transformed pixel hash before decoding. It cannot overwrite recorded package files or an existing experiment's results.

From a QR-GEN checkout with existing local zxing-wasm3.1.5, sharp0.35.5, pngjs7.0.0 and Node dependencies, first populate the pinned caches with the sibling study's preparation scripts (these perform no builds):

```text
node docs/ean-linecount-study-2026-10-11/download.mjs
node docs/ean-linecount-study-2026-10-11/prepare.mjs
node docs/ean-linecount-study-2026-10-11/generated/generate.mjs
node docs/ean-uniform-policy-study-2026-10-11/download-negatives.mjs
node docs/ean-uniform-policy-study-2026-10-11/run.mjs
```

Only the download steps use network access, downloading pinned Apache-licensed public sources with hash verification. `run.mjs` is entirely local and requires the exact actual-Chrome PNG from sibling `../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png`; `QRGEN_EAN_CHROME_PNG` can select an identical copy. Missing/changed inputs fail explicitly rather than silently reducing the scope. No browser, install or SDK/site build is performed.

Set `QRGEN_REPRO_DEPENDENCY_ROOT` (or `QRGEN_COMPARISON_REPO`) to the dependency repository root or SDK package when running elsewhere. `QRGEN_EAN_STUDY_CACHE_DIR` defaults to the sibling study's OS-temp cache `qrgen-ean-study-5bdcab8035-315`. `QRGEN_EAN_POLICY_OUTPUT_DIR` can choose a fresh writable directory outside this package; otherwise a new OS-temp directory is created for each replay. Existing `results.json` or `summary.json` outputs are rejected. No downloaded source photos or generated binary frames are included here.

`verification.json` records a fresh portable execution and exact per-case equality with all6,706 archived outcomes, including outputs/positions/supporting lines. `package-manifest.json` records file hashes and gzip-expanded hashes.

Photo source/truth provenance is pinned ZXing `zxing/zxing` commit `5bdcab8035f6d26107cfad32d1aa2a85455efbc5`, inherited from the exact referenced manifests. The Apache-2.0 license, NOTICE and REUSE metadata are retained in this folder. No downloaded binary images, Y4M files or proprietary SDK code are duplicated here.
