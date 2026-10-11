// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class EngineTests: XCTestCase {
    private func barcode(_ data: String, x: Double, y: Double, size: Double = 100, symbology: Symbology = .qr) -> Barcode {
        Barcode(
            data: data,
            symbology: symbology,
            location: .init(
                topLeft: .init(x: x, y: y),
                topRight: .init(x: x + size, y: y),
                bottomRight: .init(x: x + size, y: y + size),
                bottomLeft: .init(x: x, y: y + size)
            ),
            frameSize: .init(width: 1920, height: 1080),
            timestamp: 0
        )
    }

    func testDuplicateFilterWindow() {
        var filter = DuplicateFilter()
        XCTAssertTrue(filter.shouldReport("qr|a", now: 0, window: 1000))
        XCTAssertFalse(filter.shouldReport("qr|a", now: 500, window: 1000))
        XCTAssertTrue(filter.shouldReport("qr|b", now: 500, window: 1000))
        XCTAssertTrue(filter.shouldReport("qr|a", now: 1000, window: 1000))
    }

    func testDuplicateFilterSpecialValues() {
        var everyFrame = DuplicateFilter()
        XCTAssertTrue(everyFrame.shouldReport("qr|a", now: 0, window: 0))
        XCTAssertTrue(everyFrame.shouldReport("qr|a", now: 1, window: 0))

        var oncePerSession = DuplicateFilter()
        XCTAssertTrue(oncePerSession.shouldReport("qr|a", now: 0, window: -1))
        XCTAssertFalse(oncePerSession.shouldReport("qr|a", now: 1_000_000, window: -1))
        oncePerSession.reset()
        XCTAssertTrue(oncePerSession.shouldReport("qr|a", now: 1_000_001, window: -1))
    }

    func testTrackerKeepsStableIDsAndDropsStaleTracks() {
        var tracker = BarcodeTracker()
        let first = tracker.update(with: [barcode("A", x: 0, y: 0), barcode("B", x: 500, y: 0)], now: 0)
        XCTAssertEqual(first.map(\.id), ["1", "2"])

        let moved = tracker.update(with: [barcode("B", x: 510, y: 5), barcode("A", x: 10, y: 5)], now: 100)
        XCTAssertEqual(moved.map(\.id), ["1", "2"])
        XCTAssertEqual(moved.first { $0.data == "A" }?.count, 2)
        XCTAssertEqual(moved.first { $0.data == "A" }?.firstSeen, 0)
        XCTAssertEqual(moved.first { $0.data == "A" }?.lastSeen, 100)

        // B disappears; after 500 ms without a sighting it is dropped.
        _ = tracker.update(with: [barcode("A", x: 10, y: 5)], now: 400)
        let later = tracker.update(with: [barcode("A", x: 12, y: 5)], now: 700)
        XCTAssertEqual(later.map(\.data), ["A"])
        XCTAssertEqual(later.first?.id, "1")
    }

    func testTrackerSeparatesIdenticalLabelsAndUsesOverlapFallback() {
        var tracker = BarcodeTracker()
        _ = tracker.update(with: [barcode("SAME", x: 0, y: 0), barcode("SAME", x: 800, y: 0)], now: 0)
        let next = tracker.update(with: [barcode("SAME", x: 805, y: 0), barcode("SAME", x: 5, y: 0)], now: 50)
        XCTAssertEqual(next.count, 2)
        XCTAssertEqual(next.first { $0.id == "1" }?.location.topLeft.x, 5)
        XCTAssertEqual(next.first { $0.id == "2" }?.location.topLeft.x, 805)

        // A misread of the same physical code (different data, same place) keeps its track.
        let misread = tracker.update(with: [barcode("SAMF", x: 6, y: 0), barcode("SAME", x: 806, y: 0)], now: 100)
        XCTAssertEqual(misread.count, 2)
        XCTAssertEqual(misread.first { $0.id == "1" }?.data, "SAMF")
    }

    func testOverlapFallbackPreservesTwoEligibleTracksRegardlessOfDetectionOrder() {
        let x = barcode("X", x: 52, y: 0)
        let y = barcode("Y", x: 150, y: 0)
        for detections in [[x, y], [y, x]] {
            var tracker = BarcodeTracker()
            let first = tracker.update(with: [barcode("A", x: 0, y: 0), barcode("B", x: 100, y: 0)], now: 0)

            // X overlaps B slightly more than A, but Y can only continue B.
            // Assigning X to A leaves an eligible existing track for both detections.
            let next = tracker.update(with: detections, now: 30)
            XCTAssertEqual(next.count, 2)
            XCTAssertEqual(next.map(\.id), first.map(\.id))
            XCTAssertEqual(next.first { $0.data == "X" }?.id, first[0].id)
            XCTAssertEqual(next.first { $0.data == "Y" }?.id, first[1].id)
            for track in next {
                XCTAssertEqual(track.count, 2)
                XCTAssertEqual(track.firstSeen, 0)
                XCTAssertEqual(track.lastSeen, 30)
            }
        }
    }

    func testOverlapFallbackNeverStealsAnExactPayloadMatch() {
        let a = barcode("A", x: 52, y: 0)
        let x = barcode("X", x: 0, y: 0)
        for detections in [[a, x], [x, a]] {
            var tracker = BarcodeTracker()
            let first = tracker.update(with: [barcode("A", x: 0, y: 0), barcode("B", x: 100, y: 0)], now: 0)

            // X has stronger overlap with A's old box, but the exact A match owns that track.
            let next = tracker.update(with: detections, now: 30)
            XCTAssertEqual(next.count, 3)
            XCTAssertEqual(next.first { $0.data == "A" }?.id, first[0].id)
            XCTAssertEqual(next.first { $0.data == "A" }?.count, 2)
            XCTAssertEqual(next.first { $0.data == "B" }?.id, first[1].id)
            XCTAssertEqual(next.first { $0.data == "B" }?.count, 1)
            XCTAssertEqual(next.first { $0.data == "X" }?.id, "3")
            XCTAssertEqual(next.first { $0.data == "X" }?.count, 1)
        }
    }

    func testOverlapFallbackReassignsAThreeTrackChain() {
        let x = barcode("X", x: 52, y: 0)
        let y = barcode("Y", x: 152, y: 0)
        let z = barcode("Z", x: 250, y: 0)
        for detections in [[x, y, z], [x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x]] {
            var tracker = BarcodeTracker()
            let first = tracker.update(with: [barcode("A", x: 0, y: 0), barcode("B", x: 100, y: 0), barcode("C", x: 200, y: 0)], now: 0)

            // Greedy X->B and Y->C leave Z unmatched. Reassigning both reaches A.
            let next = tracker.update(with: detections, now: 30)
            XCTAssertEqual(next.map(\.id), first.map(\.id))
            XCTAssertEqual(next.map(\.data), ["X", "Y", "Z"])
            XCTAssertTrue(next.allSatisfy { $0.count == 2 && $0.firstSeen == 0 && $0.lastSeen == 30 })
        }
    }

    func testOverlapFallbackMatchesAnIndependentExhaustiveOracle() {
        var seed: UInt64 = 0x515247454e
        func random(_ limit: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 32) % UInt64(limit))
        }
        for sample in 0..<150 {
            let oldCount = 1 + random(5)
            let detectionCount = 1 + random(5)
            let previous = (0..<oldCount).map { index in
                barcode("old-\(sample)-\(index)", x: Double(random(9) * 25), y: Double(random(4) * 25), size: Double(50 + random(5) * 25))
            }
            let detections = (0..<detectionCount).map { index in
                barcode("new-\(sample)-\(index)", x: Double(random(9) * 25), y: Double(random(4) * 25), size: Double(50 + random(5) * 25))
            }

            // Compute eligibility directly for these axis-aligned test squares,
            // independently of the production overlap and assignment helpers.
            let eligible = detections.map { detection in
                previous.map { track in
                    let a = detection.location
                    let b = track.location
                    let width = max(0, min(a.bottomRight.x, b.bottomRight.x) - max(a.topLeft.x, b.topLeft.x))
                    let height = max(0, min(a.bottomRight.y, b.bottomRight.y) - max(a.topLeft.y, b.topLeft.y))
                    let intersection = width * height
                    let areaA = (a.bottomRight.x - a.topLeft.x) * (a.bottomRight.y - a.topLeft.y)
                    let areaB = (b.bottomRight.x - b.topLeft.x) * (b.bottomRight.y - b.topLeft.y)
                    return intersection / (areaA + areaB - intersection) >= 0.3
                }
            }
            func maximumMatches(_ detection: Int, usedTracks: Int) -> Int {
                if detection == detectionCount { return 0 }
                var best = maximumMatches(detection + 1, usedTracks: usedTracks)
                for track in 0..<oldCount where (usedTracks & (1 << track)) == 0 && eligible[detection][track] {
                    best = max(best, 1 + maximumMatches(detection + 1, usedTracks: usedTracks | (1 << track)))
                }
                return best
            }
            let expectedMatches = maximumMatches(0, usedTracks: 0)
            for (order, current) in [detections, Array(detections.reversed())].enumerated() {
                var tracker = BarcodeTracker()
                let first = tracker.update(with: previous, now: 0)
                let oldIDs = Set(first.map(\.id))
                let next = tracker.update(with: current, now: 30)
                let context = "sample \(sample), order \(order)"
                let continued = next.filter { oldIDs.contains($0.id) && $0.lastSeen == 30 }
                XCTAssertEqual(continued.count, expectedMatches, context)
                XCTAssertEqual(next.count, oldCount + detectionCount - expectedMatches, context)
                XCTAssertEqual(Set(next.map(\.id)).count, next.count, context)
                XCTAssertEqual(next.filter { $0.data.hasPrefix("new-") }.count, detectionCount, context)
                XCTAssertTrue(continued.allSatisfy { $0.count == 2 && $0.firstSeen == 0 }, context)
                XCTAssertTrue(next.filter { !oldIDs.contains($0.id) }.allSatisfy { $0.count == 1 && $0.firstSeen == 30 && $0.lastSeen == 30 }, context)
            }
        }
    }

    func testOverlapNeverMergesDifferentSymbologies() {
        var tracker = BarcodeTracker()
        let data = "5901234123457"
        _ = tracker.update(with: [barcode(data, x: 100, y: 100, symbology: .qr)], now: 0)

        let next = tracker.update(with: [barcode(data, x: 100, y: 100, symbology: .ean13)], now: 30)
        XCTAssertEqual(next.map(\.id), ["1", "2"])
        let qr = next.first { $0.id == "1" }
        XCTAssertEqual(qr?.symbology, .qr)
        XCTAssertEqual(qr?.lastSeen, 0)
        XCTAssertEqual(qr?.count, 1)
        let ean = next.first { $0.id == "2" }
        XCTAssertEqual(ean?.symbology, .ean13)
        XCTAssertEqual(ean?.firstSeen, 30)
        XCTAssertEqual(ean?.count, 1)

        let repeated = tracker.update(with: [barcode(data, x: 100, y: 100, symbology: .ean13)], now: 35)
        XCTAssertEqual(repeated.count, 2)
        XCTAssertEqual(repeated.first { $0.id == "2" }?.count, 2)
        XCTAssertEqual(repeated.first { $0.id == "1" }?.lastSeen, 0)
    }

    func testTrackedBarcodeJSONIsFlattened() throws {
        let tracked = TrackedBarcode(id: "7", barcode: barcode("hello", x: 0, y: 0), firstSeen: 1, lastSeen: 2, count: 3)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(tracked.toJSON().utf8)) as? [String: Any])
        XCTAssertEqual(object["id"] as? String, "7")
        XCTAssertEqual(object["data"] as? String, "hello")
        XCTAssertEqual(object["symbology"] as? String, "qr")
        XCTAssertEqual(object["count"] as? Int, 3)
        XCTAssertNotNil(object["location"] as? [String: Any])
        let roundTrip = try JSONDecoder().decode(TrackedBarcode.self, from: Data(tracked.toJSON().utf8))
        XCTAssertEqual(roundTrip, tracked)
    }

    func testBarcodeJSONShape() throws {
        let code = Barcode(data: "https://example.com", symbology: .qr, rawBytes: "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
                           ecLevel: "M", timestamp: 1_735_689_600_000)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(code.toJSON().utf8)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), [
            "data", "symbology", "symbologyName", "rawBytes", "contentType", "isGS1", "location",
            "frameSize", "orientation", "ecLevel", "symbologyIdentifier", "timestamp",
        ])
        XCTAssertEqual(object["symbologyName"] as? String, "QR Code")
        XCTAssertEqual(object["symbologyIdentifier"] as? String, "]Q1")
        XCTAssertEqual(object["contentType"] as? String, "text")
        XCTAssertEqual(code.rawData.flatMap { String(data: $0, encoding: .utf8) }, "https://example.com")
        XCTAssertEqual(code.parsed, .url("https://example.com"))
        XCTAssertEqual(QRGen.version, "1.0.0")
    }
}
