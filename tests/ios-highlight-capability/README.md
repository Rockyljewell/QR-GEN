# iOS UIKit outline capability probe

This isolated hosted XCTest mounts the actual QRGenKit UIKit controller in a real app scene/window. It generates a QR image with QRGenKit, decodes it with Apple Vision and delivers that real Barcode through the controller's already-bound public detection callback. The actual AVCaptureVideoPreviewLayer performs conversion and the actual controller creates its own CALayer outline.

The camera is never started. The generated image is never displayed in the app. A positive capability result requires a newly emitted nondegenerate shape with visible model/presentation geometry and an actual before/after window-raster change. This is a declared image-decoder delivery boundary, not captured camera frames. It does not test physical camera registration, rotation/mirroring, native tracking, phone performance or comparative product quality.

The local QRGenSource link must resolve the exact unchanged source checkout and its root Package.swift. source-manifest.json binds the canonical Git/LF source bytes and the normalized executable fixture bytes to their reviewed representations. The runner verifies these pins and source inventory before and after execution. Line-ending normalization is recorded explicitly; it is not a behavior change.

The single test reports supported only after the combined geometry/raster gate and actual disappearance cleanup. capability_not_established is an XCTest skip with a receipt, not supported capability. A compiler, app-host, decoder-delivery, cleanup or collector error is a harness failure. A successful workflow or an XCTest skip alone never establishes support. All positive claims still require independent review of the actual attachments against the emitted outline.

Run only through the accompanying guarded runner on an Apple host with Xcode and an available iOS Simulator. It uses a fresh directory outside source checkouts, creates one owned Simulator, retains full build/test logs and xcresult attachments, and shuts down/deletes only its owned device. It preserves evidence when compilation or execution fails.

This diagnostic has no camera permission request, signing identity, secret input, publishing step, deployment or production-source modification. In a public repository its branch files, logs and uploaded test artifacts are available under the repository's normal visibility rules. Artifacts contain generated test data and app screenshots, not personal camera images.

Observability version 2 records the exact image hash, dimensions and ordered decoder results before eligibility checks, and identifies the first unmet prerequisite. If the central image returns no results, one additional scan of the original generated image is recorded as a diagnostic control. Control results never supply outline geometry or change the central image's acceptance or skip outcome. Prior executed fixture versions and their evidence remain separately preserved.
