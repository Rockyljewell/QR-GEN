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
