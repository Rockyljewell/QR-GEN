// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class CalendarScopeTests: XCTestCase {
    private let alarm = "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Alarm reminder\nEND:VALARM"
    private let timezone = "BEGIN:VTIMEZONE\nTZID:Example/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0000\nEND:STANDARD\nEND:VTIMEZONE\n"

    private func event(_ properties: String) -> String {
        "BEGIN:VEVENT\nUID:scope@example.invalid\nDTSTAMP:20261011T120000Z\n" + properties + "\nEND:VEVENT"
    }

    private func calendar(_ components: String) -> String {
        "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QRGen//Regression//EN\n" + components + "\nEND:VCALENDAR"
    }

    private func parse(_ text: String, file: StaticString = #filePath, line: UInt = #line) -> ParsedContent.Event {
        guard case let .event(value) = QRGen.parseContent(text) else {
            XCTFail("expected an event", file: file, line: line)
            return ParsedContent.Event()
        }
        return value
    }

    func testEventStartExcludesPrecedingTimezone() {
        let parsed = parse(calendar(timezone + event("DTSTART;TZID=Example/Fixed:20261012T090000\nSUMMARY:Delivery")))
        XCTAssertEqual(parsed.start, "2026-10-12T09:00:00")
        XCTAssertEqual(parsed.summary, "Delivery")
    }

    func testMissingEventDescriptionExcludesNestedAlarm() {
        let parsed = parse(event("DTSTART:20261012T090000Z\nSUMMARY:Delivery\n" + alarm))
        XCTAssertEqual(parsed.start, "2026-10-12T09:00:00Z")
        XCTAssertEqual(parsed.summary, "Delivery")
        XCTAssertNil(parsed.description)
    }

    func testExplicitEventDescriptionSurvivesNestedAlarm() {
        XCTAssertEqual(parse(event("DESCRIPTION:Meet at receiving\n" + alarm)).description, "Meet at receiving")
    }

    func testLaterEventCannotSupplyMissingFields() {
        let first = event("DTSTART;VALUE=DATE:20261012\nSUMMARY:First")
        let second = event("DTSTART:20300101T000000Z\nSUMMARY:Second\nDTEND:20300102T000000Z\nLOCATION:Second location\nDESCRIPTION:Second description")
        let parsed = parse(calendar(first + "\n" + second))
        XCTAssertEqual(parsed.start, "2026-10-12")
        XCTAssertEqual(parsed.summary, "First")
        XCTAssertNil(parsed.end)
        XCTAssertNil(parsed.location)
        XCTAssertNil(parsed.description)
    }

    func testPrecedingTodoIsNotTheEvent() {
        let todo = "BEGIN:VTODO\nUID:todo@example.invalid\nDTSTAMP:20261011T120000Z\nDTSTART:20000101T000000Z\nSUMMARY:Task\nEND:VTODO\n"
        let parsed = parse(calendar(todo + event("DTSTART:20261012T090000Z\nSUMMARY:Delivery")))
        XCTAssertEqual(parsed.start, "2026-10-12T09:00:00Z")
        XCTAssertEqual(parsed.summary, "Delivery")
    }

    func testCalendarWithoutEventCannotBorrowTimezoneStart() {
        XCTAssertNil(parse(calendar(timezone)).start)
    }
}
