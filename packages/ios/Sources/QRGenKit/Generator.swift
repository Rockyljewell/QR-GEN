// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(CoreImage)
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
#endif

extension QRGen {
    /// Renders a barcode with Core Image.
    ///
    /// Supported symbologies: ``Symbology/qr``, ``Symbology/pdf417``, ``Symbology/aztec`` and
    /// ``Symbology/code128`` (see ``QRGen/writableSymbologies()``). Every module is scaled with
    /// nearest-neighbour sampling, so edges stay crisp at any `scale`.
    ///
    /// For every other symbology (EAN/UPC, Data Matrix, Code 39, ...) this throws
    /// ``QRGenError/unsupported(_:)``. Use the QRGen REST API instead: run `qrgen serve` (or the
    /// Docker image) and call `GET /v1/generate?data=...&symbology=ean13&format=png`, for example
    /// with ``generateRemotely(_:symbology:server:format:scale:ecLevel:)``.
    ///
    /// - Parameters:
    ///   - data: text to encode. Code 128 accepts ASCII only.
    ///   - symbology: what to render. Default QR.
    ///   - scale: pixels per module (clamped to 1...64). Default 8.
    ///   - ecLevel: QR: `"L"`, `"M"`, `"Q"`, `"H"` (default `"M"`). Aztec: error-correction percentage
    ///     `"5"`-`"95"` (non-numeric values keep Core Image's default of 23). PDF417: `"0"`-`"8"`.
    /// - Returns: a grayscale image, black modules on white, including the quiet zone Core Image adds.
    public static func generate(
        _ data: String,
        symbology: Symbology = .qr,
        scale: Int = 8,
        ecLevel: String = "M"
    ) throws -> CGImage {
        let filterName: String
        switch symbology {
        case .qr: filterName = "CIQRCodeGenerator"
        case .code128: filterName = "CICode128BarcodeGenerator"
        case .pdf417: filterName = "CIPDF417BarcodeGenerator"
        case .aztec: filterName = "CIAztecCodeGenerator"
        default:
            throw QRGenError.unsupported(
                "\(symbology.displayName) cannot be generated natively on Apple platforms. "
                + "Use the QRGen REST API (`qrgen serve`, GET /v1/generate?symbology=\(symbology.rawValue)) instead."
            )
        }
        guard let filter = CIFilter(name: filterName) else {
            throw QRGenError.engineLoadFailed("Core Image filter \(filterName) is not available.")
        }

        let message: Data
        if symbology == .code128 {
            guard let ascii = data.data(using: .ascii) else {
                throw QRGenError.unsupported("Code 128 can only encode ASCII text.")
            }
            message = ascii
        } else {
            message = Data(data.utf8)
        }
        filter.setValue(message, forKey: "inputMessage")

        let level = ecLevel.trimmingCharacters(in: .whitespaces).uppercased()
        switch symbology {
        case .qr:
            filter.setValue(["L", "M", "Q", "H"].contains(level) ? level : "M", forKey: "inputCorrectionLevel")
        case .aztec:
            if let percent = Double(level), (5...95).contains(percent) {
                filter.setValue(NSNumber(value: percent), forKey: "inputCorrectionLevel")
            }
        case .pdf417:
            if let pdfLevel = Int(level), (0...8).contains(pdfLevel) {
                filter.setValue(NSNumber(value: pdfLevel), forKey: "inputCorrectionLevel")
            }
        default:
            break
        }

        guard let output = filter.outputImage else {
            throw QRGenError.unknown("Core Image could not encode the data as \(symbology.displayName) (is it too long?).")
        }
        let extent = output.extent.integral
        guard !extent.isEmpty, !extent.isInfinite, extent.width < 10_000, extent.height < 10_000 else {
            throw QRGenError.unknown("Core Image produced an empty \(symbology.displayName) image.")
        }
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let base = context.createCGImage(output, from: extent) else {
            throw QRGenError.unknown("Core Image could not render the \(symbology.displayName) image.")
        }
        return try scaleNearestNeighbor(base, by: min(max(scale, 1), 64))
    }

    /// Same as ``generate(_:symbology:scale:ecLevel:)`` but returns PNG data.
    public static func generatePNG(
        _ data: String,
        symbology: Symbology = .qr,
        scale: Int = 8,
        ecLevel: String = "M"
    ) throws -> Data {
        let image = try generate(data, symbology: symbology, scale: scale, ecLevel: ecLevel)
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, "public.png" as CFString, 1, nil) else {
            throw QRGenError.unknown("Could not create a PNG encoder.")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw QRGenError.unknown("Could not encode the PNG.")
        }
        return output as Data
    }

    #if canImport(UIKit)
    /// Same as ``generate(_:symbology:scale:ecLevel:)`` but returns a `UIImage` (scale 1).
    public static func generateImage(
        _ data: String,
        symbology: Symbology = .qr,
        scale: Int = 8,
        ecLevel: String = "M"
    ) throws -> UIImage {
        UIImage(cgImage: try generate(data, symbology: symbology, scale: scale, ecLevel: ecLevel))
    }
    #endif

    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    /// Same as ``generate(_:symbology:scale:ecLevel:)`` but returns an `NSImage` (1 point per pixel).
    public static func generateImage(
        _ data: String,
        symbology: Symbology = .qr,
        scale: Int = 8,
        ecLevel: String = "M"
    ) throws -> NSImage {
        let image = try generate(data, symbology: symbology, scale: scale, ecLevel: ecLevel)
        return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
    }
    #endif

    /// Output formats of the REST generator.
    public enum RemoteImageFormat: String, Sendable {
        case png
        case svg
    }

    /// Generates any writable symbology (SPEC section 7) through a QRGen REST server
    /// (`qrgen serve` or the Docker image, SPEC section 6): `GET /v1/generate`.
    ///
    /// ```swift
    /// let png = try await QRGen.generateRemotely("5901234123457", symbology: .ean13,
    ///                                            server: URL(string: "http://localhost:8080")!)
    /// ```
    ///
    /// - Returns: the image bytes (PNG or SVG).
    public static func generateRemotely(
        _ data: String,
        symbology: Symbology = .qr,
        server: URL,
        format: RemoteImageFormat = .png,
        scale: Int = 4,
        ecLevel: String = "M"
    ) async throws -> Data {
        guard var components = URLComponents(url: server.appendingPathComponent("v1/generate"), resolvingAgainstBaseURL: false) else {
            throw QRGenError.unknown("Invalid server URL: \(server.absoluteString)")
        }
        components.queryItems = [
            URLQueryItem(name: "data", value: data),
            URLQueryItem(name: "symbology", value: symbology.rawValue),
            URLQueryItem(name: "format", value: format.rawValue),
            URLQueryItem(name: "scale", value: String(scale)),
            URLQueryItem(name: "ecLevel", value: ecLevel),
        ]
        // URLComponents leaves "+" alone, which servers decode as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let url = components.url else {
            throw QRGenError.unknown("Could not build the /v1/generate URL.")
        }
        let (body, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw QRGenError.unknown("Unexpected response from \(url.host ?? "server").")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: body, encoding: .utf8) ?? ""
            throw QRGenError.unknown("QRGen server returned HTTP \(http.statusCode). \(message)")
        }
        return body
    }

    /// Scales a 1-pixel-per-module image with nearest-neighbour sampling onto a white background.
    static func scaleNearestNeighbor(_ image: CGImage, by scale: Int) throws -> CGImage {
        let width = image.width * scale
        let height = image.height * scale
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            throw QRGenError.unknown("Could not create a bitmap context.")
        }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(rect)
        context.interpolationQuality = .none
        context.setShouldAntialias(false)
        context.draw(image, in: rect)
        guard let scaled = context.makeImage() else {
            throw QRGenError.unknown("Could not render the scaled image.")
        }
        return scaled
    }
}
#endif
