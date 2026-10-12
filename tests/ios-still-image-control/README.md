# iOS Simulator still-image observations

This diagnostic compiles the event checkout's unchanged QRGenKit into a hosted iOS XCTest. It records public SDK and direct Apple Vision results for one retained PNG and one newly generated QR PNG. Each available input is decoded once by each arm, in SDK then Vision order, using the same ImageIO CGImage and explicit upright orientation. There are at most four attempted decode calls.

The test records ordered results, errors, nil versus empty raw results, request defaults, caller-thread metadata and numeric geometry. It does not start a camera, scanner controller, preview or renderer. A passed test means the observation protocol completed. Empty results and per-arm errors remain observations. If generation or preparation makes the second input unavailable, the retained two-call result is explicitly partial rather than a complete two-input comparison.

The runner requires a clean checkout at the exact GitHub event commit, pins its current Package.swift plus all eighteen Swift sources, and verifies the six reviewed fixture files. It copies only those six files into a fresh directory under RUNNER_TEMP and binds QRGenSource to the current checkout root. No historical production revision is selected.

It creates its own iPhone Simulator, uses its validated host architecture consistently, and builds for testing before invoking exactly one test without building. PNG compression is disabled to preserve the retained input's exact bytes. Actual compiler inputs, test link inputs, product/resource hashes, xcresult, raw logs, compact JSON and kept JSON/PNG attachments are retained. Source, copied fixtures, executable and resource bytes must remain stable. The owned Simulator is shut down and deleted; its UUID must be absent afterward. No other device is modified.

Run on an Apple host with Xcode and an available iOS Simulator using:

```sh
python3 tests/ios-still-image-control/run.py --output "$RUNNER_TEMP/ios-still-image-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The dedicated branch workflow uploads `ios-still-image-observations`. Its artifact contains `run-receipt.json`, raw logs, `Build.xcresult`, `Test.xcresult`, exported attachments and normalized `observations.json` when collection succeeds. Failures retain available evidence and return a nonzero status. This is a diagnostic branch workflow, not a permanent benchmark.

The SDK performs its internal Vision request on a background queue; the direct request executes in the test's main-actor context. Separate requests, image representations and runtime differences limit interpretation. This diagnostic cannot establish mapper causation, UIKit preview behavior, camera registration, physical-device accuracy, scanning stability or parity with another vendor. The retained PNG is synthetic and contains only the fixed test payload. Workflow permissions are read-only; no private protocol notes, personal paths, credentials or camera media belong in this fixture.
