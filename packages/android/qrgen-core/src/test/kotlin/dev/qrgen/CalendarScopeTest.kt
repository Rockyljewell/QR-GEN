// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

/** Parity with Python/.NET/Swift: only direct properties of the first VEVENT are read (#63). */
class CalendarScopeTest {
    private val alarm = "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Alarm reminder\nEND:VALARM"
    private val timezone = "BEGIN:VTIMEZONE\nTZID:Example/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\n" +
        "TZOFFSETFROM:+0000\nTZOFFSETTO:+0000\nEND:STANDARD\nEND:VTIMEZONE\n"

    private fun event(properties: String) =
        "BEGIN:VEVENT\nUID:scope@example.invalid\nDTSTAMP:20261011T120000Z\n$properties\nEND:VEVENT"

    private fun calendar(components: String) =
        "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QRGen//Regression//EN\n$components\nEND:VCALENDAR"

    private fun parse(s: String) = ContentParser.parse(s)

    @Test
    fun nestedAlarmDoesNotOverrideEventFields() {
        assertEquals(
            ParsedContent.Event("Delivery", "2026-10-12T09:00:00Z", null, null, "Meet at receiving"),
            parse(event("DTSTART:20261012T090000Z\nSUMMARY:Delivery\nDESCRIPTION:Meet at receiving\n$alarm")),
        )
        assertEquals(
            ParsedContent.Event("Delivery", "2026-10-12T09:00:00Z", null, null, null),
            parse(event("DTSTART:20261012T090000Z\nSUMMARY:Delivery\n$alarm")),
        )
    }

    @Test
    fun timezoneAndTodoComponentsDoNotLeakIntoEvent() {
        assertEquals(
            ParsedContent.Event("Delivery", "2026-10-12T09:00:00", null, null, null),
            parse(calendar(timezone + event("DTSTART;TZID=Example/Fixed:20261012T090000\nSUMMARY:Delivery"))),
        )
        assertEquals(
            ParsedContent.Event("Delivery", "2026-10-12T09:00:00Z", null, null, null),
            parse(calendar("BEGIN:VTODO\nDTSTART:20000101T000000Z\nSUMMARY:Task\nEND:VTODO\n" + event("DTSTART:20261012T090000Z\nSUMMARY:Delivery"))),
        )
    }

    @Test
    fun calendarWithoutEventCannotBorrowTimezoneStart() {
        assertEquals(ParsedContent.Event(null, null, null, null, null), parse(calendar(timezone)))
    }

    @Test
    fun onlyFirstEventIsRead() {
        assertEquals(
            ParsedContent.Event("First", "2026-10-12", null, null, null),
            parse(calendar(event("DTSTART;VALUE=DATE:20261012\nSUMMARY:First") + "\n" + event("DTSTART:20300101T000000Z\nSUMMARY:Second\nLOCATION:Second location"))),
        )
    }
}
