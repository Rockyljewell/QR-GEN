// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The classified payload of a code (SPEC section 3.1).
///
/// JSON encoding produces the cross-platform shape, e.g.
/// `{"type":"wifi","ssid":"Home","password":"secret","security":"WPA","hidden":false}`.
public enum ParsedContent: Hashable, Sendable {
    /// A URL.
    case url(String)
    /// A GS1 Digital Link URI and its parsed GS1 data.
    case gs1DigitalLink(url: String, gs1: GS1Result)
    /// An e-mail (`mailto:`, `MATMSG:`, `SMTP:` or a bare address).
    case email(Email)
    /// A phone number (`tel:`).
    case phone(number: String)
    /// A text message (`sms:`, `smsto:`, `mms:`, `mmsto:`).
    case sms(SMS)
    /// Wi-Fi network credentials (`WIFI:`).
    case wifi(WiFi)
    /// A geographic location (`geo:`).
    case geo(Geo)
    /// A contact card (vCard or MECARD).
    case contact(Contact)
    /// A calendar event (`BEGIN:VEVENT`).
    case event(Event)
    /// A payment request (EPC/SEPA, bitcoin, ethereum, UPI, ...).
    case payment(Payment)
    /// A retail product code (GTIN) with check digit validation.
    case product(Product)
    /// A GS1 element string.
    case gs1(GS1Result)
    /// A driver license or ID card.
    case aamva(AAMVAResult)
    /// Anything else.
    case text(String)

    /// The SPEC `type` string (`"url"`, `"gs1-digital-link"`, `"wifi"`, ...).
    public var type: String {
        switch self {
        case .url: return "url"
        case .gs1DigitalLink: return "gs1-digital-link"
        case .email: return "email"
        case .phone: return "phone"
        case .sms: return "sms"
        case .wifi: return "wifi"
        case .geo: return "geo"
        case .contact: return "contact"
        case .event: return "event"
        case .payment: return "payment"
        case .product: return "product"
        case .gs1: return "gs1"
        case .aamva: return "aamva"
        case .text: return "text"
        }
    }

    /// JSON in the cross-platform shape (keys sorted).
    public func toJSON(prettyPrinted: Bool = false) -> String {
        JSONOutput.encode(self, prettyPrinted: prettyPrinted)
    }

    // MARK: Payloads

    public struct Email: Codable, Hashable, Sendable {
        public var to: String
        public var subject: String?
        public var body: String?

        public init(to: String, subject: String? = nil, body: String? = nil) {
            self.to = to
            self.subject = subject
            self.body = body
        }
    }

    public struct SMS: Codable, Hashable, Sendable {
        public var number: String
        public var body: String?

        public init(number: String, body: String? = nil) {
            self.number = number
            self.body = body
        }
    }

    public struct WiFi: Codable, Hashable, Sendable {
        public var ssid: String
        public var password: String?
        /// `"WPA"`, `"WEP"`, `"nopass"`, or the value found in the code (e.g. `"SAE"`, `"WPA2-EAP"`).
        public var security: String
        public var hidden: Bool

        public init(ssid: String, password: String? = nil, security: String = "nopass", hidden: Bool = false) {
            self.ssid = ssid
            self.password = password
            self.security = security
            self.hidden = hidden
        }
    }

    public struct Geo: Codable, Hashable, Sendable {
        public var latitude: Double
        public var longitude: Double
        public var altitude: Double?
        public var query: String?

        public init(latitude: Double, longitude: Double, altitude: Double? = nil, query: String? = nil) {
            self.latitude = latitude
            self.longitude = longitude
            self.altitude = altitude
            self.query = query
        }
    }

    public struct Contact: Codable, Hashable, Sendable {
        public enum Format: String, Codable, Hashable, Sendable {
            case vcard
            case mecard
        }

        public var name: String?
        public var organization: String?
        public var title: String?
        public var phones: [String]
        public var emails: [String]
        public var urls: [String]
        public var address: String?
        public var note: String?
        public var format: Format

        public init(name: String? = nil, organization: String? = nil, title: String? = nil,
                    phones: [String] = [], emails: [String] = [], urls: [String] = [],
                    address: String? = nil, note: String? = nil, format: Format) {
            self.name = name
            self.organization = organization
            self.title = title
            self.phones = phones
            self.emails = emails
            self.urls = urls
            self.address = address
            self.note = note
            self.format = format
        }
    }

    public struct Event: Codable, Hashable, Sendable {
        public var summary: String?
        /// ISO 8601 when the input used the iCalendar basic format, else as found.
        public var start: String?
        public var end: String?
        public var location: String?
        public var description: String?

        public init(summary: String? = nil, start: String? = nil, end: String? = nil,
                    location: String? = nil, description: String? = nil) {
            self.summary = summary
            self.start = start
            self.end = end
            self.location = location
            self.description = description
        }
    }

    public struct Payment: Codable, Hashable, Sendable {
        public enum Scheme: String, Codable, Hashable, Sendable {
            case epc
            case bitcoin
            case ethereum
            case upi
            case other
        }

        public var scheme: Scheme
        /// Wallet address or UPI VPA.
        public var address: String?
        /// Beneficiary / label.
        public var name: String?
        public var iban: String?
        public var bic: String?
        /// Amount as written in the code (for `ethereum:` the raw `value` parameter, in wei).
        public var amount: String?
        public var currency: String?
        /// Remittance reference or message.
        public var reference: String?

        public init(scheme: Scheme, address: String? = nil, name: String? = nil, iban: String? = nil,
                    bic: String? = nil, amount: String? = nil, currency: String? = nil, reference: String? = nil) {
            self.scheme = scheme
            self.address = address
            self.name = name
            self.iban = iban
            self.bic = bic
            self.amount = amount
            self.currency = currency
            self.reference = reference
        }
    }

    public struct Product: Codable, Hashable, Sendable {
        public enum Kind: String, Codable, Hashable, Sendable {
            case ean13
            case ean8
            case upca
            case upce
            case isbn
            case gtin14
        }

        /// 14-digit GTIN, zero padded (UPC-E is expanded to UPC-A first).
        public var gtin: String
        public var kind: Kind
        /// `true` when the check digit is correct.
        public var checksumValid: Bool

        public init(gtin: String, kind: Kind, checksumValid: Bool) {
            self.gtin = gtin
            self.kind = kind
            self.checksumValid = checksumValid
        }
    }
}

// MARK: - Codable (flattened "type" + fields)

extension ParsedContent: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, url, gs1, number, aamva, text
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "url": self = .url(try container.decode(String.self, forKey: .url))
        case "gs1-digital-link":
            self = .gs1DigitalLink(url: try container.decode(String.self, forKey: .url),
                                   gs1: try container.decode(GS1Result.self, forKey: .gs1))
        case "email": self = .email(try Email(from: decoder))
        case "phone": self = .phone(number: try container.decode(String.self, forKey: .number))
        case "sms": self = .sms(try SMS(from: decoder))
        case "wifi": self = .wifi(try WiFi(from: decoder))
        case "geo": self = .geo(try Geo(from: decoder))
        case "contact": self = .contact(try Contact(from: decoder))
        case "event": self = .event(try Event(from: decoder))
        case "payment": self = .payment(try Payment(from: decoder))
        case "product": self = .product(try Product(from: decoder))
        case "gs1": self = .gs1(try container.decode(GS1Result.self, forKey: .gs1))
        case "aamva": self = .aamva(try container.decode(AAMVAResult.self, forKey: .aamva))
        default: self = .text(try container.decodeIfPresent(String.self, forKey: .text) ?? "")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        switch self {
        case .url(let url): try container.encode(url, forKey: .url)
        case .gs1DigitalLink(let url, let gs1):
            try container.encode(url, forKey: .url)
            try container.encode(gs1, forKey: .gs1)
        case .email(let value): try value.encode(to: encoder)
        case .phone(let number): try container.encode(number, forKey: .number)
        case .sms(let value): try value.encode(to: encoder)
        case .wifi(let value): try value.encode(to: encoder)
        case .geo(let value): try value.encode(to: encoder)
        case .contact(let value): try value.encode(to: encoder)
        case .event(let value): try value.encode(to: encoder)
        case .payment(let value): try value.encode(to: encoder)
        case .product(let value): try value.encode(to: encoder)
        case .gs1(let gs1): try container.encode(gs1, forKey: .gs1)
        case .aamva(let aamva): try container.encode(aamva, forKey: .aamva)
        case .text(let text): try container.encode(text, forKey: .text)
        }
    }
}

// MARK: - Entry point

extension QRGen {
    /// Classifies decoded barcode text (SPEC section 3.1): URLs, GS1 Digital Link, e-mail, phone,
    /// SMS, Wi-Fi, geo, vCard / MECARD contacts, calendar events, payments, retail products, GS1
    /// element strings and AAMVA driver licenses. Everything else is `.text`.
    ///
    /// - Parameters:
    ///   - data: decoded text.
    ///   - symbology: optional hint. Retail symbologies enable product detection for digit-only
    ///     data and `upce` expands 6-8 digit UPC-E codes; for other 1D/2D symbologies a digit-only
    ///     payload stays `.text`. Without a hint, 8/12/13/14-digit strings are treated as products.
    /// - Returns: the classified content. Never throws.
    public static func parseContent(_ data: String, symbology: Symbology? = nil) -> ParsedContent {
        ContentParser.parse(data, symbology: symbology)
    }
}

enum ContentParser {
    static func parse(_ data: String, symbology: Symbology?) -> ParsedContent {
        let trimmed = data.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .text(data) }
        let lower = trimmed.lowercased()

        // Driver license / ID card.
        if trimmed.hasPrefix("@"), data.contains("ANSI ") || data.contains("AAMVA"),
           let aamva = QRGen.parseAAMVA(data) {
            return .aamva(aamva)
        }
        // EPC / SEPA credit transfer.
        if trimmed.hasPrefix("BCD"), let payment = parseEPC(trimmed) {
            return .payment(payment)
        }

        if lower.hasPrefix("upi://"), let payment = parseUPI(trimmed) { return .payment(payment) }
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            if let gs1 = GS1Parser.parseDigitalLink(trimmed, currentYear: GS1Parser.currentYear(Date())) {
                return .gs1DigitalLink(url: trimmed, gs1: gs1)
            }
            return .url(trimmed)
        }
        if lower.hasPrefix("mailto:") { return .email(parseMailto(trimmed)) }
        if lower.hasPrefix("matmsg:") { return .email(parseMATMSG(trimmed)) }
        if lower.hasPrefix("smtp:") { return .email(parseSMTP(trimmed)) }
        if lower.hasPrefix("tel:") {
            return .phone(number: decode(String(trimmed.dropFirst(4))).trimmingCharacters(in: .whitespaces))
        }
        for prefix in ["smsto:", "mmsto:", "sms:", "mms:"] where lower.hasPrefix(prefix) {
            return .sms(parseSMS(String(trimmed.dropFirst(prefix.count)), colonSeparated: prefix.hasSuffix("to:")))
        }
        if lower.hasPrefix("wifi:") { return .wifi(parseWiFi(trimmed)) }
        if lower.hasPrefix("geo:"), let geo = parseGeo(trimmed) { return .geo(geo) }
        if lower.hasPrefix("begin:vcard") { return .contact(parseVCard(trimmed)) }
        if lower.hasPrefix("mecard:") { return .contact(parseMECARD(trimmed)) }
        if lower.hasPrefix("begin:vevent") || lower.hasPrefix("begin:vcalendar"), lower.contains("begin:vevent") {
            return .event(parseEvent(trimmed))
        }
        if lower.hasPrefix("bitcoin:") { return .payment(parseCryptoURI(trimmed, scheme: .bitcoin, currency: "BTC")) }
        if lower.hasPrefix("ethereum:") { return .payment(parseEthereum(trimmed)) }
        for (prefix, currency) in otherCryptoSchemes where lower.hasPrefix(prefix) {
            return .payment(parseCryptoURI(trimmed, scheme: .other, currency: currency))
        }
        if lower.hasPrefix("mebkm:"), let url = parseMEBKM(trimmed) { return .url(url) }
        if lower.hasPrefix("urlto:") {
            let rest = String(trimmed.dropFirst(6))
            if let colon = rest.firstIndex(of: ":") {
                let url = String(rest[rest.index(after: colon)...])
                if url.contains("://") || url.lowercased().hasPrefix("www.") { return .url(url) }
            }
            return .url(rest)
        }
        if hasURLScheme(lower) { return .url(trimmed) }

        // GS1 element strings.
        if trimmed.hasPrefix("("), let gs1 = QRGen.parseGS1(trimmed) { return .gs1(gs1) }
        let gs1Prefixes = ["]C1", "]e0", "]d2", "]Q3", "]J1"]
        if gs1Prefixes.contains(where: { trimmed.hasPrefix($0) }) || trimmed.unicodeScalars.contains("\u{1D}"),
           let gs1 = QRGen.parseGS1(trimmed) {
            return .gs1(gs1)
        }

        // Retail products.
        if trimmed.allSatisfy(\.isASCIIDigit), let product = parseProduct(trimmed, symbology: symbology) {
            return .product(product)
        }

        // Bare e-mail address.
        if isBareEmail(trimmed) { return .email(ParsedContent.Email(to: trimmed)) }

        return .text(data)
    }

    static let otherCryptoSchemes: [(String, String)] = [
        ("bitcoincash:", "BCH"), ("litecoin:", "LTC"), ("dogecoin:", "DOGE"), ("monero:", "XMR"),
        ("zcash:", "ZEC"), ("dash:", "DASH"), ("solana:", "SOL"),
    ]

    // MARK: Helpers

    /// Percent-decodes, optionally turning `+` into spaces (form encoding).
    static func decode(_ value: String, plusAsSpace: Bool = false) -> String {
        let source = plusAsSpace ? value.replacingOccurrences(of: "+", with: " ") : value
        return source.removingPercentEncoding ?? source
    }

    /// Parses `a=1&b=2` into lowercase keys and decoded values (first occurrence wins).
    static func queryParameters(_ query: String, plusAsSpace: Bool = false) -> [String: String] {
        var result: [String: String] = [:]
        for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let rawKey = parts.first else { continue }
            let key = decode(String(rawKey)).lowercased()
            let value = parts.count > 1 ? decode(String(parts[1]), plusAsSpace: plusAsSpace) : ""
            if result[key] == nil { result[key] = value }
        }
        return result
    }

    /// Splits `uri` at the first `?` into (path, query).
    static func splitQuery(_ uri: String) -> (String, String) {
        guard let mark = uri.firstIndex(of: "?") else { return (uri, "") }
        return (String(uri[..<mark]), String(uri[uri.index(after: mark)...]))
    }

    static func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    static func hasURLScheme(_ lower: String) -> Bool {
        guard let range = lower.range(of: "://") else { return false }
        let scheme = lower[..<range.lowerBound]
        guard let first = scheme.first, first.isLetter, first.isASCII else { return false }
        return scheme.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "+" || $0 == "-" || $0 == ".") }
    }

    static func isBareEmail(_ value: String) -> Bool {
        guard !value.contains(where: { $0.isWhitespace }) else { return false }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1]
        guard let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return false }
        return domain.distance(from: dot, to: domain.endIndex) >= 3
    }

    /// Splits on `separator` when it is not escaped with a backslash. Escapes are kept.
    static func splitUnescaped(_ value: String, separator: Character) -> [String] {
        var parts: [String] = []
        var current = ""
        var escaped = false
        for character in value {
            if escaped {
                current.append("\\")
                current.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == separator {
                parts.append(current)
                current = ""
            } else {
                current.append(character)
            }
        }
        if escaped { current.append("\\") }
        parts.append(current)
        return parts
    }

    /// Removes backslash escapes (`\;` -> `;`, `\\` -> `\`).
    static func unescapeBackslashes(_ value: String) -> String {
        var output = ""
        var escaped = false
        for character in value {
            if escaped {
                output.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                output.append(character)
            }
        }
        if escaped { output.append("\\") }
        return output
    }

    /// Parses `KEY:value;KEY:value;;` (MECARD, MATMSG, WIFI) into ordered (key, value) pairs.
    static func parseKeyValueList(_ body: String) -> [(String, String)] {
        var pairs: [(String, String)] = []
        for field in splitUnescaped(body, separator: ";") where !field.isEmpty {
            let components = splitUnescaped(field, separator: ":")
            guard components.count >= 2 else { continue }
            let key = unescapeBackslashes(components[0]).uppercased().trimmingCharacters(in: .whitespaces)
            let value = unescapeBackslashes(components.dropFirst().joined(separator: ":"))
            pairs.append((key, value))
        }
        return pairs
    }

    // MARK: E-mail

    static func parseMailto(_ uri: String) -> ParsedContent.Email {
        let (path, query) = splitQuery(String(uri.dropFirst("mailto:".count)))
        let params = queryParameters(query)
        var to = decode(path)
        if to.isEmpty { to = params["to"] ?? "" }
        return ParsedContent.Email(to: to, subject: nonEmpty(params["subject"]), body: nonEmpty(params["body"]))
    }

    static func parseMATMSG(_ value: String) -> ParsedContent.Email {
        var email = ParsedContent.Email(to: "")
        for (key, fieldValue) in parseKeyValueList(String(value.dropFirst("MATMSG:".count))) {
            switch key {
            case "TO": if email.to.isEmpty { email.to = fieldValue }
            case "SUB": email.subject = nonEmpty(fieldValue)
            case "BODY": email.body = nonEmpty(fieldValue)
            default: break
            }
        }
        return email
    }

    static func parseSMTP(_ value: String) -> ParsedContent.Email {
        // SMTP:to:subject:body
        let parts = String(value.dropFirst("SMTP:".count)).split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        return ParsedContent.Email(
            to: parts.first.map(String.init) ?? "",
            subject: parts.count > 1 ? nonEmpty(String(parts[1])) : nil,
            body: parts.count > 2 ? nonEmpty(String(parts[2])) : nil
        )
    }

    // MARK: SMS

    static func parseSMS(_ rest: String, colonSeparated: Bool) -> ParsedContent.SMS {
        let (path, query) = splitQuery(rest)
        if !query.isEmpty {
            let params = queryParameters(query)
            return ParsedContent.SMS(number: decode(path), body: nonEmpty(params["body"]))
        }
        if let colon = path.firstIndex(of: ":") {
            let number = String(path[..<colon])
            let body = String(path[path.index(after: colon)...])
            return ParsedContent.SMS(number: decode(number), body: nonEmpty(colonSeparated ? body : decode(body)))
        }
        return ParsedContent.SMS(number: decode(path))
    }

    // MARK: Wi-Fi

    static func parseWiFi(_ value: String) -> ParsedContent.WiFi {
        var wifi = ParsedContent.WiFi(ssid: "")
        var security: String?
        for (key, fieldValue) in parseKeyValueList(String(value.dropFirst("WIFI:".count))) {
            switch key {
            case "S": wifi.ssid = stripQuotes(fieldValue)
            case "P": wifi.password = nonEmptyRaw(stripQuotes(fieldValue))
            case "T": security = fieldValue.trimmingCharacters(in: .whitespaces)
            case "H":
                let flag = fieldValue.lowercased().trimmingCharacters(in: .whitespaces)
                wifi.hidden = flag == "true" || flag == "1" || flag == "yes"
            default: break
            }
        }
        if let security, !security.isEmpty {
            wifi.security = security.lowercased() == "nopass" ? "nopass" : security.uppercased()
        } else {
            wifi.security = "nopass"
        }
        return wifi
    }

    static func stripQuotes(_ value: String) -> String {
        guard value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") else { return value }
        return String(value.dropFirst().dropLast())
    }

    static func nonEmptyRaw(_ value: String) -> String? {
        value.isEmpty ? nil : value
    }

    // MARK: Geo

    static func parseGeo(_ value: String) -> ParsedContent.Geo? {
        let (path, query) = splitQuery(String(value.dropFirst("geo:".count)))
        let coordinates = path.split(separator: ";", maxSplits: 1).first.map(String.init) ?? path
        let numbers = coordinates.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard numbers.count >= 2,
              let latitude = Double(numbers[0]), let longitude = Double(numbers[1]),
              (-90...90).contains(latitude), (-180...180).contains(longitude) else { return nil }
        let altitude = numbers.count > 2 ? Double(numbers[2]) : nil
        let params = queryParameters(query, plusAsSpace: true)
        return ParsedContent.Geo(latitude: latitude, longitude: longitude, altitude: altitude, query: nonEmpty(params["q"]))
    }

    // MARK: vCard / iCalendar lines

    struct ContentLine {
        let name: String
        let parameters: [String]
        let value: String
    }

    /// Unfolds and splits RFC 6350 / RFC 5545 content lines.
    static func contentLines(_ text: String) -> [ContentLine] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var unfolded: [String] = []
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            if let first = line.first, first == " " || first == "\t", !unfolded.isEmpty {
                unfolded[unfolded.count - 1] += String(line.dropFirst())
            } else {
                unfolded.append(String(line))
            }
        }
        var result: [ContentLine] = []
        for line in unfolded {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let head = String(line[..<colon])
            let value = String(line[line.index(after: colon)...])
            var parts = head.split(separator: ";").map(String.init)
            guard !parts.isEmpty else { continue }
            var name = parts.removeFirst()
            if let dot = name.lastIndex(of: ".") {
                name = String(name[name.index(after: dot)...])
            }
            result.append(ContentLine(name: name.uppercased(), parameters: parts, value: value))
        }
        return result
    }

    /// Removes vCard / iCalendar text escapes.
    static func unescapeText(_ value: String) -> String {
        var output = ""
        var escaped = false
        for character in value {
            if escaped {
                switch character {
                case "n", "N": output.append("\n")
                default: output.append(character)
                }
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                output.append(character)
            }
        }
        return output
    }

    static func structured(_ value: String) -> [String] {
        splitUnescaped(value, separator: ";").map { unescapeText($0).trimmingCharacters(in: .whitespaces) }
    }

    static func parseVCard(_ text: String) -> ParsedContent.Contact {
        var contact = ParsedContent.Contact(format: .vcard)
        var formattedName: String?
        var structuredName: String?
        for line in contentLines(text) {
            let value = line.value
            switch line.name {
            case "FN":
                formattedName = nonEmpty(unescapeText(value))
            case "N":
                let parts = structured(value)
                // Family; Given; Additional; Prefix; Suffix
                let ordered = [3, 1, 2, 0, 4].compactMap { $0 < parts.count ? parts[$0] : nil }
                structuredName = nonEmpty(ordered.filter { !$0.isEmpty }.joined(separator: " "))
            case "ORG":
                contact.organization = nonEmpty(structured(value).filter { !$0.isEmpty }.joined(separator: ", "))
            case "TITLE":
                contact.title = nonEmpty(unescapeText(value))
            case "TEL":
                var number = unescapeText(value)
                if number.lowercased().hasPrefix("tel:") { number = String(number.dropFirst(4)) }
                if let number = nonEmpty(number) { contact.phones.append(number) }
            case "EMAIL":
                if let email = nonEmpty(unescapeText(value)) { contact.emails.append(email) }
            case "URL":
                if let url = nonEmpty(unescapeText(value)) { contact.urls.append(url) }
            case "ADR":
                if contact.address == nil {
                    contact.address = nonEmpty(structured(value).filter { !$0.isEmpty }.joined(separator: ", "))
                }
            case "NOTE":
                contact.note = nonEmpty(unescapeText(value))
            default:
                break
            }
        }
        contact.name = formattedName ?? structuredName
        return contact
    }

    static func parseMECARD(_ text: String) -> ParsedContent.Contact {
        var contact = ParsedContent.Contact(format: .mecard)
        for (key, value) in parseKeyValueList(String(text.dropFirst("MECARD:".count))) {
            switch key {
            case "N":
                // "Last,First" -> "First Last"
                let parts = value.split(separator: ",", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                contact.name = nonEmpty(parts.count == 2 ? "\(parts[1]) \(parts[0])" : value)
            case "ORG": contact.organization = nonEmpty(value)
            case "TITLE": contact.title = nonEmpty(value)
            case "TEL", "TEL-AV": if let tel = nonEmpty(value) { contact.phones.append(tel) }
            case "EMAIL": if let email = nonEmpty(value) { contact.emails.append(email) }
            case "URL": if let url = nonEmpty(value) { contact.urls.append(url) }
            case "ADR": contact.address = nonEmpty(value.replacingOccurrences(of: ",,", with: ","))
            case "NOTE": contact.note = nonEmpty(value)
            default: break
            }
        }
        return contact
    }

    static func parseEvent(_ text: String) -> ParsedContent.Event {
        var event = ParsedContent.Event()
        var inEvent = false
        for line in contentLines(text) {
            if line.name == "BEGIN", line.value.uppercased() == "VEVENT" { inEvent = true; continue }
            if line.name == "END", line.value.uppercased() == "VEVENT" { break }
            guard inEvent else { continue }
            switch line.name {
            case "SUMMARY": event.summary = nonEmpty(unescapeText(line.value))
            case "DTSTART": event.start = nonEmpty(isoDateTime(line.value))
            case "DTEND": event.end = nonEmpty(isoDateTime(line.value))
            case "LOCATION": event.location = nonEmpty(unescapeText(line.value))
            case "DESCRIPTION": event.description = nonEmpty(unescapeText(line.value))
            default: break
            }
        }
        return event
    }

    /// `20250101` -> `2025-01-01`, `20250101T100000Z` -> `2025-01-01T10:00:00Z`; anything else unchanged.
    static func isoDateTime(_ value: String) -> String {
        let text = value.trimmingCharacters(in: .whitespaces)
        let chars = Array(text)
        func digits(_ range: Range<Int>) -> String? {
            guard range.upperBound <= chars.count else { return nil }
            let slice = chars[range]
            return slice.allSatisfy(\.isASCIIDigit) ? String(slice) : nil
        }
        guard let year = digits(0..<4), let month = digits(4..<6), let day = digits(6..<8) else { return text }
        let date = "\(year)-\(month)-\(day)"
        if chars.count == 8 { return date }
        guard chars.count >= 15, chars[8] == "T",
              let hour = digits(9..<11), let minute = digits(11..<13), let second = digits(13..<15) else { return text }
        let zone = chars.count > 15 && chars[15] == "Z" ? "Z" : ""
        return "\(date)T\(hour):\(minute):\(second)\(zone)"
    }

    static func parseMEBKM(_ text: String) -> String? {
        for (key, value) in parseKeyValueList(String(text.dropFirst("MEBKM:".count))) where key == "URL" {
            return nonEmpty(value)
        }
        return nil
    }

    // MARK: Payments

    static func parseEPC(_ text: String) -> ParsedContent.Payment? {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        guard lines.count >= 7, lines[0] == "BCD" else { return nil }
        func line(_ index: Int) -> String? { index < lines.count ? nonEmpty(lines[index]) : nil }
        guard let iban = line(6) else { return nil }
        var payment = ParsedContent.Payment(scheme: .epc, name: line(5), iban: iban.replacingOccurrences(of: " ", with: ""), bic: line(4))
        if let amount = line(7) {
            let letters = amount.prefix { $0.isLetter }
            payment.currency = letters.isEmpty ? "EUR" : String(letters).uppercased()
            payment.amount = nonEmpty(String(amount.dropFirst(letters.count)))
        }
        payment.reference = line(9) ?? line(10)
        return payment
    }

    static func parseCryptoURI(_ text: String, scheme: ParsedContent.Payment.Scheme, currency: String) -> ParsedContent.Payment {
        guard let colon = text.firstIndex(of: ":") else { return ParsedContent.Payment(scheme: scheme, currency: currency) }
        var rest = String(text[text.index(after: colon)...])
        if rest.hasPrefix("//") { rest.removeFirst(2) }
        let (address, query) = splitQuery(rest)
        let params = queryParameters(query)
        return ParsedContent.Payment(
            scheme: scheme,
            address: nonEmpty(decode(address)),
            name: nonEmpty(params["label"]),
            amount: nonEmpty(params["amount"] ?? params["tx_amount"]),
            currency: currency,
            reference: nonEmpty(params["message"] ?? params["memo"] ?? params["tx_description"])
        )
    }

    static func parseEthereum(_ text: String) -> ParsedContent.Payment {
        // EIP-681: ethereum:[pay-]<address>[@chainId][/function]?params
        var rest = String(text.dropFirst("ethereum:".count))
        if rest.lowercased().hasPrefix("pay-") { rest.removeFirst(4) }
        let (target, query) = splitQuery(rest)
        let params = queryParameters(query)
        var address = target
        var function: String?
        if let slash = address.firstIndex(of: "/") {
            function = String(address[address.index(after: slash)...])
            address = String(address[..<slash])
        }
        if let at = address.firstIndex(of: "@") {
            address = String(address[..<at])
        }
        var payment = ParsedContent.Payment(scheme: .ethereum, address: nonEmpty(address), currency: "ETH")
        if function == "transfer" {
            payment.address = nonEmpty(params["address"]) ?? payment.address
            payment.amount = nonEmpty(params["uint256"])
            payment.currency = nil
        } else {
            payment.amount = nonEmpty(params["value"] ?? params["amount"])
        }
        return payment
    }

    static func parseUPI(_ text: String) -> ParsedContent.Payment? {
        let (_, query) = splitQuery(text)
        let params = queryParameters(query, plusAsSpace: true)
        guard let address = nonEmpty(params["pa"]) else { return nil }
        return ParsedContent.Payment(
            scheme: .upi,
            address: address,
            name: nonEmpty(params["pn"]),
            amount: nonEmpty(params["am"]),
            currency: nonEmpty(params["cu"]) ?? "INR",
            reference: nonEmpty(params["tr"]) ?? nonEmpty(params["tn"])
        )
    }

    // MARK: Products

    static let retailHints: Set<Symbology> = [
        .ean13, .ean8, .upca, .upce, .isbn, .itf14, .databar, .databarLimited, .databarExpanded,
    ]

    static func parseProduct(_ digits: String, symbology: Symbology?) -> ParsedContent.Product? {
        if let symbology, !retailHints.contains(symbology) { return nil }
        if symbology == .upce, (6...8).contains(digits.count), let upca = expandUPCE(digits) {
            return ParsedContent.Product(gtin: pad14(upca.digits), kind: .upce, checksumValid: upca.checksumValid)
        }
        let kind: ParsedContent.Product.Kind
        switch digits.count {
        case 8: kind = .ean8
        case 12: kind = .upca
        case 13: kind = digits.hasPrefix("978") || digits.hasPrefix("979") ? .isbn : .ean13
        case 14: kind = .gtin14
        default: return nil
        }
        return ParsedContent.Product(gtin: pad14(digits), kind: kind, checksumValid: isValidGTIN(digits))
    }

    static func pad14(_ digits: String) -> String {
        digits.count >= 14 ? digits : String(repeating: "0", count: 14 - digits.count) + digits
    }

    /// GS1 mod-10 check digit of the digits (without the check digit).
    static func gtinCheckDigit(_ body: String) -> Int? {
        var sum = 0
        for (offset, character) in body.reversed().enumerated() {
            guard let value = character.wholeNumberValue, character.isASCIIDigit else { return nil }
            sum += value * (offset % 2 == 0 ? 3 : 1)
        }
        return (10 - sum % 10) % 10
    }

    /// `true` when the last digit is the correct GS1 check digit.
    static func isValidGTIN(_ digits: String) -> Bool {
        guard digits.count >= 2, let last = digits.last?.wholeNumberValue,
              let expected = gtinCheckDigit(String(digits.dropLast())) else { return false }
        return last == expected
    }

    /// Expands UPC-E (6, 7 or 8 digits) to the 12-digit UPC-A.
    static func expandUPCE(_ code: String) -> (digits: String, checksumValid: Bool)? {
        var numberSystem = "0"
        var body: String
        var check: Character?
        switch code.count {
        case 6: body = code
        case 7:
            numberSystem = String(code.prefix(1))
            body = String(code.dropFirst())
        case 8:
            numberSystem = String(code.prefix(1))
            body = String(code.dropFirst().dropLast())
            check = code.last
        default: return nil
        }
        guard numberSystem == "0" || numberSystem == "1" else { return nil }
        let d = Array(body)
        guard d.count == 6 else { return nil }
        let manufacturerAndProduct: String
        switch d[5] {
        case "0", "1", "2": manufacturerAndProduct = "\(d[0])\(d[1])\(d[5])0000\(d[2])\(d[3])\(d[4])"
        case "3": manufacturerAndProduct = "\(d[0])\(d[1])\(d[2])00000\(d[3])\(d[4])"
        case "4": manufacturerAndProduct = "\(d[0])\(d[1])\(d[2])\(d[3])00000\(d[4])"
        default: manufacturerAndProduct = "\(d[0])\(d[1])\(d[2])\(d[3])\(d[4])0000\(d[5])"
        }
        let withoutCheck = numberSystem + manufacturerAndProduct
        guard let expected = gtinCheckDigit(withoutCheck) else { return nil }
        let checkDigit = check.flatMap(\.wholeNumberValue) ?? expected
        return (withoutCheck + String(checkDigit), checkDigit == expected)
    }
}
