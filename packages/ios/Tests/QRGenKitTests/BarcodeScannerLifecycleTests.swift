// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(AVFoundation) && canImport(Vision) && (os(iOS) || os(macOS))
import AVFoundation
import XCTest
@testable import QRGenKit

final class BarcodeScannerLifecycleTests: XCTestCase {
    @MainActor
    func testStopInStartingStateCannotContinueToPermissionOrCaptureStartup() {
        let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["qr"]), authorizationStatus: { .denied })
        var errors: [QRGenError] = []
        scanner.onError = { errors.append($0) }
        scanner.onStateChange = { state in
            if state == .starting { scanner.stop() }
        }

        scanner.start()
        XCTAssertEqual(scanner.state, .stopped)
        XCTAssertTrue(errors.isEmpty, "The invalidated startup must not even reach permission handling")
    }

    @MainActor
    func testStopInSourceClearCallbackCannotResumeTheInvalidatedStartup() {
        let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["qr"]), authorizationStatus: { .denied })
        var errors: [QRGenError] = []
        scanner.onError = { errors.append($0) }
        scanner.onDetections = { barcodes in
            if barcodes.isEmpty, scanner.state == .starting { scanner.stop() }
        }

        scanner.start()
        XCTAssertEqual(scanner.state, .stopped)
        XCTAssertTrue(errors.isEmpty)
    }

    @MainActor
    func testRestartInStoppedStateOwnsTheNewSourceAfterAnOuterStopReturns() {
        let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["qr"]), authorizationStatus: { .denied })
        var stoppedFirstStartup = false
        var restarted = false
        var errors: [QRGenError] = []
        scanner.onError = { errors.append($0) }
        scanner.onDetections = { barcodes in
            if barcodes.isEmpty, scanner.state == .starting, !stoppedFirstStartup {
                stoppedFirstStartup = true
                scanner.stop()
            }
        }
        scanner.onStateChange = { state in
            if state == .stopped, !restarted {
                restarted = true
                scanner.start()
            }
        }

        scanner.start()
        XCTAssertTrue(restarted)
        XCTAssertEqual(scanner.state, .stopped)
        XCTAssertEqual(errors.count, 1, "Only the replacement startup may report its denied permission")
        XCTAssertEqual(errors.first, .cameraPermissionDenied)
    }
}
#endif
