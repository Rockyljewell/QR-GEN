# Native EAN-13 candidate test evidence

The exact baseline and candidate both compiled and passed the full enabled upstream unit suite on GitHub's Ubuntu runner. This package preserves the XML results, counts, source/download fingerprints, compressed logs and the published reproduction recipe. It contains no native binaries or WASM.

| Check | Baseline | Candidate |
| --- | ---: | ---: |
| Upstream GoogleTest cases | 312 | 312 |
| Added private-helper GoogleTest cases | 0 | 14 |
| Total GoogleTest cases | 312 | 326 |
| Failures / errors / disabled tests | 0 / 0 / 0 | 0 / 0 / 0 |
| CTest entries passed | 2 / 2 | 2 / 2 |

The CTest entries are `UnitTest` (the GoogleTest suite) and `ZXingCTest` (C API tests). All 312 baseline GoogleTest identities are present in the candidate, with exactly the 14 expected diagnostic tests added. Packaging independently verified both downloaded ZIP SHA-256 digests against GitHub's artifact metadata, every published recipe file fingerprint, XML counts, and the generated helper-test source fingerprint.

## Exact run and source

The [successful native run](https://github.com/Rockyljewell/QR-GEN/actions/runs/38153092445) used isolated branch `codex/ean-native-diagnostic`, commit `d9aec2cabf211181f9792ff73b65f8583afdb121`, based on unchanged product main `6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b`. The two artifacts are `ean-native-baseline` (ID 11707531485) and `ean-native-candidate` (ID 11706898931). Their immutable reported/downloaded digests are retained in each variant's `download-provenance.json`.

ZXing-C++ is pinned to `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`, the source bundled by zxing-wasm 3.1.5. The upstream CMake configuration resolved GoogleTest v1.15.2 to `b514bdc898e2951020cbdca1304b75f5950d1f59`. GCC 13.3.0, CMake 3.31.6 and exact configuration/submodule records are preserved. Candidate reader source SHA-256 is `b9cd713e52c5579fa9366f6b7c89f5012b10b1510a5c81fb01e2145f57cd46ce`; patch SHA-256 is `f80daf81fe49616e59b250fac96e25a6c5d73ee5e59e6511cec5b98dc2bd7fae`.

The workflow builds C++20/Release, all readers, both old/new writer backends, the bundled Zint implementation and experimental API. `ZXING_UNIT_TESTS=ON` and the C API are enabled; examples and blackbox tests are disabled. Full logs and CMake caches are retained verbatim under deterministic `.gz` compression, including ordinary temporary GitHub runner paths. Product source and dependencies were not changed.

## Focused helper tests and limits

The patched reader translation unit is compiled into the actual native library and exercised by the upstream library/C API suite. Separately, candidate-only tests compile exact hash-verified private helper/collector source bodies in an extracted test translation unit. They do not directly call the private helper inside the reader translation unit and add no public API.

These 14 added tests cover all 238 frozen real row masks, nine empty/singleton/parity/checksum/high-bit/dense/confirmed-image controls, and four exact-float collector cases. The generic threshold-only example uses synthetic pattern widths to isolate the strict average-variance threshold; it is not a real EAN label. The full generated test source, its fingerprint and independent expected masks are retained.

This establishes native compilation, upstream unit compatibility and the scoped private-helper checks. It does not establish population accuracy, Scandit parity, physical-phone behavior or a complete false-read fix. Actual paired rebuilt-WASM photo/alias/addon/search-budget results are documented separately. The /35 confirmed false value and the explicit UPC-A-only bypass remain unresolved. Historical `patch-metadata.json` preserves the candidate's pre-build wording; the XML and verification here record the subsequent actual successful compilation/testing.

## Reproduction

`recipe/` contains the exact six files published on the isolated branch. Publish `diagnostic-native.yml` as `.github/workflows/ean-native-diagnostic.yml` and the other five files under `diagnostics/ean-native-ambiguity/` on a separate `codex/ean-native-diagnostic` branch. The workflow performs the baseline/candidate checkouts, hash checks, preparation, native builds and CTest runs. It has `contents: read` permissions, uses no secrets and deploys/publishes nothing.

The helper adaptation derives from `core/src/oned/ODMultiUPCEANReader.cpp`, copyright 2016 Nu-book Inc., 2016 ZXing authors and 2020 Axel Waggershauser, licensed Apache-2.0. `ZXING-LICENSE.txt` applies to the inherited source adaptation. The main candidate patch preserves the original source file's header.
