import { describe, expect, it } from "vitest";
import { computeCheckDigit, formatGS1, gs1Date, isValidCheckDigit, parseAAMVA, parseContent, parseGS1 } from "../src/parsers";

const GS = "\u001d";
const AAMVA =
  "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";

describe("parseGS1", () => {
  it("parses the SPEC test vector (HRI form)", () => {
    const r = parseGS1("(01)09501101530003(17)250101(10)ABC123")!;
    expect(r.values).toEqual({ "01": "09501101530003", "17": "250101", "10": "ABC123" });
    expect(r.elements.map((e) => e.title)).toEqual(["GTIN", "USE BY or EXPIRY", "BATCH/LOT"]);
    expect(r.elements[1]!.date).toBe("2025-01-01");
    expect(r.elements[0]!.checkDigitValid).toBe(true);
    expect(formatGS1(r)).toBe("(01)09501101530003(17)250101(10)ABC123");
  });

  it("parses raw element strings with GS separators and symbology prefixes", () => {
    const r = parseGS1(`]C101095011015300031725010110ABC123${GS}21SN-42`)!;
    expect(r.values).toEqual({ "01": "09501101530003", "17": "250101", "10": "ABC123", "21": "SN-42" });
    const plain = parseGS1("01095011015300031725010110ABC123")!;
    expect(plain.values["10"]).toBe("ABC123");
  });

  it("exposes decimal values and currencies", () => {
    const r = parseGS1("(01)09501101530003(3103)001250(3922)1999(3913)978550")!;
    expect(r.elements.find((e) => e.ai === "3103")!.number).toBe(1.25);
    expect(r.elements.find((e) => e.ai === "3922")!.number).toBe(19.99);
    const cur = r.elements.find((e) => e.ai === "3913")!;
    expect(cur.iso).toBe("978");
    expect(cur.number).toBe(0.55);
  });

  it("parses GS1 Digital Link URLs", () => {
    const r = parseGS1("https://id.gs1.org/01/09501101530003/10/ABC%20123/21/7?17=250101")!;
    expect(r.values).toEqual({ "01": "09501101530003", "10": "ABC 123", "21": "7", "17": "250101" });
    expect(r.digitalLink).toContain("id.gs1.org");
    expect(parseGS1("https://example.com/products/42")).toBeNull();
  });

  it("treats unknown AIs in HRI input as element boundaries", () => {
    const r = parseGS1("(01)09501101530003(9999)x(10)LOT")!;
    expect(r.values["01"]).toBe("09501101530003");
    expect(r.values["9999"]).toBe("x");
    expect(r.values["10"]).toBe("LOT");
    expect(r.elements[1]!.title).toBe("AI 9999");
  });

  it("rejects non-GS1 input", () => {
    expect(parseGS1("hello world")).toBeNull();
    expect(parseGS1("12345")).toBeNull();
    expect(parseGS1("(99")).toBeNull();
  });

  it("handles dates and check digits", () => {
    expect(gs1Date("250200")).toBe("2025-02-28");
    expect(gs1Date("240200")).toBe("2024-02-29");
    expect(gs1Date("251301")).toBeUndefined();
    expect(isValidCheckDigit("5901234123457")).toBe(true);
    expect(isValidCheckDigit("5901234123458")).toBe(false);
    expect(computeCheckDigit("590123412345")).toBe(7);
  });
});

describe("parseAAMVA", () => {
  const now = new Date(Date.UTC(2026, 5, 1));
  it("parses the SPEC test vector", () => {
    const r = parseAAMVA(AAMVA, { now })!;
    expect(r).toMatchObject({
      issuerId: "636014",
      aamvaVersion: 10,
      documentType: "DL",
      firstName: "JANE",
      middleName: "Q",
      lastName: "SAMPLE",
      fullName: "JANE Q SAMPLE",
      dateOfBirth: "1990-01-31",
      issueDate: "2020-02-01",
      expiryDate: "2028-01-31",
      sex: "F",
      documentNumber: "D1234567",
      street: "123 MAIN ST",
      city: "SACRAMENTO",
      state: "CA",
      postalCode: "95814",
      country: "USA",
      eyeColor: "BRO",
      height: "065 IN",
      age: 36,
      isExpired: false,
      isUnder21: false,
    });
    expect(r.fields.ZCA).toBe("A");
  });

  it("uses CCYYMMDD dates for Canadian cards", () => {
    const ca = "@\n\u001e\rANSI 636012080002DL00410200ZO02410030DLDAQ123456789\nDCSDOE\nDACJOHN\nDBB19851224\nDBA20300101\nDBC1\nDCGCAN\nDAKM5V 2T6\n";
    const r = parseAAMVA(ca, { now })!;
    expect(r.dateOfBirth).toBe("1985-12-24");
    expect(r.expiryDate).toBe("2030-01-01");
    expect(r.sex).toBe("M");
    expect(r.country).toBe("CAN");
    expect(r.postalCode).toBe("M5V2T6");
  });

  it("returns null for other data", () => {
    expect(parseAAMVA("hello")).toBeNull();
    expect(parseAAMVA("@ANSI but nothing else")).toBeNull();
  });
});

describe("parseContent", () => {
  it("detects URLs and GS1 Digital Links", () => {
    expect(parseContent("https://example.com/a?b=1")).toEqual({ type: "url", url: "https://example.com/a?b=1" });
    expect(parseContent("www.example.com")).toEqual({ type: "url", url: "https://www.example.com" });
    expect(parseContent("https://id.gs1.org/01/09501101530003").type).toBe("gs1-digital-link");
  });

  it("parses Wi-Fi with escapes", () => {
    expect(parseContent(String.raw`WIFI:T:WPA;S:My\;Net;P:pa\:ss;H:true;;`)).toEqual({ type: "wifi", ssid: "My;Net", password: "pa:ss", security: "WPA", hidden: true });
    expect(parseContent("WIFI:S:Open;;")).toMatchObject({ ssid: "Open", security: "nopass" });
  });

  it("parses email, phone, sms and geo", () => {
    expect(parseContent("mailto:a@b.co?subject=Hi%20there&body=Yo")).toEqual({ type: "email", to: "a@b.co", subject: "Hi there", body: "Yo" });
    expect(parseContent("MATMSG:TO:a@b.co;SUB:S;BODY:B;;")).toEqual({ type: "email", to: "a@b.co", subject: "S", body: "B" });
    expect(parseContent("tel:+15551234567")).toEqual({ type: "phone", number: "+15551234567" });
    expect(parseContent("SMSTO:+15551234567:Hello there")).toEqual({ type: "sms", number: "+15551234567", body: "Hello there" });
    expect(parseContent("geo:37.7749,-122.4194?q=SF")).toMatchObject({ type: "geo", latitude: 37.7749, longitude: -122.4194, query: "SF" });
  });

  it("parses vCard and MECARD contacts", () => {
    const v = parseContent("BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane;;;\nFN:Jane Doe\nORG:QRGen\nTEL;TYPE=CELL:+1 555 0100\nEMAIL:jane@example.com\nURL:https://example.com\nEND:VCARD");
    expect(v).toMatchObject({ type: "contact", format: "vcard", name: "Jane Doe", organization: "QRGen", phones: ["+1 555 0100"], emails: ["jane@example.com"], urls: ["https://example.com"] });
    const m = parseContent("MECARD:N:Doe,Jane;TEL:5550100;EMAIL:jane@example.com;;");
    expect(m).toMatchObject({ type: "contact", format: "mecard", name: "Jane Doe", phones: ["5550100"] });
  });

  it("parses events and payments", () => {
    expect(parseContent("BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261001T170000Z\nLOCATION:Online\nEND:VEVENT")).toMatchObject({ type: "event", summary: "Launch", start: "2026-10-01T17:00:00Z", location: "Online" });
    const epc = parseContent("BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross\nBE72000000001616\nEUR12.30\n\n\nDonation");
    expect(epc).toMatchObject({ type: "payment", scheme: "epc", name: "Red Cross", iban: "BE72000000001616", amount: 12.3, currency: "EUR" });
    expect(parseContent("bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01&label=Tip")).toMatchObject({ type: "payment", scheme: "bitcoin", amount: 0.01, name: "Tip" });
    expect(parseContent("upi://pay?pa=shop@upi&pn=Shop&am=10")).toMatchObject({ type: "payment", scheme: "upi", address: "shop@upi", amount: 10 });
  });

  it("recognizes product codes, GS1 and AAMVA", () => {
    expect(parseContent("5901234123457")).toEqual({ type: "product", kind: "ean13", gtin: "05901234123457", checksumValid: true });
    expect(parseContent("9780306406157").type).toBe("product");
    expect(parseContent("01234565", { symbology: "upce" })).toMatchObject({ kind: "upce", gtin: "00012345000065", checksumValid: true });
    expect(parseContent("(01)09501101530003(10)A1").type).toBe("gs1");
    const a = parseContent(AAMVA, { now: new Date(Date.UTC(2026, 0, 1)) });
    expect(a.type).toBe("aamva");
  });

  it("keeps + literal in mailto and sms, converts ethereum wei", () => {
    expect(parseContent("mailto:jane+news@example.com?subject=a+b")).toMatchObject({ to: "jane+news@example.com", subject: "a+b" });
    expect(parseContent("sms:+15550100?body=1+1")).toMatchObject({ number: "+15550100", body: "1+1" });
    expect(parseContent("ethereum:0xAbC123?value=2.5e18")).toMatchObject({ scheme: "ethereum", amount: 2.5, currency: "ETH" });
  });

  it("falls back to text", () => {
    expect(parseContent("just words")).toEqual({ type: "text", text: "just words" });
    expect(parseContent("")).toEqual({ type: "text", text: "" });
  });
});
