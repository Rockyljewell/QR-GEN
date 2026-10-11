# Decoder hardening and photographic validation

The SDK pins `zxing-wasm` 3.1.5 instead of 3.1.4. The bundled ZXing-C++ revision
changes from `0b2d9a8fc81f420f369928c24331091ff0525976` to
`2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`. Its
[MaxiCode bounds fix](https://github.com/zxing-cpp/zxing-cpp/commit/d33daa0fe937fdbd836a7c4ed13289163f214889)
checks numeric/ECI lookahead on malformed input and returns a format error instead
of reading outside the supplied buffer. Upstream unit tests reproduce the decoder
case; no image-level exploit was demonstrated in this audit. This patch also
includes MicroQR and MicroPDF417 corrections.

The [release evaluation](decoder-evaluation-2026-10-11/RESEARCH.md) records primary
release/commit links, verified npm integrity and matching WASM hashes. Wrapper
source, package exports, defaults and all 46 shipped declaration files are unchanged.
The type-fest minimum Node metadata already existed before this patch. The SDK
continues to support Node 18.17; the development website requires the root
repository's newer runtime. The lockfile moves zxing-wasm under the SDK workspace;
build, Node and worker/browser resolution use that workspace correctly.

## Verification before CI

Windows x64, Node 24.19.0 for build/browser checks; actual Node 18.17.0 for the
built public Node SDK's minimum-runtime check.

| Check | Result |
| --- | --- |
| SDK build and typecheck | Pass |
| SDK unit tests | 329 passing in 22 files |
| Generated six-format / four-rotation / three-contrast corpus | 72/72 exact on Node 24.19 and 72/72 on Node 18.17 |
| Website build | 60 generated pages |
| Website typecheck | 0 errors, 0 warnings; existing clipboard deprecation hint |
| Main Chromium browser scenarios | 21 passing |
| Print/mobile browser and isolated offline scenarios | 5 + 4 passing |
| Root npm audit | 0 reported advisories; separate React Native tooling advisories remain in issue #5 |

The isolated before/after comparison used nine frozen EAN PNGs, four profiles,
encoded and RGBA inputs, and three repetitions per version: 72 paired cases and
432 reads on each runtime. Node 22.14 and Node 18.17 both produced identical
before/after results, stable repetitions and unchanged input buffers. This narrow
comparison cannot establish quality across all formats or real cameras.
The [Node 22 evidence](decoder-evaluation-2026-10-11/comparison.json),
[Node 18 evidence](decoder-evaluation-2026-10-11/comparison-node18.17.0.json),
[cross-runtime check](decoder-evaluation-2026-10-11/runtime-comparison.json) and
generated [Node 18](decoder-evaluation-2026-10-11/generated-node18.json) /
[Node 24](decoder-evaluation-2026-10-11/generated-node24.json) results are retained.
Absolute local paths in the historical probe JSON were replaced with portable
placeholders; decoder outputs, hashes and options were preserved. The research
note describes the pre-adoption evaluation, when 3.1.4 was still installed.
Generated timings are single-run diagnostics, not camera latency or a speed claim.

## Separate photographic comparison

The [frozen photographic demo comparison](photographic-comparison-2026-10-11/README.md)
observed 16 positive inputs and four no-code controls with both public workflows.
QR-GEN displayed 13 exact positive payloads; Scandit's public demo displayed 15.
All missing exact results were EAN-13 cases. A predefined follow-up reproduced
those outcomes. All 54 original/follow-up observations had live video and zero
page/console errors. No wrong payload was observed in either demo during these
observations. No visible output on a no-code control does not prove the Scandit
decoder was active or establish a population false-positive rate.

This comparison pins QR-GEN to **37185d8c87bc5827942733e8e5716bc4a128af0a**, using
the earlier decoder, and Scandit's displayed version to 8.6.1. Actual loaded
QR-GEN JavaScript/WASM hashes are recorded per case. It is historical evidence,
not a rerun of the current patch. Both demos received identical camera files,
but scan regions, inversion and some format selections differ. The upstream
ZXing corpus is not an independent held-out dataset for this ZXing-derived SDK.
Static desktop replay does not measure phone stability, latency, motion or field
workflow success. No Scandit parity claim follows from these observations.

## Confirmed EAN defect remains open

[Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) records a distinct
wrong EAN-13 result on a derived photographic input: expected `9780804816632`,
returned `0798884816632`. The engine reports a valid checksum and two agreeing
scan lines. It reproduces in both WASM versions and the Python engine with the
recorded hard-search profiles. The original photograph decodes correctly.
This wrong result was not observed in the public demo comparison; the derived
RGB transformation is not a measured copy of Chromium's camera pixels.

The [focused reproduction](ean13-repro/README.md) includes the original and
derived image, hashes, license, effective options and repeatable runners.
This dependency patch **does not fix #32**. A higher minimum line count suppresses
the wrong result in this one case, but broader labeled recall/false-positive and
thin-barcode evidence is needed before changing a public default. No ground-truth
payload correction or one-image special case was added. Physical-device and
matched Scandit validation remain unexecuted.
