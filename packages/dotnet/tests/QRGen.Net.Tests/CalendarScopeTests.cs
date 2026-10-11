// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using Xunit;

namespace QRGen.Tests
{
    public class CalendarScopeTests
    {
        private const string Alarm = "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Alarm reminder\nEND:VALARM";
        private const string Timezone = "BEGIN:VTIMEZONE\nTZID:Example/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0000\nEND:STANDARD\nEND:VTIMEZONE\n";
        private static string Event(string properties) => "BEGIN:VEVENT\nUID:scope@example.invalid\nDTSTAMP:20261011T120000Z\n" + properties + "\nEND:VEVENT";
        private static string Calendar(string components) => "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QRGen//Regression//EN\n" + components + "\nEND:VCALENDAR";

        [Fact]
        public void EventStartExcludesPrecedingTimezone()
        {
            var parsed = ContentParser.Parse(Calendar(Timezone + Event("DTSTART;TZID=Example/Fixed:20261012T090000\nSUMMARY:Delivery")));
            Assert.Equal(("2026-10-12T09:00:00", "Delivery"), (parsed.Start, parsed.Summary));
        }

        [Fact]
        public void MissingEventDescriptionExcludesNestedAlarm()
        {
            var parsed = ContentParser.Parse(Event("DTSTART:20261012T090000Z\nSUMMARY:Delivery\n" + Alarm));
            Assert.Equal(("2026-10-12T09:00:00Z", "Delivery"), (parsed.Start, parsed.Summary));
            Assert.Null(parsed.Description);
        }

        [Fact]
        public void ExplicitEventDescriptionSurvivesNestedAlarm()
        {
            Assert.Equal("Meet at receiving", ContentParser.Parse(Event("DESCRIPTION:Meet at receiving\n" + Alarm)).Description);
        }

        [Fact]
        public void LaterEventCannotSupplyMissingFields()
        {
            var first = Event("DTSTART;VALUE=DATE:20261012\nSUMMARY:First");
            var second = Event("DTSTART:20300101T000000Z\nSUMMARY:Second\nDTEND:20300102T000000Z\nLOCATION:Second location\nDESCRIPTION:Second description");
            var parsed = ContentParser.Parse(Calendar(first + "\n" + second));
            Assert.Equal(("2026-10-12", "First"), (parsed.Start, parsed.Summary));
            Assert.Null(parsed.End);
            Assert.Null(parsed.Location);
            Assert.Null(parsed.Description);
        }

        [Fact]
        public void PrecedingTodoIsNotTheEvent()
        {
            var todo = "BEGIN:VTODO\nUID:todo@example.invalid\nDTSTAMP:20261011T120000Z\nDTSTART:20000101T000000Z\nSUMMARY:Task\nEND:VTODO\n";
            var parsed = ContentParser.Parse(Calendar(todo + Event("DTSTART:20261012T090000Z\nSUMMARY:Delivery")));
            Assert.Equal(("2026-10-12T09:00:00Z", "Delivery"), (parsed.Start, parsed.Summary));
        }

        [Fact]
        public void CalendarWithoutEventCannotBorrowTimezoneStart()
        {
            var parsed = ContentParser.Parse(Calendar(Timezone));
            Assert.Equal("event", parsed.Type);
            Assert.Null(parsed.Start);
        }
    }
}
