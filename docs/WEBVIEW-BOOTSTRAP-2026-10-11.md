# WebScanner startup and retry baseline

[Issue #79](https://github.com/Rockyljewell/QR-GEN/issues/79) was reported before production changes. On main `b591828f`, both Flutter and React Native queued host `start` until camera `ready`. An embed with `autostart=0` needs that start to produce its first ready event. Flutter also reproduced a blocked public retry after an initial camera error.

The [test-only Flutter baseline](https://github.com/Rockyljewell/QR-GEN/actions/runs/38182056013/job/114596506683) adds only `web_scanner_bootstrap_widget_test.dart`; it changes no production source. The fixture stays unchanged for the before/after check.

| Layer | Actual baseline | Scope |
| --- | --- | --- |
| Flutter | 279 passed, three intended dispatch failures; all 273 prior cases and six new controls passed; nine clean widget removals. Analysis passed. | Actual widget/controller with controlled platform script/navigation boundary. |
| React Native | Three intended public-start dispatch failures, eight controls passed, eleven clean unmounts. Callable SDK bridge present; no camera-ready message supplied. | Actual component/ref and SDK bridge in React DOM with a controlled native WebView/scanner boundary. |
| Embed and decoder | Five controls passed: explicit start before ready, default autostart, camera denial, failed main navigation and same-page retry. Loaded HTML/scripts/Blob worker/WASM match the isolated build. | Actual Chromium with its controlled camera device; stream-bearing cases release their tracks. Failed-document internals are explicitly unobserved. |

The [compact evidence record](https://github.com/Rockyljewell/QR-GEN/blob/fc54ac2d60f237651985df9a9bef684c02dd1dc2/docs/webview-bootstrap-baseline-2026-10-11.json) retains runtime versions, case names, cleanup outcomes and immutable receipt/log hashes. An earlier browser fixture had navigation-observer and Blob-provenance errors; its four passing product controls were preserved separately, and it was not treated as a complete baseline. The corrected independently reviewed fixture ran in a new output directory and passed all five cases.

The repair separates command transport from camera readiness. Only start/stop may be admitted before camera-ready after checking the current command API. Pause/resume/torch retain their actual-ready queue. Default autostart and explicit `autostart=0` stay intact. Transport checks never manufacture `onReady` or Flutter `isReady`. Reload, replacement, failed loading and removal invalidate pending asynchronous ownership.

The fixed React Native component passes all eleven unchanged before/after checks and sixteen independently reviewed edge checks, including a lost dispatch acknowledgement followed by camera-ready. The package passes 308 tests, type checking and its build. All 27 component runs remove their refs, listeners and bridge; all sixteen edge runs also record no remaining retry timers. Neither fixture records unintended browser errors or network requests. These checks use the actual component, private transport and SDK bridge with controlled native boundaries. The Flutter fixture remains unchanged; its additional transport tests cover delayed capability, redirects, failed evaluation/injection and replacement ownership. The branch CI runs its actual Flutter analysis and widget suite.

The existing rendered widgets, colors, typography, controls and overlays remain unchanged. These tests do not establish physical camera-driver reliability, native WebView event provenance, phone performance or Scandit parity. A native evaluation already submitted during navigation cannot be retracted by host generation checks.
