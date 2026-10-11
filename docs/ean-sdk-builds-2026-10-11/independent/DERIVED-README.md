# Independent staged SDK package and smoke review

The retained isolated SDK packages pass this decode-free artifact review. No production integration or complete issue 32 fix is established.

`review.py` independently checks 913 artifact/source assertions. `review-results.json` records every check, with zero failures. The review reads existing evidence and writes only this independent review directory; it does not import an SDK, decode an image, build, install, or mutate the repository or GitHub.

- Both variants originate from all 77 tracked SDK files at `6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b`; original provenance hashes match the Git blobs. Baseline changes only diagnostic package metadata. Candidate changes that metadata and exactly seven declared tracked source/test files. The mock test changes only its module path; all assertions are preserved. New private graph, diagnostic asset, notices and provenance are separately inventoried.
- The real checkout's 77 tracked SDK files and root dependency lock match that base after explicit CRLF-to-LF normalization. Their raw filesystem bytes differ due to line endings. This is a bounded current-state source check, not proof about every prior action, generated file, dependency, or historical mutation. The staging/packing scripts direct their writes to external study directories.
- Every byte of both 95-file archives matches the recorded inventory, extracted consumer package, and staged packed file. Both packages retain the base public export map and CLI target. All 28 export leaf targets exist per package; this does not mean every optional framework or export was exercised at runtime.
- The candidate's executable private reader graph equals the matching rebuilt graph byte-for-byte. Emitted source maps contain the exact private graph contents, with no official reader source origin; executable package files have no external official reader import. The generated worker source hash is preserved. Actual browser/worker execution is a separate study.
- Baseline reader SHA256 is `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`; candidate is `f9d636340ef9b9b3e433e9c81a1cff228c80c4d9f45b748b6fe116308821ddc6`. Both packed writers are unchanged, SHA256 `af26f895fe471d23cb2d742bc3eca0695dbecb4ea6bad9b92eba3763ec505941`. Node automatic writer loading continues to use the existing `zxing-wasm` dependency; this is not a dependency-free distribution test.
- All eight retained Node 18.17.0/24.19.0 × ESM/CommonJS × baseline/candidate entry smoke records match their retained packed entry hashes. Each observes exactly the expected reader and original writer bytes at the intercepted WebAssembly instantiation boundary, records no fetch attempts, and returns one correct public QR, EAN-13 and UPC-A result with unchanged input. These are 24 repeated clean-case executions of three identities, not a larger independent image sample.
- The original Node18 v1 harness failure occurred before SDK import/decode because a Windows URL pathname produced `C:\C:\...`. The exact v1 runner remains preserved; the derived runner differs only in URL-to-path conversion. Node24 records use v1; Node18 uses the derived runner. `node18-first-attempt-observation.json` is explicitly a historical tool-response observation (chunk `504a57`), not an original redirected stderr archive. The retrospective toolchain observation is accurately labelled after successful execution and matches current retained dependency metadata.

The original smoke monitor intercepts byte inputs to `WebAssembly.instantiate` and denies `fetch`; it is not a universal WebAssembly or network monitor. The stronger broader Node matrix monitor is reviewed separately. Caller-supplied binaries, official default CDN behavior, capability/build identity, cache migration, held-out accuracy, physical devices and Scandit parity remain outside these checks. The package and protocol clearly label the result as a nonproduction diagnostic requiring explicitly matching browser assets.

Archive SHA256:

| Variant | SHA256 |
| --- | --- |
| Baseline | `b1c94ed2a326fe98213013269a8e99cf28ceb23b40c4e1f3e59d22495f5b97f8` |
| Candidate | `d04e4bd4b1d693c91ab37fbb4aac40ce79f6f5024c2c4f047aa46d8f55fb8033` |

Run the retained `review.py` with the bundled Python runtime from this artifact directory to reproduce the checks. It reads the original study, actual reader build, and base repository objects at their existing local paths and rewrites only its own two result files. `manifest.json` freezes this independent review package.
