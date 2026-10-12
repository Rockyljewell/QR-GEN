# QR-GEN creation, capture and access experiments

October 11, 2026. The objective is fewer steps from intent to a correct, usable code and from an available image/camera to the intended action. Existing engines provide interoperable encoding/decoding. QR-GEN's experiment layer adds planning, useful defaults, measured capture decisions and honest availability reporting.

## Implemented foundations

| Slice | Behavior | Stability boundary |
| --- | --- | --- |
| Physical QR planning | Real encoder probes, whole printer dots, four-module quiet zones, exact ECC/floors, structured size remedies, mm-sized SVG | JavaScript/browser and Node only; 2048 pixels per side; geometry is not physical scan certification |
| Purpose-based creation | Link/text/Wi-Fi print flow at `/plan/`; escaped standard payloads; exact-content PNG check; readable content alternative | No silent URL rewriting/shortening; old exports invalidate immediately; credentials stay in memory |
| Adaptive capture | Bounded full-frame input, decoder-latency feedback, periodic discovery, observed input stats | Opt-in; no changes to default fixed capture, decoder selection or camera constraints; lifecycle and stale-result guards |
| Capability diagnostics | Declared formats, prerequisites, asset provenance, unknown/unsupported requests | Synchronous/read-only; no camera/permission/engine/network invocation; offline readiness stays unverified |
| Offline example | Dedicated local shell and matching bundled engine assets | First installation requires access to the assets; browser installation/reload/update checks pass with compressed assets; browser cache eviction can remove saved tools |

The branch integrates main through `8bd0a6e`, including inversion/pending-batch fixes, accessible batch-results controls, spatial reset and whole-frame tracking association. The recorded capture benchmark predates that final integration; its report retains the measured source revision and exact asset hashes. Further main changes must be fetched and tested before merging.

## Experiments and reproducibility

Run `npm ci`, `npm run build`, `npm test`, `npm run typecheck`, `npm run test:e2e` and `npm run test:frontier`. The fast suites validate contracts and lifecycle; browser tests exercise actual exports, mobile/keyboard operation, local assets and installed/offline/failure behavior. CI runs the print-flow and offline checks on Linux and Windows.

`node scripts/benchmark-planning.mjs` records 24 real-encoder plans for 60/120/240-byte URLs, 20/30 mm, 203/300 DPI and automatic/explicit H correction. Suitable PNGs must return the exact payload text and bytes. The [planning report](https://github.com/Rockyljewell/QR-GEN/blob/fc54ac2d60f237651985df9a9bef684c02dd1dc2/docs/planning-benchmark-2026-10-11.json) contains geometry and unsuitable decisions. This does not test a printer or camera.

`npm run benchmark:frontier` compares fixed/adaptive capture in fresh desktop Chromium instances with generated Y4M feeds: an easy QR code, a tiny dense QR code, inverted Code 128 and a blank frame. It records actual input dimensions, time to first correct result, accepted frames, discovery frames and comparable capture-plus-decode p50/p95. Decoder-only adaptive timing is kept separate. All engine assets are local and external requests are blocked. Reports include environment and asset hashes.

The initial experiment exposed a policy regression: the tiny code was readable only on high-resolution discovery frames, because adaptation returned to an unreadable smaller size after each success. The initial report is retained. The next policy retains a successfully decoded discovery size if its measured decoder time is within budget, with slow-frame demotion and lifecycle reset still active. The subsequent report must be read alongside the initial result; first-read discovery delay remains an explicit tradeoff. One short synthetic run is exploratory, not a statistically established speed or reliability improvement.

Recorded results on desktop Chromium 153 with generated 1280 × 720 camera input:

| Scene | Fixed exact frames | Adaptive exact frames | Fixed / adaptive capture + decode median | Finding |
| --- | --- | --- | --- | --- |
| Easy QR | 47/47 | 47/47 | 12.3 / 5.6 ms | Adaptive used one quarter of the pixels in this scene |
| Tiny dense QR | 49/49 | 39/47 | 8.7 / 8.9 ms | First eight smaller inputs missed; discovery then sustained readable resolution |
| Inverted Code 128 | 24/48 | 24/48 | 12.8 / 5.4 ms | Both retained the existing alternating inversion behavior |
| Blank | No detections in 48 frames | No detections in 48 frames | 11.7 / 5.4 ms | Periodic discovery stayed bounded |

The tiny-code experiment improved from 5/48 exact adaptive frames in the [initial report](https://github.com/Rockyljewell/QR-GEN/blob/fc54ac2d60f237651985df9a9bef684c02dd1dc2/docs/frontier-benchmark-2026-10-11-initial.json) to 39/47 in the [subsequent report](https://github.com/Rockyljewell/QR-GEN/blob/fc54ac2d60f237651985df9a9bef684c02dd1dc2/docs/frontier-benchmark-2026-10-11.json). Its first correct result still took 644 ms from start versus 159 ms with fixed capture. This fixes a sustained-read regression; it does not establish a general reliability or speed advantage. All eight final runs had zero unexpected detections, scanner/browser errors, capture-accounting errors or external requests. Each scene/policy ran once for three seconds, with other validation workloads active; timing and error-rate conclusions require repeated paired trials.

The planning experiment produced 19 suitable and five unsuitable decisions; all 19 suitable PNGs returned the exact expected text and bytes. After integrating main's stability fixes, the local SDK regression suite passed 329 tests. The print-flow suite passed five scenarios including keyboard controls and 320-pixel layout. These counts describe the checked implementation, not physical-device coverage.

Four offline browser scenarios pass with genuinely gzip-compressed shell/scripts/WASM: installed tools reload without network and create/decode an image; a failed first engine install never claims readiness; a mismatched replacement preserves the previous working copy and a valid update activates after old tabs close; a first-ever offline visit fails honestly. They also check tracking-query navigation, scope isolation, cache contents and decoded-response headers. These checks exposed and fixed an install-time request stall caused by waiting for every response header before consuming large bodies. Each fetch now drains promptly with a 30-second timeout; reconstructed decoded responses discard stale transfer headers.

Independent review also identified and fixed a narrow-region pixel-budget breach, coordinate rounding distortion, leading Unicode BOM loss in the writer string path, missing viewBox validation, ambiguous hex-looking Wi-Fi passwords and stale async generator actions. Regression tests cover the supported fix paths. The planner rejects a leading BOM rather than silently changing it; the general encoder's BOM behavior is not changed by this slice.

Final integration tests cover intrinsic camera-size reset before adaptive training, stale in-flight results/errors, callback-driven pause/settings changes, CSS-only resize and stable batch identity across decoder-size changes. Review also corrected incoming component startup when camera/resolution/worker settings change while permission/startup is pending, retaining explicit-stop and replacement guards.

## Next implementation and validation gates

1. **Physical corpus and device trials.** Follow [phone validation](PHONE-VALIDATION.md). Use paired identical labels on low/mid/high-range Android and iOS phones plus desktop webcams, printed at actual size on ordinary and thermal printers. Include motion, off-axis views, glare, low light, damaged borders and multiple equal-payload codes. Record first correct result, wrong results, missed targets, warm/cold startup, p50/p95 and sustained thermal/battery behavior. Synthetic no-error results cannot establish a real-world error rate.
2. **Available native guidance.** Android's already bundled ML Kit supports potential barcode regions and zoom suggestions. Add separate opt-in guidance events and bounded zoom with camera/source/session guards, manual override and exactly-once frame release. Run unit/lifecycle tests and physical zoom-oscillation trials before broadening defaults. [Primary-source details and adapter constraints](ACCESS-RESEARCH-2026-10-11.md).
3. **Optional platform engines.** Query actual BarcodeDetector formats asynchronously, then preserve portable fallback for unsupported formats/failures. Establish raw-byte/GS1 metadata contracts first; never fabricate binary bytes from returned text. Evaluate OpenCV/multi-frame recovery only against a shared corpus where current engines actually fail.
4. **Broader creation access.** Port the planner's contract and golden payload/geometry fixtures to native SDKs, add contact/calendar payloads with reader interoperability fixtures, and test printable accessible companions. Signed/dynamic links and specialized code formats need an explicit interoperability/security case.
5. **Default changes.** Require reviewed compatibility, browser/platform build checks and paired device evidence with no material regression. Keep experimental switches available for rollback. No claim of frontier advancement is made merely because a feature exists; users must complete creation or scanning more successfully with fewer steps.

Before another adaptive policy change, repeat the same corpus with earlier first discovery and with a blank → tiny → easy transition. Measure first correct result and the cost of retaining a previously necessary high resolution separately. Change one policy decision at a time and preserve fixed capture as the paired baseline.

Also test mixed-size and equal-payload neighbors before recommending adaptation for batch/inventory use. Current discovery requires globally empty decode results: an easy code can keep a smaller neighboring code from ever receiving high-resolution discovery. This is a known limitation of the opt-in policy, not a tested multi-code availability improvement. Fixed capture is the recommended path when every visible item matters. A future policy must explore despite partial success without always promoting easy scenes to maximum resolution.

Native candidate/zoom adapters, cross-platform planner parity and physical-device conclusions remain follow-up work. They are not implied by the implemented JavaScript APIs or this report.
