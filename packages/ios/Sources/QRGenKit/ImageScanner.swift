// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(Vision) && (os(iOS) || os(macOS))
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
#endif

/// Carries immutable, thread-safe Core Graphics objects (`CGImage`) into a background task.
private struct UncheckedSendable<Value>: @unchecked Sendable {
    let value: Value
}

extension QRGen {
    /// Scans a still image for barcodes with Apple Vision.
    ///
    /// ```swift
    /// let barcodes = try await QRGen.scan(image: cgImage, symbologies: ["qr", "ean13"])
    /// ```
    ///
    /// - Parameters:
    ///   - image: the image to scan.
    ///   - orientation: EXIF orientation of `image` (locations are reported in the upright image).
    ///   - symbologies: ids, aliases or groups (SPEC section 1). Default: all.
    /// - Returns: every code found, with ``Barcode/location`` in pixel coordinates of the upright image.
    /// - Throws: ``QRGenError/unsupported(_:)`` when no requested symbology can be read,
    ///   ``QRGenError/engineLoadFailed(_:)`` when Vision fails.
    public static func scan(
        image: CGImage,
        orientation: CGImagePropertyOrientation = .up,
        symbologies: [String] = ["all"]
    ) async throws -> [Barcode] {
        let requested = Symbology.resolve(symbologies)
        let box = UncheckedSendable(value: image)
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try scanSynchronously(box.value, orientation: orientation, requested: requested))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Scans encoded image data (PNG, JPEG, HEIC, ...), honouring its EXIF orientation.
    public static func scan(imageData: Data, symbologies: [String] = ["all"]) async throws -> [Barcode] {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw QRGenError.unknown("The data could not be decoded as an image.")
        }
        var orientation = CGImagePropertyOrientation.up
        if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let raw = properties[kCGImagePropertyOrientation] as? UInt32,
           let exif = CGImagePropertyOrientation(rawValue: raw) {
            orientation = exif
        }
        return try await scan(image: image, orientation: orientation, symbologies: symbologies)
    }

    /// Scans an image file on disk.
    public static func scan(contentsOf url: URL, symbologies: [String] = ["all"]) async throws -> [Barcode] {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw QRGenError.unknown("Could not read \(url.lastPathComponent): \(error.localizedDescription)")
        }
        return try await scan(imageData: data, symbologies: symbologies)
    }

    #if canImport(UIKit)
    /// Scans a `UIImage` (its `imageOrientation` is honoured).
    public static func scan(image: UIImage, symbologies: [String] = ["all"]) async throws -> [Barcode] {
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        if let cgImage = image.cgImage {
            return try await scan(image: cgImage, orientation: orientation, symbologies: symbologies)
        }
        if let ciImage = image.ciImage {
            let context = CIContext(options: nil)
            if let rendered = context.createCGImage(ciImage, from: ciImage.extent.integral) {
                return try await scan(image: rendered, orientation: orientation, symbologies: symbologies)
            }
        }
        throw QRGenError.unknown("The image has no bitmap representation.")
    }
    #endif

    #if canImport(AppKit) && !targetEnvironment(macCatalyst)
    /// Scans an `NSImage`.
    public static func scan(image: NSImage, symbologies: [String] = ["all"]) async throws -> [Barcode] {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw QRGenError.unknown("The image has no bitmap representation.")
        }
        return try await scan(image: cgImage, orientation: .up, symbologies: symbologies)
    }
    #endif

    /// Synchronous Vision pass (runs on the caller's thread).
    static func scanSynchronously(_ image: CGImage, orientation: CGImagePropertyOrientation, requested: Set<Symbology>) throws -> [Barcode] {
        let request = try VisionBarcodeMapper.makeRequest(for: requested)
        let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw QRGenError.engineLoadFailed("Vision barcode detection failed: \(error.localizedDescription)")
        }
        let rotated: Bool
        switch orientation {
        case .left, .leftMirrored, .right, .rightMirrored: rotated = true
        default: rotated = false
        }
        let size = rotated
            ? CGSize(width: image.height, height: image.width)
            : CGSize(width: image.width, height: image.height)
        return VisionBarcodeMapper.barcodes(
            from: request.results ?? [],
            requested: requested,
            imageSize: size,
            timestamp: Barcode.currentTimestamp()
        )
    }
}

#if canImport(UIKit)
extension CGImagePropertyOrientation {
    /// Maps `UIImage.Orientation` to the matching EXIF orientation.
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
#endif
#endif
