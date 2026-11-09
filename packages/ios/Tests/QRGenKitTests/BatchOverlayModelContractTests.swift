// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

/// Confirms a representative UIKit probe scene using the real session with
/// nominal paired inputs at 0/40/220 ms; the live probe measures elapsed times.
/// This is not a camera, OS-clock, preview-projection or visible-UI test.
final class BatchOverlayModelContractTests: XCTestCase {
    private let wallStart: Int64 = 1_700_000_000_000

    private func barcode(_ payload: String, x: Double, y: Double, timestamp: Int64) -> Barcode {
        Barcode(
            data: payload, symbology: .qr,
            location: .init(
                topLeft: .init(x: x, y: y), topRight: .init(x: x + 96, y: y),
                bottomRight: .init(x: x + 96, y: y + 54), bottomLeft: .init(x: x, y: y + 54)
            ),
            frameSize: .init(width: 1920, height: 1080), timestamp: timestamp
        )
    }

    private func verifyScene(name: String, correction: Int64) throws {
        let session = CameraFrameSession()
        let source = session.beginSource(resetDuplicateHistory: true)
        let epoch = session.processingEpoch
        func accept(_ detections: [Barcode], wall: Int64, elapsed: Int64) throws -> [TrackedBarcode] {
            let output = try XCTUnwrap(session.process(
                detections, source: source, epoch: epoch, now: wall,
                mode: .batch, duplicateWindow: 1000, elapsedTime: elapsed
            ))
            XCTAssertEqual(output.detections, detections)
            XCTAssertTrue(session.isCurrent(source: output.source, epoch: output.epoch))
            let tracked = try XCTUnwrap(output.tracked)
            XCTAssertNotNil(session.commitScans(output, now: wall, duplicateWindow: 1000, elapsedTime: elapsed))
            return tracked
        }

        let a1 = barcode("BATCH-PROBE-A", x: 768, y: 454, timestamp: wallStart)
        let first = try accept([a1], wall: wallStart, elapsed: 0)
        XCTAssertEqual(first, [
            TrackedBarcode(id: "1", barcode: a1, firstSeen: wallStart, lastSeen: wallStart, count: 1),
        ])

        let secondWall = wallStart + 40
        let a2 = barcode("BATCH-PROBE-A", x: 768, y: 454, timestamp: secondWall)
        let b = barcode("BATCH-PROBE-B", x: 1056, y: 562, timestamp: secondWall)
        let second = try accept([a2, b], wall: secondWall, elapsed: 40)
        XCTAssertEqual(second, [
            TrackedBarcode(id: "1", barcode: a2, firstSeen: wallStart, lastSeen: secondWall, count: 2),
            TrackedBarcode(id: "2", barcode: b, firstSeen: secondWall, lastSeen: secondWall, count: 1),
        ])

        let thirdWall = wallStart + 220 + correction
        let movedA = barcode("BATCH-PROBE-A", x: 922, y: 454, timestamp: thirdWall)
        let third = try accept([movedA], wall: thirdWall, elapsed: 220)
        XCTAssertEqual(third, [
            TrackedBarcode(id: "1", barcode: movedA, firstSeen: wallStart, lastSeen: thirdWall, count: 3),
            TrackedBarcode(id: "2", barcode: b, firstSeen: secondWall, lastSeen: secondWall, count: 1),
        ])
        XCTAssertEqual(third.last, second.last, "Unobserved B remains unchanged at an elapsed age of 180 ms")
        print("SWIFT_BATCH_OVERLAY_MODEL case=\(name) source=\(source) epoch=\(epoch) elapsed=0,40,220 correction=\(correction) Acount=1,2,3 Bcount=1 retainedAgeMs=180")
    }

    func testOrdinaryBatchOverlayModelsComeFromAcceptedSessionFrames() throws {
        try verifyScene(name: "ordinary", correction: 0)
    }

    func testBackwardEpochBatchOverlayModelsComeFromAcceptedSessionFrames() throws {
        try verifyScene(name: "backward-epoch", correction: -60_000)
    }
}
