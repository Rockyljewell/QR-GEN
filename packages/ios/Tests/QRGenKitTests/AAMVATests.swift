// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import QRGenKit

final class AAMVATests: XCTestCase {
    /// SPEC section 3.3 test vector (fictional data).
    static let specVector = "@\n\u{1E}\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r"

    /// 2025-06-01T12:00:00Z
    let referenceDate = Date(timeIntervalSince1970: 1_748_779_200)

    func testSpecVector() throws {
        let result = try XCTUnwrap(QRGen.parseAAMVA(Self.specVector, referenceDate: referenceDate))
        XCTAssertEqual(result.firstName, "JANE")
        XCTAssertEqual(result.middleName, "Q")
        XCTAssertEqual(result.lastName, "SAMPLE")
        XCTAssertEqual(result.fullName, "JANE Q SAMPLE")
        XCTAssertEqual(result.dateOfBirth, "1990-01-31")
        XCTAssertEqual(result.expiryDate, "2028-01-31")
        XCTAssertEqual(result.issueDate, "2020-02-01")
        XCTAssertEqual(result.sex, "F")
        XCTAssertEqual(result.postalCode, "95814")
        XCTAssertEqual(result.state, "CA")
        XCTAssertEqual(result.city, "SACRAMENTO")
        XCTAssertEqual(result.street, "123 MAIN ST")
        XCTAssertEqual(result.country, "USA")
        XCTAssertEqual(result.eyeColor, "BRO")
        XCTAssertEqual(result.height, "065 IN")
        XCTAssertEqual(result.documentNumber, "D1234567")
        XCTAssertEqual(result.documentType, "DL")
        XCTAssertEqual(result.issuerId, "636014")
        XCTAssertEqual(result.aamvaVersion, 10)
        XCTAssertEqual(result.jurisdictionVersion, 0)
        XCTAssertEqual(result.age, 35)
        XCTAssertFalse(result.isExpired)
        XCTAssertFalse(result.isUnder21)
        XCTAssertEqual(result.fields["DAQ"], "D1234567")
        XCTAssertEqual(result.fields["DCS"], "SAMPLE")
        XCTAssertNil(result.fields["ZCA"], "the ZC subfile is not part of the DL subfile")
    }

    func testExpiryAndUnder21() throws {
        // 2029-06-01: the card expired on 2028-01-31.
        let later = Date(timeIntervalSince1970: 1_875_009_600)
        let result = try XCTUnwrap(QRGen.parseAAMVA(Self.specVector, referenceDate: later))
        XCTAssertTrue(result.isExpired)
        XCTAssertEqual(result.age, 39)

        let young = Self.specVector.replacingOccurrences(of: "DBB01311990", with: "DBB01312010")
        let teen = try XCTUnwrap(QRGen.parseAAMVA(young, referenceDate: referenceDate))
        XCTAssertEqual(teen.age, 15)
        XCTAssertTrue(teen.isUnder21)
    }

    func testCanadianDatesAndLegacyName() throws {
        let data = "@\n\u{1E}\rANSI 636012030001DL00310120DLDAQA1234-56789-01234\nDAAMARTIN,LOUIS,PAUL\nDBB19850415\nDBA20300415\nDBC1\nDAJON\nDAKK1A 0B1\nDCGCAN\n\r"
        let result = try XCTUnwrap(QRGen.parseAAMVA(data, referenceDate: referenceDate))
        XCTAssertEqual(result.lastName, "MARTIN")
        XCTAssertEqual(result.firstName, "LOUIS")
        XCTAssertEqual(result.middleName, "PAUL")
        XCTAssertEqual(result.dateOfBirth, "1985-04-15")
        XCTAssertEqual(result.expiryDate, "2030-04-15")
        XCTAssertEqual(result.sex, "M")
        XCTAssertEqual(result.postalCode, "K1A 0B1")
        XCTAssertEqual(result.country, "CAN")
        XCTAssertEqual(result.aamvaVersion, 3)
    }

    func testBrokenOffsetsFallBack() throws {
        // Same data as the SPEC vector but with a wrong DL offset.
        let broken = Self.specVector.replacingOccurrences(of: "DL00410279", with: "DL00990279")
        let result = try XCTUnwrap(QRGen.parseAAMVA(broken, referenceDate: referenceDate))
        XCTAssertEqual(result.documentNumber, "D1234567")
        XCTAssertEqual(result.lastName, "SAMPLE")
    }

    func testNonAAMVAInput() {
        XCTAssertNil(QRGen.parseAAMVA("hello"))
        XCTAssertNil(QRGen.parseAAMVA(""))
        XCTAssertNil(QRGen.parseAAMVA("@\n\u{1E}\rANSI 6360141000"))
    }
}
