# Contact, calendar, upload and camera reliability

These fixes start from main `a76a71e837ce2e5fb0aabad10b6aea6e3b661e41`.
Each defect was reproduced and reported before its production fix. The original
site design, styles, dependencies and decoder settings remain unchanged.

| Issue | Reproduction and resulting behavior |
| --- | --- |
| [#62](https://github.com/Rockyljewell/QR-GEN/issues/62) | The web vCard parser split escaped semicolons inside organization/address fields and decoded literal backslashes twice. It now separates raw structured fields before decoding each value once. Formatted-name precedence, folded lines and accepted name-only fallback are retained. The name-only fallback fixture is not a complete standards-valid v3 card. |
| [#63](https://github.com/Rockyljewell/QR-GEN/issues/63) | The web calendar parser could take a timezone component's date, and nested alarm text leaked into event fields across implementations. Web, Python, .NET and Swift now read only direct properties of the first event, preserving existing date formatting and missing-field behavior. |
| [#64](https://github.com/Rockyljewell/QR-GEN/issues/64) | An Android unsupported-format warning callback could stop/release the scanner, but the outer start still acquired a camera provider and restored STARTING. Start ownership now follows the latest callback action, including restart, replacement camera/options and lifecycle owner. |
| [#66](https://github.com/Rockyljewell/QR-GEN/issues/66) | A valid PNG with boundary-like bytes in an ancillary chunk scanned normally as raw bytes but was truncated in multipart uploads. The Node server recognizes complete delimiter lines, preserves file bytes and rejects incomplete framing. |
| [#67](https://github.com/Rockyljewell/QR-GEN/issues/67) | Valid mixed-case JSON and multipart media types were treated as image bytes. The Node server normalizes the media-type token and parameter names while preserving the case-sensitive boundary value. |

The contact/calendar SDK regressions produced nine intended baseline failures
and two passing controls. Python calendar regressions produced two baseline
failures and four passing controls. Actual .NET parser sources also reproduced
alarm leakage under PowerShell's .NET runtime; this is separate from the .NET 8
project suite. Swift changes received source review and require hosted execution.

The Android tests-only baseline ran in hosted CI: two intended state assertion
failures, two passing controls, no test errors or skips. Both public camera
provider entry points are shadowed and provider requests are counted. The fixed
suite adds four callback-ownership controls, for eight new cases in total.
These are Robolectric lifecycle checks without a physical camera or ML Kit scan.

HTTP regressions use generated QR images with CRC-valid PNG text chunks; raw
requests provide decoding controls. The baseline had ten intended failures and
28 passing HTTP tests. The fixed HTTP suite has 39 cases, including quoted
parameters, options before/after a file, preamble/epilogue, delimiter lookalikes,
closing delimiters and malformed/incomplete requests. Built ESM and CommonJS
server entry points also passed ten actual localhost requests.

All source and regression changes received peer review. The combined branch is
gated on the complete existing hosted matrix before merge. Desktop browser,
simulated Android and source-level checks do not establish physical phone
coverage, sustained thermal performance or Scandit parity. The previously
reported decoder accuracy limitations remain open.
