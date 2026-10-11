# Native callback and clock reliability follow-up

This round integrates three independently reviewed fixes from main
`cffdb177ed4ee4bb0c4e764106925303253f6adc`. It preserves the original styling,
dependencies and scanner payload aggregation policies.

* [#57](https://github.com/Rockyljewell/QR-GEN/issues/57): React Native and
  Flutter completed a single scan after calling application callbacks. A callback
  that restarted scanning could therefore have its new session stopped by the
  old frame. Completion now happens before feedback and callbacks. Restart,
  resume, reset, mode change, stop and unmount retain the callback's intended state;
  reset clears duplicate history while start/resume preserve it.
* [#58](https://github.com/Rockyljewell/QR-GEN/issues/58): Swift now rejects
  overlong known variable fields and incomplete Digital Link path tails. Swift
  and .NET reject empty known query fields and currency fields without an amount.
  Encoded path values decode once; .NET retains the escaped representation
  exposed by `System.Uri` when it differs from the value. Tests retain unknown-AI,
  optional identifier suffix, short GTIN padding and calendar/checksum policies.
* [#59](https://github.com/Rockyljewell/QR-GEN/issues/59): Python duplicate and
  tracking windows use monotonic elapsed time for ordinary calls, while public
  timestamps remain epoch milliseconds. Explicit `now_ms` calls retain their
  injected-clock behavior. Mixing clock sources rebases history from timestamp
  ages at each transition; a consistent clock basis remains advisable.

The three fixes retain their separate commits. Source and regression-test peer
reviews found no blocking issue. Native Swift/.NET runtime checks and Flutter
widget execution are supplied by the exact-head CI gate before merge.

Local integration validation uses an independent locked npm install, Node 24.19.0,
Python 3.12.14 and Chromium. Results:

| Check | Result |
| --- | --- |
| Web SDK unit tests | 394 passed |
| React Native unit tests | 108 passed |
| Python full suite | 328 passed |
| SDK and React Native type checks; SDK/site builds; site type check | Passed; one existing deprecated-copy hint |
| Internal links and skill manifest | 9,369 links across 60 pages; seven skills passed |
| Site camera/browser scenarios | 23 passed |
| React adapter checks | Five passed, including server rendering |
| Native single-scan callback integration | Ten passed |
| Print-planning and offline browser checks | Nine passed |
| Built CLI generated-QR round trip | Exact payload passed |

The native browser regression runs the real React Native scanner component,
public imperative ref and scan session under ReactDOM. Camera/platform/views and
overlays are boundary stubs. Flutter adds eight widget cases using its fake
platform. These tests establish callback ownership, not physical camera behavior.
Python checks use controlled clocks and generated frames. An initial Python run
hit a temporary-directory permission error; its result was retained separately,
and the full suite then passed with a fresh temporary directory. No physical
phone, sustained thermal, persistent item identity or Scandit parity claim follows
from this validation. Existing decoder accuracy limitations remain open.
