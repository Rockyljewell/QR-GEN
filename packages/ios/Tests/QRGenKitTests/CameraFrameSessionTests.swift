// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class CameraFrameSessionTests: XCTestCase {
    private func barcode(_ data: String, x: Double = 0) -> Barcode {
        Barcode(
            data: data, symbology: .qr,
            location: .init(
                topLeft: .init(x: x, y: 0), topRight: .init(x: x + 100, y: 0),
                bottomRight: .init(x: x + 100, y: 100), bottomLeft: .init(x: x, y: 100)
            ),
            frameSize: .init(width: 1920, height: 1080), timestamp: 0
        )
    }

    func testNewSourceClearsTracksEvenWithoutDetectionsAndKeepsIncreasingIDs() throws {
        let session = CameraFrameSession()
        let sourceA = session.beginSource(resetDuplicateHistory: true)
        let first = try XCTUnwrap(session.process(
            [barcode("A"), barcode("B", x: 500)], source: sourceA, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(first.tracked?.map(\.id), ["1", "2"])
        _ = session.commitScans(first, now: 0, duplicateWindow: -1)

        let sourceB = session.beginSource()
        let empty = try XCTUnwrap(session.process([], source: sourceB, epoch: session.processingEpoch, now: 30, mode: .batch, duplicateWindow: -1))
        XCTAssertEqual(empty.tracked, [])
        let returning = try XCTUnwrap(session.process(
            [barcode("A")], source: sourceB, epoch: session.processingEpoch, now: 40, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(returning.tracked?.map(\.id), ["3"])
        XCTAssertEqual(returning.tracked?.first?.firstSeen, 40)
        XCTAssertEqual(returning.tracked?.first?.count, 1)
        XCTAssertTrue(returning.scans.isEmpty, "Camera changes preserve the duplicate-filter policy")
    }

    func testLateOldSourceCannotMutateNewTracksOrDuplicateHistory() throws {
        let session = CameraFrameSession()
        let sourceA = session.beginSource()
        _ = session.process([barcode("A")], source: sourceA, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: -1)
        let sourceB = session.beginSource()
        XCTAssertNil(session.process(
            [barcode("late")], source: sourceA, epoch: session.processingEpoch, now: 30, mode: .batch, duplicateWindow: -1
        ))
        let fresh = try XCTUnwrap(session.process(
            [barcode("late")], source: sourceB, epoch: session.processingEpoch, now: 40, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(fresh.tracked?.map(\.id), ["2"])
        XCTAssertEqual(fresh.tracked?.first?.firstSeen, 40)
        XCTAssertEqual(fresh.tracked?.first?.count, 1)
        XCTAssertEqual(fresh.scans.map(\.data), ["late"])
    }

    func testQueuedOutputBecomesInvalidOnSourceChange() throws {
        let session = CameraFrameSession()
        let sourceA = session.beginSource()
        let queued = try XCTUnwrap(session.process(
            [barcode("A")], source: sourceA, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: 0
        ))
        XCTAssertTrue(session.isCurrent(queued.source))
        let sourceB = session.beginSource()
        XCTAssertFalse(session.isCurrent(queued.source))
        XCTAssertTrue(session.isCurrent(sourceB))
    }

    func testTrackClearOnlyOccursOnceAfterPreviouslyTrackedCodes() {
        let session = CameraFrameSession()
        let first = session.beginSource()
        XCTAssertFalse(session.takeTrackClear(source: first))
        XCTAssertNil(session.process([], source: first, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: 0))
        _ = session.process([barcode("A")], source: first, epoch: session.processingEpoch, now: 1, mode: .batch, duplicateWindow: 0)
        let replacement = session.beginSource()
        let latest = session.beginSource()
        XCTAssertFalse(session.takeTrackClear(source: replacement))
        XCTAssertTrue(session.takeTrackClear(source: latest))
        XCTAssertFalse(session.takeTrackClear(source: latest))
        let stoppedAgain = session.beginSource()
        XCTAssertFalse(session.takeTrackClear(source: stoppedAgain))
    }

    func testUnchangedSourcePreservesTracksAndNewSessionResetsDuplicateHistory() throws {
        let session = CameraFrameSession()
        let source = session.beginSource(resetDuplicateHistory: true)
        let first = try XCTUnwrap(session.process([barcode("A")], source: source, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: -1))
        _ = session.commitScans(first, now: 0, duplicateWindow: -1)
        let moved = try XCTUnwrap(session.process(
            [barcode("A", x: 5)], source: source, epoch: session.processingEpoch, now: 30, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(moved.tracked?.first?.id, "1")
        XCTAssertEqual(moved.tracked?.first?.count, 2)
        XCTAssertTrue(moved.scans.isEmpty)

        let next = session.beginSource(resetDuplicateHistory: true)
        let restarted = try XCTUnwrap(session.process(
            [barcode("A")], source: next, epoch: session.processingEpoch, now: 40, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(restarted.tracked?.first?.id, "2")
        XCTAssertEqual(restarted.scans.map(\.data), ["A"])
    }

    func testPauseAndResumeRejectOldProcessingWithoutResettingTracksOrReports() throws {
        let session = CameraFrameSession()
        let source = session.beginSource()
        let oldEpoch = session.processingEpoch
        let first = try XCTUnwrap(session.process(
            [barcode("reported")], source: source, epoch: oldEpoch, now: 0, mode: .batch, duplicateWindow: -1
        ))
        _ = session.commitScans(first, now: 0, duplicateWindow: -1)
        session.invalidateProcessing() // pause
        let resumedEpoch = session.invalidateProcessing() // resume
        XCTAssertTrue(session.isCurrent(source), "The physical camera source does not change")
        XCTAssertFalse(session.isCurrent(source: first.source, epoch: first.epoch))
        XCTAssertNil(session.process(
            [barcode("pending")], source: source, epoch: oldEpoch, now: 10, mode: .batch, duplicateWindow: -1
        ))
        let resumed = try XCTUnwrap(session.process(
            [barcode("reported"), barcode("pending", x: 500)], source: source, epoch: resumedEpoch,
            now: 20, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(resumed.tracked?.first?.id, "1")
        XCTAssertEqual(resumed.tracked?.first?.count, 2)
        XCTAssertEqual(resumed.scans.map(\.data), ["pending"], "Undelivered old work cannot consume duplicate history")
    }

    func testConfigurationChangeRejectsAnOldSingleModeResult() throws {
        let session = CameraFrameSession()
        let source = session.beginSource()
        let singleEpoch = session.processingEpoch
        let continuousEpoch = session.invalidateProcessing()
        XCTAssertNil(session.process(
            [barcode("A")], source: source, epoch: singleEpoch, now: 0, mode: .single, duplicateWindow: -1
        ))
        let current = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: continuousEpoch, now: 1, mode: .continuous, duplicateWindow: -1
        ))
        XCTAssertFalse(current.completedSingleScan)
        XCTAssertEqual(current.scans.map(\.data), ["A"])
    }

    func testProcessingChangeInvalidatesRemainingCallbacksForAnAcceptedFrame() throws {
        let session = CameraFrameSession()
        let source = session.beginSource()
        let output = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: session.processingEpoch, now: 0, mode: .single, duplicateWindow: 0
        ))
        XCTAssertTrue(output.completedSingleScan)
        XCTAssertTrue(session.isCurrent(source: output.source, epoch: output.epoch), "Automatic single pause retains its own accepted result")
        session.invalidateProcessing() // a detection/track/state callback pauses, resumes or changes options
        XCTAssertFalse(session.isCurrent(source: output.source, epoch: output.epoch))
    }

    func testCallbackCancellationDoesNotConsumeFirstScanReport() throws {
        let session = CameraFrameSession()
        let source = session.beginSource()
        let output = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: session.processingEpoch, now: 0, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(output.scans.map(\.data), ["A"])
        session.invalidateProcessing() // onDetections/onTrack pauses or changes options
        XCTAssertNil(session.commitScans(output, now: 0, duplicateWindow: -1))
        let next = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: session.processingEpoch, now: 10, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(session.commitScans(next, now: 10, duplicateWindow: -1)?.map(\.data), ["A"])
    }

    func testSingleStateCallbackCanResumeAndChangeModeWithoutLosingTheReport() throws {
        let session = CameraFrameSession()
        let source = session.beginSource()
        let single = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: session.processingEpoch, now: 0, mode: .single, duplicateWindow: -1
        ))
        XCTAssertTrue(single.completedSingleScan)
        session.invalidateProcessing() // onStateChange(.paused) resumes
        let continuousEpoch = session.invalidateProcessing() // and changes mode
        XCTAssertNil(session.commitScans(single, now: 0, duplicateWindow: -1))
        let continuous = try XCTUnwrap(session.process(
            [barcode("A")], source: source, epoch: continuousEpoch, now: 10, mode: .continuous, duplicateWindow: -1
        ))
        XCTAssertFalse(continuous.completedSingleScan)
        XCTAssertEqual(session.commitScans(continuous, now: 10, duplicateWindow: -1)?.map(\.data), ["A"])
    }
}
