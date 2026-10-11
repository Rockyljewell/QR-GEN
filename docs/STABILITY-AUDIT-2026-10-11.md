# QRGen stability audit and retail AR assessment

Audit date: October 11, 2026. Baseline: `c11ebae` on `main`.
Findings: [GitHub issue #3](https://github.com/Rockyljewell/QR-GEN/issues/3).

QRGen is more resilient after these fixes, but **parity with Scandit has not been
established**. Passing generated-image and fake-camera tests does not demonstrate
equivalent decoding, tracking, device support or operational reliability in stores.
There was no locally configured Scandit trial or matched physical-device corpus in this audit.

## Confirmed bugs and fixes

The original web suite passed 63 tests. New regressions first exposed 17 failures
in lifecycle, worker recovery, tracking and HTTP behavior; later checks exposed
scan-limit, reentrant-event and Windows tooling defects.

| Area | Reproduction / effect | Fix and evidence |
| --- | --- | --- |
| Camera ownership | Stop during permission prompt; a late stream remains live. Concurrent starts can attach an older stream. Metadata waits hang after stop; playback failure leaks the stream. | Generation checks dispose late streams, cancel metadata waits, time out missing metadata and release streams on failure. Unit tests plus real Chromium stop/unmount regressions. |
| Scanner sessions | Old decode results/errors affect a restarted or resumed session, changed options or switched camera. Stop during torch setup still emits ready; stopping in a track callback or changing the session in a single-mode pause callback still emits scan. | Invalidate pending results at lifecycle boundaries, recheck after asynchronous work and callbacks, reacquire a healthy shared decoder on restart. Unit regressions. |
| Frame capture | A canvas capture exception escapes the asynchronous callback, leaving the camera running without reporting the failure. | Stop and release the camera, report the error, and avoid submitting an invalid frame. Unit regression. |
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

## Original local verification before PR #4

Windows x64; Node 22.14 for unit tests and the image benchmark, Node 24.19 for the
website build/browser checks; Python 3.12 and zxing-cpp 3.1.1.

| Check | Result |
| --- | --- |
| Web SDK unit tests | 102 passing, including 39 added regressions |
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

## Follow-up after the approved merge

PR #4 was approved and merged as `f6ba331` after all 12 original CI jobs passed.
Further review found these separately reported defects:

| Issue | Finding | Follow-up change |
| --- | --- | --- |
| [#7](https://github.com/Rockyljewell/QR-GEN/issues/7) | React Native, Flutter and Python revive expired tracks. React Native/Flutter expose duplicate active IDs for the real FNV collision `costarring` / `liquid`; Python drops distinct payloads under an injected hash collision. | Expire before matching, preserve exact-timeout boundaries, store Python tracks by full payload key, allocate unique active IDs while preserving public hash helpers. Test both collision orders, expiry and reappearance. |
| [#8](https://github.com/Rockyljewell/QR-GEN/issues/8) | Queued autostart opens a detached scanner; reconnects duplicate click actions; a delayed element camera switch dereferences a destroyed scanner or updates its replacement. | Guard connection identity, cancel queued starts, remove root listeners on disconnect and check scanner ownership after switching. Real Chromium reproductions plus unit/browser regressions. |
| [#9](https://github.com/Rockyljewell/QR-GEN/issues/9) | Android overlap matching changes an old track's symbology and suppresses a new batch scan. | Restrict fallback to matching symbology; retain intentional same-symbology payload-jitter behavior. Kotlin regression and Swift parity test. |
| [#10](https://github.com/Rockyljewell/QR-GEN/issues/10) | Concurrent web camera switches hide the only reopening failure, leaving scanning state with no camera. | Share one in-flight operation/outcome, isolate restarted sessions, wait for camera readiness before scheduling. Regression tests and a real Camera/Scanner deferred-failure reproduction. |
| [#11](https://github.com/Rockyljewell/QR-GEN/issues/11) | iOS/Android camera changes retain old-source spatial tracks and delayed callbacks. | Clear spatial state on source changes and keep an immutable source identity through capture, processing and queued delivery. Preserve duplicate-filter history separately; add source-isolation tests and native CI coverage. |
| [#13](https://github.com/Rockyljewell/QR-GEN/issues/13) | Native pause/resume and settings changes admit queued old results; a stale single-mode completion can disable replacement processing. | Separate processing epochs from camera identities, admit decoded results before state mutation, and commit duplicate history immediately before valid scan delivery. Eleven new Swift and eleven Android regressions. |
| [#14](https://github.com/Rockyljewell/QR-GEN/issues/14) | Engine inversion is format dependent, missing sixteen generated PDF417/linear probes. | Bounded explicit polarity fallback, spatial merging, combined limits, raw main/worker paths and explicit Node codecs. Preserve the original benchmark alongside the improved result. |
| [#15](https://github.com/Rockyljewell/QR-GEN/issues/15) | Python rejects explicit GS1 for inherently GS1 DataBar writers. | Omit the redundant FNC1 mode flag for the DataBar family; six canonical/alias round trips, including four fail-before cases. |
| [#16](https://github.com/Rockyljewell/QR-GEN/issues/16) | Browser/SVG color swapping turns white bars on black into a solid black image. | Replace original black/white fills in one pass; six fail-before style regressions and a real browser generation/scan round trip. |
| [#17](https://github.com/Rockyljewell/QR-GEN/issues/17) | Pausing from a web batch track callback permanently loses the first scan while the code stays visible. | Retain pending first-scan IDs separately from spatial tracks, and admit them only when observed and delivery remains valid. |

The initial follow-up snapshot passed 113 SDK tests, 223 Python tests, 108 React Native tests,
SDK/React Native type checks and builds, the full website build, and 17 Chromium scenarios.
The new native source-isolation cases run in expanded CI: Swift pure-state tests on Linux,
native camera compilation/tests on macOS, and Android camera-module unit tests as well as
core tests and sample/library builds. Native pause/settings revision `a38d5b7` also passed all 13 CI jobs, including Linux/macOS Swift and Android camera-module tests/builds. These checks still do not provide physical-phone evidence.

The PR #12 follow-up candidate passes 156 SDK tests, 248 Python tests, SDK type
checking, the full SDK/website build (57 pages), and all 19 Chromium scenarios.
The React Native snapshot remains at 108 passing tests with type checking and
build passing. The final browser cases exercise mixed-polarity identical payloads
through the worker and browser-generated inverted PNG, EXIF-oriented JPEG and
transparent images. The [follow-up PR checks](https://github.com/Rockyljewell/QR-GEN/pull/12/checks)
provide the authoritative cross-platform result for each published revision.

No accessible phone or mobile test tools were found on the host. The user has no Scandit
trial configured. Hardware scanning, real store workloads and competitor parity remain open.

## Further stability and accessible selection round

The approved [PR #12](https://github.com/Rockyljewell/QR-GEN/pull/12) merged as
`7296c67`, with all 13 CI checks passing. The separately approved
[PR #18](https://github.com/Rockyljewell/QR-GEN/pull/18) merged as `98d9b9f`.
It replaces selection by tapping moving web highlights with stable barcode buttons
below the preview. Each track has its own labelled button, selected state and
keyboard activation. Selected snapshots remain available to deselect after leaving
view; the in-view count continues to describe current spatial tracks.

The next review round reported six additional defects before fixing them:

| Issue | Finding | Change and regression evidence |
| --- | --- | --- |
| [#19](https://github.com/Rockyljewell/QR-GEN/issues/19) | Mirroring reverses thin-barcode quad winding and collapses expanded highlights. | Orient minimum-height expansion toward the opposite edge; cover mirrored/unmirrored thin codes, rotations, expanded height and quad area. |
| [#20](https://github.com/Rockyljewell/QR-GEN/issues/20) | A paused camera switch retains the previous source's highlights, selectable rows and in-view count. | Clear spatial visuals, current rows and the in-view count before in-place switches, including failed switches. In-place camera switches and intrinsic frame-size changes preserve selected snapshots as out of view; attribute-driven scanner recreation clears selection. Unit and actual Chromium regressions cover paused switches and fresh track IDs. |
| [#21](https://github.com/Rockyljewell/QR-GEN/issues/21) | Intrinsic video-size changes combine tracks from incompatible pixel coordinate spaces and admit old-size output. | Invalidate obsolete processing and spatial state when frame dimensions change; preserve tracks for CSS-only layout changes. Cover queued results, track/count state and unchanged-size layout. |
| [#22](https://github.com/Rockyljewell/QR-GEN/issues/22) | Greedy association turns two identical observed items into three tracks depending on detection order. | Match the maximum number of same-payload/symbology tracks within distance gates, then minimize total movement. Regressions include both orders, deterministic ties, impossible matches and 150 exhaustive small-scene oracle checks. This does not establish physical identity through occlusion. |
| [#23](https://github.com/Rockyljewell/QR-GEN/issues/23) | Invalid Python images leak raw image errors/HTTP 500 and internally opened files can remain locked while the error is retained. | Normalize invalid-image failures at the input boundary, validate dimensions/channels and close internally owned resources while preserving caller ownership. SDK/REST, warning-as-error and held-error file cleanup regressions exercise the boundaries. |
| [#24](https://github.com/Rockyljewell/QR-GEN/issues/24) | Failed image URL responses retain unread bodies; interrupted successful bodies leak unnormalized errors. | Cancel unread error bodies and wrap image body-read failures with the original cause. Local streaming HTTP tests cover cancellation, interrupted bodies, startup failures and valid decoding. |

Whole-frame association has cubic worst-case cost for large ambiguous groups of
identical payloads. The default batch result limit is 20; integrations raising
limits need to validate dense duplicate scenes and frame responsiveness on target
phones. A higher supported limit does not imply uniformly cheap matching.

The current candidate passes **195 SDK tests**, **280 Python tests** and **21 real
Chromium browser scenarios**, including the paused-source switch with retained
out-of-view selection and a fresh replacement track ID. Python coverage includes
three malformed-EXIF inputs whose fallback retains usable loaded pixels and closes
owned resources. The full SDK/website build also passes.

The [portable browser stress run](browser-stress-2026-10-11.json), reproducible with
`npm run test:stress -w qrgen-site`, passes 50 start/stop cycles, 20 camera switches,
20 pause/resume cycles and a 180.6-second continuous fake-camera session. Across the
run it records 2,970 exact scan events, zero wrong payloads, zero scanner errors and
zero page/console errors. These repeated events come from one static generated QR
code and do not represent distinct physical items. All 18 continuous-session
samples retain one worker and one live camera track. Destroy returns the scanner
to idle, releases the camera track and detaches video; the healthy shared worker
remains intentionally cached. The recorded SDK asset SHA256 matches the built
candidate bundle, separately from the unpinned public-demo observations below.

This bounded desktop run does not establish phone thermal behavior, multi-hour
reliability, heap stability or matched competitor performance.

## Public demo smoke check and phone testing

The [public Scandit web demo](https://websdk.demos.scandit.com/) works without a
locally configured trial. Its [official web testing guide](https://docs.scandit.com/sdks/web/testing/)
documents Chromium's fake-camera video route and cautions about GPU fallback and
cross-origin isolation when measuring performance.

Both QRGen 1.0.0 (source snapshot `f698f59`) and the hosted Scandit 8.6.1 demo
displayed the exact `QRGEN-SCANDIT-SMOKE-20261011` payload from the same generated
640x480, 30 fps QR feed, with no page errors. The [saved evidence](public-demo-smoke-2026-10-11.json)
includes fixture arguments/hash, versions, visible results and settings. Scandit's
QR preset and QRGen's continuous/all-formats defaults differ; only the hosted
Scandit page had cross-origin isolation. A repeated Scandit quantity observation
was the same static code detected twice, not two physical items.

This single clean-code smoke check establishes a usable comparison route, not
relative speed or stability. No accessible physical phone was available. The
[phone run sheet](PHONE-VALIDATION.md) makes the remaining browser/native lifecycle,
camera-switch and physical-label checks repeatable; none are marked as executed.

The expanded [public format matrix](public-demo-format-matrix-2026-10-11.json)
records ten identical-input pairs: normal and inverted QR, Data Matrix, PDF417,
EAN-13 and Code 128. QRGen displayed all ten exact payloads; the Scandit 8.6.1 demo
displayed nine. Its inverted PDF417 case showed no exact result within the bounded
20-second observation, despite live video and no page errors. The public list/resume
state does not establish a proprietary decoder failure, so that case is recorded as
**inconclusive**. An initial off-screen Clear List obstacle was followed once using
ordinary Expand list and keyboard controls; unchanged failures were not rerun.

Every pair has the same Y4M SHA256. Each fresh browser context uses a 640x480,
30 fps generated feed and records exact input, fixture placement/module size,
selected format, inversion setting, observation time and outcome. Scandit's
EAN-13/UPC-A checkbox combines two formats; QRGen selects EAN-13 alone. Scandit's
Color Inverted setting and QRGen's default alternate-frame inversion also differ.
All observed pages had live video and zero page errors; QRGen used its worker path.
GPU acceleration and other engine/threading settings were not matched.

The public QRGen SDK asset was not hashed per case. PR #18 merged during the run
and its automatic deployment may have changed the public UI, so the evidence does
not pin a single hosted QRGen revision. The recorded local revision identifies
fixture generation only. These generated-label observations do not rank decoding
quality, speed, stability or physical-item tracking, and do not replace the
unexecuted phone protocol.

## Reproducible image benchmark

Run `npm run build:sdk`, then
`node scripts/benchmark-scanning.mjs docs/scanning-benchmark-2026-10-11-after.json`.
The [baseline](scanning-benchmark-2026-10-11.json) and
[result after the inversion fix](scanning-benchmark-2026-10-11-after.json) retain
machine details, engine versions, individual cases and warm decode timings.

The corpus has six formats (QR, Data Matrix, PDF417, EAN-13, Code 128 and DataBar),
four right-angle rotations and three contrast variants. The original result was
**56/72 exact**: inverted PDF417/EAN-13/Code 128/DataBar accounted for all 16 misses.
After [#14](https://github.com/Rockyljewell/QR-GEN/issues/14), **72/72 decode exactly**
through the public Node API, including all four rotations of every inverted case.
The built package also passes all 72 probes on its minimum supported Node 18.17 runtime.

The upstream engine's [inversion option is format dependent](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/ReaderOptions.h).
QRGen now performs at most one extra pixel-inverted decode for formats the engine
does not invert, when inversion is enabled and the result limit is not full.
It still performs that pass when normal-polarity codes are present, retaining
separate physical codes with identical payloads and merging repeated detections
by payload and overlapping location. Image pixels are copied for inversion;
alpha and coordinates are preserved. Both camera main-thread and worker paths
use the same helper, including the default/all-symbology selection.

Browser encoded images are normalized once before both passes, using the actual
raster dimensions and EXIF orientation; transparent pixels are composited on
white. Node loads explicit PNG/JPEG/GIF/BMP codecs only when a fallback is needed.
PNM/PSD retain their original engine decode behavior but have no Node raster
inversion fallback; callers can convert them or supply browser-rendered pixels.
Node fallback raster expansion is limited to 64 megapixels (JPEG also limits its
decoder memory to 256 MB). The codec dependencies remain outside browser/worker
bundles and the root npm audit still reports zero advisories.

On this desktop with Node 22.14, warm decoding rose from baseline p50 **1.282 ms** /
p95 **2.732 ms** to p50 **3.938 ms** / p95 **6.521 ms**. This is the cost of the
extra search and encoded-raster work on this generated corpus; the baseline also
includes 16 misses, so these single-run measurements are not a controlled speed
comparison. A separate 64-case codec probe recovered all inverted PNG/JPEG/GIF/BMP
fixtures without changing their input buffers. The public image `tryInvert: false`
option disables the additional search when speed matters more than reversed
reflectance. Python uses its existing `try_harder` / low-level `try_invert` controls;
its existing second-binarizer retry can run for each polarity when no code is found.

These diagnostics exclude engine startup and are **not camera latency, a performance
guarantee or a Scandit comparison**. They do not cover glare, damage, motion blur,
perspective, dense physical shelves or phone thermal behavior. Regression checks
include mixed-polarity identical payloads, combined limits, disabled inversion,
RGBA/input immutability, optional codec failures and fallback engine failures.

## Native overlap association follow-up

[Issue #28](https://github.com/Rockyljewell/QR-GEN/issues/28) reproduced an
avoidable two-to-three track inflation in Android and both Swift CI platforms.
Exact payload matches remain fixed while incomplete overlap assignments are
repaired before creating new IDs. [Reproduction, matching scope and validation](NATIVE-TRACKING-2026-10-11.md)
are recorded separately; physical item identity and phone parity remain unverified.

## Decoder hardening and photographic follow-up

The [decoder patch evaluation](DECODER-PATCH-2026-10-11.md) records the 3.1.5
dependency hardening and minimum-runtime/build/browser verification. The
[frozen photographic comparison](photographic-comparison-2026-10-11/README.md)
observed QR-GEN 13/16 and Scandit 15/16 exact positive payloads, with different
demo scan regions/options. It pins the earlier QR-GEN application revision and
keeps its follow-up separate. It does not establish stability or phone parity.

[Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) separately reproduces
a valid but wrong EAN-13 payload on a derived image. The decoder update does not
fix it; no wrong payload was observed in the public photographic demo run.
The [portable reproduction](ean13-repro/README.md) retains the image and options.

The [actual browser follow-up](ean-browser-diagnostic-2026-10-11/README.md)
subsequently reproduces #32 in full-frame hard search on a captured camera raster;
its ordinary aiming ROI returns no result. This does not change the historical
vendor observations. The [broader supporting-line study](ean-linecount-study-2026-10-11/README.md)
finds lost correct photographic/thin-code reads at stronger thresholds and another
wrong-value candidate that survives threshold 4. Decoder defaults remain unchanged.

## Encoded image dimensions and option descriptions

[Issue #34](https://github.com/Rockyljewell/QR-GEN/issues/34) reproduces exact
decodes with zero or incorrect frame dimensions for P5/P6 PNM, PSD, JPEGs with
legal marker fill/large metadata, and OS/2 BMP headers. Header inspection now
preserves those raster dimensions; encoded Blobs reuse one full byte read after
browser normalization is unavailable. Twelve real-reader regressions include
rectangular images, truncated-input behavior and Blob read reuse. Eight valid
dimension cases failed before the fix. The full SDK suite passes 341 tests;
the built public SDK also passes five dimension probes on Node 18.17.

[Issue #35](https://github.com/Rockyljewell/QR-GEN/issues/35) corrects descriptions
that said every camera mode defaults to fast search. Existing batch behavior is
tryHarder=true; single/continuous default to false and explicit values are retained.
No scan-policy default was changed. The prior decoder deployment's
[hosted lifecycle check](public-postdeploy-9f95203-2026-10-11.json) matches loaded
website modules against the successful CI deployment artifact; desktop fake
cameras still do not establish phone or Scandit parity.

## Batch configuration and retry ownership follow-up

[Issue #37](https://github.com/Rockyljewell/QR-GEN/issues/37) reproduces disabled
barcode types remaining counted and selectable after a paused symbology change.
Removed types now leave spatial tracking and pending scan reports immediately;
enabled track identities and intentionally chosen out-of-view snapshots remain.
[Issue #38](https://github.com/Rockyljewell/QR-GEN/issues/38) reproduces host apps
retaining stale selections because automatic resets omit the `select` event.
Nonempty resets now notify consumers once, including mode/source recreation and
disconnect. Callback ownership guards preserve a listener's replacement session.
[Issue #39](https://github.com/Rockyljewell/QR-GEN/issues/39) reproduces an obsolete
camera-start error after an error-state listener retries or stops; original start
promise rejections remain while obsolete event delivery is suppressed.

The prior `ded21a8` deployment's [hosted check](public-postdeploy-ded21a8-2026-10-11.json)
matches loaded app modules and both WASM assets against its successful Pages
artifact, including a PNM Blob dimension probe. Its separate
[ten-minute desktop check](browser-stress-ded21a8-2026-10-11.json) covers 50
start/stop cycles, 20 requested camera switches, 20 pause/resume cycles and
continuous worker decoding. The synthetic static camera is not phone, thermal,
memory-growth or Scandit parity evidence.

The [uniform EAN policy study](ean-uniform-policy-study-2026-10-11/README.md)
made 6,706 frozen-input reads across seven binarizer/global-contrast policies.
No tested policy recovered the actual Chrome camera target, and several lost
correct photographic reads or introduced other wrong values. The compact package
preserves full raw outputs and exact portable replay; no decoder default changed.
[Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) remains open.

## Compiled EAN candidate and deployed retail follow-up

The [compiled ambiguity candidate report](EAN-CANDIDATE-VALIDATION-2026-10-11.md)
preserves a reproducible baseline, actual rebuilt-WASM comparison, native unit
suite and real Chromium worker checks. Its 3,988 profiles / 12,108 reader calls
retain every expected text/family/bytes found by the baseline and introduce no new text/format
pairs. The candidate suppresses the known /2/07 ambiguity; /1/35 and explicit
UPC-A-only behavior remain unresolved. Production still uses released 3.1.5.
These development fixtures do not establish population or phone/vendor parity.

The merged retail release at `6d3728f` passes main CI, Pages and Docker builds.
Its [three hosted checks](retail-state-postdeploy-2026-10-11/README.md) match all
loaded modules and reader WASM to the actual successful Pages artifact, exercise
paused pruning/reset callbacks, and release every live camera track.

The [isolated public SDK follow-up](EAN-SDK-INTEGRATION-2026-10-11.md) now checks
the actual packaged SDK, Node entries and embedded browser worker with matching
reader assets. Its 4,648 public image calls lose no expected baseline target
record or bytes. The physical-conflict study refutes a simple overlap filter
for the separate /1/35 case. Neither study changes the released decoder.

## Camera ownership fixes and actual EAN row traces

[PR #45](https://github.com/Rockyljewell/QR-GEN/pull/45) fixes camera restart
from a synchronous destroy callback and obsolete frame-error delivery after a
stopped callback opens a replacement session. Thirteen added regressions bring
the SDK suite to 371 passing tests. Separate actual Chromium checks exercise
the public scanner, embedded worker and fake native camera; they reproduce the
old failures and verify cleanup in the fixed scanner. Fake cameras do not
establish physical-device behavior.

[PR #47](https://github.com/Rockyljewell/QR-GEN/pull/47) fixes Android Compose
retaining a replaced lifecycle owner or scanner state. Six Compose/Robolectric
tests exercise real view/controller ownership, including unchanged-owner
controls. Four intended baseline assertions fail; all six fixed cases pass.
Camera permission is denied in these tests, so they do not establish active
CameraX/MLKit or phone behavior. All 13 CI jobs and the automatic Pages/Docker
workflows pass for both merged revisions.

The [actual C++ row-trace report](ean-actual-row-trace-2026-10-11/README.md)
records unchanged released-reader policy on 15 saved rasters with fast/hard
search and limits 1, 2 and 255. All 90 baseline/instrumented pairs preserve every
recorded public result field; this is an instrumentation conformance check,
not 90 correct decodes. File-only analysis reconstructs 931,395 retained events
and all 30 result-limit comparisons without another recognition call.

The wrong `/2/07` and `/1/35` EAN values remain reproducible. The traces explain
which rows support each value and how result limits change the scan schedule.
They also show one decoder group collecting support from both placements of a
two-identical-label control. Returned positions are representative scanline-based
quadrilaterals and need not enclose every historical contributing row. They do
not establish physical symbol boundaries or item counts. No new decoder filter
or default is justified by this diagnostic study; production remains released
zxing-wasm 3.1.5 and [issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32)
remains open.

## Adapter, HTTP and GS1 reliability follow-up

[PR #55](https://github.com/Rockyljewell/QR-GEN/pull/55) fixes
[#51](https://github.com/Rockyljewell/QR-GEN/issues/51): embed URLs converted
numeric `0`/`1` to Boolean strings, losing result limits and duplicate-filter
settings. Only Boolean attributes are now coerced. Merge `4789fb2` passes all
13 main CI jobs, Pages and Docker.

Further fixes address Python unread-body connection corruption
([#50](https://github.com/Rockyljewell/QR-GEN/issues/50)), React events reaching
uncommitted callbacks ([#52](https://github.com/Rockyljewell/QR-GEN/issues/52)),
and malformed known GS1 fields producing misleading annotations
([#53](https://github.com/Rockyljewell/QR-GEN/issues/53)). The serializer fix
([#54](https://github.com/Rockyljewell/QR-GEN/issues/54)) applies GS1
predefined-prefix separator rules in Python, Swift and .NET. Existing styling
is preserved.

The combined fixes pass 394 SDK and 313 Python tests, SDK typecheck/build,
React browser regressions and existing frontier/offline checks. HTTP regressions
cover readable rejection responses and bounded cleanup; React checks isolate
wrapper ownership from decoding. GS1 checks enforce basic field structure and
separator rules. These fixes do not establish physical-phone reliability or
Scandit parity; the documented decoder accuracy and retail workflow gaps remain.

## React Native duration and callback reliability

Two additional bugs were reproduced and reported before production changes:

| Issue | Reproduction | Fix and evidence |
| --- | --- | --- |
| [#69](https://github.com/Rockyljewell/QR-GEN/issues/69) | Independent forward/backward system-clock changes expire fresh tracks or retain stale ones and change duplicate suppression. | Default duration windows use monotonic elapsed time through the pure helpers, session and native component. Epoch metadata and explicit injected-clock behavior remain intact. The pure baseline produced 14 intended failures; a separate component baseline produced six failures with six controls passing. All 137 React Native tests pass after the fix, including 29 new clock and control cases. |
| [#70](https://github.com/Rockyljewell/QR-GEN/issues/70) | A batch `onScan` resets/unmounts the scanner, commits a different mode, or processes a nested replacement frame, then receives the obsolete `onTrack` snapshot. | Validate delivery generation and mounted session ownership after the callback. Four original actual-component baseline assertions fail while 15 controls pass; an additional nested-frame failure was confirmed during review. The fixed checks retain ordinary batch callbacks, cosmetic changes, idempotent start/resume and a still-current snapshot after a no-change empty frame. |

Component checks render the exported scanner with ReactDOM and stub native camera,
platform and overlay boundaries. Local ownership probes also use the installed
VisionCamera 4.7.3 hook; the CI boundary models its stable latest-callback forwarding.
They establish callback ordering and duration plumbing, not native-driver frame provenance.
All 34 permanent component cases pass, including two nested-empty-frame controls and
12 independently controlled wall/elapsed-clock cases. The initial draft cancelled a
still-current notification after a no-change empty frame; peer review caught that
regression before publication, and only replacement tracking updates now advance delivery.
React Native 0.73 monotonic-clock availability was verified from its release sources;
unsupported pure-JavaScript environments without `performance.now()` retain wall time.
The original scanner styles, overlay, dependencies and decoder remain unchanged.
Physical phones, long store sessions and matched Scandit comparison remain unverified.

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
| Multi-code overlays | Web canvas highlights, smoothing and accessible per-track list selection; native overlays also exist. | Add explicit per-code inventory/task states and test list selection with representative users and dense views. |
| Identical-product counting | Web/iOS/Android match spatial detections. Python offers optional short-lived spatial observations with a bounded association workload; its default tracker and React Native/Flutter still aggregate by symbology and payload. Web scan-event duplicate filtering also aggregates payloads. | Add spatial tracking to remaining aggregating platforms. Validate decoded observations against physical items, including misses, duplicate detections and identity swaps; tracks do not establish confirmed quantities or persistent physical identity. |
| Remembering off-screen items | Web tracks expire after 500 ms by default. Confirmed receiving quantities persist locally after leaving view and reload. There is no persistent scene map or physical item identity across occlusion/camera movement. | Validate physical re-identification separately. Increasing a timeout alone does not establish physical identity. |
| Picking / receiving | The [local receiving workflow](RECEIVING-WORKFLOW.md) supports expected quantities, unexpected products, explicit confirmation, corrections with history, parallel-tab transactions and stable exports. Scanner observations do not increment quantities. | Validate with representative users and integrate authoritative inventory data. Add target-SKU picking separately. |
| Price / expiry checks | GS1 dates, amounts and product identifiers can be parsed. | Connect an authoritative product/inventory source; show provenance and freshness before acting on an overlay. |
| Label OCR and broader IDs | AAMVA parsing is present. Parsing a barcode is not authenticity verification; no general label OCR/passport verification engine was found. | Treat OCR and document authenticity as separate integrations and validation projects. |
| Feedback / accessibility | Beep, vibration, visual highlights and labelled keyboard-operable web batch buttons exist. | Test noisy stores, gloves, one-handed use, color vision differences and dense tap targets. Pair colors with text/icons. |

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
   p50/p95/p99 latency, overlay jitter, selection accuracy, camera-switch recovery, memory
   and thermal behavior. Run repeated permission/background/navigation cycles and
   multi-hour sessions on representative low/mid/high-tier phones.
5. **Trial the workflow.** Test receiving and picking with real users. Require no
   leaked camera tracks, unhandled errors or lost confirmed actions; compare task
   accuracy and completion time to the pinned competitor under the same conditions.

Release the current bug fixes after CI review. Keep the physical-device benchmark,
upstream dependency advisories and AR feature work tracked independently; this
audit does not authorize publishing an unverified "as stable or better" claim.
