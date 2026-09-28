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
