# EAN-13 minimum supporting lines study

Raising the threshold clearly trades recall for filtering. It suppresses the known actual-browser wrong value, but loses correct reads on real photos and thin generated symbols, and does not remove every false-payload candidate. These results do not support a universal default change.

## Frozen scope

Source: [ZXing](https://github.com/zxing/zxing/tree/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox), pinned at `5bdcab8035f6d26107cfad32d1aa2a85455efbc5`. Initial rules were declared at 14:51:06Z, then refined to retain the unregistered suite 5 before decoder use. The final rule hash and all 157 source/truth pairs were frozen at2026-10-11T14:53:06.088Z, and all 314 raster hashes at2026-10-11T14:54:25.559Z, before the new corpus decoder run. All eligible named EAN13-suite files were included mechanically: 34/28/55/22/18 in suites 1/2/3/4/5, with zero exclusions. All companion labels are exactly 13 ASCII digits with a valid EAN check digit; no trim. Suites 1–4 have explicit upstream EAN_13 test classes (139 images); suite 5 has no matching test class and its 18 images are flagged folder-inferred. Results for both scopes are in `recorded-summary.json`.

The corpus is related to ZXing development and includes difficult images and potentially multiple physical barcodes. It is not an independent population sample, phone test or Scandit comparison. Prior knowledge of ean13-2/07 is disclosed. Apache-2.0 LICENSE/NOTICE/REUSE metadata is copied alongside the downloaded source data. No product code, build or default was changed.

Originals are decoded as white-composited sRGB RGBA at source resolution. Derived frames use the previously documented 640x480 fit-inside/no-upscale/centered limited-luma then expanded-RGB conversion; only images larger than the frame are resized with lanczos3. Every pixel/PNG/source/truth hash is frozen in the manifests. The preselected actual Chrome -07 frame is a separate supplemental case, not included in the 157-photo table.

Raw local zxing-wasm 3.1.5 (`2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`, WASM SHA256`aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`) reads RGBA with EAN13 only, hard=false/true, thresholds 2/3/4, rotate/downscale=true, invert=false, maxSymbols 255, LocalAverage/HRI, Ignore addon, returnErrors=false. There were 1890 photo/supplement reads, no exceptions. Full result text, positions and supporting lines are retained in `recorded-photo-results.json`.

## Photo results

Values are threshold 2 / 3 / 4 counts out of 157 per row. “Exact only” requires no differing payload. “Target present” also counts mixed exact+other output. “Mismatch” means a differing payload relative to the single companion label; it does **not** automatically mean a false positive.

| Input | Search | Exact only | Target present | Mismatch | Miss |
| --- | --- | --- | --- | --- | --- |
| Original | Fast | 99 / 97 / 90 | 99 / 97 / 90 | 0 / 0 / 0 | 58 / 60 / 67 |
| Original | Hard | 114 / 112 / 106 | 117 / 115 / 108 | 4 / 3 / 2 | 39 / 42 / 49 |
| Derived | Fast | 45 / 44 / 39 | 45 / 44 / 39 | 0 / 0 / 0 | 112 / 113 / 118 |
| Derived | Hard | 63 / 60 / 57 | 64 / 61 / 58 | 2 / 1 / 1 | 92 / 96 / 99 |

For example, original ean13-2/09 (9780345348036) and ean13-4/05 (9780441014989) have correct two-line hard-search results at threshold 2 and become misses at 3/4. Fast-search examples ean13-1/23 and /38 also lose correct two-line reads at 3. Target-loss cases and supporting lines are retained, not removed from the denominator. A disclosed post-hoc stability probe repeated the two hard-search recall losses, the /35 false-payload candidate (original and derived), and actual Chrome capture five times per threshold: all 75 reads were stable; see selected-stability.json.

Several mismatches on ean13-2/14, /20 and /24 come from a visible separate lower barcode, so their truth is ambiguous beyond the intended companion target. `visual-ambiguities.json` records post-hoc inspection without changing inclusion or truth. On ean13-1/35 there is one visibly complete printed barcode 5030159003930: hard search additionally returns 7034759003930 from another strip of that same barcode. Its derived-frame wrong strip has 5 supporting lines and survives threshold 4, demonstrating that line count alone does not eliminate every false-payload candidate.

## Actual Chrome frame and generated controls

The actual 640x480 fake-camera capture has PNG SHA256`63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399`. Hard search at threshold 2 returns wrong 0798884816632 with 2 lines and bounds x188..424/y207..209; thresholds 3/4 return no result. Fast search returns no result at all three thresholds. This corroborates filtering of the actual captured raster, not recovery of its correct target. The separate browser agent owns public UI/live-worker evidence.

The independently frozen generated arm has 144 positives (three payloads ×six bar heights ×two module widths ×four exact rotations) and 12 no-code patterns/rotations. It made 5616 reads across PNG/RGBA, fast/hard, thresholds 2/3/4, three repeats; all repeats were stable and both input paths agreed. Height 1 always missed. Height 2 read 24/24 at 2 and 0/24 at 3/4. Height 3 read 24/24 at 2/3 and 0/24 at 4. Heights 4/8/16 read at all thresholds. Aggregate generated recall is 120/144 →96/144 →72/144. No generated wrong payloads or control reads occurred. These clipped writer rows are intentionally artificial, not a claim of printed EAN compliance. Generation/oracles/manifest/evidence are in `generated/`.

The supporting-line count can be censored by early stopping: with maxSymbols 1 the reader may return after reaching the requested minimum. This study uses 255 so a returned count 2 is not merely that one-symbol early-stop threshold. Filtering should be an explicit tradeoff evaluated with application data, not described as a safe accuracy fix from this study.

## Reproduction and package contents

This compact package contains frozen source/truth/raster hashes, options, aggregate summaries, per-case outputs, ambiguity annotations, stability confirmations, and licenses. It contains no photos or Y4M videos. Source photos are downloaded from the pinned commit into a temporary cache. The generated arm is reconstructed from its frozen writer 3.1.5 bit rows and all 156 expected PNG/pixel hashes are verified. The modified portable runners preserve the original inclusion and expected hashes; original generator/decoder fingerprints remain in the frozen generated manifest as provenance.

From a QR-GEN repository root with existing SDK dependencies 3.1.5, sharp 0.35.5 and pngjs 7.0.0, run:

    node docs/ean-linecount-study-2026-10-11/download.mjs
    node docs/ean-linecount-study-2026-10-11/prepare.mjs
    node docs/ean-linecount-study-2026-10-11/run.mjs
    node docs/ean-linecount-study-2026-10-11/generated/generate.mjs
    node docs/ean-linecount-study-2026-10-11/generated/run.mjs

Set QRGEN_REPRO_DEPENDENCY_ROOT (or compatibility alias QRGEN_COMPARISON_REPO) when running elsewhere; either a repository root or its packages/sdk directory works. The reader resolves from the SDK package so a nested 3.1.5 takes precedence over an older monorepo-root copy. No install or build is performed. Only download.mjs uses network access, and it verifies all 314 pinned source/truth hashes. All other runners operate locally.

Mutable downloads, regenerated rasters and outputs default to an OS-temp cache named qrgen-ean-study-5bdcab8035-315. Override QRGEN_EAN_STUDY_CACHE_DIR / QRGEN_EAN_STUDY_OUTPUT_DIR if desired; both must be outside this documentation package. Existing recorded files are never rewritten. Execution reports print their external output path.

The actual Chrome supplement is referenced from the sibling package ../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png, with SHA256 63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399. Set QRGEN_EAN_CHROME_PNG to another copy of that exact image when needed. If absent, run.mjs explicitly reports that the supplement was skipped while still running all 157 source cases. The picture is not duplicated in this package.

recorded-photo-results.json has all 1890 per-profile outcomes and returned text/validity/line counts/positions. recorded-summary.json has both 157-image and 139-test-registered scopes and every target-loss transition. generated/recorded-results.json retains each case/profile classification, three-repeat stability and every distinct returned output, omitting only duplicate repeated arrays. generated/summary.json retains all profile/height totals. visual-ambiguities.json explicitly labels reviewed secondary-code mismatches; any other mismatch remains an unreviewed companion-label mismatch until independently assessed. selected-stability.json contains the disclosed 75-read follow-up. These files are diagnostic evidence, not population false-positive estimates.

The portable replay is recorded in verification.json: all 314 source/truth files and 314 photo raster hashes verified, all 156 generated PNG/pixel hashes verified, and all 1890 photo outcomes plus 5616 generated reads reproduced the archived per-case results exactly. The actual Chrome supplement was included through the sibling package.
