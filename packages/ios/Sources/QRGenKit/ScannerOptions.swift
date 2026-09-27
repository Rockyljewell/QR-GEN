#if canImport(CoreGraphics)
import Foundation
#else
// swift-corelibs-foundation (Linux) does not mark CGRect as Sendable; Apple platforms do.
@preconcurrency import Foundation
#endif

/// Camera scanner options (SPEC section 4). All defaults match the other QRGen SDKs.
///
/// ```swift
/// let options = ScannerOptions(symbologies: ["qr", "ean13"], mode: .single)
/// ```
public struct ScannerOptions: Equatable, Sendable {
    /// Scanning mode.
    public enum Mode: String, Codable, CaseIterable, Sendable {
        /// Stop processing after the first scan (the preview keeps running; call `resume()` to scan again).
        case single
        /// Keep scanning and report every new code (subject to ``ScannerOptions/duplicateFilter``).
        case continuous
        /// Track many codes at once and report them through `track` events.
        case batch
    }

    /// Camera selection.
    public enum Camera: Equatable, Hashable, Sendable {
        /// The back camera (default).
        case back
        /// The front (selfie) camera.
        case front
        /// A specific capture device, identified by `AVCaptureDevice.uniqueID`.
        case device(id: String)

        /// `"back"`, `"front"` or the device id, as in the other SDKs.
        public var id: String {
            switch self {
            case .back: return "back"
            case .front: return "front"
            case .device(let id): return id
            }
        }

        /// Parses `"back"`, `"front"` or a device id.
        public init(id: String) {
            switch id.lowercased() {
            case "back", "rear", "environment": self = .back
            case "front", "user", "selfie": self = .front
            default: self = .device(id: id)
            }
        }
    }

    /// Overlay style drawn by `QRGenScannerViewController`.
    public enum Viewfinder: String, Codable, CaseIterable, Sendable {
        /// Rounded corner brackets around the scan area.
        case frame
        /// A horizontal laser-style line, suited to 1D barcodes.
        case line
        /// No overlay.
        case none
    }

    /// Symbology ids, aliases or groups (SPEC section 1). Default `["all"]`.
    public var symbologies: [String]
    /// Scanning mode. Default ``Mode/continuous``.
    public var mode: Mode
    /// Duplicate filter window in milliseconds. Default `1000`.
    ///
    /// The same symbology + data is not reported again within this window after it was reported.
    /// `0` reports the code on every processed frame, `-1` reports it once per session
    /// (until the scanner is stopped and started again).
    public var duplicateFilter: Int
    /// Play a short tone on scan. Default `true`.
    public var beep: Bool
    /// Haptic feedback on scan. Default `true`.
    public var vibrate: Bool
    /// Camera to use. Default ``Camera/back``.
    public var camera: Camera
    /// Turn the flashlight on when the scanner starts. Default `false`.
    public var torch: Bool
    /// Overlay style. `nil` (default) means ``Viewfinder/frame``, or ``Viewfinder/line`` when every
    /// requested symbology is linear. See ``resolvedViewfinder``.
    public var viewfinder: Viewfinder?
    /// Region of interest, normalized to `0...1` with the origin at the top-left of the visible
    /// preview. `nil` (default) scans the full visible frame.
    ///
    /// `QRGenScannerViewController` maps it through the preview layer, so it matches what the user
    /// sees. When ``BarcodeScanner`` is used without that view controller it is interpreted relative
    /// to the upright (portrait on iOS) camera frame; call `BarcodeScanner.setRegionOfInterest(_:)`
    /// for exact capture-device coordinates.
    public var scanArea: CGRect?
    /// Maximum number of codes reported per frame. `nil` (default) means `1`, or `20` in batch mode.
    /// See ``resolvedMaxResults``.
    public var maxResults: Int?

    /// Creates scanner options. Every parameter defaults to the cross-platform default.
    public init(
        symbologies: [String] = ["all"],
        mode: Mode = .continuous,
        duplicateFilter: Int = 1000,
        beep: Bool = true,
        vibrate: Bool = true,
        camera: Camera = .back,
        torch: Bool = false,
        viewfinder: Viewfinder? = nil,
        scanArea: CGRect? = nil,
        maxResults: Int? = nil
    ) {
        self.symbologies = symbologies
        self.mode = mode
        self.duplicateFilter = duplicateFilter
        self.beep = beep
        self.vibrate = vibrate
        self.camera = camera
        self.torch = torch
        self.viewfinder = viewfinder
        self.scanArea = scanArea
        self.maxResults = maxResults
    }

    /// Creates scanner options from typed symbologies, e.g. `ScannerOptions(symbologies: [.qr, .ean13])`.
    @_disfavoredOverload
    public init(
        symbologies: [Symbology],
        mode: Mode = .continuous,
        duplicateFilter: Int = 1000,
        beep: Bool = true,
        vibrate: Bool = true,
        camera: Camera = .back,
        torch: Bool = false,
        viewfinder: Viewfinder? = nil,
        scanArea: CGRect? = nil,
        maxResults: Int? = nil
    ) {
        self.init(
            symbologies: symbologies.map(\.rawValue),
            mode: mode,
            duplicateFilter: duplicateFilter,
            beep: beep,
            vibrate: vibrate,
            camera: camera,
            torch: torch,
            viewfinder: viewfinder,
            scanArea: scanArea,
            maxResults: maxResults
        )
    }

    /// ``symbologies`` resolved through ``Symbology/resolve(_:)``.
    public var resolvedSymbologies: Set<Symbology> { Symbology.resolve(symbologies) }

    /// The effective overlay style (``viewfinder`` or the automatic default).
    public var resolvedViewfinder: Viewfinder {
        if let viewfinder { return viewfinder }
        let requested = resolvedSymbologies
        return !requested.isEmpty && requested.isSubset(of: Symbology.linear) ? .line : .frame
    }

    /// The effective per-frame result limit (at least 1).
    public var resolvedMaxResults: Int {
        max(1, maxResults ?? (mode == .batch ? 20 : 1))
    }

    /// ``scanArea`` clamped to the unit square, or `nil` when it is absent or empty.
    public var normalizedScanArea: CGRect? {
        guard let area = scanArea else { return nil }
        let minX = min(max(Double(area.minX), 0), 1)
        let minY = min(max(Double(area.minY), 0), 1)
        let maxX = min(max(Double(area.maxX), 0), 1)
        let maxY = min(max(Double(area.maxY), 0), 1)
        guard maxX > minX, maxY > minY else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}
