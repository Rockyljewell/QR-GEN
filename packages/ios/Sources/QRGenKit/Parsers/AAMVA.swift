// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A North American driver license or ID card, parsed from its PDF417 (SPEC section 3.3).
///
/// Text fields are `""` when absent. Dates are ISO `YYYY-MM-DD` (or `""`).
public struct AAMVAResult: Codable, Hashable, Sendable {
    /// Issuer identification number (IIN), e.g. `"636014"` for California.
    public var issuerId: String
    /// AAMVA standard version (1-10+).
    public var aamvaVersion: Int
    /// Jurisdiction version (0 for version 1 cards).
    public var jurisdictionVersion: Int
    /// `"DL"` (driver license) or `"ID"` (identification card).
    public var documentType: String
    public var firstName: String
    public var middleName: String
    public var lastName: String
    public var suffix: String
    /// `first middle last suffix`, skipping empty parts.
    public var fullName: String
    public var dateOfBirth: String
    public var issueDate: String
    public var expiryDate: String
    /// `"M"`, `"F"`, `"X"` or `""`.
    public var sex: String
    /// Customer id / license number (DAQ).
    public var documentNumber: String
    /// Document discriminator (DCF).
    public var documentDiscriminator: String
    public var street: String
    public var city: String
    /// Jurisdiction code, e.g. `"CA"`.
    public var state: String
    /// Postal code (5-digit ZIP for US cards).
    public var postalCode: String
    /// `"USA"`, `"CAN"` or `""`.
    public var country: String
    public var eyeColor: String
    /// Height as printed, e.g. `"065 IN"` or `"175 CM"`.
    public var height: String
    /// Age in whole years at parse time, when the date of birth is known.
    public var age: Int?
    /// `true` when the expiry date is before the parse date.
    public var isExpired: Bool
    /// `true` when ``age`` is known and below 21.
    public var isUnder21: Bool
    /// Every element of the DL/ID subfile keyed by its 3-letter code, e.g. `["DAQ": "D1234567"]`.
    public var fields: [String: String]
}

extension QRGen {
    /// Parses the PDF417 on the back of North American driver licenses and ID cards (SPEC section 3.3).
    ///
    /// Handles the AAMVA header (`@` LF RS CR `ANSI ` IIN, versions, subfile designators), the DL/ID
    /// subfile, elements separated by LF or CR, US `MMDDCCYY` and Canadian `CCYYMMDD` dates, and the
    /// legacy version 1 name layout (`DAA` = `LAST,FIRST,MIDDLE`).
    ///
    /// - Parameters:
    ///   - data: the decoded PDF417 text.
    ///   - referenceDate: the date used for ``AAMVAResult/age`` and ``AAMVAResult/isExpired`` (default: now).
    /// - Returns: `nil` when the input is not an AAMVA barcode. Never throws.
    public static func parseAAMVA(_ data: String, referenceDate: Date = Date()) -> AAMVAResult? {
        AAMVAParser.parse(data, referenceDate: referenceDate)
    }
}

enum AAMVAParser {
    private struct Designator {
        let type: String
        let offset: Int
        let length: Int
    }

    private struct Header {
        var issuerId = ""
        var version = 0
        var jurisdictionVersion = 0
        var designators: [Designator] = []
        var endIndex = 0
    }

    /// Element codes used to recognise the first element of a subfile when no header is available.
    private static let knownCodes: Set<String> = [
        "DAA", "DAB", "DAC", "DAD", "DAE", "DAF", "DAG", "DAH", "DAI", "DAJ", "DAK", "DAL", "DAM", "DAN",
        "DAO", "DAP", "DAQ", "DAR", "DAS", "DAT", "DAU", "DAV", "DAW", "DAX", "DAY", "DAZ", "DBA", "DBB",
        "DBC", "DBD", "DBE", "DBF", "DBG", "DBH", "DBI", "DBJ", "DBK", "DBL", "DBM", "DBN", "DBO", "DBP",
        "DBQ", "DBR", "DBS", "DCA", "DCB", "DCD", "DCE", "DCF", "DCG", "DCH", "DCI", "DCJ", "DCK", "DCL",
        "DCM", "DCN", "DCO", "DCP", "DCQ", "DCR", "DCS", "DCT", "DCU", "DDA", "DDB", "DDC", "DDD", "DDE",
        "DDF", "DDG", "DDH", "DDI", "DDJ", "DDK", "DDL",
    ]

    private static let lineFeed: Unicode.Scalar = "\n"
    private static let carriageReturn: Unicode.Scalar = "\r"
    private static let recordSeparator: Unicode.Scalar = "\u{1E}"

    static func parse(_ input: String, referenceDate: Date) -> AAMVAResult? {
        let scalars = Array(input.unicodeScalars)
        guard !scalars.isEmpty else { return nil }

        let header = parseHeader(scalars)
        var fields: [String: String] = [:]
        var documentType = ""

        if let header, let subfile = header.designators.first(where: { $0.type == "DL" || $0.type == "ID" }) {
            documentType = subfile.type
            if let start = locateSubfile(subfile, in: scalars, headerEnd: header.endIndex) {
                fields = parseElements(scalars, from: start, stripSubfilePrefix: false)
            }
        }
        if fields.isEmpty {
            // No usable header: scan every line for element codes.
            fields = parseElements(scalars, from: header?.endIndex ?? 0, stripSubfilePrefix: true)
            if documentType.isEmpty {
                documentType = input.contains("IDDAQ") || input.contains("IDDCA") ? "ID" : "DL"
            }
        }
        let identifyingCodes = ["DAQ", "DCS", "DAC", "DBB", "DAA", "DCT"]
        guard identifyingCodes.contains(where: { fields[$0] != nil }) else { return nil }

        return buildResult(fields: fields, header: header, documentType: documentType, referenceDate: referenceDate)
    }

    // MARK: Header

    private static func parseHeader(_ scalars: [Unicode.Scalar]) -> Header? {
        let text = String(String.UnicodeScalarView(scalars))
        let markerRange = text.range(of: "ANSI ") ?? text.range(of: "AAMVA")
        guard let markerRange else { return nil }
        let markerOffset = text.unicodeScalars.distance(from: text.unicodeScalars.startIndex, to: markerRange.upperBound)

        var cursor = markerOffset
        func readDigits(_ count: Int) -> Int? {
            guard cursor + count <= scalars.count else { return nil }
            var value = 0
            for scalar in scalars[cursor..<(cursor + count)] {
                guard scalar.value >= 48, scalar.value <= 57 else { return nil }
                value = value * 10 + Int(scalar.value - 48)
            }
            cursor += count
            return value
        }
        func readString(_ count: Int) -> String? {
            guard cursor + count <= scalars.count else { return nil }
            let value = String(String.UnicodeScalarView(scalars[cursor..<(cursor + count)]))
            cursor += count
            return value
        }

        var header = Header()
        guard let issuer = readString(6), issuer.allSatisfy(\.isASCIIDigit) else { return nil }
        header.issuerId = issuer
        guard let version = readDigits(2) else { return header }
        header.version = version
        if version >= 2 {
            guard let jurisdiction = readDigits(2) else { return header }
            header.jurisdictionVersion = jurisdiction
        }
        guard let entries = readDigits(2) else { return header }
        header.endIndex = cursor
        for _ in 0..<entries {
            let save = cursor
            guard let type = readString(2), type.allSatisfy({ $0.isUppercase || $0.isASCIIDigit }),
                  let offset = readDigits(4), let length = readDigits(4) else {
                cursor = save
                break
            }
            header.designators.append(Designator(type: type, offset: offset, length: length))
            header.endIndex = cursor
        }
        return header
    }

    /// Index of the first element of a subfile (just after its 2-letter type), if it can be found.
    private static func locateSubfile(_ designator: Designator, in scalars: [Unicode.Scalar], headerEnd: Int) -> Int? {
        let type = Array(designator.type.unicodeScalars)
        func matches(at index: Int) -> Bool {
            guard index >= 0, index + 2 <= scalars.count else { return false }
            return scalars[index] == type[0] && scalars[index + 1] == type[1]
        }
        if matches(at: designator.offset) {
            return designator.offset + 2
        }
        // Offsets are frequently wrong in the field: search for the type followed by an element code.
        var index = headerEnd
        while index + 5 <= scalars.count {
            if matches(at: index) {
                let code = String(String.UnicodeScalarView(scalars[(index + 2)..<(index + 5)]))
                if knownCodes.contains(code) {
                    return index + 2
                }
            }
            index += 1
        }
        return nil
    }

    // MARK: Elements

    private static func parseElements(_ scalars: [Unicode.Scalar], from start: Int, stripSubfilePrefix: Bool) -> [String: String] {
        var fields: [String: String] = [:]
        var line = String.UnicodeScalarView()

        func flush() {
            var text = String(line).trimmingCharacters(in: .whitespaces)
            line = String.UnicodeScalarView()
            if text.hasPrefix("@") { text.removeFirst() }
            if stripSubfilePrefix, text.count >= 5 {
                // "DLDAQ..." / "IDDAQ..." / "ZCZCA...": drop the subfile type in front of the first element.
                let prefix = String(text.prefix(2))
                let code = String(text.dropFirst(2).prefix(3))
                if (prefix == "DL" || prefix == "ID") && knownCodes.contains(code) {
                    text.removeFirst(2)
                }
                if let ansi = text.range(of: "ANSI ") ?? text.range(of: "AAMVA") {
                    // Header line without designator parsing: keep only what follows a DL/ID marker.
                    let rest = text[ansi.upperBound...]
                    if let marker = rest.range(of: "DLDAQ") ?? rest.range(of: "IDDAQ") {
                        text = String(rest[rest.index(marker.lowerBound, offsetBy: 2)...])
                    } else {
                        text = ""
                    }
                }
            }
            guard text.count >= 3 else { return }
            let code = String(text.prefix(3))
            guard code.allSatisfy({ $0.isASCII && ($0.isUppercase || $0.isASCIIDigit) }),
                  code.first?.isUppercase == true else { return }
            let value = String(text.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            if fields[code] == nil {
                fields[code] = value
            }
        }

        var index = max(0, start)
        while index < scalars.count {
            let scalar = scalars[index]
            if scalar == lineFeed || scalar == carriageReturn || scalar == recordSeparator {
                flush()
                if scalar == carriageReturn && !stripSubfilePrefix {
                    // CR terminates the subfile.
                    return fields
                }
            } else {
                line.append(scalar)
            }
            index += 1
        }
        flush()
        return fields
    }

    // MARK: Result

    private static func buildResult(fields: [String: String], header: Header?, documentType: String, referenceDate: Date) -> AAMVAResult {
        func field(_ code: String) -> String {
            let value = fields[code]?.trimmingCharacters(in: .whitespaces) ?? ""
            return value
        }
        func nameField(_ code: String) -> String {
            let value = field(code)
            let upper = value.uppercased()
            return upper == "NONE" || upper == "UNAVL" || upper == "UNAVAILABLE" ? "" : value
        }

        var firstName = nameField("DAC")
        var middleName = nameField("DAD")
        var lastName = nameField("DCS")
        var suffix = nameField("DCU")
        if lastName.isEmpty { lastName = nameField("DAB") }
        if suffix.isEmpty { suffix = nameField("DAE") }

        if firstName.isEmpty, !field("DCT").isEmpty {
            // Version 2: DCT holds the given names, "FIRST,MIDDLE" or "FIRST MIDDLE".
            let given = splitNames(field("DCT"))
            firstName = given.first ?? ""
            if middleName.isEmpty { middleName = given.dropFirst().joined(separator: " ") }
        }
        if firstName.isEmpty || lastName.isEmpty, !field("DAA").isEmpty {
            // Version 1: DAA holds the full name "LAST,FIRST,MIDDLE".
            let full = field("DAA")
            if full.contains(",") || full.contains("$") {
                let parts = splitNames(full)
                if lastName.isEmpty { lastName = parts.first ?? "" }
                if firstName.isEmpty { firstName = parts.count > 1 ? parts[1] : "" }
                if middleName.isEmpty { middleName = parts.count > 2 ? parts[2...].joined(separator: " ") : "" }
            } else {
                let parts = full.split(separator: " ").map(String.init)
                if firstName.isEmpty { firstName = parts.first ?? "" }
                if lastName.isEmpty, parts.count > 1 { lastName = parts.last ?? "" }
                if middleName.isEmpty, parts.count > 2 { middleName = parts[1..<(parts.count - 1)].joined(separator: " ") }
            }
        }
        let fullName = [firstName, middleName, lastName, suffix].filter { !$0.isEmpty }.joined(separator: " ")

        var country = field("DCG").uppercased()
        let state = field("DAJ").uppercased()
        if country.isEmpty, let header, isCanadianIssuer(header.issuerId) {
            country = "CAN"
        }
        let preferCanadianDates = country == "CAN"

        let dob = parseDate(field("DBB"), canadian: preferCanadianDates, country: country)
        let expiry = parseDate(field("DBA"), canadian: preferCanadianDates, country: country)
        let issue = parseDate(field("DBD"), canadian: preferCanadianDates, country: country)

        let sex: String
        switch field("DBC").uppercased() {
        case "1", "M": sex = "M"
        case "2", "F": sex = "F"
        case "9", "X": sex = "X"
        default: sex = ""
        }

        var postal = field("DAK")
        if country != "CAN" {
            let digits = postal.filter(\.isASCIIDigit)
            if digits.count >= 5, postal.filter({ !$0.isASCIIDigit && $0 != "-" && $0 != " " }).isEmpty {
                postal = String(digits.prefix(5))
            }
        }

        let today = ymd(referenceDate)
        var age: Int?
        if let dob {
            var years = today.year - dob.year
            if (today.month, today.day) < (dob.month, dob.day) { years -= 1 }
            age = max(0, years)
        }
        var isExpired = false
        if let expiry {
            isExpired = (today.year, today.month, today.day) > (expiry.year, expiry.month, expiry.day)
        }

        return AAMVAResult(
            issuerId: header?.issuerId ?? "",
            aamvaVersion: header?.version ?? 0,
            jurisdictionVersion: header?.jurisdictionVersion ?? 0,
            documentType: documentType,
            firstName: firstName,
            middleName: middleName,
            lastName: lastName,
            suffix: suffix,
            fullName: fullName,
            dateOfBirth: dob.map(iso) ?? "",
            issueDate: issue.map(iso) ?? "",
            expiryDate: expiry.map(iso) ?? "",
            sex: sex,
            documentNumber: field("DAQ"),
            documentDiscriminator: field("DCF"),
            street: field("DAG"),
            city: field("DAI"),
            state: state,
            postalCode: postal,
            country: country,
            eyeColor: field("DAY"),
            height: field("DAU"),
            age: age,
            isExpired: isExpired,
            isUnder21: age.map { $0 < 21 } ?? false,
            fields: fields
        )
    }

    private static func splitNames(_ value: String) -> [String] {
        let separators = CharacterSet(charactersIn: ",$")
        let parts = value.components(separatedBy: separators)
        let pieces = parts.count > 1 ? parts : value.components(separatedBy: " ")
        return pieces.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// Canadian jurisdictions' issuer identification numbers.
    private static func isCanadianIssuer(_ iin: String) -> Bool {
        ["604426", "604428", "604429", "604430", "604432", "604433", "636012", "636013",
         "636016", "636017", "636028", "636044", "636048"].contains(iin)
    }

    // MARK: Dates

    struct YMD: Equatable {
        let year: Int
        let month: Int
        let day: Int
    }

    private static func iso(_ date: YMD) -> String {
        String(format: "%04d-%02d-%02d", date.year, date.month, date.day)
    }

    private static func ymd(_ date: Date) -> YMD {
        let calendar = Calendar(identifier: .gregorian)
        let components = calendar.dateComponents(in: TimeZone.current, from: date)
        return YMD(year: components.year ?? 1970, month: components.month ?? 1, day: components.day ?? 1)
    }

    /// Parses `MMDDCCYY` (USA) or `CCYYMMDD` (Canada), falling back to whichever layout is plausible.
    static func parseDate(_ raw: String, canadian: Bool, country: String) -> YMD? {
        let digits = raw.filter(\.isASCIIDigit)
        guard digits.count == 8 else { return nil }
        let chars = Array(digits)
        func number(_ range: ClosedRange<Int>) -> Int { Int(String(chars[range])) ?? 0 }
        let us = YMD(year: number(4...7), month: number(0...1), day: number(2...3))
        let canada = YMD(year: number(0...3), month: number(4...5), day: number(6...7))
        let ordered: [YMD]
        if canadian {
            ordered = [canada, us]
        } else if country == "USA" {
            ordered = [us, canada]
        } else {
            // Unknown country: prefer the layout whose year looks like a year.
            ordered = (1900...2199).contains(canada.year) && (1...12).contains(canada.month) ? [canada, us] : [us, canada]
        }
        return ordered.first(where: isValid)
    }

    private static func isValid(_ date: YMD) -> Bool {
        guard (1900...2199).contains(date.year), (1...12).contains(date.month), date.day >= 1 else { return false }
        return date.day <= GS1Parser.daysInMonth(year: date.year, month: date.month)
    }
}
