The compile check builds and links the current event's real QRGenKit source for the iOS Simulator SDK. Its small UIKit host directly constructs the public `QRGenScannerViewController`, with automatic camera startup disabled. Production source, rendering and styling are unchanged by this fixture.

The runner requires a clean tracked checkout matching `GITHUB_SHA`, a fresh output under `RUNNER_TEMP`, all current Swift implementation files in actual compiler invocations, and matching host/object architectures. It verifies that the host links the real QRGenKit object, and retains full build logs, a result bundle and source/fixture hashes before and after the build.

```sh
python3 tests/ios-uikit-build/run.py --output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

`ARCHS` explicitly selects the Apple host's Simulator architecture; `ONLY_ACTIVE_ARCH` alone can be ignored for a generic destination. This command creates no Simulator and establishes compilation/linking only.

The separate, opt-in UI runtime probe reuses that exact compiled app and verifies its executable hash against the build receipt:

```sh
python3 tests/ios-uikit-build/run-ui-probe.py --build-output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

It creates one owned iPhone Simulator from an installed available runtime/device-type pair, boots it, installs the compiled app and launches `--qrgen-toast-lifecycle-probe` with a fresh token. The host exercises the actual scanner view controller in a real navigation stack, with `startsAutomatically=false`. Controlled public scan callbacks show the toast; ordinary expiry and a fresh-toast control surround the same-controller disappearance/reappearance case. The app records actual lifecycle/timing calibration and UI state. It does not start a camera or decode an image.

The helper waits at most 45 seconds after launch for the app's terminal receipt. It copies the raw receipt from the app container before evaluating it, distinguishes semantic failures from failed controls or inconclusive timing/setup, and verifies the checkout and compiled executable remain unchanged. Every created Simulator is terminated, shut down and deleted by its exact recorded UUID, with deletion verified. No pre-existing Simulator is booted, shut down or deleted.

The existing macOS CI job runs compilation first and the runtime probe second. Its always-uploaded `ios-uikit-build` artifact retains both the original compilation evidence and the separate `evidence/ui-runtime/` command logs, raw app receipt and runtime receipt, including failed or inconclusive runs. These checks do not establish physical-phone camera behavior, decoder accuracy or Scandit parity.
