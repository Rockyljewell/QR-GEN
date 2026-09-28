// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation
#if canImport(Vision) && (os(iOS) || os(macOS))
import Vision
#endif

/// A barcode symbology, identified by the lowercase ids of the QRGen specification.
///
/// The raw value is the cross-platform id (`"qr"`, `"micro-qr"`, `"data-matrix"`, ...),
/// which is also what ``Barcode/symbology`` encodes to in JSON.
///
/// Use ``resolve(_:)`` to turn user input such as `["QRCode", "ean", "retail"]` into a
/// set of symbologies; it understands every alias and group of the specification.
public enum Symbology: String, CaseIterable, Codable, Hashable, Sendable {
    case qr = "qr"
    case microQR = "micro-qr"
    case rmqr = "rmqr"
    case dataMatrix = "data-matrix"
    case aztec = "aztec"
    case pdf417 = "pdf417"
    case microPDF417 = "micro-pdf417"
    case maxicode = "maxicode"
    case ean13 = "ean13"
    case ean8 = "ean8"
    case upca = "upca"
    case upce = "upce"
    case isbn = "isbn"
    case code128 = "code128"
    case code39 = "code39"
    case code93 = "code93"
    case codabar = "codabar"
    case itf = "itf"
    case itf14 = "itf14"
    case databar = "databar"
    case databarExpanded = "databar-expanded"
    case databarLimited = "databar-limited"
    case code32 = "code32"
    case pzn = "pzn"
    case telepen = "telepen"
    case dxFilmEdge = "dx-film-edge"

    /// The cross-platform id (same as `rawValue`).
    public var id: String { rawValue }

    /// Human readable name, e.g. `"QR Code"` or `"EAN-13"`.
    public var displayName: String {
        switch self {
        case .qr: return "QR Code"
        case .microQR: return "Micro QR Code"
        case .rmqr: return "rMQR Code"
        case .dataMatrix: return "Data Matrix"
        case .aztec: return "Aztec"
        case .pdf417: return "PDF417"
        case .microPDF417: return "MicroPDF417"
        case .maxicode: return "MaxiCode"
        case .ean13: return "EAN-13"
        case .ean8: return "EAN-8"
        case .upca: return "UPC-A"
        case .upce: return "UPC-E"
        case .isbn: return "ISBN"
        case .code128: return "Code 128"
        case .code39: return "Code 39"
        case .code93: return "Code 93"
        case .codabar: return "Codabar"
        case .itf: return "Interleaved 2 of 5"
        case .itf14: return "ITF-14"
        case .databar: return "GS1 DataBar"
        case .databarExpanded: return "GS1 DataBar Expanded"
        case .databarLimited: return "GS1 DataBar Limited"
        case .code32: return "Code 32 (Italian Pharmacode)"
        case .pzn: return "PZN"
        case .telepen: return "Telepen"
        case .dxFilmEdge: return "DX Film Edge"
        }
    }

    /// `true` for one-dimensional (linear) symbologies.
    public var isLinear: Bool { Symbology.linear.contains(self) }

    /// `true` for two-dimensional (matrix and stacked) symbologies.
    public var isMatrix: Bool { Symbology.matrix.contains(self) }

    // MARK: - Groups

    /// Every symbology (group `all`).
    public static let all: Set<Symbology> = Set(allCases)

    /// Group `linear` / `1d`.
    public static let linear: Set<Symbology> = [
        .ean13, .ean8, .upca, .upce, .isbn, .code128, .code39, .code93, .codabar, .itf, .itf14,
        .databar, .databarExpanded, .databarLimited, .code32, .pzn, .telepen, .dxFilmEdge,
    ]

    /// Group `matrix` / `2d`.
    public static let matrix: Set<Symbology> = [
        .qr, .microQR, .rmqr, .dataMatrix, .aztec, .pdf417, .microPDF417, .maxicode,
    ]

    /// Group `retail`.
    public static let retail: Set<Symbology> = [
        .ean13, .ean8, .upca, .upce, .isbn, .databar, .databarExpanded, .databarLimited,
    ]

    /// Group `industrial`.
    public static let industrial: Set<Symbology> = [
        .code128, .code39, .code93, .codabar, .itf, .itf14, .dataMatrix,
    ]

    /// Group `gs1`.
    public static let gs1: Set<Symbology> = [
        .code128, .dataMatrix, .qr, .databar, .databarExpanded, .databarLimited,
    ]

    /// Group names accepted by ``resolve(_:)`` (already normalized).
    public static let groups: [String: Set<Symbology>] = [
        "all": all,
        "linear": linear,
        "1d": linear,
        "matrix": matrix,
        "2d": matrix,
        "retail": retail,
        "industrial": industrial,
        "gs1": gs1,
    ]

    /// Aliases of the specification, keyed by normalized name.
    private static let aliases: [String: Symbology] = {
        var table: [String: Symbology] = [:]
        for symbology in Symbology.allCases {
            table[normalize(symbology.rawValue)] = symbology
        }
        let extra: [String: Symbology] = [
            "qrcode": .qr,
            "microqrcode": .microQR,
            "rmqrcode": .rmqr,
            "datamatrix": .dataMatrix,
            "dm": .dataMatrix,
            "azteccode": .aztec,
            "compactpdf417": .pdf417,
            "micropdf417": .microPDF417,
            "ean": .ean13,
            "jan": .ean13,
            "gtin13": .ean13,
            "gtin8": .ean8,
            "upc": .upca,
            "isbn13": .isbn,
            "gs1128": .code128,
            "ean128": .code128,
            "code3of9": .code39,
            "nw7": .codabar,
            "interleaved2of5": .itf,
            "i2of5": .itf,
            "rss14": .databar,
            "databaromni": .databar,
            "rssexpanded": .databarExpanded,
            "rsslimited": .databarLimited,
        ]
        table.merge(extra) { _, new in new }
        return table
    }()

    /// Normalizes a user supplied name: lowercases it and removes everything except `[a-z0-9]`.
    ///
    /// `"QR-Code"`, `"qr_code"` and `"QRCODE"` all normalize to `"qrcode"`.
    public static func normalize(_ name: String) -> String {
        String(String.UnicodeScalarView(name.lowercased().unicodeScalars.filter { scalar in
            (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9")
        }))
    }

    /// Looks up a single symbology by id or alias (case-insensitive, punctuation ignored).
    ///
    /// Returns `nil` for unknown names and for group names; use ``resolve(_:)`` for groups.
    public init?(name: String) {
        guard let symbology = Symbology.aliases[Symbology.normalize(name)] else { return nil }
        self = symbology
    }

    /// Resolves ids, aliases and groups (SPEC section 1) into a set of symbologies.
    ///
    /// - Unknown names are skipped silently.
    /// - An empty list resolves to every symbology (the specification's default, `all`).
    ///
    /// ```swift
    /// Symbology.resolve(["QRCode", "ean"])   // [.qr, .ean13]
    /// Symbology.resolve(["retail"])          // [.ean13, .ean8, .upca, .upce, .isbn, .databar, ...]
    /// ```
    public static func resolve(_ names: [String]) -> Set<Symbology> {
        if names.isEmpty { return all }
        var result = Set<Symbology>()
        for name in names {
            let key = normalize(name)
            if let group = groups[key] {
                result.formUnion(group)
            } else if let symbology = aliases[key] {
                result.insert(symbology)
            }
        }
        return result
    }

    /// Variadic convenience for ``resolve(_:)``.
    public static func resolve(_ names: String...) -> Set<Symbology> {
        resolve(names)
    }

    /// AIM symbology identifier (ISO/IEC 15424) for a code of this symbology, when known.
    ///
    /// - Parameter isGS1: whether the code carries GS1 data (changes the modifier, e.g. `]C1`).
    public func aimIdentifier(isGS1: Bool) -> String {
        switch self {
        case .qr, .microQR: return isGS1 ? "]Q3" : "]Q1"
        case .dataMatrix: return isGS1 ? "]d2" : "]d1"
        case .aztec: return isGS1 ? "]z1" : "]z0"
        case .pdf417, .microPDF417: return "]L2"
        case .maxicode: return "]U0"
        case .ean13, .upca, .upce, .isbn: return "]E0"
        case .ean8: return "]E4"
        case .code128: return isGS1 ? "]C1" : "]C0"
        case .code39: return "]A0"
        case .code93: return "]G0"
        case .codabar: return "]F0"
        case .itf: return "]I0"
        case .itf14: return "]I1"
        case .databar, .databarExpanded, .databarLimited: return "]e0"
        case .rmqr, .code32, .pzn, .telepen, .dxFilmEdge: return ""
        }
    }
}

// MARK: - Apple Vision mapping

#if canImport(Vision) && (os(iOS) || os(macOS))
extension Symbology {
    /// The Vision symbologies that must be requested to read this symbology.
    ///
    /// UPC-A and ISBN are reported by Vision as EAN-13, so they map to `.ean13`
    /// (see ``init(vision:payload:requested:)``). Symbologies Vision cannot read
    /// (`rmqr`, `maxicode`, `code32`, `pzn`, `telepen`, `dx-film-edge`) map to `[]`.
    ///
    /// `.microQR`, `.microPDF417`, `.codabar` and the `.gs1DataBar*` symbologies were added
    /// in iOS 15 / macOS 12 (Vision barcode revision 2). QRGenKit's minimum deployment
    /// targets are exactly iOS 15 and macOS 12, so they are always available and need no
    /// `#available` check; ``BarcodeScanner`` and ``QRGen/scan(image:orientation:symbologies:)``
    /// still intersect the list with `VNDetectBarcodesRequest.supportedSymbologies()` at
    /// runtime so an older request revision never receives an unknown symbology.
    public var visionSymbologies: [VNBarcodeSymbology] {
        switch self {
        case .qr: return [.qr]
        case .microQR: return [.microQR]
        case .dataMatrix: return [.dataMatrix]
        case .aztec: return [.aztec]
        case .pdf417: return [.pdf417]
        case .microPDF417: return [.microPDF417]
        case .ean13, .upca, .isbn: return [.ean13]
        case .ean8: return [.ean8]
        case .upce: return [.upce]
        case .code128: return [.code128]
        case .code39: return [.code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum]
        case .code93: return [.code93, .code93i]
        case .codabar: return [.codabar]
        case .itf: return [.i2of5, .i2of5Checksum, .itf14]
        case .itf14: return [.itf14]
        case .databar: return [.gs1DataBar]
        case .databarExpanded: return [.gs1DataBarExpanded]
        case .databarLimited: return [.gs1DataBarLimited]
        case .rmqr, .maxicode, .code32, .pzn, .telepen, .dxFilmEdge: return []
        }
    }

    /// Unique Vision symbologies needed to read every symbology in `set`, in a stable order.
    public static func visionSymbologies(for set: Set<Symbology>) -> [VNBarcodeSymbology] {
        var seen = Set<VNBarcodeSymbology>()
        var result: [VNBarcodeSymbology] = []
        for symbology in allCases where set.contains(symbology) {
            for vision in symbology.visionSymbologies where !seen.contains(vision) {
                seen.insert(vision)
                result.append(vision)
            }
        }
        return result
    }

    /// Maps a Vision symbology back to a QRGen symbology, taking the caller's request into account.
    ///
    /// Vision reports UPC-A as EAN-13 with a leading `0` and ISBN (Bookland) as EAN-13 with a
    /// `978`/`979` prefix. When the caller asked for `upca` or `isbn`, those codes are reported
    /// with the more specific id (UPC-A data is shortened to its 12 digits by the caller).
    /// Returns `nil` when the detected code is not part of `requested`.
    ///
    /// - Parameters:
    ///   - vision: the symbology reported by Vision.
    ///   - payload: the decoded text (used to tell EAN-13, UPC-A and ISBN apart).
    ///   - requested: the set the caller asked for.
    public init?(vision: VNBarcodeSymbology, payload: String, requested: Set<Symbology>) {
        let resolved: Symbology?
        switch vision {
        case .qr: resolved = .qr
        case .microQR: resolved = .microQR
        case .dataMatrix: resolved = .dataMatrix
        case .aztec: resolved = .aztec
        case .pdf417: resolved = .pdf417
        case .microPDF417: resolved = .microPDF417
        case .ean8: resolved = .ean8
        case .upce: resolved = .upce
        case .code128: resolved = .code128
        case .code39, .code39Checksum, .code39FullASCII, .code39FullASCIIChecksum: resolved = .code39
        case .code93, .code93i: resolved = .code93
        case .codabar: resolved = .codabar
        case .gs1DataBar: resolved = .databar
        case .gs1DataBarExpanded: resolved = .databarExpanded
        case .gs1DataBarLimited: resolved = .databarLimited
        case .itf14:
            resolved = requested.contains(.itf14) ? .itf14 : .itf
        case .i2of5, .i2of5Checksum:
            if requested.contains(.itf) {
                resolved = .itf
            } else if payload.count == 14 {
                resolved = .itf14
            } else {
                resolved = nil
            }
        case .ean13:
            let isDigits13 = payload.count == 13 && payload.allSatisfy(\.isASCIIDigit)
            if requested.contains(.isbn), isDigits13, payload.hasPrefix("978") || payload.hasPrefix("979") {
                resolved = .isbn
            } else if requested.contains(.upca), isDigits13, payload.hasPrefix("0") {
                resolved = .upca
            } else {
                resolved = .ean13
            }
        default:
            resolved = nil
        }
        guard let symbology = resolved, requested.contains(symbology) else { return nil }
        self = symbology
    }
}
#endif

extension Character {
    /// `true` for the ASCII digits `0`-`9` only (unlike `isNumber`, which accepts any script).
    var isASCIIDigit: Bool {
        guard let ascii = asciiValue else { return false }
        return ascii >= 48 && ascii <= 57
    }
}
