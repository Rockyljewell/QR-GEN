// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class GS1Tests: XCTestCase {
    /// SPEC section 3.2 test vector.
    func testSpecVector() throws {
        let result = try XCTUnwrap(QRGen.parseGS1("(01)09501101530003(17)250101(10)ABC123"))
        XCTAssertEqual(result.values, ["01": "09501101530003", "17": "250101", "10": "ABC123"])
        XCTAssertEqual(result.elements.map(\.ai), ["01", "17", "10"])
        XCTAssertEqual(result.element("01")?.title, "GTIN")
        XCTAssertEqual(result.element("17")?.title, "USE BY or EXPIRY")
        XCTAssertEqual(result.element("10")?.title, "BATCH/LOT")
        XCTAssertEqual(result.element("17")?.date, "2025-01-01")
        XCTAssertEqual(result.hri, "(01)09501101530003(17)250101(10)ABC123")
        XCTAssertEqual(result.gtin, "09501101530003")
        XCTAssertEqual(result.expiryDate, "2025-01-01")
    }

    func testRawElementStringWithGroupSeparatorsAndSymbologyIdentifier() throws {
        let raw = "]C1010950110153000317250101" + "10ABC123\u{1D}21XYZ"
        let result = try XCTUnwrap(QRGen.parseGS1(raw))
        XCTAssertEqual(result.values, ["01": "09501101530003", "17": "250101", "10": "ABC123", "21": "XYZ"])
        XCTAssertEqual(result.elementString, "010950110153000317250101" + "10ABC123\u{1D}21XYZ")

        let datamatrix = try XCTUnwrap(QRGen.parseGS1("]d2\u{1D}0109501101530003\u{1D}10LOT7"))
        XCTAssertEqual(datamatrix.values["10"], "LOT7")
    }

    func testDigitalLink() throws {
        let result = try XCTUnwrap(QRGen.parseGS1("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101"))
        XCTAssertEqual(result.values, ["01": "09501101530003", "10": "ABC123", "17": "250101"])
        XCTAssertEqual(result.element("17")?.date, "2025-01-01")

        let short = try XCTUnwrap(QRGen.parseGS1("https://example.com/shop/01/9501101530003/21/S%2F1?linkType=all"))
        XCTAssertEqual(short.values["01"], "09501101530003", "GTIN-13 is zero padded")
        XCTAssertEqual(short.element("01")?.raw, "9501101530003")
        XCTAssertEqual(short.values["21"], "S/1")

        XCTAssertNil(QRGen.parseGS1("https://example.com/products/42"))
    }

    func testFixedFieldsOutsidePredefinedTableNeedSeparator() throws {
        for (ai, value) in [("7003", "2610111230"), ("7006", "261011"), ("8005", "001234"),
                            ("3942", "1250"), ("3952", "001234")] {
            let result = try XCTUnwrap(QRGen.parseGS1("(01)09501101530003(\(ai))\(value)(17)261012"))
            let expected = "0109501101530003" + ai + value + "\u{1D}17261012"
            XCTAssertEqual(result.elementString, expected, ai)
            XCTAssertEqual(try XCTUnwrap(QRGen.parseGS1(expected)).values, result.values, ai)
            XCTAssertEqual(try XCTUnwrap(QRGen.parseGS1("(\(ai))\(value)")).elementString, ai + value, ai)
        }
    }

    func testPredefinedFieldsNeedNoSeparator() throws {
        for (ai, value) in [("00", "123456789012345675"), ("01", "09501101530003"), ("11", "261011"),
                            ("20", "01"), ("3103", "000195"), ("410", "9501101530003")] {
            let result = try XCTUnwrap(QRGen.parseGS1("(\(ai))\(value)(17)261012"))
            XCTAssertEqual(result.elementString, ai + value + "17261012", ai)
        }
    }

    func testFullLengthVariableFieldStillNeedsSeparator() throws {
        let value = String(repeating: "A", count: 20)
        let result = try XCTUnwrap(QRGen.parseGS1("(10)\(value)(21)XYZ"))
        XCTAssertEqual(result.elementString, "10" + value + "\u{1D}21XYZ")
    }

    func testDecimalAndDateAIs() throws {
        let result = try XCTUnwrap(QRGen.parseGS1("(3103)000750(15)260200(3922)1999(11)991231"))
        XCTAssertEqual(result.element("3103")?.number ?? 0, 0.75, accuracy: 1e-9)
        XCTAssertEqual(result.element("3103")?.title, "NET WEIGHT (kg)")
        XCTAssertEqual(result.element("15")?.date, "2026-02-28", "day 00 is the last day of the month")
        XCTAssertEqual(result.element("3922")?.number ?? 0, 19.99, accuracy: 1e-9)
        XCTAssertEqual(result.element("11")?.date, "1999-12-31")

        let currency = try XCTUnwrap(QRGen.parseGS1("(3932)97812345"))
        XCTAssertEqual(currency.element("3932")?.number ?? 0, 123.45, accuracy: 1e-9)
    }

    func testKnownVariableFieldShapesBeforeAnnotations() throws {
        let overlongLot = String(repeating: "A", count: 21)
        let overlongAmount = "1234567890123456"
        for input in ["(10)" + overlongLot, "]C110" + overlongLot,
                      "https://id.gs1.org/01/09501101530003/10/" + overlongLot,
                      "(3922)" + overlongAmount, "]C13922" + overlongAmount,
                      "https://id.gs1.org/01/09501101530003?3922=" + overlongAmount] {
            XCTAssertNil(QRGen.parseGS1(input), input)
        }
        XCTAssertNotNil(QRGen.parseGS1("(10)" + String(repeating: "A", count: 20)))
        XCTAssertNotNil(QRGen.parseGS1("(3922)123456789012345"))
        for ai in ["3912", "3932"] {
            for input in ["(\(ai))978", "]C1\(ai)978", "https://id.gs1.org/01/09501101530003?\(ai)=978"] {
                XCTAssertNil(QRGen.parseGS1(input), input)
            }
            for input in ["(\(ai))9781", "]C1\(ai)9781", "https://id.gs1.org/01/09501101530003?\(ai)=9781"] {
                let result = try XCTUnwrap(QRGen.parseGS1(input))
                XCTAssertEqual(try XCTUnwrap(result.element(ai)?.number), 0.01, accuracy: 1e-9)
            }
        }
        XCTAssertNotNil(QRGen.parseGS1("(253)9501101530003"), "identifier suffix stays optional")
        XCTAssertNotNil(QRGen.parseGS1("(01)09501101530004"), "checksum enforcement is not added")
        let calendar = try XCTUnwrap(QRGen.parseGS1("(17)251301"))
        XCTAssertNil(calendar.expiryDate, "malformed calendars remain unannotated")
        XCTAssertEqual(QRGen.parseGS1("(01)09501101530003(7299)X")?.element("7299")?.title, "UNKNOWN")
    }

    func testDigitalLinkRequiresCompleteKnownFields() throws {
        let base = "https://id.gs1.org/01/09501101530003"
        for suffix in ["/17", "/17/", "/tail/value", "?17=", "?17", "?10=", "?3103=", "?3932="] {
            XCTAssertNil(QRGen.parseGS1(base + suffix), suffix)
        }
        XCTAssertNotNil(QRGen.parseGS1(base + "?linkType=&9999="), "non-AI parameters stay ignored")
        XCTAssertNotNil(QRGen.parseGS1("https://example.com/shop/01/09501101530003/10/LOT"))
        for gtin in ["96385074", "012345000065", "9501101530003"] {
            let result = try XCTUnwrap(QRGen.parseGS1("https://id.gs1.org/01/" + gtin))
            XCTAssertEqual(result.gtin?.count, 14)
            XCTAssertEqual(result.element("01")?.raw, gtin)
        }
    }

    func testDigitalLinkPreservesEncodedPathValues() throws {
        for (encoded, decoded) in [("SN%2F42", "SN/42"), ("SN%252F42", "SN%2F42"), ("caf%C3%A9", "café")] {
            let result = try XCTUnwrap(QRGen.parseGS1("https://id.gs1.org/01/09501101530003/21/" + encoded))
            XCTAssertEqual(result.element("21")?.value, decoded)
            XCTAssertEqual(result.element("21")?.raw, encoded)
        }
        let literalPlus = try XCTUnwrap(QRGen.parseGS1("https://id.gs1.org/01/09501101530003/21/A+B"))
        XCTAssertEqual(literalPlus.element("21")?.value, "A+B")
        XCTAssertNil(literalPlus.element("21")?.raw)
    }

    func testInvalidInput() {
        XCTAssertNil(QRGen.parseGS1(""))
        XCTAssertNil(QRGen.parseGS1("hello world"))
        XCTAssertNil(QRGen.parseGS1("(01)123"), "GTIN must be 14 digits")
        XCTAssertNil(QRGen.parseGS1("(01)0950110153000A"), "GTIN must be numeric")
        XCTAssertNil(QRGen.parseGS1("0112"), "truncated fixed-length field")
    }

    func testDateWindow() {
        XCTAssertEqual(GS1Parser.isoDate(yymmdd: "250101", currentYear: 2026), "2025-01-01")
        XCTAssertEqual(GS1Parser.isoDate(yymmdd: "990101", currentYear: 2026), "1999-01-01")
        XCTAssertEqual(GS1Parser.isoDate(yymmdd: "760101", currentYear: 2026), "2076-01-01")
        XCTAssertEqual(GS1Parser.isoDate(yymmdd: "240200", currentYear: 2026), "2024-02-29")
        XCTAssertNil(GS1Parser.isoDate(yymmdd: "251301", currentYear: 2026))
        XCTAssertNil(GS1Parser.isoDate(yymmdd: "250231", currentYear: 2026))
    }

    func testJSONShape() throws {
        let result = try XCTUnwrap(QRGen.parseGS1("(01)09501101530003(17)250101"))
        let json = try JSONSerialization.jsonObject(with: Data(JSONOutput.encode(result, prettyPrinted: false).utf8)) as? [String: Any]
        let elements = try XCTUnwrap(json?["elements"] as? [[String: Any]])
        XCTAssertEqual(elements.first?["ai"] as? String, "01")
        XCTAssertEqual(elements.last?["date"] as? String, "2025-01-01")
        XCTAssertEqual((json?["values"] as? [String: String])?["17"], "250101")
    }
}
