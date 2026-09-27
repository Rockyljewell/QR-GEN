#if canImport(Vision) && (os(iOS) || os(macOS))
import CoreGraphics
import CoreImage
import Foundation
import Vision

/// Converts Vision observations into ``Barcode`` values (shared by the camera and image scanners).
enum VisionBarcodeMapper {
    /// Creates a barcode request limited to `symbologies`, intersected with what the running OS supports.
    ///
    /// - Throws: ``QRGenError/unsupported(_:)`` when none of the requested symbologies can be read.
    static func makeRequest(for symbologies: Set<Symbology>) throws -> VNDetectBarcodesRequest {
        let request = VNDetectBarcodesRequest()
        let wanted = Symbology.visionSymbologies(for: symbologies)
        let supported = Set((try? request.supportedSymbologies()) ?? wanted)
        let usable = wanted.filter { supported.contains($0) }
        guard !usable.isEmpty else {
            let ids = symbologies.map(\.rawValue).sorted().joined(separator: ", ")
            throw QRGenError.unsupported("None of the requested symbologies (\(ids.isEmpty ? "none" : ids)) can be read with Apple Vision on this device.")
        }
        request.symbologies = usable
        return request
    }

    /// Maps observations to barcodes.
    ///
    /// - Parameters:
    ///   - observations: results of a `VNDetectBarcodesRequest`.
    ///   - requested: the caller's symbologies (used for the EAN-13 / UPC-A / ISBN split).
    ///   - imageSize: pixel size of the image in the orientation given to Vision.
    ///   - regionOfInterest: the request's region of interest (Vision coordinates, origin bottom-left).
    ///     Vision reports observations relative to it; they are converted back to the full image.
    ///   - timestamp: detection time in ms since epoch.
    static func barcodes(
        from observations: [VNBarcodeObservation],
        requested: Set<Symbology>,
        imageSize: CGSize,
        regionOfInterest: CGRect = CGRect(x: 0, y: 0, width: 1, height: 1),
        timestamp: Int64
    ) -> [Barcode] {
        var seen = Set<String>()
        var result: [Barcode] = []
        for observation in observations {
            guard let barcode = barcode(from: observation, requested: requested, imageSize: imageSize,
                                        regionOfInterest: regionOfInterest, timestamp: timestamp) else { continue }
            // Vision sometimes reports the same symbol twice (e.g. once per matching symbology variant).
            let key = barcode.dedupeKey + "@\(Int(barcode.location.center.x / 8)),\(Int(barcode.location.center.y / 8))"
            guard seen.insert(key).inserted else { continue }
            result.append(barcode)
        }
        return result
    }

    static func barcode(
        from observation: VNBarcodeObservation,
        requested: Set<Symbology>,
        imageSize: CGSize,
        regionOfInterest: CGRect,
        timestamp: Int64
    ) -> Barcode? {
        var payloadData: Data?
        var reportsGS1 = false
        if #available(iOS 17.0, macOS 14.0, *) {
            payloadData = observation.payloadData
            reportsGS1 = observation.isGS1DataCarrier
        }
        let payloadString = observation.payloadStringValue
        let text: String
        var contentType: Barcode.ContentType = .text
        if let payloadString {
            text = payloadString
        } else if let payloadData, !payloadData.isEmpty {
            if let utf8 = String(data: payloadData, encoding: .utf8) {
                text = utf8
            } else {
                text = String(data: payloadData, encoding: .isoLatin1) ?? ""
                contentType = .binary
            }
        } else {
            return nil
        }

        guard let symbology = Symbology(vision: observation.symbology, payload: text, requested: requested) else {
            return nil
        }
        var data = text
        if symbology == .upca, data.count == 13, data.hasPrefix("0") {
            data.removeFirst()
        }

        // GS1: DataBar always carries GS1 data; iOS 17+ reports FNC1 for the other symbologies, and some
        // payloads carry a GS1 AIM symbology identifier.
        let isDataBar = symbology == .databar || symbology == .databarExpanded || symbology == .databarLimited
        let hasGS1Identifier = ["]C1", "]d2", "]Q3", "]e0", "]J1"].contains { data.hasPrefix($0) }
        var isGS1 = reportsGS1 || isDataBar || hasGS1Identifier
        if isGS1 {
            var candidate = data
            if isDataBar, data.count == 14 || data.count == 13, data.allSatisfy(\.isASCIIDigit) {
                candidate = "01" + String(repeating: "0", count: 14 - data.count) + data
            }
            if let gs1 = QRGen.parseGS1(candidate) {
                data = gs1.hri
            } else if !isDataBar {
                isGS1 = false
            }
        }
        if isGS1 {
            contentType = .gs1
        } else if data.hasPrefix("[)>\u{1E}") {
            contentType = .iso15434
        }
        let raw = payloadData.map { $0.base64EncodedString() } ?? Data(text.utf8).base64EncodedString()

        let width = Double(imageSize.width)
        let height = Double(imageSize.height)
        func pixel(_ point: CGPoint) -> Barcode.Point {
            let x = Double(regionOfInterest.minX + point.x * regionOfInterest.width)
            let y = Double(regionOfInterest.minY + point.y * regionOfInterest.height)
            return Barcode.Point(x: x * width, y: (1 - y) * height)
        }
        let location = Barcode.Quadrilateral(
            topLeft: pixel(observation.topLeft),
            topRight: pixel(observation.topRight),
            bottomRight: pixel(observation.bottomRight),
            bottomLeft: pixel(observation.bottomLeft)
        )

        return Barcode(
            data: data,
            symbology: symbology,
            rawBytes: raw,
            contentType: contentType,
            isGS1: isGS1,
            location: location,
            frameSize: Barcode.Size(width: width, height: height),
            orientation: orientation(of: location),
            ecLevel: errorCorrectionLevel(observation.barcodeDescriptor),
            symbologyIdentifier: symbology.aimIdentifier(isGS1: isGS1),
            timestamp: timestamp
        )
    }

    /// Angle of the top edge in degrees, clockwise, 0...359.
    static func orientation(of quad: Barcode.Quadrilateral) -> Int {
        let dx = quad.topRight.x - quad.topLeft.x
        let dy = quad.topRight.y - quad.topLeft.y
        guard dx != 0 || dy != 0 else { return 0 }
        var degrees = atan2(dy, dx) * 180 / .pi
        if degrees < 0 { degrees += 360 }
        return Int(degrees.rounded()) % 360
    }

    /// QR error-correction level from Core Image's descriptor (`"L"`, `"M"`, `"Q"`, `"H"`), else `""`.
    static func errorCorrectionLevel(_ descriptor: CIBarcodeDescriptor?) -> String {
        guard let qr = descriptor as? CIQRCodeDescriptor else { return "" }
        // The enum's raw values are the ASCII codes of the level letters.
        let raw = qr.errorCorrectionLevel.rawValue
        guard let scalar = Unicode.Scalar(UInt32(clamping: raw)), "LMQH".unicodeScalars.contains(scalar) else { return "" }
        return String(Character(scalar))
    }
}
#endif
