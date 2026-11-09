// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest
@testable import QRGenKit

/// Real elapsed waits pair controlled camera-epoch metadata with duration inputs
/// carried by the native packet contract. These do not change the OS clock or
/// run a camera. Manual helper controls deliberately omit the elapsed argument.
final class CameraDurationClockTests: XCTestCase {
    private let wallStart: Int64 = 1_800_000_000_000

    private func barcode(timestamp: Int64) -> Barcode {
        Barcode(
            data: "SWIFT-CAMERA-CLOCK", symbology: .qr,
            location: .init(
                topLeft: .init(x: 10, y: 10), topRight: .init(x: 50, y: 10),
                bottomRight: .init(x: 50, y: 50), bottomLeft: .init(x: 10, y: 50)
            ),
            frameSize: .init(width: 640, height: 480), timestamp: timestamp
        )
    }

    private func waitUntilElapsed(_ milliseconds: Int64, since start: TimeInterval) {
        let deadline = start + Double(milliseconds) / 1000
        while ProcessInfo.processInfo.systemUptime < deadline {
            Thread.sleep(forTimeInterval: max(0, deadline - ProcessInfo.processInfo.systemUptime))
        }
    }

    private func record(_ values: [String: Any]) throws {
        let bytes = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
        print("SWIFT_CAMERA_CLOCK " + String(decoding: bytes, as: UTF8.self))
    }

    private func duplicateScenario(name: String, correction: Int64, wait: Int64, expectedScans: Int) throws {
        let session = CameraFrameSession()
        let source = session.beginSource(resetDuplicateHistory: true)
        let epoch = session.processingEpoch
        let start = ProcessInfo.processInfo.systemUptime
        let initial = barcode(timestamp: wallStart)
        let first = try XCTUnwrap(session.process(
            [initial], source: source, epoch: epoch, now: wallStart, mode: .continuous, duplicateWindow: 1000, elapsedTime: 0
        ))
        let committedFirst = try XCTUnwrap(session.commitScans(first, now: wallStart, duplicateWindow: 1000, elapsedTime: 0))
        XCTAssertEqual(committedFirst.map(\.data), [initial.data])
        let firstCommittedAt = ProcessInfo.processInfo.systemUptime
        waitUntilElapsed(wait, since: firstCommittedAt)
        let elapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        let ageSinceCommit = Int64(((ProcessInfo.processInfo.systemUptime - firstCommittedAt) * 1000).rounded(.down))
        let secondWall = wallStart + elapsed + correction
        let second = try XCTUnwrap(session.process(
            [barcode(timestamp: secondWall)], source: source, epoch: epoch, now: secondWall,
            mode: .continuous, duplicateWindow: 1000, elapsedTime: elapsed
        ))
        let committed = try XCTUnwrap(session.commitScans(second, now: secondWall, duplicateWindow: 1000, elapsedTime: elapsed))
        let postElapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        XCTAssertTrue(session.isCurrent(source: source, epoch: epoch))
        XCTAssertEqual(first.detections.first?.timestamp, wallStart)
        XCTAssertEqual(second.detections.first?.timestamp, secondWall)
        XCTAssertEqual(committedFirst.first, initial)
        let calibrated = wait == 0 ? elapsed < 1000 && postElapsed < 1000 : ageSinceCommit >= 1000
        try record([
            "case": name, "source": source, "epoch": epoch, "realElapsedMs": elapsed, "postOperationElapsedMs": postElapsed, "ageSinceFirstCommitMs": ageSinceCommit,
            "modeledWallFirst": wallStart, "modeledWallSecond": secondWall, "wallCorrectionMs": correction,
            "privateElapsedFirst": 0, "privateElapsedSecond": elapsed,
            "calibrated": calibrated, "eligibleScans": second.scans.count,
            "committedScans": committed.count, "expectedScansByElapsed": expectedScans,
        ])
        try XCTSkipUnless(calibrated, "Scheduling left the duplicate-window timing oracle inconclusive")
        XCTAssertEqual(committed.count, expectedScans, "Camera duplicate windows must follow elapsed time")
    }

    private func expiryScenario(name: String, correction: Int64, wait: Int64, expectedTracks: Int) throws {
        let session = CameraFrameSession()
        let source = session.beginSource(resetDuplicateHistory: true)
        let epoch = session.processingEpoch
        let start = ProcessInfo.processInfo.systemUptime
        let initial = barcode(timestamp: wallStart)
        let first = try XCTUnwrap(session.process(
            [initial], source: source, epoch: epoch, now: wallStart, mode: .batch, duplicateWindow: -1, elapsedTime: 0
        ))
        let firstTrack = try XCTUnwrap(first.tracked?.first)
        XCTAssertEqual(session.commitScans(first, now: wallStart, duplicateWindow: -1, elapsedTime: 0)?.count, 1)
        let firstCommittedAt = ProcessInfo.processInfo.systemUptime
        waitUntilElapsed(wait, since: firstCommittedAt)
        let elapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        let ageSinceCommit = Int64(((ProcessInfo.processInfo.systemUptime - firstCommittedAt) * 1000).rounded(.down))
        let secondWall = wallStart + elapsed + correction
        let second = try XCTUnwrap(session.process(
            [], source: source, epoch: epoch, now: secondWall, mode: .batch, duplicateWindow: -1, elapsedTime: elapsed
        ))
        let tracks = try XCTUnwrap(second.tracked)
        XCTAssertTrue(second.scans.isEmpty)
        XCTAssertTrue(session.commitScans(second, now: secondWall, duplicateWindow: -1, elapsedTime: elapsed)?.isEmpty == true)
        let postElapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        XCTAssertTrue(session.isCurrent(source: source, epoch: epoch))
        XCTAssertEqual(firstTrack.timestamp, wallStart)
        XCTAssertEqual(firstTrack.firstSeen, wallStart)
        XCTAssertEqual(firstTrack.lastSeen, wallStart)
        XCTAssertEqual(firstTrack.count, 1)
        let calibrated = wait == 0 ? elapsed < 500 && postElapsed < 500 : ageSinceCommit > 500
        try record([
            "case": name, "source": source, "epoch": epoch, "realElapsedMs": elapsed, "postOperationElapsedMs": postElapsed, "ageSinceFirstCommitMs": ageSinceCommit,
            "modeledWallFirst": wallStart, "modeledWallSecond": secondWall, "wallCorrectionMs": correction,
            "privateElapsedFirst": 0, "privateElapsedSecond": elapsed,
            "calibrated": calibrated, "tracks": tracks.count, "expectedTracksByElapsed": expectedTracks,
            "firstTimestamp": firstTrack.timestamp, "firstSeen": firstTrack.firstSeen, "lastSeen": firstTrack.lastSeen,
        ])
        try XCTSkipUnless(calibrated, "Scheduling left the track-expiry timing oracle inconclusive")
        XCTAssertEqual(tracks.count, expectedTracks, "Camera track expiry must follow elapsed time")
    }

    func testBackwardCameraEpochCorrectionUsesElapsedDuplicateWindow() throws {
        try duplicateScenario(name: "duplicate-backward", correction: -60_000, wait: 1200, expectedScans: 1)
    }

    func testForwardCameraEpochCorrectionUsesElapsedDuplicateWindow() throws {
        try duplicateScenario(name: "duplicate-forward", correction: 60_000, wait: 0, expectedScans: 0)
    }

    func testBackwardCameraEpochCorrectionUsesElapsedTrackExpiry() throws {
        try expiryScenario(name: "expiry-backward", correction: -60_000, wait: 650, expectedTracks: 0)
    }

    func testForwardCameraEpochCorrectionUsesElapsedTrackExpiry() throws {
        try expiryScenario(name: "expiry-forward", correction: 60_000, wait: 0, expectedTracks: 1)
    }

    func testOrdinaryContinuousWindowControl() throws {
        try duplicateScenario(name: "duplicate-ordinary", correction: 0, wait: 1200, expectedScans: 1)
    }

    func testOrdinaryBatchExpiryControl() throws {
        try expiryScenario(name: "expiry-ordinary", correction: 0, wait: 650, expectedTracks: 0)
    }

    func testExplicitFilterTimesKeepTheirNumericContract() throws {
        var filter = DuplicateFilter()
        XCTAssertTrue(filter.shouldReport("qr|A", now: 0, window: 1000))
        XCTAssertFalse(filter.shouldReport("qr|A", now: 999, window: 1000))
        XCTAssertTrue(filter.shouldReport("qr|A", now: 1000, window: 1000))
        XCTAssertTrue(filter.shouldReport("qr|A", now: 1001, window: 0))
        var once = DuplicateFilter()
        XCTAssertTrue(once.shouldReport("qr|A", now: 0, window: -1))
        XCTAssertFalse(once.shouldReport("qr|A", now: 1_000_000, window: -1))
        once.reset()
        XCTAssertTrue(once.shouldReport("qr|A", now: 1_000_001, window: -1))
        try record(["case": "explicit-filter-control", "exactBoundaryMs": 1000, "passedNumericAssertions": true])
    }

    func testExplicitTrackerTimesAndEpochMetadataKeepTheirContract() throws {
        var tracker = BarcodeTracker()
        let initial = barcode(timestamp: wallStart)
        let first = try XCTUnwrap(tracker.update(with: [initial], now: wallStart).first)
        XCTAssertEqual(tracker.update(with: [], now: wallStart + 500), [first])
        XCTAssertTrue(tracker.update(with: [], now: wallStart + 501).isEmpty)
        let returning = try XCTUnwrap(tracker.update(with: [initial], now: wallStart + 600).first)
        XCTAssertNotEqual(returning.id, first.id)
        XCTAssertEqual(returning.count, 1)
        XCTAssertEqual(first.timestamp, wallStart)
        XCTAssertEqual(first.firstSeen, wallStart)
        XCTAssertEqual(first.lastSeen, wallStart)
        XCTAssertEqual(returning.timestamp, wallStart)
        XCTAssertEqual(returning.firstSeen, wallStart + 600)
        XCTAssertEqual(returning.lastSeen, wallStart + 600)
        try record(["case": "explicit-tracker-control", "retainedBoundaryMs": 500, "expiredBoundaryMs": 501, "epochTimestamp": first.timestamp])
    }

    func testManualAndElapsedClockTransitionsPreserveNumericAgesAndReset() throws {
        var filter = DuplicateFilter()
        XCTAssertTrue(filter.shouldReport("qr|A", now: wallStart, window: 1000))
        XCTAssertFalse(filter.shouldReport("qr|A", now: wallStart + 500, window: 1000, elapsedTime: 500))
        XCTAssertTrue(filter.shouldReport("qr|A", now: wallStart + 1000, window: 1000, elapsedTime: 1000))
        XCTAssertFalse(filter.shouldReport("qr|A", now: wallStart + 1999, window: 1000))
        XCTAssertTrue(filter.shouldReport("qr|A", now: wallStart + 2000, window: 1000))
        filter.reset()
        XCTAssertTrue(filter.shouldReport("qr|A", now: wallStart, window: -1, elapsedTime: 0))

        var tracker = BarcodeTracker()
        let initial = barcode(timestamp: wallStart)
        let first = try XCTUnwrap(tracker.update(with: [initial], now: wallStart).first)
        XCTAssertEqual(tracker.update(with: [], now: wallStart + 500, elapsedTime: 500), [first])
        XCTAssertTrue(tracker.update(with: [], now: wallStart + 501, elapsedTime: 501).isEmpty)
        tracker.reset()
        let next = try XCTUnwrap(tracker.update(with: [initial], now: wallStart, elapsedTime: 0).first)
        XCTAssertNotEqual(next.id, first.id)
        XCTAssertEqual(tracker.update(with: [], now: wallStart + 500), [next])
        XCTAssertTrue(tracker.update(with: [], now: wallStart + 501).isEmpty)
        XCTAssertEqual(next.firstSeen, wallStart)
        XCTAssertEqual(next.lastSeen, wallStart)
    }

    func testElapsedPreviewAndRejectedOwnersDoNotConsumeReports() throws {
        let session = CameraFrameSession()
        let firstSource = session.beginSource(resetDuplicateHistory: true)
        let firstEpoch = session.processingEpoch
        let a = barcode(timestamp: wallStart)
        var b = a
        b.data = "UNCOMMITTED-B"
        let first = try XCTUnwrap(session.process([a], source: firstSource, epoch: firstEpoch, now: wallStart, mode: .continuous, duplicateWindow: -1, elapsedTime: 0))
        XCTAssertEqual(session.commitScans(first, now: wallStart, duplicateWindow: -1, elapsedTime: 0)?.count, 1)
        let pending = try XCTUnwrap(session.process([b], source: firstSource, epoch: firstEpoch, now: wallStart + 10, mode: .continuous, duplicateWindow: -1, elapsedTime: 10))
        let nextSource = session.beginSource()
        let nextEpoch = session.processingEpoch
        XCTAssertNil(session.commitScans(pending, now: wallStart + 10, duplicateWindow: -1, elapsedTime: 10))
        let fresh = try XCTUnwrap(session.process([b], source: nextSource, epoch: nextEpoch, now: wallStart + 20, mode: .continuous, duplicateWindow: -1, elapsedTime: 20))
        XCTAssertEqual(session.commitScans(fresh, now: wallStart + 20, duplicateWindow: -1, elapsedTime: 20)?.count, 1)
        let remembered = try XCTUnwrap(session.process([a], source: nextSource, epoch: nextEpoch, now: wallStart + 30, mode: .continuous, duplicateWindow: -1, elapsedTime: 30))
        XCTAssertTrue(remembered.scans.isEmpty)
        var c = a
        c.data = "UNCOMMITTED-C"
        let oldEpoch = try XCTUnwrap(session.process([c], source: nextSource, epoch: nextEpoch, now: wallStart + 40, mode: .continuous, duplicateWindow: -1, elapsedTime: 40))
        let currentEpoch = session.invalidateProcessing()
        XCTAssertNil(session.commitScans(oldEpoch, now: wallStart + 40, duplicateWindow: -1, elapsedTime: 40))
        let current = try XCTUnwrap(session.process([c], source: nextSource, epoch: currentEpoch, now: wallStart + 50, mode: .continuous, duplicateWindow: -1, elapsedTime: 50))
        XCTAssertEqual(session.commitScans(current, now: wallStart + 50, duplicateWindow: -1, elapsedTime: 50)?.count, 1)
    }

    func testDefaultClockSampleKeepsEpochAndMonotonicFieldsSeparate() {
        let before = Barcode.currentTimestamp()
        let first = CameraFrameClock.sample()
        Thread.sleep(forTimeInterval: 0.01)
        let second = CameraFrameClock.sample()
        let after = Barcode.currentTimestamp()
        XCTAssertGreaterThanOrEqual(first.timestamp, min(before, after))
        XCTAssertLessThanOrEqual(second.timestamp, max(before, after))
        XCTAssertGreaterThanOrEqual(second.elapsedTime - first.elapsedTime, 1)
    }
}
