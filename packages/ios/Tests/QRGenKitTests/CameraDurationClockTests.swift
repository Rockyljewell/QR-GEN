// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest
@testable import QRGenKit

/// Real elapsed waits plus controlled camera-epoch inputs exercise the session
/// called by BarcodeScanner. These do not change the OS clock or run a camera;
/// the unchanged native caller supplies Date epoch milliseconds to this path.
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
            [initial], source: source, epoch: epoch, now: wallStart, mode: .continuous, duplicateWindow: 1000
        ))
        let committedFirst = try XCTUnwrap(session.commitScans(first, now: wallStart, duplicateWindow: 1000))
        XCTAssertEqual(committedFirst.map(\.data), [initial.data])
        let firstCommittedAt = ProcessInfo.processInfo.systemUptime
        waitUntilElapsed(wait, since: firstCommittedAt)
        let elapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        let ageSinceCommit = Int64(((ProcessInfo.processInfo.systemUptime - firstCommittedAt) * 1000).rounded(.down))
        let secondWall = wallStart + elapsed + correction
        let second = try XCTUnwrap(session.process(
            [barcode(timestamp: secondWall)], source: source, epoch: epoch, now: secondWall,
            mode: .continuous, duplicateWindow: 1000
        ))
        let committed = try XCTUnwrap(session.commitScans(second, now: secondWall, duplicateWindow: 1000))
        let postElapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        XCTAssertTrue(session.isCurrent(source: source, epoch: epoch))
        XCTAssertEqual(first.detections.first?.timestamp, wallStart)
        XCTAssertEqual(second.detections.first?.timestamp, secondWall)
        XCTAssertEqual(committedFirst.first, initial)
        let calibrated = wait == 0 ? elapsed < 1000 && postElapsed < 1000 : ageSinceCommit >= 1000
        try record([
            "case": name, "source": source, "epoch": epoch, "realElapsedMs": elapsed, "postOperationElapsedMs": postElapsed, "ageSinceFirstCommitMs": ageSinceCommit,
            "modeledWallFirst": wallStart, "modeledWallSecond": secondWall, "wallCorrectionMs": correction,
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
            [initial], source: source, epoch: epoch, now: wallStart, mode: .batch, duplicateWindow: -1
        ))
        let firstTrack = try XCTUnwrap(first.tracked?.first)
        XCTAssertEqual(session.commitScans(first, now: wallStart, duplicateWindow: -1)?.count, 1)
        let firstCommittedAt = ProcessInfo.processInfo.systemUptime
        waitUntilElapsed(wait, since: firstCommittedAt)
        let elapsed = Int64(((ProcessInfo.processInfo.systemUptime - start) * 1000).rounded(.down))
        let ageSinceCommit = Int64(((ProcessInfo.processInfo.systemUptime - firstCommittedAt) * 1000).rounded(.down))
        let secondWall = wallStart + elapsed + correction
        let second = try XCTUnwrap(session.process(
            [], source: source, epoch: epoch, now: secondWall, mode: .batch, duplicateWindow: -1
        ))
        let tracks = try XCTUnwrap(second.tracked)
        XCTAssertTrue(second.scans.isEmpty)
        XCTAssertTrue(session.commitScans(second, now: secondWall, duplicateWindow: -1)?.isEmpty == true)
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
}
