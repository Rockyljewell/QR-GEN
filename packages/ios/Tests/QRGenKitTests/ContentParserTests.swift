// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class ContentParserTests: XCTestCase {
    func testURL() {
        XCTAssertEqual(QRGen.parseContent("https://example.com/path?q=1"), .url("https://example.com/path?q=1"))
        XCTAssertEqual(QRGen.parseContent("  HTTP://EXAMPLE.COM  "), .url("HTTP://EXAMPLE.COM"))
        XCTAssertEqual(QRGen.parseContent("ftp://files.example.com"), .url("ftp://files.example.com"))
    }

    func testDigitalLink() {
        guard case let .gs1DigitalLink(url, gs1) = QRGen.parseContent("https://id.gs1.org/01/09501101530003/10/ABC123") else {
            return XCTFail("expected a GS1 Digital Link")
        }
        XCTAssertEqual(url, "https://id.gs1.org/01/09501101530003/10/ABC123")
        XCTAssertEqual(gs1.values["10"], "ABC123")
    }

    func testWiFiWithEscapes() {
        let parsed = QRGen.parseContent(#"WIFI:T:WPA;S:My\;Net\:work;P:pa\:ss\\wo\,rd;H:true;;"#)
        XCTAssertEqual(parsed, .wifi(.init(ssid: "My;Net:work", password: #"pa:ss\wo,rd"#, security: "WPA", hidden: true)))

        let open = QRGen.parseContent("WIFI:S:Cafe;;")
        XCTAssertEqual(open, .wifi(.init(ssid: "Cafe", password: nil, security: "nopass", hidden: false)))

        let reordered = QRGen.parseContent("wifi:P:secret;S:\"Home\";T:wep;;")
        XCTAssertEqual(reordered, .wifi(.init(ssid: "Home", password: "secret", security: "WEP", hidden: false)))
    }

    func testVCard() {
        let vcard = """
        BEGIN:VCARD\r
        VERSION:3.0\r
        N:Doe;John;Q.;Dr.;Jr.\r
        FN:John Doe\r
        ORG:Acme\\, Inc.;Research\r
        TITLE:Chief\r
          Scientist\r
        TEL;TYPE=CELL:+1 555 0100\r
        item1.TEL:+1 555 0101\r
        EMAIL;TYPE=INTERNET:john@example.com\r
        URL:https://example.com\r
        ADR;TYPE=WORK:;;1 Main St;Springfield;IL;62701;USA\r
        NOTE:Line 1\\nLine 2\r
        END:VCARD
        """
        guard case let .contact(contact) = QRGen.parseContent(vcard) else { return XCTFail("expected a contact") }
        XCTAssertEqual(contact.format, .vcard)
        XCTAssertEqual(contact.name, "John Doe")
        XCTAssertEqual(contact.organization, "Acme, Inc., Research")
        XCTAssertEqual(contact.title, "Chief Scientist")
        XCTAssertEqual(contact.phones, ["+1 555 0100", "+1 555 0101"])
        XCTAssertEqual(contact.emails, ["john@example.com"])
        XCTAssertEqual(contact.urls, ["https://example.com"])
        XCTAssertEqual(contact.address, "1 Main St, Springfield, IL, 62701, USA")
        XCTAssertEqual(contact.note, "Line 1\nLine 2")
    }

    func testMECARD() {
        guard case let .contact(contact) = QRGen.parseContent("MECARD:N:Doe,John;TEL:+15550100;EMAIL:john@example.com;URL:https\\://example.com;;") else {
            return XCTFail("expected a contact")
        }
        XCTAssertEqual(contact.format, .mecard)
        XCTAssertEqual(contact.name, "John Doe")
        XCTAssertEqual(contact.phones, ["+15550100"])
        XCTAssertEqual(contact.emails, ["john@example.com"])
        XCTAssertEqual(contact.urls, ["https://example.com"])
    }

    func testEmail() {
        XCTAssertEqual(QRGen.parseContent("mailto:jane@example.com?subject=Hello%20there&body=Hi%21"),
                       .email(.init(to: "jane@example.com", subject: "Hello there", body: "Hi!")))
        XCTAssertEqual(QRGen.parseContent("MATMSG:TO:jane@example.com;SUB:Hi;BODY:See you\\; soon;;"),
                       .email(.init(to: "jane@example.com", subject: "Hi", body: "See you; soon")))
        XCTAssertEqual(QRGen.parseContent("jane+tag@example.com"), .email(.init(to: "jane+tag@example.com")))
    }

    func testPhoneAndSMS() {
        XCTAssertEqual(QRGen.parseContent("tel:+1-555-0100"), .phone(number: "+1-555-0100"))
        XCTAssertEqual(QRGen.parseContent("SMSTO:+15550100:Hello there"), .sms(.init(number: "+15550100", body: "Hello there")))
        XCTAssertEqual(QRGen.parseContent("sms:+15550100?body=Hi%20you"), .sms(.init(number: "+15550100", body: "Hi you")))
    }

    func testGeo() {
        XCTAssertEqual(QRGen.parseContent("geo:37.786971,-122.399677?q=Coffee+Shop"),
                       .geo(.init(latitude: 37.786971, longitude: -122.399677, altitude: nil, query: "Coffee Shop")))
        XCTAssertEqual(QRGen.parseContent("geo:48.2010,16.3695,183;crs=wgs84"),
                       .geo(.init(latitude: 48.201, longitude: 16.3695, altitude: 183)))
        XCTAssertEqual(QRGen.parseContent("geo:999,0"), .text("geo:999,0"))
    }

    func testEvent() {
        let text = "BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20250101T100000Z\nDTEND;VALUE=DATE:20250102\nLOCATION:HQ\nDESCRIPTION:Bring\\, snacks\nEND:VEVENT"
        XCTAssertEqual(QRGen.parseContent(text), .event(.init(
            summary: "Launch", start: "2025-01-01T10:00:00Z", end: "2025-01-02", location: "HQ", description: "Bring, snacks"
        )))
    }

    func testPayments() {
        let epc = "BCD\n002\n1\nSCT\nBPOTBEB1\nRed Cross\nBE72000000001616\nEUR12.50\n\n\nDonation"
        XCTAssertEqual(QRGen.parseContent(epc), .payment(.init(
            scheme: .epc, name: "Red Cross", iban: "BE72000000001616", bic: "BPOTBEB1",
            amount: "12.50", currency: "EUR", reference: "Donation"
        )))
        XCTAssertEqual(QRGen.parseContent("bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.01&label=Satoshi&message=Thanks"),
                       .payment(.init(scheme: .bitcoin, address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", name: "Satoshi",
                                      amount: "0.01", currency: "BTC", reference: "Thanks")))
        XCTAssertEqual(QRGen.parseContent("ethereum:0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359@1?value=2.014e18"),
                       .payment(.init(scheme: .ethereum, address: "0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359",
                                      amount: "2.014e18", currency: "ETH")))
        XCTAssertEqual(QRGen.parseContent("upi://pay?pa=shop@upi&pn=Corner%20Shop&am=99.00&cu=INR&tn=Order+42"),
                       .payment(.init(scheme: .upi, address: "shop@upi", name: "Corner Shop",
                                      amount: "99.00", currency: "INR", reference: "Order 42")))
    }

    func testProductsAndCheckDigits() {
        XCTAssertEqual(QRGen.parseContent("4006381333931"), .product(.init(gtin: "04006381333931", kind: .ean13, checksumValid: true)))
        XCTAssertEqual(QRGen.parseContent("4006381333932"), .product(.init(gtin: "04006381333932", kind: .ean13, checksumValid: false)))
        XCTAssertEqual(QRGen.parseContent("036000291452"), .product(.init(gtin: "00036000291452", kind: .upca, checksumValid: true)))
        XCTAssertEqual(QRGen.parseContent("96385074"), .product(.init(gtin: "00000096385074", kind: .ean8, checksumValid: true)))
        XCTAssertEqual(QRGen.parseContent("9780306406157"), .product(.init(gtin: "09780306406157", kind: .isbn, checksumValid: true)))
        XCTAssertEqual(QRGen.parseContent("10012345678902"), .product(.init(gtin: "10012345678902", kind: .gtin14, checksumValid: true)))
        // UPC-E 04252614 expands to UPC-A 042100005264.
        XCTAssertEqual(QRGen.parseContent("04252614", symbology: .upce), .product(.init(gtin: "00042100005264", kind: .upce, checksumValid: true)))
        // Digit-only data from a non-retail symbology stays text.
        XCTAssertEqual(QRGen.parseContent("4006381333931", symbology: .qr), .text("4006381333931"))
        XCTAssertEqual(QRGen.parseContent("12345"), .text("12345"))
    }

    func testGS1AndAAMVA() {
        guard case let .gs1(gs1) = QRGen.parseContent("(01)09501101530003(17)250101(10)ABC123") else {
            return XCTFail("expected GS1")
        }
        XCTAssertEqual(gs1.values["17"], "250101")
        guard case let .aamva(id) = QRGen.parseContent(AAMVATests.specVector) else { return XCTFail("expected AAMVA") }
        XCTAssertEqual(id.lastName, "SAMPLE")
    }

    func testTextFallback() {
        XCTAssertEqual(QRGen.parseContent("Hello, world"), .text("Hello, world"))
        XCTAssertEqual(QRGen.parseContent(""), .text(""))
    }

    func testJSONShape() throws {
        let wifi = QRGen.parseContent("WIFI:T:WPA;S:Home;P:secret;;")
        XCTAssertEqual(wifi.toJSON(), #"{"hidden":false,"password":"secret","security":"WPA","ssid":"Home","type":"wifi"}"#)
        XCTAssertEqual(ParsedContent.text("hi").toJSON(), #"{"text":"hi","type":"text"}"#)
        XCTAssertEqual(ParsedContent.phone(number: "+1").toJSON(), #"{"number":"+1","type":"phone"}"#)

        let decoded = try JSONDecoder().decode(ParsedContent.self, from: Data(wifi.toJSON().utf8))
        XCTAssertEqual(decoded, wifi)
        let product = QRGen.parseContent("4006381333931")
        XCTAssertEqual(try JSONDecoder().decode(ParsedContent.self, from: Data(product.toJSON().utf8)), product)
    }
}
