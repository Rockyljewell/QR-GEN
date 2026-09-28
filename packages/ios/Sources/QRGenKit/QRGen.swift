// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation
#if canImport(Vision) && (os(iOS) || os(macOS))
import Vision
#endif

/// Namespace and facade of QRGenKit.
///
/// ```swift
/// import QRGenKit
///
/// let codes = try await QRGen.scan(image: cgImage, symbologies: ["qr", "ean13"])
/// let image = try QRGen.generate("https://example.com")
/// let content = QRGen.parseContent("WIFI:T:WPA;S:Home;P:secret;;")
/// ```
///
/// Camera scanning lives in ``BarcodeScanner`` (engine) and `QRGenScannerViewController` /
/// `QRGenScannerView` (ready-made UI, iOS).
public enum QRGen {
    /// Version of QRGenKit.
    public static let version = "1.0.0"

    /// Symbologies this device can read, in SPEC order.
    ///
    /// On iOS / macOS this is every symbology Apple Vision supports at runtime (UPC-A and ISBN are
    /// derived from EAN-13). The platform-independent build (e.g. Linux, used for tests) returns `[]`.
    public static func supportedSymbologies() -> [Symbology] {
        #if canImport(Vision) && (os(iOS) || os(macOS))
        let request = VNDetectBarcodesRequest()
        let supported = Set((try? request.supportedSymbologies()) ?? [])
        return Symbology.allCases.filter { symbology in
            symbology.visionSymbologies.contains { supported.contains($0) }
        }
        #else
        return []
        #endif
    }

    /// Symbologies ``generate(_:symbology:scale:ecLevel:)`` can render on this device
    /// (Core Image: QR, PDF417, Aztec and Code 128). Use the REST API (`qrgen serve`) for the rest.
    public static func writableSymbologies() -> [Symbology] {
        #if canImport(CoreImage)
        return [.qr, .pdf417, .aztec, .code128]
        #else
        return []
        #endif
    }

    /// Resolves ids, aliases and groups; same as ``Symbology/resolve(_:)``.
    public static func resolveSymbologies(_ names: [String]) -> Set<Symbology> {
        Symbology.resolve(names)
    }
}
