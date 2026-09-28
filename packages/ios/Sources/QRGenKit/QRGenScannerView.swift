// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(SwiftUI) && canImport(UIKit) && canImport(AVFoundation) && canImport(Vision) && os(iOS)
import SwiftUI
import UIKit

/// SwiftUI camera scanner, wrapping ``QRGenScannerViewController``.
///
/// ```swift
/// QRGenScannerView(options: .init(symbologies: ["qr", "ean13"], mode: .single)) { barcodes in
///     result = barcodes.first
/// }
/// .onError { error in message = error.message }
/// .onClose { isScanning = false }
/// .ignoresSafeArea()
/// ```
///
/// Call the scanner modifiers (`onError`, `onTrack`, `onClose`, `scannerAccentColor`) before
/// generic SwiftUI modifiers such as `ignoresSafeArea()`. Changing `options` updates the running
/// scanner. The close button is only shown when an `onClose` action is set.
public struct QRGenScannerView: UIViewControllerRepresentable {
    public typealias UIViewControllerType = QRGenScannerViewController

    private let options: ScannerOptions
    private let scanHandler: @MainActor ([Barcode]) -> Void
    private var trackHandler: (@MainActor ([TrackedBarcode]) -> Void)?
    private var errorHandler: (@MainActor (QRGenError) -> Void)?
    private var closeHandler: (@MainActor () -> Void)?
    private var accentColor: UIColor = QRGenScannerViewController.defaultAccentColor
    private var showsTorchButton = true
    private var showsToast = true

    /// Creates a scanner view.
    ///
    /// - Parameters:
    ///   - options: scanner options (SPEC section 4). Default: all symbologies, continuous mode.
    ///   - onScan: called on the main actor with newly scanned codes.
    public init(options: ScannerOptions = ScannerOptions(), onScan: @escaping @MainActor ([Barcode]) -> Void) {
        self.options = options
        self.scanHandler = onScan
    }

    /// Called on errors such as ``QRGenError/cameraPermissionDenied``.
    public func onError(_ action: @escaping @MainActor (QRGenError) -> Void) -> QRGenScannerView {
        var copy = self
        copy.errorHandler = action
        return copy
    }

    /// Batch mode: called with every live track on each processed frame.
    public func onTrack(_ action: @escaping @MainActor ([TrackedBarcode]) -> Void) -> QRGenScannerView {
        var copy = self
        copy.trackHandler = action
        return copy
    }

    /// Shows a close button and calls `action` when it is tapped.
    public func onClose(_ action: @escaping @MainActor () -> Void) -> QRGenScannerView {
        var copy = self
        copy.closeHandler = action
        return copy
    }

    /// Viewfinder, highlight and toast accent color. Default QRGen teal `#2EC1CE`.
    public func scannerAccentColor(_ color: UIColor) -> QRGenScannerView {
        var copy = self
        copy.accentColor = color
        return copy
    }

    /// Viewfinder, highlight and toast accent color from a SwiftUI `Color`.
    public func scannerAccentColor(_ color: Color) -> QRGenScannerView {
        scannerAccentColor(UIColor(color))
    }

    /// Hides or shows the torch button and the success toast.
    public func scannerControls(torchButton: Bool = true, toast: Bool = true) -> QRGenScannerView {
        var copy = self
        copy.showsTorchButton = torchButton
        copy.showsToast = toast
        return copy
    }

    public final class Coordinator {
        var appliedOptions: ScannerOptions

        init(options: ScannerOptions) {
            self.appliedOptions = options
        }
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(options: options)
    }

    @MainActor
    public func makeUIViewController(context: Context) -> QRGenScannerViewController {
        let controller = QRGenScannerViewController(options: options, accentColor: accentColor)
        apply(to: controller)
        return controller
    }

    @MainActor
    public func updateUIViewController(_ controller: QRGenScannerViewController, context: Context) {
        apply(to: controller)
        // Only push options SwiftUI changed, so internal changes (e.g. switchCamera) are kept.
        if context.coordinator.appliedOptions != options {
            context.coordinator.appliedOptions = options
            controller.update(options: options)
        }
    }

    @MainActor
    public static func dismantleUIViewController(_ controller: QRGenScannerViewController, coordinator: Coordinator) {
        controller.scanner.stop()
    }

    @MainActor
    private func apply(to controller: QRGenScannerViewController) {
        controller.onScan = scanHandler
        controller.onTrack = trackHandler
        controller.onError = errorHandler
        controller.onClose = closeHandler
        controller.showsCloseButton = closeHandler != nil
        controller.showsTorchButton = showsTorchButton
        controller.showsToast = showsToast
        if controller.accentColor != accentColor {
            controller.accentColor = accentColor
        }
    }
}
#endif
