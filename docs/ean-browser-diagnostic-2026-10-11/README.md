# Three EAN photographs: separate browser diagnosis

This is a focused follow-up to three historical no-exact demo observations, **not a new vendor comparison or an unbiased success-rate study**. The historical 40 original and 14 readiness-follow-up QRGen/Scandit observations remain unchanged. No Scandit browser was used here.

Recorded browser run: 2026-10-11 14:51:12â€“14:51:49 UTC, QR-GEN commit `4949870806cd9e1d384cd4535a53f46ae4f21076`, clean working tree, zxing-wasm **3.1.5**. Every loaded local JavaScript/WASM response matched the built-file SHA-256 recorded before the run. The actual Astro chunks and standalone public SDK are listed separately; they are not assumed to be the same bundle.

## Findings

| Frozen source | Expected EAN-13 | Original photo, public scanImage | Actual browser camera, public scanImage and worker |
|---|---|---|---|
| ean13-2/01.png | 9780804816632 | No result with either tryHarder setting | No result with either setting, aiming ROI or full frame |
| ean13-2/07.png | 9780804816632 | Exact with either setting | Aiming ROI: none. Full frame + tryHarder false: none. Full frame + tryHarder true: **wrong 0798884816632** |
| ean13-2/21.png | 9784872348880 | No result with either setting | No result with either setting, aiming ROI or full frame |

Each camera phase ran for 2.5 seconds **after** confirming a ready 640Ã—480 video, scanner state `scanning` and engine `worker`. The 12 phases produced 37â€“40 decoded-frame events each (469 total), with stable effective options and no page/console errors. In the wrong-output phase, all 38 decoded frames contained that same wrong EAN. Repeated frames and a valid checksum therefore do not establish correctness. These windows are diagnostics, not latency measurements, phone tests or an indefinite guarantee.

The demo's derived aiming crop was x22/y151/595Ã—179 of the 640Ã—480 camera frame. Its normalized scanArea, preview geometry, effective settings and per-phase timestamps/frame counts are retained in `recorded-evidence.json`. Static public calls tested both tryInvert false/true; camera phases retained the ordinary alternating inversion setting. No stronger search setting recovered the other two photos.

The exact captured camera full-frame PNG is retained in `fixtures/ean13-2-07-full.png`. It has PNG SHA-256 `63783fca63db9e02e42cd905cae39630fd68acdcdb5ba7bb265e5f5a076e7399` and decoded RGBA SHA-256 `ec287e182dca32d86261e719e4a9525277023ba1872394ca6d4fa4e454fc7107`. The replay validates browser RGBA against the saved PNG pixels. Chrome expands the generated limited-range Y: padding Y200 became RGB214/214/214, and mean absolute error against round((Yâˆ’16)Ã—255/219) was 0.0176 levels for this case. This is an observation of the synthetic input conversion, not a claim about real camera color conversion.

## Separate crop/downscale/support probe

`crop-downscale-supplement.json` uses the exact captured PNG and matching reader WASM SHA-256 `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`.

- Disabling tryDownscale did not change the full-frame wrong output.
- Cropping to the original photograph's known source rectangle x80/y60/480Ã—360 recovered the exact EAN with tryHarder true. The rectangle came from the frozen conversion geometry, not a decoded payload or a search for a successful crop. Fast search remained empty.
- With maxNumberOfSymbols 255, the wrong full-frame read has two supporting lines at y207â€“209; minLineCount 3/4 suppresses it without producing the correct result. The correct cropped read has 107 supporting lines and remains exact at thresholds 2/3/4.

The initial probe matches the public maxNumberOfSymbols 1 setting; its reported lineCount can stop at the minimum. The separate max255 probe is required before interpreting lineCount as total support. This single-image result does **not** justify changing a default threshold. The separate broader study found valid thin-label reads lost at stronger thresholds.

## Practical implication

There is no validated safe automatic wider-region/tryHarder fallback from this evidence. The current fast setting avoids the demonstrated wrong read. A low-risk UI candidate is a clear prompt to center the complete barcode or move closer after repeated empty frames, followed by corpus and physical-camera validation. It changes guidance rather than accepting a new weaker result. A narrower crop can help this photo, but a fixed automatic crop can exclude other labels; stronger thresholds can discard valid small or thin barcodes. No decoder/API/default or payload-specific rule was changed in this diagnostic.

## Replay

Use a QR-GEN checkout with its usual dependencies, built SDK/site, Node, Playwright Chromium and Sharp. To reproduce the recorded revision, check out the recorded commit and build using the repository's documented build commands. Do not run a simultaneous site build while replaying: the runner hashes the already-built assets, but does not build them.

From that checkout, set `QRGEN_COMPARISON_REPO` if the current directory is elsewhere, and optionally `CHROMIUM_PATH` to the intended Chromium executable. Set `QRGEN_DIAGNOSTIC_OUT` to a new writable directory **outside this evidence package**; otherwise a temporary output directory is created. Then run:

```text
node <package-path>/replay.mjs
node <package-path>/raw-crop-downscale.mjs
```

The browser runner downloads only the three pinned Apache-licensed source PNGs, validates their hashes, regenerates and verifies the exact frozen Y4M, starts a local Astro preview on port4348, and saves fresh outputs outside this package. `QRGEN_DIAGNOSTIC_PORT` can change the port. Fresh browser contexts use the normal fake-camera flags. The initial symbology choice and start use the visible demo UI; factor tests deliberately use QRGen's public scanner and scanImage APIs. This is therefore a controlled diagnostic, not a claim about untouched default public UI behavior.

The raw runner uses the bundled captured PNG by default; `QRGEN_CAMERA_CAPTURE` can select a newly captured full-frame PNG. It resolves zxing-wasm from `packages/sdk`, loads the local reader WASM and records its actual version/hash. No Y4M, proprietary SDK, license key or base64 image payload belongs in this review package. The runner was syntax checked; the raw runner was executed from this portable package. The recorded browser experiment used the equivalent original artifact runner; its output is preserved unchanged.

## Corpus provenance and license

Source: ZXing `zxing/zxing`, commit `5bdcab8035f6d26107cfad32d1aa2a85455efbc5`, `core/src/test/resources/blackbox/ean13-2/{01,07,21}.png`, with exact UTF-8 companion `.txt` truth and `EAN13BlackBox2TestCase.java` metadata. `fixture-manifest.json` retains source/truth/test-class URLs, hashes and frozen imageâ†’Y4M geometry. These are upstream decoder test images, not unseen proprietary photographs or a held-out capability benchmark.

The captured PNG is a grayscale/padded derivative of upstream ean13-2/07.png. The source image and derivative are Apache-2.0 licensed according to the pinned repository's `LICENSE`, `NOTICE` and `.reuse/dep5`, retained in `licenses/`. Attribution: ZXing authors. Source bytes were converted with the included `image-camera.mjs`; no original SDK code was copied. Only the required captured full-frame PNG is included; the ROI raster can be regenerated using its recorded rectangle.

`package-manifest.json` records portable artifact hashes. Repository source files and historical comparison artifacts were not edited.
