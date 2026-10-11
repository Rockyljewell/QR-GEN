# EAN-13 derived-frame reproduction

This focused diagnostic contains one source photo and one modified frame. It reproduces a checksum-valid wrong payload in the underlying decoder. It does **not** report a wrong value observed in either public demo, a phone test, or a QR-GEN/Scandit parity result. The frame conversion approximates video luminance expansion; it is not a capture of Chrome's actual decoder input. No decoder defaults were changed.

## Provenance and modifications

The original is ZXing's [`ean13-2/07.png`](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox/ean13-2/07.png), pinned at `5bdcab8035f6d26107cfad32d1aa2a85455efbc5`. Its [truth file](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/resources/blackbox/ean13-2/07.txt) contains exactly `9780804816632` (13 UTF-8 bytes, no trimming). The [test class](https://github.com/zxing/zxing/blob/5bdcab8035f6d26107cfad32d1aa2a85455efbc5/core/src/test/java/com/google/zxing/oned/EAN13BlackBox2TestCase.java) identifies EAN-13 mobile photos under difficult lighting. Its adjacent EAN-5 supplement is excluded from this EAN-13-only probe.

Both images are redistributed under Apache-2.0. The copied upstream license, NOTICE, and REUSE metadata are included. **Modified file:** `ean13-2-07-frozen-first-frame-limited-Y-expanded-RGB.png` was derived from the original using the conversion below. `fixtures.json` records both exact hashes, dimensions, source/truth provenance and the frozen fake-camera fixture hash. This small package was selected for diagnosis after the browser-comparison fixture selection had been frozen; it is not an independent accuracy sample.

`derive-frame.mjs` reproduces the modification: composite on white, remove alpha, convert to sRGB, and center the unchanged 480 x 360 source at x80/y60 in a 640 x 480 frame. No resizing occurs. Background luminance is 200. For each source RGB pixel, compute `Y = round(16 + (65.738R + 129.057G + 25.064B) / 255)`, then set all three output channels to `clamp(round((Y - 16) * 255 / 219), 0, 255)` with alpha255. The PNG generator's hash must match the checked-in derived fixture. This is a focused modification of the original fake-camera conversion, without generating or storing its Y4M video.

## Recorded result

| Input | Truth | WASM 3.1.5 / current SDK, harder=false | WASM 3.1.5 / current SDK, harder=true | Raw Python 3.1.1 / Python SDK |
| --- | --- | --- | --- | --- |
| Original PNG | 9780804816632 | Exact | Exact | Exact |
| Derived RGB PNG | 9780804816632 | No result | Wrong `0798884816632` | Wrong `0798884816632` |

Each repeated profile ran five times. WASM encoded-PNG and raw-RGBA reads agreed, and the SDK preserved the same payload. The wrong upstream result is marked valid, has no error, has a valid EAN check digit, and has only two supporting lines at approximately x188..424/y207..209 inside the real barcode. Thus a normal checksum check does not reject it. The original remains exact and has 107 supporting lines when the maximum is 255. The prior 3.1.4 probe produced the same result; the isolated 3.1.5 patch does not remedy this case.

Python does not expose WASM's `tryHarder` flag. Its two profiles vary rotation/downscaling; both return the same wrong derived value. Actual parameters, version/engine hashes, repeated-result summaries and the focused threshold check are in `recorded-evidence.json`, which contains no host-specific paths.

The threshold diagnostic tests `minLineCount` 2/3/4 with maximum-symbol counts 1/255. Thresholds 3/4 suppress this wrong derived result and preserve this original photo. They do not recover the correct derived payload. One example is insufficient to change defaults: stricter filtering needs a broader recall and false-positive study.

## Run locally without network access

Use existing local dependencies: `zxing-wasm` (recorded 3.1.5), `pngjs` (recorded 7.0.0); optional fixture regeneration also needs `sharp` (recorded 0.35.5). No script installs packages or contacts the network. The Python probe needs Pillow and `zxing-cpp` (recorded 3.1.1); `qrgen_sdk` is optional.

From a built QR-GEN checkout root, these commands work without setting a dependency path:

```powershell
node docs/ean13-repro/repeat-node.mjs
node docs/ean13-repro/min-line-probe.mjs
node docs/ean13-repro/derive-frame.mjs
& .venv/Scripts/python.exe docs/ean13-repro/repeat-python.py
```

Each invocation writes reports into a new OS temporary directory and prints its path. To collect reports together, set `QRGEN_REPRO_OUTPUT_DIR` to an output directory outside this package. Existing recorded evidence and input files are never rewritten. All runners verify input hashes. The derivation runner also verifies the output hash.

If running from elsewhere, set `QRGEN_REPRO_DEPENDENCY_ROOT` to either the QR-GEN repository root, its `packages/sdk` directory, or a directory with the upstream dependencies installed. Repository-root resolution intentionally starts at `packages/sdk/package.json`, so a newer nested reader takes precedence over an older root copy. Both repository-root and SDK-directory resolution were verified to use 3.1.5 and produce identical results. The optional SDK is loaded from that package's `dist/node.js`; when absent, only the upstream reader is tested. `QRGEN_COMPARISON_REPO` is accepted as a compatibility alias.

The Python probe imports the optional SDK from its current Python environment. All images it owns are closed. Its white alpha compositing does not affect this opaque wrong-payload fixture.
