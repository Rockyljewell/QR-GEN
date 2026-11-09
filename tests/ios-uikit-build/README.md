The compile check builds and links the current event's real QRGenKit source for the iOS Simulator SDK. Its small UIKit host directly constructs the public `QRGenScannerViewController`, with automatic camera startup disabled. Production source, rendering and styling are unchanged by this fixture.

The runner requires a clean tracked checkout matching `GITHUB_SHA`, a fresh output under `RUNNER_TEMP`, all current Swift implementation files in actual compiler invocations, and matching host/object architectures. It verifies that the host links the real QRGenKit object, and retains full build logs, a result bundle and source/fixture hashes before and after the build.

```sh
python3 tests/ios-uikit-build/run.py --output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

`ARCHS` explicitly selects the Apple host's Simulator architecture; `ONLY_ACTIVE_ARCH` alone can be ignored for a generic destination. This command creates no Simulator and establishes compilation/linking only.

The separate, opt-in UI runtime helper reuses that exact compiled app and verifies its executable hash against the build receipt. Its default remains the toast probe alone:

```sh
python3 tests/ios-uikit-build/run-ui-probe.py --build-output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

CI explicitly requests the toast and separate model path probes:

```sh
python3 tests/ios-uikit-build/run-ui-probe.py --build-output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" --probe toast --probe batch-model-path
```

The helper creates one owned iPhone Simulator from an installed available runtime/device-type pair, boots it and installs the compiled app once. Each probe gets a fresh app launch, token and distinct app receipt file. The toast probe exercises the actual scanner view controller in a real navigation stack, with `startsAutomatically=false`. Controlled public scan callbacks show the toast; ordinary expiry and a fresh-toast control surround the same-controller disappearance/reappearance case. Its original two fixture classes and three named oracles remain unchanged; the host adds separate launch dispatches for the batch probes.

The `batch-model-path` probe inspects actual captured `CAShapeLayer.path` values on four fresh controllers for numerical capability, ordinary movement, backward-epoch movement and an independent source-clear control. It requires finite, nonzero, distinct numerical geometry and uses scale-relative comparisons. Controlled public callback models describe the 0/40/220 ms scene; this app does not execute an internal frame session. Its receipt explicitly declares `visibleOverlayClaim=false`, `presentationInspected=false`, `nativeSessionExecuted=false` and `modelTimesControlled=true`. It tests which layer's model path changes and whether source-clear detaches it. It does not inspect presentation paths or establish visible overlays, pixels or camera behavior. Complete receipts require all four named checks and all three semantic cases; a failed capability is inconclusive and fails the helper.

The original `batch-overlay` diagnostic remains available separately:

```sh
python3 tests/ios-uikit-build/run-ui-probe.py --build-output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" --probe batch-overlay
```

Its original fixture and gates remain unchanged: finite, distinct, nondegenerate, on-window projection, identifiable visible model/presentation paths, measured elapsed grace and an independent early source-clear control. The [first test-only baseline](https://github.com/Rockyljewell/QR-GEN/actions/runs/42553846690) was explicitly inconclusive: with no capture input or preview connection, projection returned tiny fractional coordinates below the frozen size and movement gates. It ran zero semantic cases. Selecting this diagnostic still fails on that unsupported capability; the separate model path probe does not turn that result into visibility evidence.

The two-case Swift model test uses actual `CameraFrameSession` output with nominal 0/40/220 ms inputs to validate the public callback scene. This establishes model reachability separately from the controller's model path selection and the unsupported visible-overlay diagnostic.

Simulator boot readiness has a five-minute budget before installation and launch. Each app receipt has a separate deadline of at most 45 seconds after its launch. All requested probes' raw terminal or partial receipts are copied before suite classification, so a failed toast check does not prevent collection of the batch probe. Setup errors, failed controls, inconclusive capability/timing and valid target failures remain distinct. The helper verifies the checkout and compiled executable remain unchanged. Every created Simulator is terminated, shut down and deleted by its exact recorded UUID, with deletion verified. No pre-existing Simulator is booted, shut down or deleted.

The existing macOS CI job runs compilation first and the runtime probes second. Its always-uploaded `ios-uikit-build` artifact retains the original compilation evidence and the separate `evidence/ui-runtime/` command logs, each raw app receipt and aggregate runtime receipt, including failed or inconclusive runs. The app records actual lifecycle/timing calibration, scanner state and cleanup. Both probes use controlled public callbacks without starting a camera or decoding an image; the batch app does not execute an internal frame session. These checks do not establish physical-phone camera behavior, decoder accuracy or Scandit parity.
