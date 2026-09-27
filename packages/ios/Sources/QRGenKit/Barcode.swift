import Foundation

/// A decoded barcode, matching the cross-platform result shape (SPEC section 2).
///
/// Encoding a `Barcode` with `JSONEncoder` (or ``toJSON(prettyPrinted:)``) produces exactly
/// the JSON the other QRGen SDKs emit, so results can travel over bridges unchanged.
public struct Barcode: Codable, Hashable, Sendable, Identifiable {
    /// The kind of payload a code carries.
    public enum ContentType: String, Codable, Hashable, Sendable, CaseIterable {
        case text
        case binary
        case gs1
        case iso15434
        case mixed
        case unknownECI = "unknown-eci"
    }

    /// A point in pixel coordinates of the source frame or image (origin top-left).
    public struct Point: Codable, Hashable, Sendable {
        public var x: Double
        public var y: Double

        public init(x: Double, y: Double) {
            self.x = x
            self.y = y
        }
    }

    /// The four corners of a code, in the reading orientation of the symbol.
    public struct Quadrilateral: Codable, Hashable, Sendable {
        public var topLeft: Point
        public var topRight: Point
        public var bottomRight: Point
        public var bottomLeft: Point

        public init(topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point) {
            self.topLeft = topLeft
            self.topRight = topRight
            self.bottomRight = bottomRight
            self.bottomLeft = bottomLeft
        }

        /// The corners in drawing order: top-left, top-right, bottom-right, bottom-left.
        public var points: [Point] { [topLeft, topRight, bottomRight, bottomLeft] }

        /// Centre of the quadrilateral (average of the corners).
        public var center: Point {
            let all = points
            return Point(
                x: all.reduce(0) { $0 + $1.x } / 4,
                y: all.reduce(0) { $0 + $1.y } / 4
            )
        }

        /// Axis-aligned bounds as `(minX, minY, maxX, maxY)`.
        public var bounds: (minX: Double, minY: Double, maxX: Double, maxY: Double) {
            let xs = points.map(\.x)
            let ys = points.map(\.y)
            return (xs.min() ?? 0, ys.min() ?? 0, xs.max() ?? 0, ys.max() ?? 0)
        }

        /// A zero-sized quadrilateral at the origin (used when the location is unknown).
        public static let zero = Quadrilateral(
            topLeft: Point(x: 0, y: 0), topRight: Point(x: 0, y: 0),
            bottomRight: Point(x: 0, y: 0), bottomLeft: Point(x: 0, y: 0)
        )
    }

    /// Pixel size of the frame or image a code was found in.
    public struct Size: Codable, Hashable, Sendable {
        public var width: Double
        public var height: Double

        public init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }
    }

    /// Decoded text. GS1 codes use the human readable form, e.g. `(01)09501101530003(10)ABC`.
    public var data: String
    /// Symbology id (SPEC section 1).
    public var symbology: Symbology
    /// Human readable symbology name, e.g. `"QR Code"`.
    public var symbologyName: String
    /// Base64 of the raw payload bytes; may be `""` when the platform does not expose them.
    public var rawBytes: String
    /// Kind of payload.
    public var contentType: ContentType
    /// `true` when the code carries GS1 data (FNC1 / GS1 symbology).
    public var isGS1: Bool
    /// Corners of the code in pixel coordinates of the source frame or image.
    ///
    /// For camera frames this is the camera's native buffer orientation (landscape on iPhone).
    /// Use `AVCaptureVideoPreviewLayer.layerPoints(for:)` to map it onto a preview layer.
    public var location: Quadrilateral
    /// Size of the source frame or image in pixels.
    public var frameSize: Size
    /// Rotation of the code in degrees (0 = upright in the source frame, clockwise).
    public var orientation: Int
    /// Error-correction level when known (e.g. `"M"` for QR codes), else `""`.
    public var ecLevel: String
    /// AIM symbology identifier when known (e.g. `"]Q1"`), else `""`.
    public var symbologyIdentifier: String
    /// Detection time in milliseconds since 1970-01-01.
    public var timestamp: Int64

    public init(
        data: String,
        symbology: Symbology,
        symbologyName: String? = nil,
        rawBytes: String = "",
        contentType: ContentType = .text,
        isGS1: Bool = false,
        location: Quadrilateral = .zero,
        frameSize: Size = Size(width: 0, height: 0),
        orientation: Int = 0,
        ecLevel: String = "",
        symbologyIdentifier: String? = nil,
        timestamp: Int64 = Barcode.currentTimestamp()
    ) {
        self.data = data
        self.symbology = symbology
        self.symbologyName = symbologyName ?? symbology.displayName
        self.rawBytes = rawBytes
        self.contentType = contentType
        self.isGS1 = isGS1
        self.location = location
        self.frameSize = frameSize
        self.orientation = orientation
        self.ecLevel = ecLevel
        self.symbologyIdentifier = symbologyIdentifier ?? symbology.aimIdentifier(isGS1: isGS1)
        self.timestamp = timestamp
    }

    /// A stable identity for SwiftUI lists and sheets: symbology, data and timestamp.
    public var id: String { "\(symbology.rawValue)|\(timestamp)|\(data)" }

    /// The key used by the duplicate filter and the batch tracker: symbology plus data.
    public var dedupeKey: String { "\(symbology.rawValue)|\(data)" }

    /// The decoded raw payload bytes, when ``rawBytes`` is non-empty valid base64.
    public var rawData: Data? { rawBytes.isEmpty ? nil : Data(base64Encoded: rawBytes) }

    /// ``timestamp`` as a `Date`.
    public var date: Date { Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000) }

    /// The payload classified by ``QRGen/parseContent(_:symbology:)`` (URL, Wi-Fi, vCard, GS1, ...).
    public var parsed: ParsedContent { QRGen.parseContent(data, symbology: symbology) }

    /// JSON in the cross-platform shape (keys sorted).
    public func toJSON(prettyPrinted: Bool = false) -> String {
        JSONOutput.encode(self, prettyPrinted: prettyPrinted)
    }

    /// Milliseconds since 1970-01-01 for "now".
    public static func currentTimestamp() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }
}

/// A barcode followed across frames in batch mode (SPEC section 4, `track` event).
///
/// All ``Barcode`` properties are available directly through dynamic member lookup
/// (`tracked.data`, `tracked.location`, ...). JSON encoding flattens the barcode and adds
/// `id`, `firstSeen`, `lastSeen` and `count`, like the other SDKs.
@dynamicMemberLookup
public struct TrackedBarcode: Codable, Hashable, Sendable, Identifiable {
    /// Stable id of the track for as long as the code stays in view.
    public var id: String
    /// Latest detection of the code.
    public var barcode: Barcode
    /// First time the code was seen (ms since epoch).
    public var firstSeen: Int64
    /// Last time the code was seen (ms since epoch).
    public var lastSeen: Int64
    /// Number of frames the code was detected in.
    public var count: Int

    public init(id: String, barcode: Barcode, firstSeen: Int64, lastSeen: Int64, count: Int) {
        self.id = id
        self.barcode = barcode
        self.firstSeen = firstSeen
        self.lastSeen = lastSeen
        self.count = count
    }

    public subscript<Value>(dynamicMember keyPath: KeyPath<Barcode, Value>) -> Value {
        barcode[keyPath: keyPath]
    }

    private enum CodingKeys: String, CodingKey {
        case id, firstSeen, lastSeen, count
    }

    public init(from decoder: Decoder) throws {
        barcode = try Barcode(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        firstSeen = try container.decode(Int64.self, forKey: .firstSeen)
        lastSeen = try container.decode(Int64.self, forKey: .lastSeen)
        count = try container.decode(Int.self, forKey: .count)
    }

    public func encode(to encoder: Encoder) throws {
        try barcode.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(firstSeen, forKey: .firstSeen)
        try container.encode(lastSeen, forKey: .lastSeen)
        try container.encode(count, forKey: .count)
    }

    /// JSON in the cross-platform shape (barcode fields plus track fields, keys sorted).
    public func toJSON(prettyPrinted: Bool = false) -> String {
        JSONOutput.encode(self, prettyPrinted: prettyPrinted)
    }
}

extension Array where Element == Barcode {
    /// JSON array of barcodes in the cross-platform shape.
    public func toJSON(prettyPrinted: Bool = false) -> String {
        JSONOutput.encode(self, prettyPrinted: prettyPrinted)
    }
}

extension Array where Element == TrackedBarcode {
    /// JSON array of tracked barcodes in the cross-platform shape.
    public func toJSON(prettyPrinted: Bool = false) -> String {
        JSONOutput.encode(self, prettyPrinted: prettyPrinted)
    }
}

/// Shared JSON encoding helper.
enum JSONOutput {
    static func encode<T: Encodable>(_ value: T, prettyPrinted: Bool) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = prettyPrinted ? [.sortedKeys, .prettyPrinted] : [.sortedKeys]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return text
    }
}
