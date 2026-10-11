// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(AVFoundation) && canImport(Vision) && (os(iOS) || os(macOS))
import CoreGraphics
import XCTest
@testable import QRGenKit

final class FrameProcessorEpochTests: XCTestCase {
    private let region = CGRect(x: 0, y: 0, width: 1, height: 1)

    private func configuration(mode: ScannerOptions.Mode = .batch) -> FrameProcessor.Configuration {
        FrameProcessor.Configuration(options: ScannerOptions(symbologies: ["qr"], mode: mode), regionOfInterest: region)
    }

    func testPendingOptionsCannotStampOldSettingsWithTheNewEpoch() throws {
        let processor = FrameProcessor(configuration: configuration())
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        let next = configuration(mode: .continuous)
        processor.queue.sync {
            processor.update(next)
            XCTAssertNil(processor.currentEpoch(for: source), "Old queue settings are invalid as soon as update is requested")
        }
        let updated = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        XCTAssertNotEqual(updated, original)
        XCTAssertTrue(processor.sourceSession.isCurrent(source))
    }

    func testPendingRegionChangeRejectsOldFrameOwnership() throws {
        let processor = FrameProcessor(configuration: configuration())
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        processor.queue.sync {
            processor.setRegionOfInterest(CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5))
            XCTAssertNil(processor.currentEpoch(for: source))
        }
        let updated = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        XCTAssertNotEqual(updated, original)
    }

    func testPauseThenResumeInvalidatesOldOutputWithoutReplacingTheCamera() throws {
        let processor = FrameProcessor(configuration: configuration())
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        processor.setEnabled(false)
        XCTAssertNil(processor.queue.sync { processor.currentEpoch(for: source) })
        processor.setEnabled(true)
        let resumed = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        XCTAssertNotEqual(resumed, original)
        XCTAssertTrue(processor.sourceSession.isCurrent(source))
        XCTAssertFalse(processor.sourceSession.isCurrent(source: source, epoch: original))
    }

    func testOldSingleCompletionCannotDisableNewContinuousConfiguration() throws {
        let processor = FrameProcessor(configuration: configuration(mode: .single))
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        let continuous = configuration(mode: .continuous)
        processor.queue.sync {
            processor.update(continuous)
            processor.completeSingleScan(source: source, epoch: original)
        }
        let updated = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        XCTAssertNotEqual(updated, original)
    }

    func testAcceptedSinglePauseKeepsItsResultButCannotDisableALaterResume() throws {
        let processor = FrameProcessor(configuration: configuration(mode: .single))
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        processor.completeSingleScan(source: source, epoch: original)
        XCTAssertNil(processor.queue.sync { processor.currentEpoch(for: source) }, "The accepted single completion can still pause its own epoch")
        XCTAssertTrue(processor.sourceSession.isCurrent(source: source, epoch: original))
        processor.setEnabled(true)
        processor.completeSingleScan(source: source, epoch: original)
        XCTAssertNotNil(processor.queue.sync { processor.currentEpoch(for: source) }, "Resume wins over a delayed old completion")
    }

    func testOptionsChangeFromSinglePauseRemainsPausedUntilResume() throws {
        let processor = FrameProcessor(configuration: configuration(mode: .single))
        let source = processor.beginSource()
        processor.setEnabled(true)
        let original = try XCTUnwrap(processor.queue.sync { processor.currentEpoch(for: source) })
        let continuous = configuration(mode: .continuous)
        processor.queue.sync {
            processor.completeSingleScan(source: source, epoch: original)
            processor.update(continuous, enabled: false) // paused-state callback changes options without resume
        }
        XCTAssertNil(processor.queue.sync { processor.currentEpoch(for: source) })
        processor.setEnabled(true)
        XCTAssertNotNil(processor.queue.sync { processor.currentEpoch(for: source) })
    }
}
#endif
