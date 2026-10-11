# QRGen stability audit and retail AR assessment

Audit date: October 11, 2026. Baseline: `c11ebae` on `main`.
Findings: [GitHub issue #3](https://github.com/Rockyljewell/QR-GEN/issues/3).

QRGen is more resilient after these fixes, but **parity with Scandit has not been
established**. Passing generated-image and fake-camera tests does not demonstrate
equivalent decoding, tracking, device support or operational reliability in stores.
There was no licensed Scandit SDK or matched physical-device corpus in this audit.

## Confirmed bugs and fixes

The original web suite passed 63 tests. New regressions first exposed 17 failures
in lifecycle, worker recovery, tracking and HTTP behavior; later checks exposed
scan-limit, reentrant-event and Windows tooling defects.

| Area | Reproduction / effect | Fix and evidence |
| --- | --- | --- |
| Camera ownership | Stop during permission prompt; a late stream remains live. Concurrent starts can attach an older stream. Metadata waits hang after stop; playback failure leaks the stream. | Generation checks dispose late streams, cancel metadata waits, time out missing metadata and release streams on failure. Unit tests plus real Chromium stop/unmount regressions. |
| Scanner sessions | Old decode results/errors affect a restarted or resumed session, changed options or switched camera. Stop during torch setup still emits ready; stopping in a track callback still emits scan. | Invalidate pending results at lifecycle boundaries, recheck after asynchronous work and callbacks, reacquire a healthy shared decoder on restart. Unit regressions. |
| Worker failure | Runtime errors, unreadable responses, absent responses or failed sends strand pending decodes or reuse a dead worker. | Reject pending requests, clear timers, terminate and evict failed workers. A 20-second decode timeout bounds a lost response. Regression tests cover failure and healthy concurrent requests. |
| Web tracking timeout | A detection after the timeout revives an expired track before cleanup. | Expire before matching. A returning code receives a fresh track id and count. |
| REST input shape | `POST /v1/scan` with JSON `null` returns HTTP 500. | Reject non-object JSON as HTTP 400 `bad-request`. |
| REST multipart options | Multipart `parse=false` is ignored; `tryHarder` is not forwarded. | Read multipart scan options consistently with JSON/query inputs. |
| REST result limit | Node ignores `maxResults` sent by clients including .NET. | Forward validated limits from query, JSON or multipart. Real two-code images verify the limit; non-integer/out-of-range limits return HTTP 400. |
| Windows development | SDK asset packaging cannot launch npm; skill validation rejects CRLF frontmatter. | Invoke npm's JS entry with Node and normalize frontmatter line endings. Add a Windows build/browser CI job. |

Root dependencies were patched for the four reported advisories in esbuild,
http-cache-semantics, sharp and source-map-js. The separate React Native lock was
patched for the critical handlebars and shell-quote advisories. Two upstream
advisories remain in React Native development tooling: braces and sprintf-js.
Their dependency chains produce 29 audit entries (9 high, 20 moderate); they are
not 29 distinct underlying bugs. No patched versions were offered by the registry
at audit time. The suggested React Native/Jest downgrades were not applied.

## Local verification

Windows x64; Node 22.14 for unit tests and the image benchmark, Node 24.19 for the
website build/browser checks; Python 3.12 and zxing-cpp 3.1.1.

| Check | Result |
| --- | --- |
| Web SDK unit tests | 97 passing, including 34 added regressions |
| SDK TypeScript checks | Pass |
| Full SDK and website build | Pass; 57 generated pages |
| Website type check | No errors; existing clipboard deprecation hint |
| Chromium browser tests | 15 passing scenarios, including late permission after stop/unmount |
| Internal website links | 9,037 resolve |
| Agent Skills validator | All 7 valid |
| Python | 220 passing tests |
| React Native | 102 passing tests; type check and build pass |
| Root npm audit | Zero reported advisories after patches |

Native iOS, Android, Flutter, .NET and Docker were not executed locally because
their toolchains were unavailable. Their existing GitHub CI jobs must pass for
this branch. Real cameras, Safari/Firefox, mobile operating-system lifecycle,
thermal behavior and long-running store workflows remain unverified.

## Reproducible image benchmark

Run `npm run build:sdk`, then
`node scripts/benchmark-scanning.mjs docs/scanning-benchmark-2026-10-11.json`.
The [saved result](scanning-benchmark-2026-10-11.json) includes the machine,
engine version and individual cases.

The corpus has six formats (QR, Data Matrix, PDF417, EAN-13, Code 128 and DataBar),
four right-angle rotations and three contrast variants. **56 of 72 total probes
decoded exactly.** All 56 expected supported cases passed. The other 16 probes
are inverted PDF417/linear codes and did not decode. They remain in the output
as explicit limitations. The engine's [inversion option is format dependent](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/ReaderOptions.h).

Warm image decoding measured p50 1.282 ms and p95 2.732 ms on this desktop. These
are single-run diagnostics, include misses, exclude engine startup and are
**not camera latency, a performance guarantee or a Scandit comparison**. The
images do not cover glare, damage, motion blur, perspective or dense physical shelves.

## Retail AR and adjacent features

The following is an assessment of repository code against the vendors' published
capabilities, not a measured comparison of product quality. Scandit's
[retail AR guide](https://www.scandit.com/resources/guides/how-to-launch-ar-retail-app/)
emphasizes stable barcode anchoring, handling identical items, interactive overlays
and testing in the working environment. Its
[barcode product page](https://www.scandit.com/products/barcode-scanning/)
also describes multiple-code workflows. Its [web MatrixScan documentation](https://docs.scandit.com/sdks/web/matrixscan/get-started/)
provides tracking and overlay integration patterns.

| Capability | QRGen today | Next useful work |
| --- | --- | --- |
| Multi-code overlays | Web canvas highlights, smoothing and tap selection; native overlays also exist. | Add explicit per-code inventory/task states with accessible labels and overlap handling. |
| Identical-product counting | Web/iOS/Android match spatial detections; React Native/Flutter/Python trackers aggregate by symbology and payload. Web scan-event duplicate filtering also aggregates payloads. | Use track instances for visible-item counts; distinguish them from unique SKUs. Add spatial tracking to aggregating platforms before claiming item counts. |
| Remembering off-screen items | Web tracks expire after 500 ms by default. There is no persistent scene map or physical item identity across occlusion/camera movement. | Design an explicit count session with confirmation/correction and evidence of re-identification. Increasing a timeout alone does not establish physical identity. |
| Picking / receiving | SDK primitives can scan and select codes. No complete inventory reconciliation or guided picking workflow was found. | Build one narrow receiving workflow: expected quantities, unknown items, confirmation and idempotent export. Then add target-SKU picking. |
| Price / expiry checks | GS1 dates, amounts and product identifiers can be parsed. | Connect an authoritative product/inventory source; show provenance and freshness before acting on an overlay. |
| Label OCR and broader IDs | AAMVA parsing is present. Parsing a barcode is not authenticity verification; no general label OCR/passport verification engine was found. | Treat OCR and document authenticity as separate integrations and validation projects. |
| Feedback / accessibility | Beep, vibration and visual highlights exist. | Test noisy stores, gloves, one-handed use, color vision differences and dense tap targets. Pair colors with text/icons. |

## Proposed gates before a stability-parity claim

These are proposed acceptance criteria, not measured results or a release promise.

1. **Match the comparison.** Pin QRGen and Scandit versions/options; use the same
   devices, input frames, barcode sizes, distances, lighting and tasks. Separate
   decode success from field workflow success, and keep unsupported formats visible.
2. **Build a held-out corpus.** Include clean/damaged labels, glare, blur, tilt,
   low light, very small codes, no-code frames and duplicate products. Label payload,
   location and physical item identity; publish per-condition sample sizes and uncertainty.
3. **Measure correctness first.** Report exact payload recall, false positives,
   false SKU selection, count error and duplicate/lost physical items. Compare each
   stratum; an aggregate average can conceal a serious device or format regression.
4. **Measure responsiveness and stability.** Include cold start and camera-to-overlay
   p50/p95/p99 latency, overlay jitter, tap accuracy, camera-switch recovery, memory
   and thermal behavior. Run repeated permission/background/navigation cycles and
   multi-hour sessions on representative low/mid/high-tier phones.
5. **Trial the workflow.** Test receiving and picking with real users. Require no
   leaked camera tracks, unhandled errors or lost confirmed actions; compare task
   accuracy and completion time to the pinned competitor under the same conditions.

Release the current bug fixes after CI review. Keep the physical-device benchmark,
upstream dependency advisories and AR feature work tracked independently; this
audit does not authorize publishing an unverified "as stable or better" claim.
