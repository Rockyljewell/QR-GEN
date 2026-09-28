// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Errors reported by QRGenKit. ``code`` returns the cross-platform error code (SPEC section 4).
public enum QRGenError: Error, Equatable, Hashable, Sendable {
    /// The user denied (or a policy restricts) camera access. Code `camera-permission-denied`.
    case cameraPermissionDenied
    /// No camera matches the requested position or device id. Code `camera-not-found`.
    case cameraNotFound
    /// The camera is in use by another app or unavailable (e.g. iPad multitasking). Code `camera-in-use`.
    case cameraInUse
    /// Only meaningful in web contexts; kept for parity with the other SDKs. Code `insecure-context`.
    case insecureContext
    /// The recognition engine (Vision / Core Image) could not be used. Code `engine-load-failed`.
    case engineLoadFailed(String)
    /// The requested feature or symbology is not supported on this platform. Code `unsupported`.
    case unsupported(String)
    /// Anything else. Code `unknown`.
    case unknown(String)

    /// Cross-platform error code, e.g. `"camera-permission-denied"`.
    public var code: String {
        switch self {
        case .cameraPermissionDenied: return "camera-permission-denied"
        case .cameraNotFound: return "camera-not-found"
        case .cameraInUse: return "camera-in-use"
        case .insecureContext: return "insecure-context"
        case .engineLoadFailed: return "engine-load-failed"
        case .unsupported: return "unsupported"
        case .unknown: return "unknown"
        }
    }

    /// Human readable description.
    public var message: String {
        switch self {
        case .cameraPermissionDenied:
            return "Camera access was denied. Enable it in Settings to scan codes."
        case .cameraNotFound:
            return "No camera was found for the requested position or device."
        case .cameraInUse:
            return "The camera is in use by another app or is currently unavailable."
        case .insecureContext:
            return "The camera requires a secure context."
        case .engineLoadFailed(let detail),
             .unsupported(let detail),
             .unknown(let detail):
            return detail
        }
    }

    /// Creates an error from a cross-platform code (unknown codes map to ``unknown(_:)``).
    public init(code: String, message: String) {
        switch code {
        case "camera-permission-denied": self = .cameraPermissionDenied
        case "camera-not-found": self = .cameraNotFound
        case "camera-in-use": self = .cameraInUse
        case "insecure-context": self = .insecureContext
        case "engine-load-failed": self = .engineLoadFailed(message)
        case "unsupported": self = .unsupported(message)
        default: self = .unknown(message)
        }
    }

    /// `{ "code": ..., "message": ... }` as used by the `error` event of the other SDKs.
    public var dictionary: [String: String] { ["code": code, "message": message] }
}

extension QRGenError: LocalizedError {
    public var errorDescription: String? { message }
}

extension QRGenError: CustomNSError {
    public static var errorDomain: String { "dev.qrgen" }

    public var errorCode: Int {
        switch self {
        case .cameraPermissionDenied: return 1
        case .cameraNotFound: return 2
        case .cameraInUse: return 3
        case .insecureContext: return 4
        case .engineLoadFailed: return 5
        case .unsupported: return 6
        case .unknown: return 7
        }
    }

    public var errorUserInfo: [String: Any] {
        [NSLocalizedDescriptionKey: message, "code": code]
    }
}

extension QRGenError: CustomStringConvertible {
    public var description: String { "QRGenError(\(code)): \(message)" }
}
