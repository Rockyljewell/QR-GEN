#if canImport(UIKit) && canImport(AVFoundation) && canImport(Vision) && os(iOS)
import AVFoundation
import UIKit

/// A ready-made, full-screen camera scanner: live preview, viewfinder, animated highlights on
/// detected codes, a torch button, a close button and a success toast.
///
/// ```swift
/// let scanner = QRGenScannerViewController(options: ScannerOptions(symbologies: ["qr", "ean13"], mode: .single))
/// scanner.onScan = { barcodes in
///     print(barcodes[0].data)
///     scanner.dismiss(animated: true)
/// }
/// present(scanner, animated: true)
/// ```
///
/// The scanner starts in `viewWillAppear` and stops in `viewDidDisappear`. Add
/// `NSCameraUsageDescription` to your Info.plist.
@MainActor
open class QRGenScannerViewController: UIViewController {
    /// QRGen teal, `#2EC1CE`.
    public nonisolated static var defaultAccentColor: UIColor {
        UIColor(red: 46.0 / 255.0, green: 193.0 / 255.0, blue: 206.0 / 255.0, alpha: 1)
    }

    /// The engine. Use it for torch, zoom, pause / resume, or to set a delegate.
    public let scanner: BarcodeScanner

    /// Color of the viewfinder, highlights and toast icon.
    public var accentColor: UIColor {
        didSet { if isViewLoaded { applyAccentColor() } }
    }
    /// Newly scanned codes (after the duplicate filter).
    public var onScan: (@MainActor ([Barcode]) -> Void)?
    /// Batch mode: every live track, on each processed frame.
    public var onTrack: (@MainActor ([TrackedBarcode]) -> Void)?
    /// Errors, e.g. ``QRGenError/cameraPermissionDenied``.
    public var onError: (@MainActor (QRGenError) -> Void)?
    /// Close button action. When `nil`, the controller dismisses itself (or pops from its navigation controller).
    public var onClose: (@MainActor () -> Void)?

    /// Shows the close button (top left). Default `true`.
    public var showsCloseButton = true {
        didSet { if isViewLoaded { updateControls() } }
    }
    /// Shows the torch button (bottom centre) when the camera has a torch. Default `true`.
    public var showsTorchButton = true {
        didSet { if isViewLoaded { updateControls() } }
    }
    /// Shows the success toast with the symbology name and data. Default `true`.
    public var showsToast = true
    /// Draws animated quads on detected codes. Default `true`.
    public var showsHighlights = true
    /// How long the toast stays visible, in seconds. Default 2.
    public var toastDuration: TimeInterval = 2
    /// Starts the scanner in `viewWillAppear`. Default `true`.
    public var startsAutomatically = true

    private let previewView = CameraPreviewView()
    private let overlayView = UIView()
    private let dimmingLayer = CAShapeLayer()
    private let viewfinderLayer = CAShapeLayer()
    private let scanLineLayer = CAShapeLayer()
    private let highlightLayer = CALayer()
    private let closeButton = ScannerControlButton(systemImageName: "xmark", diameter: 44)
    private let torchButton = ScannerControlButton(systemImageName: "flashlight.off.fill", diameter: 56)
    private let toastView = ScanToastView()
    private let permissionView = CameraPermissionView()

    private var highlights: [String: Highlight] = [:]
    private var pruneTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?

    private final class Highlight {
        let layer: CAShapeLayer
        var lastSeen: CFTimeInterval

        init(layer: CAShapeLayer, lastSeen: CFTimeInterval) {
            self.layer = layer
            self.lastSeen = lastSeen
        }
    }

    // MARK: Init

    /// Creates a scanner screen.
    ///
    /// - Parameters:
    ///   - options: scanner options (SPEC section 4).
    ///   - accentColor: viewfinder / highlight color. Default QRGen teal `#2EC1CE`.
    public init(options: ScannerOptions = ScannerOptions(), accentColor: UIColor = QRGenScannerViewController.defaultAccentColor) {
        self.scanner = BarcodeScanner(options: options)
        self.accentColor = accentColor
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    public required init?(coder: NSCoder) {
        self.scanner = BarcodeScanner()
        self.accentColor = QRGenScannerViewController.defaultAccentColor
        super.init(coder: coder)
        modalPresentationStyle = .fullScreen
    }

    // MARK: Public API

    /// Applies new options (symbologies, mode, viewfinder, scan area, ...).
    public func update(options: ScannerOptions) {
        scanner.update(options: options)
        if isViewLoaded {
            view.setNeedsLayout()
        }
    }

    /// Resumes scanning, e.g. after a single-mode scan.
    public func resumeScanning() {
        clearHighlights()
        scanner.resume()
    }

    // MARK: Lifecycle

    open override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    open override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        overrideUserInterfaceStyle = .dark

        previewView.frame = view.bounds
        previewView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        previewView.videoPreviewLayer.videoGravity = .resizeAspectFill
        previewView.videoPreviewLayer.session = scanner.captureSession
        view.addSubview(previewView)

        overlayView.frame = view.bounds
        overlayView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlayView.isUserInteractionEnabled = false
        view.addSubview(overlayView)

        dimmingLayer.fillRule = .evenOdd
        dimmingLayer.fillColor = UIColor(white: 0, alpha: 0.45).cgColor
        viewfinderLayer.fillColor = UIColor.clear.cgColor
        viewfinderLayer.lineWidth = 5
        viewfinderLayer.lineCap = .round
        viewfinderLayer.lineJoin = .round
        scanLineLayer.fillColor = UIColor.clear.cgColor
        scanLineLayer.lineWidth = 2.5
        scanLineLayer.lineCap = .round
        scanLineLayer.shadowOffset = .zero
        scanLineLayer.shadowRadius = 6
        scanLineLayer.shadowOpacity = 0.9
        for layer in [dimmingLayer, viewfinderLayer, scanLineLayer, highlightLayer] {
            overlayView.layer.addSublayer(layer)
        }

        setUpControls()
        applyAccentColor()
        bindScanner()
        updateControls()
    }

    open override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if startsAutomatically {
            scanner.start()
        }
        startPruningHighlights()
    }

    open override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        scanner.stop()
        pruneTask?.cancel()
        pruneTask = nil
        toastTask?.cancel()
        toastTask = nil
        clearHighlights()
        updateTorchButton(isOn: false)
    }

    open override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateVideoOrientation()
        layoutOverlay()
        updateRegionOfInterest()
    }

    // MARK: Scanner events

    private func bindScanner() {
        scanner.onReady = { [weak self] in self?.scannerDidBecomeReady() }
        scanner.onDetections = { [weak self] barcodes in self?.showHighlights(for: barcodes) }
        scanner.onTrack = { [weak self] tracked in self?.handleTracked(tracked) }
        scanner.onScan = { [weak self] barcodes in self?.handleScan(barcodes) }
        scanner.onError = { [weak self] error in self?.handleError(error) }
    }

    private func scannerDidBecomeReady() {
        permissionView.isHidden = true
        updateControls()
        updateVideoOrientation()
        updateRegionOfInterest()
    }

    private func handleScan(_ barcodes: [Barcode]) {
        if showsToast {
            showToast(for: barcodes)
        }
        onScan?(barcodes)
    }

    private func handleTracked(_ tracked: [TrackedBarcode]) {
        if showsHighlights, let newest = tracked.map(\.lastSeen).max() {
            for item in tracked where item.lastSeen == newest {
                updateHighlight(key: "track-" + item.id, barcode: item.barcode)
            }
        }
        onTrack?(tracked)
    }

    private func handleError(_ error: QRGenError) {
        if error == .cameraPermissionDenied {
            permissionView.isHidden = false
            view.bringSubviewToFront(permissionView)
        }
        onError?(error)
    }

    // MARK: Controls

    private func setUpControls() {
        closeButton.accessibilityLabel = "Close"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        torchButton.accessibilityLabel = "Flashlight"
        torchButton.addTarget(self, action: #selector(torchTapped), for: .touchUpInside)
        permissionView.settingsButton.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        toastView.isHidden = true
        permissionView.isHidden = true

        for control in [closeButton, torchButton, toastView, permissionView] as [UIView] {
            control.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(control)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            closeButton.topAnchor.constraint(equalTo: guide.topAnchor, constant: 12),

            torchButton.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            torchButton.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -28),

            toastView.topAnchor.constraint(equalTo: closeButton.bottomAnchor, constant: 14),
            toastView.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            toastView.leadingAnchor.constraint(greaterThanOrEqualTo: guide.leadingAnchor, constant: 16),
            toastView.trailingAnchor.constraint(lessThanOrEqualTo: guide.trailingAnchor, constant: -16),

            permissionView.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            permissionView.centerYAnchor.constraint(equalTo: guide.centerYAnchor),
            permissionView.leadingAnchor.constraint(greaterThanOrEqualTo: guide.leadingAnchor, constant: 32),
            permissionView.trailingAnchor.constraint(lessThanOrEqualTo: guide.trailingAnchor, constant: -32),
        ])
    }

    private func updateControls() {
        closeButton.isHidden = !showsCloseButton
        torchButton.isHidden = !showsTorchButton || !scanner.hasTorch
    }

    private func updateTorchButton(isOn: Bool) {
        torchButton.setSymbol(isOn ? "flashlight.on.fill" : "flashlight.off.fill")
        torchButton.isSelected = isOn
        torchButton.accessibilityValue = isOn ? "On" : "Off"
    }

    private func applyAccentColor() {
        viewfinderLayer.strokeColor = accentColor.cgColor
        scanLineLayer.strokeColor = accentColor.cgColor
        scanLineLayer.shadowColor = accentColor.cgColor
        for highlight in highlights.values {
            style(highlight.layer)
        }
        permissionView.settingsButton.tintColor = accentColor
        toastView.accentColor = accentColor
    }

    @objc private func closeTapped() {
        if let onClose {
            onClose()
        } else if presentingViewController != nil {
            dismiss(animated: true)
        } else {
            navigationController?.popViewController(animated: true)
        }
    }

    @objc private func torchTapped() {
        scanner.setTorch(!scanner.isTorchOn) { [weak self] isOn in
            self?.updateTorchButton(isOn: isOn)
        }
    }

    @objc private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        view.window?.windowScene?.open(url, options: nil, completionHandler: nil)
    }

    // MARK: Layout

    private var resolvedViewfinder: ScannerOptions.Viewfinder { scanner.options.resolvedViewfinder }

    /// The scan area in overlay coordinates.
    private func scanRect(in bounds: CGRect) -> CGRect {
        if let area = scanner.options.normalizedScanArea {
            return CGRect(
                x: bounds.minX + area.minX * bounds.width,
                y: bounds.minY + area.minY * bounds.height,
                width: area.width * bounds.width,
                height: area.height * bounds.height
            )
        }
        let safe = bounds.inset(by: view.safeAreaInsets)
        switch resolvedViewfinder {
        case .line:
            let width = min(safe.width * 0.86, 560)
            let height = min(width * 0.45, safe.height * 0.35)
            return CGRect(x: safe.midX - width / 2, y: safe.midY - height / 2, width: width, height: height)
        case .frame, .none:
            let side = min(min(safe.width, safe.height) * 0.7, 340)
            return CGRect(x: safe.midX - side / 2, y: safe.midY - side / 2 - safe.height * 0.04, width: side, height: side)
        }
    }

    private func layoutOverlay() {
        let bounds = overlayView.bounds
        guard bounds.width > 0, bounds.height > 0 else { return }
        let rect = scanRect(in: bounds)
        let radius = min(18, min(rect.width, rect.height) * 0.12)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for layer in [dimmingLayer, viewfinderLayer, scanLineLayer, highlightLayer] {
            layer.frame = bounds
        }
        let dimming = UIBezierPath(rect: bounds)
        dimming.append(UIBezierPath(roundedRect: rect, cornerRadius: radius))
        dimmingLayer.path = dimming.cgPath

        switch resolvedViewfinder {
        case .frame:
            dimmingLayer.isHidden = false
            viewfinderLayer.isHidden = false
            viewfinderLayer.path = cornerBracketsPath(for: rect, radius: radius).cgPath
            scanLineLayer.isHidden = true
            scanLineLayer.removeAnimation(forKey: "pulse")
        case .line:
            dimmingLayer.isHidden = false
            viewfinderLayer.isHidden = true
            let line = UIBezierPath()
            line.move(to: CGPoint(x: rect.minX + 12, y: rect.midY))
            line.addLine(to: CGPoint(x: rect.maxX - 12, y: rect.midY))
            scanLineLayer.path = line.cgPath
            scanLineLayer.isHidden = false
            if scanLineLayer.animation(forKey: "pulse") == nil {
                let pulse = CABasicAnimation(keyPath: "opacity")
                pulse.fromValue = 1
                pulse.toValue = 0.35
                pulse.duration = 0.9
                pulse.autoreverses = true
                pulse.repeatCount = .infinity
                pulse.isRemovedOnCompletion = false
                scanLineLayer.add(pulse, forKey: "pulse")
            }
        case .none:
            dimmingLayer.isHidden = true
            viewfinderLayer.isHidden = true
            scanLineLayer.isHidden = true
        }
        CATransaction.commit()
    }

    /// Four rounded corner brackets around `rect`.
    private func cornerBracketsPath(for rect: CGRect, radius: CGFloat) -> UIBezierPath {
        let length = max(radius + 8, min(rect.width, rect.height) * 0.18)
        let path = UIBezierPath()
        // Top left
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + length))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(withCenter: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius,
                    startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
        path.addLine(to: CGPoint(x: rect.minX + length, y: rect.minY))
        // Top right
        path.move(to: CGPoint(x: rect.maxX - length, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addArc(withCenter: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius,
                    startAngle: .pi * 1.5, endAngle: 0, clockwise: true)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + length))
        // Bottom right
        path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - length))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addArc(withCenter: CGPoint(x: rect.maxX - radius, y: rect.maxY - radius), radius: radius,
                    startAngle: 0, endAngle: .pi * 0.5, clockwise: true)
        path.addLine(to: CGPoint(x: rect.maxX - length, y: rect.maxY))
        // Bottom left
        path.move(to: CGPoint(x: rect.minX + length, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        path.addArc(withCenter: CGPoint(x: rect.minX + radius, y: rect.maxY - radius), radius: radius,
                    startAngle: .pi * 0.5, endAngle: .pi, clockwise: true)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - length))
        return path
    }

    /// Keeps the preview upright when the interface rotates.
    private func updateVideoOrientation() {
        guard let connection = previewView.videoPreviewLayer.connection, connection.isVideoOrientationSupported else { return }
        let orientation: AVCaptureVideoOrientation
        switch view.window?.windowScene?.interfaceOrientation ?? .portrait {
        case .landscapeLeft: orientation = .landscapeLeft
        case .landscapeRight: orientation = .landscapeRight
        case .portraitUpsideDown: orientation = .portraitUpsideDown
        default: orientation = .portrait
        }
        if connection.videoOrientation != orientation {
            connection.videoOrientation = orientation
        }
    }

    /// Maps the scan area (or the visible preview) into capture-device coordinates for Vision.
    private func updateRegionOfInterest() {
        let previewLayer = previewView.videoPreviewLayer
        let bounds = overlayView.bounds
        guard previewLayer.connection != nil, bounds.width > 0, bounds.height > 0 else { return }
        let visible = scanner.options.normalizedScanArea != nil ? scanRect(in: bounds) : bounds
        let layerRect = previewLayer.convert(visible, from: overlayView.layer)
        let deviceRect = previewLayer.metadataOutputRectConverted(fromLayerRect: layerRect)
        if BarcodeScanner.clampToUnit(deviceRect) != nil {
            scanner.setRegionOfInterest(deviceRect)
        }
    }

    // MARK: Highlights

    private func showHighlights(for barcodes: [Barcode]) {
        guard showsHighlights, scanner.options.mode != .batch else { return }
        for barcode in barcodes {
            updateHighlight(key: barcode.dedupeKey, barcode: barcode)
        }
    }

    private func updateHighlight(key: String, barcode: Barcode) {
        let previewLayer = previewView.videoPreviewLayer
        let points = previewLayer.layerPoints(for: barcode).map { highlightLayer.convert($0, from: previewLayer) }
        guard points.count == 4, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return }
        let path = CGMutablePath()
        path.addLines(between: points)
        path.closeSubpath()
        let now = CACurrentMediaTime()

        if let highlight = highlights[key] {
            let layer = highlight.layer
            let move = CABasicAnimation(keyPath: "path")
            move.fromValue = layer.presentation()?.path ?? layer.path
            move.toValue = path
            move.duration = 0.12
            move.timingFunction = CAMediaTimingFunction(name: .easeOut)
            layer.removeAnimation(forKey: "fade")
            layer.opacity = 1
            layer.path = path
            layer.add(move, forKey: "path")
            highlight.lastSeen = now
        } else {
            let layer = CAShapeLayer()
            style(layer)
            layer.path = path
            highlightLayer.addSublayer(layer)
            let appear = CABasicAnimation(keyPath: "opacity")
            appear.fromValue = 0
            appear.toValue = 1
            appear.duration = 0.15
            layer.add(appear, forKey: "appear")
            highlights[key] = Highlight(layer: layer, lastSeen: now)
        }
    }

    private func style(_ layer: CAShapeLayer) {
        layer.fillColor = accentColor.withAlphaComponent(0.22).cgColor
        layer.strokeColor = accentColor.cgColor
        layer.lineWidth = 3
        layer.lineJoin = .round
        layer.shadowColor = accentColor.cgColor
        layer.shadowRadius = 8
        layer.shadowOpacity = 0.6
        layer.shadowOffset = .zero
    }

    private func startPruningHighlights() {
        pruneTask?.cancel()
        pruneTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                self?.pruneHighlights()
            }
        }
    }

    /// Fades out highlights of codes that have left the frame.
    private func pruneHighlights() {
        let now = CACurrentMediaTime()
        for (key, highlight) in highlights where now - highlight.lastSeen > 0.35 {
            highlights[key] = nil
            fadeOut(highlight.layer)
        }
    }

    private func clearHighlights() {
        for highlight in highlights.values {
            highlight.layer.removeFromSuperlayer()
        }
        highlights.removeAll()
    }

    private func fadeOut(_ layer: CAShapeLayer) {
        CATransaction.begin()
        CATransaction.setCompletionBlock {
            layer.removeFromSuperlayer()
        }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = layer.presentation()?.opacity ?? 1
        fade.toValue = 0
        fade.duration = 0.2
        layer.opacity = 0
        layer.add(fade, forKey: "fade")
        CATransaction.commit()
    }

    // MARK: Toast

    private func showToast(for barcodes: [Barcode]) {
        guard let first = barcodes.first else { return }
        let title = barcodes.count > 1 ? "\(barcodes.count) codes" : first.symbologyName
        let detail = barcodes.count > 1 ? barcodes.map(\.data).joined(separator: "  ·  ") : first.data
        toastView.configure(title: title, detail: detail.isEmpty ? "(no text)" : detail)
        view.bringSubviewToFront(toastView)
        if toastView.isHidden {
            toastView.alpha = 0
            toastView.transform = CGAffineTransform(translationX: 0, y: -16)
            toastView.isHidden = false
        }
        UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.4,
                       options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.toastView.alpha = 1
            self.toastView.transform = .identity
        }
        UIAccessibility.post(notification: .announcement, argument: "\(title): \(detail)")

        toastTask?.cancel()
        let nanoseconds = UInt64(max(0.5, toastDuration) * 1_000_000_000)
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            self?.hideToast()
        }
    }

    private func hideToast() {
        UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState], animations: {
            self.toastView.alpha = 0
            self.toastView.transform = CGAffineTransform(translationX: 0, y: -12)
        }, completion: { finished in
            if finished {
                self.toastView.isHidden = true
            }
        })
    }
}

// MARK: - Subviews

/// A view backed by an `AVCaptureVideoPreviewLayer`.
private final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    var videoPreviewLayer: AVCaptureVideoPreviewLayer {
        // layerClass guarantees the type; fall back to a detached layer rather than crashing.
        (layer as? AVCaptureVideoPreviewLayer) ?? AVCaptureVideoPreviewLayer()
    }
}

/// A round, blurred icon button used for close and torch.
private final class ScannerControlButton: UIButton {
    private let blurView = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
    private let diameter: CGFloat

    init(systemImageName: String, diameter: CGFloat) {
        self.diameter = diameter
        super.init(frame: CGRect(x: 0, y: 0, width: diameter, height: diameter))
        blurView.isUserInteractionEnabled = false
        blurView.clipsToBounds = true
        blurView.layer.cornerRadius = diameter / 2
        insertSubview(blurView, at: 0)
        tintColor = .white
        setSymbol(systemImageName)
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: diameter),
            heightAnchor.constraint(equalToConstant: diameter),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func setSymbol(_ name: String) {
        let configuration = UIImage.SymbolConfiguration(pointSize: diameter * 0.36, weight: .semibold)
        setImage(UIImage(systemName: name, withConfiguration: configuration), for: .normal)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        blurView.frame = bounds
        sendSubviewToBack(blurView)
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.6 : 1 }
    }
}

/// The success pill: icon, symbology name and data.
private final class ScanToastView: UIView {
    var accentColor: UIColor = QRGenScannerViewController.defaultAccentColor {
        didSet { iconView.tintColor = accentColor }
    }

    private let iconView = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(white: 0.08, alpha: 0.92)
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.borderColor = UIColor(white: 1, alpha: 0.1).cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.35
        layer.shadowRadius = 12
        layer.shadowOffset = CGSize(width: 0, height: 4)

        iconView.tintColor = accentColor
        iconView.contentMode = .scaleAspectFit
        iconView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        iconView.setContentHuggingPriority(.required, for: .horizontal)
        iconView.setContentCompressionResistancePriority(.required, for: .horizontal)

        titleLabel.font = .systemFont(ofSize: 11, weight: .bold)
        titleLabel.textColor = UIColor(white: 1, alpha: 0.6)
        detailLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        detailLabel.textColor = .white
        detailLabel.numberOfLines = 2
        detailLabel.lineBreakMode = .byTruncatingTail

        let text = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
        text.axis = .vertical
        text.spacing = 2
        let stack = UIStackView(arrangedSubviews: [iconView, text])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
        ])
        isAccessibilityElement = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func configure(title: String, detail: String) {
        titleLabel.text = title.uppercased()
        detailLabel.text = detail
        accessibilityLabel = "\(title): \(detail)"
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = min(bounds.height / 2, 26)
    }
}

/// Shown when camera access is denied.
private final class CameraPermissionView: UIView {
    let settingsButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        let icon = UIImageView(image: UIImage(systemName: "camera.fill"))
        icon.tintColor = UIColor(white: 1, alpha: 0.8)
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 40, weight: .regular)
        icon.contentMode = .scaleAspectFit

        let title = UILabel()
        title.text = "Camera access needed"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textColor = .white
        title.textAlignment = .center

        let message = UILabel()
        message.text = "Allow camera access in Settings to scan barcodes and QR codes."
        message.font = .systemFont(ofSize: 15)
        message.textColor = UIColor(white: 1, alpha: 0.7)
        message.textAlignment = .center
        message.numberOfLines = 0

        settingsButton.setTitle("Open Settings", for: .normal)
        settingsButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)

        let stack = UIStackView(arrangedSubviews: [icon, title, message, settingsButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(20, after: message)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }
}
#endif
