This CI check compiles and links the current event's QRGenKit source for the iOS Simulator SDK. The small UIKit host directly constructs the public `QRGenScannerViewController`, with automatic camera startup disabled. Production source, rendering and styling are unchanged.

The runner requires a clean tracked checkout matching `GITHUB_SHA`, a fresh output under `RUNNER_TEMP`, all current Swift implementation files in actual compiler invocations, and matching host/object architectures. It verifies that the host links the real QRGenKit object, and retains full build logs, a result bundle and source/fixture hashes before and after the build.

```sh
python3 tests/ios-uikit-build/run.py --output "$RUNNER_TEMP/qrgen-ios-uikit-build-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

`ARCHS` explicitly selects the Apple host's Simulator architecture; `ONLY_ACTIVE_ARCH` alone can be ignored for a generic destination. No Simulator is created or booted. This check establishes compilation and linking only; it does not run the app or establish camera, rendering, decoding accuracy or Scandit parity.
