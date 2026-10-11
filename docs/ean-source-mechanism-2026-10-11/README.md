# EAN-13 source mechanism and conservative candidate

The two confirmed false values are recognition/confidence failures, not a bypassed checksum or SDK text conversion. The pinned decoder deliberately permits equal best digit matches and selects the earliest table entry. In the actual Chrome case, equal-best alternatives admit both the wrong and correct complete EAN-13 values. A narrow artifact-only filter suppresses that ambiguity while preserving every target read in the scoped port study. It does not suppress the separate /35 false value. No product code, dependency, default or upstream issue was changed.

## Exact source and mechanism

zxing-wasm 3.1.5 pins [ZXing-C++ 2ecec3f5](https://github.com/zxing-cpp/zxing-cpp/tree/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4). The installed released reader WASM SHA256 is aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931. source-manifest.json records 83 read-only official source files/hashes.

* [EAN digit matching](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/oned/ODMultiUPCEANReader.cpp#L46-L61) uses average variance 0.48f and individual variance 0.7f, with requireUnambiguousMatch=false. [RowReader](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/oned/ODRowReader.h#L121-L136) normally offers tie rejection, but this caller explicitly disables it.
* [EAN13 parsing](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/oned/ODMultiUPCEANReader.cpp#L132-L156) checks guards and the six-bit left parity. [The actual check digit is enforced](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/oned/ODMultiUPCEANReader.cpp#L289), using [GTIN's ordinary weighted checksum](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/GTIN.h#L24-L39). All reported wrong values satisfy it.
* [LocalAverage's 1D path](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/HybridBinarizer.cpp#L31-L37) forwards to [per-row histogram and sharpening](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/GlobalHistogramBinarizer.cpp#L132-L166). Adding gray padding can change the threshold while the barcode pixels stay identical. On actual Chrome rows 207/209, full-frame threshold 127 becomes 111/119 after exact geometric crop (80, 60, 480, 360). The false rows disappear; other rows recover 107 correct supporting rows. recorded-padding-threshold.json proves source luminance equality.
* [Aggregation](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/oned/ODReader.cpp#L168-L239) increments support for equal payload/geometry, then discards weaker intersecting result boxes. [Equality](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/Barcode.cpp#L200-L240) requires the same payload. Narrow disjoint strips can therefore retain different payloads from one physical barcode. maxSymbols=1 can stop before a stronger competing group is found.

The explicit permissive argument is longstanding: it appears in the [July 2020 rewrite](https://github.com/zxing-cpp/zxing-cpp/commit/44f7054b731e918fcb6eaa0d25c097d19f732cfe) and the preceding old implementation. The checked history does not separately explain why ties were allowed; it is not evidence of a new 3.1.5 typo. This is a concrete confidence gap in an intentionally permissive recognition policy, not proof that checksum arithmetic is broken.

## Exact accepted-row traces

The artifact port enumerated and reproduced every accepted supporting row for these cases, and actual unmodified WASM BoolCast replays confirmed representative first/last binary rows. recorded-row-trace.json retains every false row, tied correct rows and representative untied rows; groups retain all row coordinates. These counts use maxSymbols=255, hard/full-resolution, not censored maxSymbols=1 support.

| Raster | Value | Support | Tied-support rows | Whole-word filter |
| --- | --- | ---: | --- | --- |
| /2/07 original | correct 9780804816632 | 107 | 197 | retained |
| /2/07 actual Chrome | wrong 0798884816632 | 2 | 207, 209 | suppressed |
| Actual Chrome source crop | correct 9780804816632 | 107 | none | retained |
| /1/35 original | wrong 7034759003930 | 3 | 241, 244, 264 | retained |
| /1/35 original | correct 5030159003930 | 8 | 307, 316, 317 | retained |
| /1/35 derived | wrong 7034759003930 | 5 | 241, 243, 244, 264, 265 | retained |
| /1/35 derived | correct 5030159003930 | 6 | 296, 307 | retained |

On both actual Chrome false rows, encoded digit positions 3, 4, 6 have equal minima: L9/G8, L8/G0, L8/G0. Table-first choices produce 0798884816632; alternate tied G choices produce 9780804816632. Both complete values pass parity and checksum. On /35, equal-best alternatives admit only the wrong complete word: rejecting whole-word ambiguity cannot resolve it. The false rows already have plausible digit/guard module sizes (within about 8%) and ample quiet zones; an EAN-8 style 20% module-size check or stricter quiet zone does not explain/fix these examples.

## Frozen uniform port comparisons

All 157 previously frozen photos were included as originals and deterministic derived frames, plus the separately labelled actual Chrome capture, 144 thin generated positives and 12 no-code controls. Inclusion, labels, raster hashes, licensing and limitations are inherited unchanged from the sibling ean-linecount-study-2026-10-11 package. These are difficult development fixtures with possible secondary visible codes, not a population sample or phone/vendor comparison.

Each policy was frozen before its own 942 profiles: 471 rasters × fast/hard, EAN13 only, maxSymbols=255, minLineCount=2, tryRotate=true, tryDownscale=false, tryInvert=false, LocalAverage, HRI, Ignore addon, returnErrors=false. Full-resolution isolation is deliberate. The baseline port matched actual released 3.1.5 WASM text, support count and position on all 942 profiles in both runs. The candidate is still a JavaScript source port, not a rebuilt/patched decoder.

| Group | Baseline target present | Reject any tied digit | Reject only multiple valid whole words |
| --- | ---: | ---: | ---: |
| 157 original/fast | 99 | 96 | 99 |
| 157 original/hard | 117 | 115 | 117 |
| 157 derived/fast | 45 | 41 | 45 |
| 157 derived/hard | 64 | 63 | 64 |
| 144 generated/fast | 120 | 120 | 120 |
| 144 generated/hard | 120 | 120 | 120 |

Both policies suppress actual Chrome false /2/07. The narrow policy also suppresses derived /2/07, retains both /35 false groups, and changes one original fast result's support count without losing its exact payload. No no-code result occurs. Companion mismatches are not automatically false reads: reviewed secondary barcodes /2/14,/20,/24 remain ambiguities; other non-confirmed differences remain unreviewed companion-label mismatches. Full per-case outputs and all changed cases are retained in recorded-*results/summary files.

Blanket tie rejection is not a proposed production change: it loses correct targets, including original/derived /1/29 and original /2/28 under hard search. The narrow policy is evidence for further testing, not a generalized false-read fix.

The distinct-prefix DP was cross-checked against independent exhaustive enumeration on 238 selected real rows plus 1000 fixed-seed synthetic cases (1,238 checks). An independent reviewer translated the actual fixed-array C++ algorithm and checked 238 real rows, 2,000 synthetic masks and one dense case (2,239 checks), with 0 mismatches. This is algorithm review, not C++ compilation.

## Portable replay

From a QR-GEN root with installed SDK zxing-wasm 3.1.5, sharp 0.35.5 and pngjs 7.0.0, prepare the existing external temporary cache:

    node docs/ean-linecount-study-2026-10-11/download.mjs
    node docs/ean-linecount-study-2026-10-11/prepare.mjs
    node docs/ean-linecount-study-2026-10-11/generated/generate.mjs
    node PATH_TO_THIS_PACKAGE/run-port.mjs

QRGEN_REPRO_DEPENDENCY_ROOT accepts a repository root or its packages/sdk folder; the SDK-local dependency takes precedence. QRGEN_EAN_STUDY_CACHE_DIR overrides the existing cache default; QRGEN_EAN_MECHANISM_OUTPUT_DIR selects an external output directory. The actual Chrome PNG defaults to the sibling ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png; set QRGEN_EAN_CHROME_PNG for another exact copy. Its hash must match 63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399. The portable replay requires this supplement so the 942-profile scope cannot silently shrink. Recorded package files are never overwritten. The copy-ready runner was replayed against all frozen rasters: 942 profiles, 0 released-baseline mismatches, 0 recorded-policy mismatches, all input hashes matched (recorded-portable-replay-verification.json). Portable scripts were adapted only for dependency/cache/output paths; original plan/source fingerprints remain recorded separately.

## Reviewable C++ candidate and actual-build requirements

candidate/ contains an uncompiled patch against the pinned source, metadata and an isolated diagnostic build workflow. It collects exact equal-minimum 20-bit pattern masks using the existing float variance routine; fixed arrays cap path counts at 2 across at most 64 parity × 10 checksum states, with an untied fast path. Each complete EAN13 word uniquely determines its parity/digit encoding, so saturated path counts equal distinct-word counts.

The final filter runs after baseline parsing, checksum, and optional addon Read/Require handling, immediately before returning a baseline-valid EAN13-format result. Final row cursor consumption is preserved; it does not synthesize an alternate value. EAN8, UPC-E, checksum-error results and explicit UPCA-only converted results bypass it. EAN13-format leading-zero data needs explicit alias tests. Actual unmodified raw 3.1.5 returns the false /2/07 as EAN13 for EAN13/mixed/all formats, and as UPCA with 13-digit text under UPCA-only; SDK normalization may rename/shorten it. No generalized all-format claim follows from an EAN13-only study.

Preserved row cursor does not guarantee a global output subset: checkRows, maxSymbols budgets, overlap competition, vertical search, downscale and inversion can change after filtering. Required actual rebuilt comparisons are baseline+candidate+released315, downscale true/false, maxSymbols=1/2/255, EAN13/UPCA/mixed/all formats, addonIgnore/Read/Require, leading-zero valid targets, all 314 photo rasters, actual live capture, 144thin positives,12 controls, broader no-code controls and 72 generated multi-format cases. Record exact+miss+wrong/companion outcomes and warm latency, and run native/upstream tests. /35 remains unresolved. No production decision is justified before these checks.

## Build pins and provenance

Official zxing-wasm v3.1.5 resolves to b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54; its gitlink is the C++ commit above. Upstream [setup](https://github.com/Sec-ant/zxing-wasm/blob/b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54/.github/actions/setup/action.yml) pins EMSDK 5.0.4. The isolated workflow additionally pins the setup-emsdk action to 6ab9eb1bda2574c4ddb79809fc9247783eaf9021, Node 22.14.0 and pnpm 12.8.2, which the official npm metadata supports on Node 18+.

The official [CMake](https://github.com/Sec-ant/zxing-wasm/blob/b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54/src/cpp/CMakeLists.txt) uses C++20/Release, exceptions, web+worker, Embind, ES6/modularize, no filesystem/dynamic execution, memory growth and a 5 MiB stack. Reader-only compile commands are:

    emcmake cmake -S src/cpp -B build -DTARGET=READER
    cmake --build build -j2

The exact official Vite wrapper config reads all three WASM hashes, so the provided workflow builds all upstream WASM targets then runs pnpm exec vite build, producing matching JS glue and reader WASM for each variant. It does not pair independently rebuilt WASM with the installed minified loader. The diagnostic branch has contents:read, no secrets/deployment/publication, and uploads only diagnostic build outputs. Build smoke confirms module/blank-image operation only; actual corpus runner/evidence must follow. A rebuilt baseline hash may differ from the published release; it must reproduce release behavior before interpreting candidate differences.

Source algorithm adaptation follows Apache-2.0 ZXing-C++ copyrights; copied source candidate retains its header. ZXING-LICENSE/NOTICE/REUSE metadata applies to the inherited photo fixtures. No photos/Y4M/binaries or host-specific absolute paths are included in this compact package.
