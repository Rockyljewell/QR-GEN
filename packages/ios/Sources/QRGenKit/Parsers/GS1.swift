// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// One GS1 element (application identifier + value).
public struct GS1Element: Codable, Hashable, Sendable {
    /// Application identifier, e.g. `"01"` or `"3103"`.
    public var ai: String
    /// GS1 data title, e.g. `"GTIN"` or `"NET WEIGHT (kg)"`; `"UNKNOWN"` for unlisted AIs.
    public var title: String
    /// The value as encoded (for AI 01 from a Digital Link, zero padded to 14 digits).
    public var value: String
    /// The value exactly as it appeared in the input, when it differs from ``value``
    /// (percent-encoded or unpadded Digital Link segments).
    public var raw: String?
    /// ISO `YYYY-MM-DD` for date AIs (11, 12, 13, 15, 16, 17, 7006). Day `00` = last day of month.
    public var date: String?
    /// Decimal value for measure and amount AIs (310n-369n, 390n-395n); `n` is the number of decimals.
    public var number: Double?

    public init(ai: String, title: String, value: String, raw: String? = nil, date: String? = nil, number: Double? = nil) {
        self.ai = ai
        self.title = title
        self.value = value
        self.raw = raw
        self.date = date
        self.number = number
    }
}

/// Result of ``QRGen/parseGS1(_:)``.
public struct GS1Result: Codable, Hashable, Sendable {
    /// Elements in input order.
    public var elements: [GS1Element]
    /// Values keyed by AI (the first occurrence wins).
    public var values: [String: String]

    public init(elements: [GS1Element]) {
        self.elements = elements
        var values: [String: String] = [:]
        for element in elements where values[element.ai] == nil {
            values[element.ai] = element.value
        }
        self.values = values
    }

    /// Value of an AI, e.g. `result["01"]`.
    public subscript(ai: String) -> String? { values[ai] }

    /// First element with the given AI.
    public func element(_ ai: String) -> GS1Element? { elements.first { $0.ai == ai } }

    /// Human readable form, e.g. `(01)09501101530003(17)250101(10)ABC123`.
    public var hri: String { elements.map { "(\($0.ai))\($0.value)" }.joined() }

    /// Raw element string with ASCII 29 (GS) separators after variable-length fields.
    public var elementString: String {
        var output = ""
        for (index, element) in elements.enumerated() {
            output += element.ai + element.value
            let isLast = index == elements.count - 1
            if !isLast, GS1Parser.definition(for: element.ai)?.fixedLength == nil {
                output += "\u{1D}"
            }
        }
        return output
    }

    /// GTIN (AI 01), if present.
    public var gtin: String? { values["01"] }
    /// Batch or lot number (AI 10), if present.
    public var batch: String? { values["10"] }
    /// Serial number (AI 21), if present.
    public var serial: String? { values["21"] }
    /// Expiry date (AI 17) as ISO `YYYY-MM-DD`, if present and valid.
    public var expiryDate: String? { element("17")?.date }
}

extension QRGen {
    /// Parses GS1 element strings (SPEC section 3.2).
    ///
    /// Accepts the human readable form `(01)09501101530003(17)250101(10)ABC123`, raw element
    /// strings with ASCII 29 (GS) separators and an optional `]C1` / `]d2` / `]Q3` / `]e0`
    /// symbology identifier, and GS1 Digital Link URIs such as
    /// `https://id.gs1.org/01/09501101530003/10/ABC123?17=250101`.
    ///
    /// Never throws; returns `nil` when the input is not a valid GS1 element string.
    public static func parseGS1(_ data: String) -> GS1Result? {
        GS1Parser.parse(data)
    }
}

/// Definition of a GS1 application identifier.
struct GS1ApplicationIdentifier: Sendable {
    enum Format: Sendable { case numeric, alphanumeric }
    enum Kind: Sendable { case plain, date, decimal, decimalWithCurrency }

    let ai: String
    let title: String
    /// Data length when the AI has a fixed length, else `nil`.
    let fixedLength: Int?
    let maxLength: Int
    let format: Format
    let kind: Kind

    /// Decimal places encoded in the last digit of decimal AIs.
    var decimalPlaces: Int? {
        guard kind == .decimal || kind == .decimalWithCurrency, let last = ai.last else { return nil }
        return Int(String(last))
    }
}

enum GS1Parser {
    static let groupSeparator: Unicode.Scalar = "\u{1D}"

    // MARK: AI table

    static let table: [String: GS1ApplicationIdentifier] = {
        var t: [String: GS1ApplicationIdentifier] = [:]
        func fixed(_ ai: String, _ title: String, _ length: Int,
                   _ format: GS1ApplicationIdentifier.Format = .numeric,
                   _ kind: GS1ApplicationIdentifier.Kind = .plain) {
            t[ai] = GS1ApplicationIdentifier(ai: ai, title: title, fixedLength: length, maxLength: length, format: format, kind: kind)
        }
        func variable(_ ai: String, _ title: String, _ maxLength: Int,
                      _ format: GS1ApplicationIdentifier.Format = .alphanumeric,
                      _ kind: GS1ApplicationIdentifier.Kind = .plain) {
            t[ai] = GS1ApplicationIdentifier(ai: ai, title: title, fixedLength: nil, maxLength: maxLength, format: format, kind: kind)
        }

        // Identification keys and product attributes.
        fixed("00", "SSCC", 18)
        fixed("01", "GTIN", 14)
        fixed("02", "CONTENT", 14)
        fixed("03", "MTO GTIN", 14)
        variable("10", "BATCH/LOT", 20)
        fixed("11", "PROD DATE", 6, .numeric, .date)
        fixed("12", "DUE DATE", 6, .numeric, .date)
        fixed("13", "PACK DATE", 6, .numeric, .date)
        fixed("15", "BEST BEFORE or BEST BY", 6, .numeric, .date)
        fixed("16", "SELL BY", 6, .numeric, .date)
        fixed("17", "USE BY or EXPIRY", 6, .numeric, .date)
        fixed("20", "VARIANT", 2)
        variable("21", "SERIAL", 20)
        variable("22", "CPV", 20)
        variable("235", "TPX", 28)
        variable("240", "ADDITIONAL ID", 30)
        variable("241", "CUST. PART No.", 30)
        variable("242", "MTO VARIANT", 6, .numeric)
        variable("243", "PCN", 20)
        variable("250", "SECONDARY SERIAL", 30)
        variable("251", "REF. TO SOURCE", 30)
        variable("253", "GDTI", 30)
        variable("254", "GLN EXTENSION COMPONENT", 20)
        variable("255", "GCN", 25, .numeric)
        variable("30", "VAR. COUNT", 8, .numeric)
        variable("37", "COUNT", 8, .numeric)

        // Measures: 6-digit values, last AI digit = decimal places.
        let measures: [(String, String)] = [
            ("310", "NET WEIGHT (kg)"), ("311", "LENGTH (m)"), ("312", "WIDTH (m)"),
            ("313", "HEIGHT (m)"), ("314", "AREA (m2)"), ("315", "NET VOLUME (l)"),
            ("316", "NET VOLUME (m3)"),
            ("320", "NET WEIGHT (lb)"), ("321", "LENGTH (in)"), ("322", "LENGTH (ft)"),
            ("323", "LENGTH (yd)"), ("324", "WIDTH (in)"), ("325", "WIDTH (ft)"),
            ("326", "WIDTH (yd)"), ("327", "HEIGHT (in)"), ("328", "HEIGHT (ft)"),
            ("329", "HEIGHT (yd)"),
            ("330", "GROSS WEIGHT (kg)"), ("331", "LENGTH (m), log"), ("332", "WIDTH (m), log"),
            ("333", "HEIGHT (m), log"), ("334", "AREA (m2), log"), ("335", "VOLUME (l), log"),
            ("336", "VOLUME (m3), log"), ("337", "KG PER m2"),
            ("340", "GROSS WEIGHT (lb)"), ("341", "LENGTH (in), log"), ("342", "LENGTH (ft), log"),
            ("343", "LENGTH (yd), log"), ("344", "WIDTH (in), log"), ("345", "WIDTH (ft), log"),
            ("346", "WIDTH (yd), log"), ("347", "HEIGHT (in), log"), ("348", "HEIGHT (ft), log"),
            ("349", "HEIGHT (yd), log"),
            ("350", "AREA (in2)"), ("351", "AREA (ft2)"), ("352", "AREA (yd2)"),
            ("353", "AREA (in2), log"), ("354", "AREA (ft2), log"), ("355", "AREA (yd2), log"),
            ("356", "NET WEIGHT (troy oz)"), ("357", "NET VOLUME (oz)"),
            ("360", "NET VOLUME (qt)"), ("361", "NET VOLUME (gal.)"), ("362", "VOLUME (qt), log"),
            ("363", "VOLUME (gal.), log"), ("364", "VOLUME (in3)"), ("365", "VOLUME (ft3)"),
            ("366", "VOLUME (yd3)"), ("367", "VOLUME (in3), log"), ("368", "VOLUME (ft3), log"),
            ("369", "VOLUME (yd3), log"),
        ]
        for (prefix, title) in measures {
            for places in 0...9 {
                fixed(prefix + String(places), title, 6, .numeric, .decimal)
            }
        }
        for places in 0...9 {
            let n = String(places)
            variable("390" + n, "AMOUNT", 15, .numeric, .decimal)
            variable("391" + n, "AMOUNT", 18, .numeric, .decimalWithCurrency)
            variable("392" + n, "PRICE", 15, .numeric, .decimal)
            variable("393" + n, "PRICE", 18, .numeric, .decimalWithCurrency)
            fixed("394" + n, "PRCNT OFF", 4, .numeric, .decimal)
            fixed("395" + n, "PRICE/UoM", 6, .numeric, .decimal)
        }

        // Logistics, parties and locations.
        variable("400", "ORDER NUMBER", 30)
        variable("401", "GINC", 30)
        fixed("402", "GSIN", 17)
        variable("403", "ROUTE", 30)
        fixed("410", "SHIP TO LOC", 13)
        fixed("411", "BILL TO", 13)
        fixed("412", "PURCHASE FROM", 13)
        fixed("413", "SHIP FOR LOC", 13)
        fixed("414", "LOC No.", 13)
        fixed("415", "PAY TO", 13)
        fixed("416", "PROD/SERV LOC", 13)
        fixed("417", "PARTY", 13)
        variable("420", "SHIP TO POST", 20)
        variable("421", "SHIP TO POST", 12)
        fixed("422", "ORIGIN", 3)
        variable("423", "COUNTRY - INITIAL PROCESS.", 15, .numeric)
        fixed("424", "COUNTRY - PROCESS.", 3)
        variable("425", "COUNTRY - DISASSEMBLY", 15, .numeric)
        fixed("426", "COUNTRY - FULL PROCESS", 3)
        variable("427", "ORIGIN SUBDIVISION", 3)

        // 7xxx
        fixed("7001", "NSN", 13)
        variable("7002", "MEAT CUT", 30)
        fixed("7003", "EXPIRY TIME", 10)
        variable("7004", "ACTIVE POTENCY", 4, .numeric)
        variable("7005", "CATCH AREA", 12)
        fixed("7006", "FIRST FREEZE DATE", 6, .numeric, .date)
        variable("7007", "HARVEST DATE", 12, .numeric)
        variable("7008", "AQUATIC SPECIES", 3)
        variable("7009", "FISHING GEAR TYPE", 10)
        variable("7010", "PROD METHOD", 2)
        variable("7020", "REFURB LOT", 20)
        variable("7021", "FUNC STAT", 20)
        variable("7022", "REV STAT", 20)
        variable("7023", "GIAI - ASSEMBLY", 30)
        for digit in 0...9 {
            variable("703" + String(digit), "PROCESSOR # \(digit)", 30)
        }

        // 8xxx
        fixed("8001", "DIMENSIONS", 14)
        variable("8002", "CMT No.", 20)
        variable("8003", "GRAI", 30)
        variable("8004", "GIAI", 30)
        fixed("8005", "PRICE PER UNIT", 6)
        fixed("8006", "ITIP", 18)
        variable("8007", "IBAN", 34)
        variable("8008", "PROD TIME", 12, .numeric)
        variable("8009", "OPTSEN", 50)
        variable("8010", "CPID", 30)
        variable("8011", "CPID SERIAL", 12, .numeric)
        variable("8012", "VERSION", 20)
        variable("8013", "GMN", 25)
        fixed("8017", "GSRN - PROVIDER", 18)
        fixed("8018", "GSRN - RECIPIENT", 18)
        variable("8019", "SRIN", 10, .numeric)
        variable("8020", "REF No.", 25)
        fixed("8026", "ITIP CONTENT", 18)
        variable("8110", "COUPON", 70)
        variable("8111", "POINTS", 4, .numeric)
        variable("8112", "COUPON", 70)
        variable("8200", "PRODUCT URL", 70)

        // Company internal.
        variable("90", "INTERNAL", 30)
        for digit in 1...9 {
            variable("9" + String(digit), "INTERNAL", 90)
        }
        return t
    }()

    /// Definition of an AI, when it is in the table.
    static func definition(for ai: String) -> GS1ApplicationIdentifier? { table[ai] }

    /// AI length implied by the first two digits (GS1 General Specifications, figure 3.2-1 ranges).
    static func aiLength(forPrefix prefix: String) -> Int? {
        guard prefix.count == 2, let value = Int(prefix) else { return nil }
        switch value {
        case 0...3, 10...22, 30, 37, 90...99: return 2
        case 23...25, 40...42: return 3
        case 31...36, 39, 43, 70...72, 80...82: return 4
        default: return nil
        }
    }

    static func unknownDefinition(_ ai: String) -> GS1ApplicationIdentifier {
        GS1ApplicationIdentifier(ai: ai, title: "UNKNOWN", fixedLength: nil, maxLength: 90, format: .alphanumeric, kind: .plain)
    }

    // MARK: Entry point

    static func parse(_ input: String, referenceDate: Date = Date()) -> GS1Result? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let year = currentYear(referenceDate)
        let lower = trimmed.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            return parseDigitalLink(trimmed, currentYear: year)
        }
        var body = trimmed
        if body.hasPrefix("]"), body.count >= 3 {
            body = String(body.dropFirst(3))
        }
        if body.hasPrefix("(") {
            return parseHRI(body, currentYear: year)
        }
        return parseRaw(body, currentYear: year)
    }

    // MARK: Human readable form

    static func parseHRI(_ input: String, currentYear: Int) -> GS1Result? {
        let scalars = Array(input.unicodeScalars)
        var index = 0
        var pairs: [(ai: String, value: String)] = []

        func aiStart(at position: Int) -> (ai: String, end: Int)? {
            guard position < scalars.count, scalars[position] == "(" else { return nil }
            var cursor = position + 1
            var digits = ""
            while cursor < scalars.count, isDigit(scalars[cursor]), digits.count < 4 {
                digits.unicodeScalars.append(scalars[cursor])
                cursor += 1
            }
            guard (2...4).contains(digits.count), cursor < scalars.count, scalars[cursor] == ")" else { return nil }
            return (digits, cursor + 1)
        }

        while index < scalars.count {
            guard let start = aiStart(at: index) else { return nil }
            var cursor = start.end
            var value = ""
            while cursor < scalars.count, aiStart(at: cursor) == nil {
                if scalars[cursor] != groupSeparator {
                    value.unicodeScalars.append(scalars[cursor])
                }
                cursor += 1
            }
            pairs.append((start.ai, value))
            index = cursor
        }
        return makeResult(pairs.map { ($0.ai, $0.value, nil) }, currentYear: currentYear)
    }

    // MARK: Raw element string

    static func parseRaw(_ input: String, currentYear: Int) -> GS1Result? {
        let scalars = Array(input.unicodeScalars)
        var index = 0
        var pairs: [(String, String, String?)] = []
        while index < scalars.count {
            if scalars[index] == groupSeparator {
                index += 1
                continue
            }
            guard let (definition, aiLength) = lookupAI(scalars, at: index) else { return nil }
            index += aiLength
            var value = ""
            if let length = definition.fixedLength {
                guard index + length <= scalars.count else { return nil }
                for scalar in scalars[index..<(index + length)] {
                    value.unicodeScalars.append(scalar)
                }
                index += length
            } else {
                while index < scalars.count, scalars[index] != groupSeparator {
                    value.unicodeScalars.append(scalars[index])
                    index += 1
                }
            }
            pairs.append((definition.ai, value, nil))
        }
        return makeResult(pairs, currentYear: currentYear)
    }

    static func lookupAI(_ scalars: [Unicode.Scalar], at index: Int) -> (GS1ApplicationIdentifier, Int)? {
        var digits = ""
        var cursor = index
        while cursor < scalars.count, digits.count < 4, isDigit(scalars[cursor]) {
            digits.unicodeScalars.append(scalars[cursor])
            cursor += 1
        }
        guard digits.count >= 2 else { return nil }
        for length in 2...digits.count {
            let candidate = String(digits.prefix(length))
            if let definition = table[candidate] {
                return (definition, length)
            }
        }
        guard let length = aiLength(forPrefix: String(digits.prefix(2))), length <= digits.count else { return nil }
        return (unknownDefinition(String(digits.prefix(length))), length)
    }

    // MARK: GS1 Digital Link

    /// Primary keys that may start the path of a Digital Link URI.
    static let digitalLinkPrimaryKeys: Set<String> = [
        "00", "01", "253", "255", "401", "402", "414", "417", "8003", "8004", "8006", "8010", "8013", "8017", "8018",
    ]

    /// Legacy short names accepted in Digital Link paths.
    static let digitalLinkAliases: [String: String] = [
        "gtin": "01", "sscc": "00", "cpv": "22", "lot": "10", "ser": "21", "gln": "414", "party": "417",
        "gdti": "253", "gcn": "255", "ginc": "401", "gsin": "402", "grai": "8003", "giai": "8004",
        "itip": "8006", "cpid": "8010", "cpsn": "8011", "gmn": "8013", "gsrnp": "8017", "gsrn": "8018",
        "glnx": "254",
    ]

    static func digitalLinkAI(_ segment: String) -> String? {
        if let alias = digitalLinkAliases[segment.lowercased()] { return alias }
        guard (2...4).contains(segment.count), segment.allSatisfy(\.isASCIIDigit) else { return nil }
        return segment
    }

    static func parseDigitalLink(_ input: String, currentYear: Int) -> GS1Result? {
        guard let components = URLComponents(string: input), components.host != nil else { return nil }
        let segments = components.percentEncodedPath.split(separator: "/").map(String.init)
        guard let start = segments.indices.first(where: { index in
            guard index + 1 < segments.count, let ai = digitalLinkAI(segments[index]) else { return false }
            return digitalLinkPrimaryKeys.contains(ai)
        }) else { return nil }

        var pairs: [(String, String, String?)] = []
        var index = start
        while index + 1 < segments.count, let ai = digitalLinkAI(segments[index]) {
            let rawValue = segments[index + 1]
            var value = rawValue.removingPercentEncoding ?? rawValue
            if ai == "01", value.count < 14, [8, 12, 13].contains(value.count), value.allSatisfy(\.isASCIIDigit) {
                value = String(repeating: "0", count: 14 - value.count) + value
            }
            pairs.append((ai, value, value == rawValue ? nil : rawValue))
            index += 2
        }
        for item in components.queryItems ?? [] {
            guard let ai = digitalLinkAI(item.name), let value = item.value, !value.isEmpty else { continue }
            guard table[ai] != nil else { continue }
            pairs.append((ai, value, nil))
        }
        guard !pairs.isEmpty else { return nil }
        return makeResult(pairs, currentYear: currentYear)
    }

    // MARK: Element construction

    static func makeResult(_ pairs: [(String, String, String?)], currentYear: Int) -> GS1Result? {
        guard !pairs.isEmpty else { return nil }
        var elements: [GS1Element] = []
        for (ai, value, raw) in pairs {
            guard let element = makeElement(ai: ai, value: value, raw: raw, currentYear: currentYear) else { return nil }
            elements.append(element)
        }
        return GS1Result(elements: elements)
    }

    static func makeElement(ai: String, value: String, raw: String?, currentYear: Int) -> GS1Element? {
        guard !value.isEmpty else { return nil }
        let definition = table[ai] ?? {
            guard let length = aiLength(forPrefix: String(ai.prefix(2))), length == ai.count else { return nil }
            return unknownDefinition(ai)
        }()
        guard let definition else { return nil }
        if definition.format == .numeric, !value.allSatisfy(\.isASCIIDigit) { return nil }
        if let length = definition.fixedLength, value.count != length { return nil }

        var element = GS1Element(ai: ai, title: definition.title, value: value, raw: raw)
        switch definition.kind {
        case .plain:
            break
        case .date:
            element.date = isoDate(yymmdd: value, currentYear: currentYear)
        case .decimal:
            if let places = definition.decimalPlaces, let number = Double(value) {
                element.number = number / pow(10, Double(places))
            }
        case .decimalWithCurrency:
            if let places = definition.decimalPlaces, value.count > 3, let number = Double(value.dropFirst(3)) {
                element.number = number / pow(10, Double(places))
            }
        }
        return element
    }

    // MARK: Dates

    static func currentYear(_ date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? calendar.timeZone
        return calendar.component(.year, from: date)
    }

    /// Converts GS1 `YYMMDD` to ISO `YYYY-MM-DD` using the GS1 sliding century window.
    static func isoDate(yymmdd: String, currentYear: Int) -> String? {
        guard yymmdd.count == 6, yymmdd.allSatisfy(\.isASCIIDigit) else { return nil }
        let digits = Array(yymmdd)
        guard let yy = Int(String(digits[0...1])),
              let month = Int(String(digits[2...3])),
              var day = Int(String(digits[4...5])) else { return nil }
        guard (1...12).contains(month) else { return nil }
        let currentCentury = currentYear / 100
        let difference = yy - currentYear % 100
        var century = currentCentury
        if difference >= 51 {
            century -= 1
        } else if difference <= -50 {
            century += 1
        }
        let year = century * 100 + yy
        let lastDay = daysInMonth(year: year, month: month)
        if day == 0 { day = lastDay }
        guard day <= lastDay else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 1, 3, 5, 7, 8, 10, 12: return 31
        case 4, 6, 9, 11: return 30
        default:
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
            return leap ? 29 : 28
        }
    }

    static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value >= 48 && scalar.value <= 57
    }
}
