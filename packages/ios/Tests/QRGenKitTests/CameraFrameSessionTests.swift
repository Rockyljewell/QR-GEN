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
            [barcode("A"), barcode("B", x: 500)], source: sourceA, now: 0, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(first.tracked?.map(\.id), ["1", "2"])

        let sourceB = session.beginSource()
        let empty = try XCTUnwrap(session.process([], source: sourceB, now: 30, mode: .batch, duplicateWindow: -1))
        XCTAssertEqual(empty.tracked, [])
        let returning = try XCTUnwrap(session.process(
            [barcode("A")], source: sourceB, now: 40, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(returning.tracked?.map(\.id), ["3"])
        XCTAssertEqual(returning.tracked?.first?.firstSeen, 40)
        XCTAssertEqual(returning.tracked?.first?.count, 1)
        XCTAssertTrue(returning.scans.isEmpty, "Camera changes preserve the duplicate-filter policy")
    }

    func testLateOldSourceCannotMutateNewTracksOrDuplicateHistory() throws {
        let session = CameraFrameSession()
        let sourceA = session.beginSource()
        _ = session.process([barcode("A")], source: sourceA, now: 0, mode: .batch, duplicateWindow: -1)
        let sourceB = session.beginSource()
        XCTAssertNil(session.process(
            [barcode("late")], source: sourceA, now: 30, mode: .batch, duplicateWindow: -1
        ))
        let fresh = try XCTUnwrap(session.process(
            [barcode("late")], source: sourceB, now: 40, mode: .batch, duplicateWindow: -1
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
            [barcode("A")], source: sourceA, now: 0, mode: .batch, duplicateWindow: 0
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
        XCTAssertNil(session.process([], source: first, now: 0, mode: .batch, duplicateWindow: 0))
        _ = session.process([barcode("A")], source: first, now: 1, mode: .batch, duplicateWindow: 0)
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
        _ = session.process([barcode("A")], source: source, now: 0, mode: .batch, duplicateWindow: -1)
        let moved = try XCTUnwrap(session.process(
            [barcode("A", x: 5)], source: source, now: 30, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(moved.tracked?.first?.id, "1")
        XCTAssertEqual(moved.tracked?.first?.count, 2)
        XCTAssertTrue(moved.scans.isEmpty)

        let next = session.beginSource(resetDuplicateHistory: true)
        let restarted = try XCTUnwrap(session.process(
            [barcode("A")], source: next, now: 40, mode: .batch, duplicateWindow: -1
        ))
        XCTAssertEqual(restarted.tracked?.first?.id, "2")
        XCTAssertEqual(restarted.scans.map(\.data), ["A"])
    }
}
