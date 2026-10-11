# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

import pytest
from qrgen_sdk import parse_content


ALARM = "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Alarm reminder\nEND:VALARM"
TIMEZONE = "BEGIN:VTIMEZONE\nTZID:Example/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0000\nEND:STANDARD\nEND:VTIMEZONE\n"


def event(properties):
    return "BEGIN:VEVENT\nUID:scope@example.invalid\nDTSTAMP:20261011T120000Z\n" + properties + "\nEND:VEVENT"


def calendar(components):
    return "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QRGen//Regression//EN\n" + components + "\nEND:VCALENDAR"


@pytest.mark.parametrize("text, expected", [
    (calendar(TIMEZONE + event("DTSTART;TZID=Example/Fixed:20261012T090000\nSUMMARY:Delivery")), {"type": "event", "start": "2026-10-12T09:00:00", "summary": "Delivery"}),
    (event("DTSTART:20261012T090000Z\nSUMMARY:Delivery\n" + ALARM), {"type": "event", "start": "2026-10-12T09:00:00Z", "summary": "Delivery"}),
    (event("DESCRIPTION:Meet at receiving\n" + ALARM), {"type": "event", "description": "Meet at receiving"}),
    (calendar(event("DTSTART;VALUE=DATE:20261012\nSUMMARY:First") + "\n" + event("DTSTART:20300101T000000Z\nSUMMARY:Second\nDTEND:20300102T000000Z\nLOCATION:Second location\nDESCRIPTION:Second description")), {"type": "event", "start": "2026-10-12", "summary": "First"}),
    (calendar("BEGIN:VTODO\nUID:todo@example.invalid\nDTSTAMP:20261011T120000Z\nDTSTART:20000101T000000Z\nSUMMARY:Task\nEND:VTODO\n" + event("DTSTART:20261012T090000Z\nSUMMARY:Delivery")), {"type": "event", "start": "2026-10-12T09:00:00Z", "summary": "Delivery"}),
    (calendar(TIMEZONE), {"type": "event"}),
])
def test_event_fields_belong_to_first_direct_vevent(text, expected):
    assert parse_content(text) == expected
