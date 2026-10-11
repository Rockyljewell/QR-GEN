// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseContent } from "../src/parsers/content.js";

describe("vCard text and structured field escaping", () => {
  it("keeps escaped semicolons inside organization and address fields", () => {
    const card = ["BEGIN:VCARD", "VERSION:3.0", "FN:Jane Doe", String.raw`N:Doe;Jane;;;`, String.raw`ORG:One\;Two;Team`, String.raw`ADR:;;12 Main\; Apt 3;Town;;;`, "END:VCARD"].join("\r\n");
    expect(parseContent(card)).toMatchObject({ name: "Jane Doe", organization: "One;Two Team", address: "12 Main; Apt 3, Town" });
  });

  it("preserves escaped delimiters in the supported structured-name fallback", () => {
    expect(parseContent(String.raw`BEGIN:VCARD
N:Doe\;Smith;Jane;;;Jr.
END:VCARD`)).toMatchObject({ name: "Jane Doe;Smith Jr." });
  });

  it("distinguishes a literal backslash from an escape for the following separator", () => {
    expect(parseContent(String.raw`BEGIN:VCARD
N:Doe\\;Jane;;;
END:VCARD`)).toMatchObject({ name: "Jane Doe\\" });
    expect(parseContent(String.raw`BEGIN:VCARD
N:Doe\\\;Smith;Jane;;;
END:VCARD`)).toMatchObject({ name: String.raw`Jane Doe\;Smith` });
  });

  it("decodes literal backslashes once without turning a following n into a newline", () => {
    expect(parseContent(String.raw`BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
NOTE:C:\\new\\notes\nSecond line\, with comma\; and semicolon
END:VCARD`)).toMatchObject({ note: String.raw`C:\new\notes` + "\nSecond line, with comma; and semicolon" });
  });

  it("unfolds values before decoding a split escape and keeps formatted-name precedence", () => {
    const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Other;Name;;;\r\nFN:Jane\\\r\n ; Doe\r\nNOTE:One\\Ntwo\r\nEND:VCARD";
    expect(parseContent(card)).toMatchObject({ name: "Jane; Doe", note: "One\ntwo" });
  });
});

const event = (properties: string, suffix = "") => `BEGIN:VEVENT\nUID:scope@example.invalid\nDTSTAMP:20261011T120000Z\n${properties}\nEND:VEVENT${suffix}`;
const alarm = "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nDESCRIPTION:Alarm reminder\nEND:VALARM";
const timezone = "BEGIN:VTIMEZONE\nTZID:Example/Fixed\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0000\nEND:STANDARD\nEND:VTIMEZONE\n";
const calendar = (components: string) => `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//QRGen//Regression//EN\n${components}\nEND:VCALENDAR`;

describe("calendar component ownership", () => {
  it("takes the appointment start from VEVENT rather than the preceding timezone", () => {
    expect(parseContent(calendar(timezone + event("DTSTART;TZID=Example/Fixed:20261012T090000\nSUMMARY:Delivery")))).toMatchObject({ start: "2026-10-12T09:00:00", summary: "Delivery" });
  });

  it("does not borrow an alarm description when the event has none", () => {
    const parsed = parseContent(event(`DTSTART:20261012T090000Z\nSUMMARY:Delivery\n${alarm}`));
    expect(parsed).toMatchObject({ summary: "Delivery", start: "2026-10-12T09:00:00Z" });
    expect(parsed).not.toHaveProperty("description", "Alarm reminder");
    expect("description" in parsed ? parsed.description : undefined).toBeUndefined();
  });

  it("retains explicit event descriptions when an alarm follows", () => {
    expect(parseContent(event(`DESCRIPTION:Meet at receiving\n${alarm}`))).toMatchObject({ description: "Meet at receiving" });
  });

  it("keeps missing fields missing instead of taking them from a later event", () => {
    const first = event("DTSTART;VALUE=DATE:20261012\nSUMMARY:First");
    const second = event("DTSTART:20300101T000000Z\nSUMMARY:Second\nDTEND:20300102T000000Z\nLOCATION:Second location\nDESCRIPTION:Second description");
    const parsed = parseContent(calendar(first + "\n" + second));
    if (parsed.type !== "event") throw new Error("expected the first event");
    expect(parsed).toMatchObject({ summary: "First", start: "2026-10-12" });
    for (const field of ["end", "location", "description"] as const) expect(parsed[field]).toBeUndefined();
  });

  it("ignores a preceding todo and a calendar with no event", () => {
    const todo = "BEGIN:VTODO\nUID:todo@example.invalid\nDTSTAMP:20261011T120000Z\nDTSTART:20000101T000000Z\nSUMMARY:Task\nEND:VTODO\n";
    expect(parseContent(calendar(todo + event("DTSTART:20261012T090000Z\nSUMMARY:Delivery")))).toMatchObject({ summary: "Delivery", start: "2026-10-12T09:00:00Z" });
    const parsed = parseContent(calendar(timezone));
    expect(parsed.type).toBe("event");
    expect("start" in parsed ? parsed.start : undefined).toBeUndefined();
  });

  it("decodes direct event text once and preserves ordinary date formatting", () => {
    expect(parseContent(event(String.raw`DTSTART;VALUE=DATE:20261012
DESCRIPTION:C:\\new\\notes\nNext line\, here`))).toMatchObject({ start: "2026-10-12", description: String.raw`C:\new\notes` + "\nNext line, here" });
  });
});
