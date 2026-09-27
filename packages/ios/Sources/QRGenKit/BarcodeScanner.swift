#if canImport(AVFoundation) && canImport(Vision) && (os(iOS) || os(macOS))
import AVFoundation
import CoreGraphics
import Foundation
import Vision

// MARK: - Delegate

/// Receives scanner events on the main actor. Every method has a default empty implementation.
@MainActor
public protocol BarcodeScannerDelegate: AnyObject {
    /// The camera is running and frames are being processed (SPEC `ready` event).
    func barcodeScannerDidBecomeReady(_ scanner: BarcodeScanner)
    /// New codes were scanned, after the duplicate filter (SPEC `scan` event).
    func barcodeScanner(_ scanner: BarcodeScanner, didScan barcodes: [Barcode])
    /// Batch mode: the set of tracked codes changed or moved (SPEC `track` event).
    func barcodeScanner(_ scanner: BarcodeScanner, didTrack tracked: [TrackedBarcode])
    /// Something went wrong (SPEC `error` event).
    func barcodeScanner(_ scanner: BarcodeScanner, didFailWithError error: QRGenError)
}

public extension BarcodeScannerDelegate {
    func barcodeScannerDidBecomeReady(_ scanner: BarcodeScanner) {}
    func barcodeScanner(_ scanner: BarcodeScanner, didScan barcodes: [Barcode]) {}
    func barcodeScanner(_ scanner: BarcodeScanner, didTrack tracked: [TrackedBarcode]) {}
    func barcodeScanner(_ scanner: BarcodeScanner, didFailWithError error: QRGenError) {}
}

// MARK: - Scanner

/// The camera scanning engine: `AVCaptureSession` + `AVCaptureVideoDataOutput` + Vision.
///
/// Frames are processed on a background queue; every callback is delivered on the main actor.
/// Use it headless, or through `QRGenScannerViewController` / `QRGenScannerView` for a ready-made UI.
///
/// ```swift
/// let scanner = BarcodeScanner(options: ScannerOptions(symbologies: ["qr", "ean13"]))
/// scanner.onScan = { barcodes in print(barcodes.map(\.data)) }
/// scanner.onError = { error in print(error.code) }
/// view.layer.addSublayer(AVCaptureVideoPreviewLayer(session: scanner.captureSession))
/// scanner.start()
/// ```
///
/// Add `NSCameraUsageDescription` to your Info.plist; ``start()`` requests camera access when needed.
@MainActor
public final class BarcodeScanner {
    /// Lifecycle state.
    public enum State: String, Sendable {
        case idle
        /// Waiting for camera permission or for the session to start.
        case starting
        case running
        /// The camera runs but frames are not processed (``pause()``, or after a single-mode scan).
        case paused
        case stopped
    }

    /// Delegate alternative to the closures below; both are called.
    public weak var delegate: (any BarcodeScannerDelegate)?
    /// Called when the camera is running (SPEC `ready`).
    public var onReady: (@MainActor () -> Void)?
    /// Called with newly scanned codes (SPEC `scan`).
    public var onScan: (@MainActor ([Barcode]) -> Void)?
    /// Batch mode: called with every live track on each processed frame (SPEC `track`).
    public var onTrack: (@MainActor ([TrackedBarcode]) -> Void)?
    /// Called on errors (SPEC `error`).
    public var onError: (@MainActor (QRGenError) -> Void)?
    /// Called with every detection of every processed frame, before the duplicate filter.
    /// Useful for drawing overlays; `QRGenScannerViewController` uses it for its highlights.
    public var onDetections: (@MainActor ([Barcode]) -> Void)?
    /// Called whenever ``state`` changes.
    public var onStateChange: (@MainActor (State) -> Void)?

    /// Current options. Change them with ``update(options:)``.
    public private(set) var options: ScannerOptions
    /// Current lifecycle state.
    public private(set) var state: State = .idle {
        didSet { if state != oldValue { onStateChange?(state) } }
    }
    /// `true` while the torch is on.
    public private(set) var isTorchOn = false
    /// `true` when the active camera has a torch (known once the scanner is ready).
    public private(set) var hasTorch = false
    /// Current zoom, where `1` is the natural field of view of the wide camera.
    public private(set) var zoomFactor: CGFloat = 1
    /// Highest zoom accepted by ``setZoom(_:)`` for the active camera.
    public private(set) var maxZoomFactor: CGFloat = 1
    /// `AVCaptureDevice.uniqueID` of the active camera.
    public private(set) var activeDeviceID: String?
    /// Region of interest in capture-device coordinates (normalized, origin top-left, sensor orientation).
    public private(set) var regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1)

    /// `true` while frames are being processed.
    public var isScanning: Bool { state == .running }

    /// The capture session. Attach an `AVCaptureVideoPreviewLayer` to show the camera.
    public var captureSession: AVCaptureSession { capture.session }

    private let capture: CaptureController
    private let processor: FrameProcessor
    private var customRegionOfInterest: CGRect?
    private var generation = 0

    /// Creates a scanner. Nothing happens until ``start()``.
    public init(options: ScannerOptions = ScannerOptions()) {
        let region = BarcodeScanner.defaultRegion(for: options)
        self.options = options
        self.regionOfInterest = region
        self.capture = CaptureController()
        self.processor = FrameProcessor(configuration: FrameProcessor.Configuration(options: options, regionOfInterest: region))
        processor.setOutputHandler { [weak self] output in
            guard let self else { return }
            Task { @MainActor in self.handle(output) }
        }
        capture.setEventHandler { [weak self] event in
            guard let self else { return }
            Task { @MainActor in self.handle(event) }
        }
    }

    deinit {
        capture.stop()
    }

    // MARK: Permission

    /// Current camera authorization status.
    public static var authorizationStatus: AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }

    /// Asks for camera access if it has not been decided yet. Returns `true` when access is granted.
    public static func requestCameraAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    // MARK: Lifecycle

    /// Requests camera permission if needed, starts the camera and begins scanning.
    ///
    /// Calling `start()` while paused resumes. Errors are reported through ``onError`` / the delegate.
    public func start() {
        switch state {
        case .running, .starting:
            return
        case .paused:
            resume()
            return
        case .idle, .stopped:
            break
        }
        guard !Symbology.visionSymbologies(for: options.resolvedSymbologies).isEmpty else {
            report(.unsupported("None of the requested symbologies (\(options.symbologies.joined(separator: ", "))) can be read with Apple Vision."))
            return
        }
        generation += 1
        let current = generation
        state = .starting
        processor.reset()
        ScanFeedback.prepare()

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCapture(generation: current)
        case .notDetermined:
            Task { [weak self] in
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                guard let self, self.generation == current, self.state == .starting else { return }
                if granted {
                    self.startCapture(generation: current)
                } else {
                    self.state = .stopped
                    self.report(.cameraPermissionDenied)
                }
            }
        default:
            state = .stopped
            report(.cameraPermissionDenied)
        }
    }

    /// Stops the camera. The duplicate filter and batch tracks are reset on the next ``start()``.
    public func stop() {
        guard state != .idle, state != .stopped else { return }
        state = .stopped
        processor.setEnabled(false)
        capture.stop()
        isTorchOn = false
    }

    /// Stops processing frames; the camera (and preview) keep running.
    public func pause() {
        guard state == .running else { return }
        state = .paused
        processor.setEnabled(false)
    }

    /// Resumes processing after ``pause()`` or after a single-mode scan.
    public func resume() {
        guard state == .paused else { return }
        state = .running
        processor.setEnabled(true)
    }

    // MARK: Configuration

    /// Applies new options while running (symbologies, mode, duplicate filter, camera, torch, ...).
    public func update(options newOptions: ScannerOptions) {
        let old = options
        options = newOptions
        if customRegionOfInterest == nil {
            regionOfInterest = BarcodeScanner.defaultRegion(for: newOptions)
        }
        processor.update(FrameProcessor.Configuration(options: newOptions, regionOfInterest: regionOfInterest))
        if old.camera != newOptions.camera {
            use(camera: newOptions.camera)
        }
        if old.torch != newOptions.torch, state == .running || state == .paused {
            setTorch(newOptions.torch)
        }
    }

    /// Sets the region of interest in capture-device coordinates (normalized, origin top-left, in the
    /// sensor's orientation), e.g. from `AVCaptureVideoPreviewLayer.metadataOutputRectConverted(fromLayerRect:)`.
    /// Pass `nil` to go back to ``ScannerOptions/scanArea``.
    public func setRegionOfInterest(_ rect: CGRect?) {
        customRegionOfInterest = rect.flatMap(BarcodeScanner.clampToUnit)
        regionOfInterest = customRegionOfInterest ?? BarcodeScanner.defaultRegion(for: options)
        processor.setRegionOfInterest(regionOfInterest)
    }

    /// Turns the torch on or off. `completion` receives the resulting state.
    public func setTorch(_ on: Bool, completion: (@MainActor @Sendable (Bool) -> Void)? = nil) {
        capture.setTorch(on) { [weak self] isOn in
            guard let self else { return }
            Task { @MainActor in
                self.isTorchOn = isOn
                completion?(isOn)
            }
        }
    }

    /// Toggles between the back and the front camera.
    public func switchCamera() {
        let next: ScannerOptions.Camera = options.camera == .front ? .back : .front
        options.camera = next
        use(camera: next)
    }

    /// Zooms the camera. `1` is the natural field of view; values below 1 use the ultra-wide camera
    /// when available. Clamped to the device's range (iOS only; a no-op on macOS).
    public func setZoom(_ factor: CGFloat) {
        capture.setZoom(factor) { [weak self] actual in
            guard let self else { return }
            Task { @MainActor in self.zoomFactor = actual }
        }
    }

    // MARK: Internals

    private func use(camera: ScannerOptions.Camera) {
        guard state == .running || state == .paused || state == .starting else { return }
        capture.switchCamera(to: camera) { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                switch result {
                case .success(let info):
                    self.apply(info)
                    self.isTorchOn = false
                case .failure(let error):
                    self.report(error)
                }
            }
        }
    }

    private func startCapture(generation current: Int) {
        capture.start(camera: options.camera, processor: processor) { [weak self] result in
            guard let self else { return }
            Task { @MainActor in self.captureDidStart(result, generation: current) }
        }
    }

    private func captureDidStart(_ result: Result<CaptureController.DeviceInfo, QRGenError>, generation current: Int) {
        guard current == generation, state == .starting else {
            if state == .stopped || state == .idle { capture.stop() }
            return
        }
        switch result {
        case .success(let info):
            apply(info)
            state = .running
            processor.setEnabled(true)
            if options.torch { setTorch(true) }
            onReady?()
            delegate?.barcodeScannerDidBecomeReady(self)
        case .failure(let error):
            state = .stopped
            capture.stop()
            report(error)
        }
    }

    private func apply(_ info: CaptureController.DeviceInfo) {
        hasTorch = info.hasTorch
        maxZoomFactor = info.maxZoom
        zoomFactor = 1
        activeDeviceID = info.deviceID
    }

    private func handle(_ output: FrameOutput) {
        guard state == .running else { return }
        if let error = output.error {
            report(error)
            return
        }
        if output.completedSingleScan {
            state = .paused
        }
        if !output.detections.isEmpty {
            onDetections?(output.detections)
        }
        if let tracked = output.tracked {
            onTrack?(tracked)
            delegate?.barcodeScanner(self, didTrack: tracked)
        }
        if !output.scans.isEmpty {
            ScanFeedback.play(beep: options.beep, vibrate: options.vibrate)
            onScan?(output.scans)
            delegate?.barcodeScanner(self, didScan: output.scans)
        }
    }

    private func handle(_ event: CaptureController.Event) {
        switch event {
        case .runtimeError(let message):
            guard state != .stopped, state != .idle else { return }
            report(.unknown(message))
        case .interrupted(let cameraInUse):
            if cameraInUse, state == .running || state == .paused || state == .starting {
                report(.cameraInUse)
            }
        case .interruptionEnded:
            break
        }
    }

    private func report(_ error: QRGenError) {
        onError?(error)
        delegate?.barcodeScanner(self, didFailWithError: error)
    }

    /// Default region of interest from ``ScannerOptions/scanArea``.
    ///
    /// On iOS the scan area is taken relative to the portrait-upright frame and rotated into the
    /// sensor's landscape coordinates; on macOS camera frames are already upright.
    nonisolated static func defaultRegion(for options: ScannerOptions) -> CGRect {
        guard let area = options.normalizedScanArea else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
        #if os(iOS)
        return CGRect(x: area.minY, y: 1 - area.maxX, width: area.height, height: area.width)
        #else
        return area
        #endif
    }

    nonisolated static func clampToUnit(_ rect: CGRect) -> CGRect? {
        guard rect.minX.isFinite, rect.minY.isFinite, rect.width.isFinite, rect.height.isFinite else { return nil }
        let minX = min(max(rect.minX, 0), 1)
        let minY = min(max(rect.minY, 0), 1)
        let maxX = min(max(rect.maxX, 0), 1)
        let maxY = min(max(rect.maxY, 0), 1)
        guard maxX > minX, maxY > minY else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

// MARK: - Preview layer helpers

public extension AVCaptureVideoPreviewLayer {
    /// Converts a camera ``Barcode``'s corners (pixels of the camera frame) into this layer's
    /// coordinate space, accounting for `videoGravity` (e.g. `.resizeAspectFill`), rotation and mirroring.
    ///
    /// - Returns: top-left, top-right, bottom-right and bottom-left in layer coordinates, or `[]`
    ///   when the barcode has no frame size.
    func layerPoints(for barcode: Barcode) -> [CGPoint] {
        let width = barcode.frameSize.width
        let height = barcode.frameSize.height
        guard width > 0, height > 0 else { return [] }
        return barcode.location.points.map { point in
            layerPointConverted(fromCaptureDevicePoint: CGPoint(x: point.x / width, y: point.y / height))
        }
    }
}

// MARK: - Frame processing

/// Result of one processed frame, delivered to the main actor.
struct FrameOutput: Sendable {
    var detections: [Barcode] = []
    var scans: [Barcode] = []
    var tracked: [TrackedBarcode]?
    var completedSingleScan = false
    var error: QRGenError?
}

/// Runs Vision on camera frames. All mutable state is confined to ``queue``.
final class FrameProcessor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    struct Configuration: Sendable {
        var symbologies: Set<Symbology>
        var mode: ScannerOptions.Mode
        var duplicateFilter: Int
        var maxResults: Int
        /// Capture-device coordinates, normalized, origin top-left.
        var regionOfInterest: CGRect
        /// Frame throttling: minimum time between two processed frames.
        var minimumFrameInterval: TimeInterval

        init(options: ScannerOptions, regionOfInterest: CGRect) {
            symbologies = options.resolvedSymbologies
            mode = options.mode
            duplicateFilter = options.duplicateFilter
            maxResults = options.resolvedMaxResults
            self.regionOfInterest = regionOfInterest
            minimumFrameInterval = options.mode == .batch ? 1.0 / 30.0 : 1.0 / 20.0
        }
    }

    /// Serial queue receiving sample buffers; owns every mutable property below.
    let queue = DispatchQueue(label: "dev.qrgen.scanner.frames", qos: .userInitiated)

    private var configuration: Configuration
    private var isEnabled = false
    private var lastFrameTime: TimeInterval = 0
    private var duplicates = DuplicateFilter()
    private var tracker = BarcodeTracker()
    private var hadTracks = false
    private var request: VNDetectBarcodesRequest?
    private var requestSymbologies: Set<Symbology>?
    private var failedSymbologies: Set<Symbology>?

    private let handlerLock = NSLock()
    private var outputHandler: (@Sendable (FrameOutput) -> Void)?

    init(configuration: Configuration) {
        self.configuration = configuration
        super.init()
    }

    func setOutputHandler(_ handler: @escaping @Sendable (FrameOutput) -> Void) {
        handlerLock.lock()
        outputHandler = handler
        handlerLock.unlock()
    }

    func update(_ configuration: Configuration) {
        queue.async { [self] in
            if configuration.symbologies != self.configuration.symbologies {
                failedSymbologies = nil
            }
            if configuration.mode != self.configuration.mode {
                tracker.reset()
                hadTracks = false
            }
            self.configuration = configuration
        }
    }

    func setRegionOfInterest(_ rect: CGRect) {
        queue.async { [self] in configuration.regionOfInterest = rect }
    }

    func setEnabled(_ enabled: Bool) {
        queue.async { [self] in
            isEnabled = enabled
            lastFrameTime = 0
        }
    }

    func reset() {
        queue.async { [self] in
            duplicates.reset()
            tracker.reset()
            hadTracks = false
            failedSymbologies = nil
        }
    }

    // AVCaptureVideoDataOutputSampleBufferDelegate (called on `queue`).
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard isEnabled else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastFrameTime >= configuration.minimumFrameInterval else { return }
        lastFrameTime = now
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        process(pixelBuffer)
    }

    private func process(_ pixelBuffer: CVPixelBuffer) {
        let config = configuration
        guard failedSymbologies != config.symbologies else { return }
        let request: VNDetectBarcodesRequest
        do {
            request = try currentRequest(for: config.symbologies)
        } catch {
            failedSymbologies = config.symbologies
            emit(FrameOutput(error: error as? QRGenError ?? .engineLoadFailed(error.localizedDescription)))
            return
        }

        let visionRegion = FrameProcessor.visionRegion(fromDeviceRect: config.regionOfInterest)
        request.regionOfInterest = visionRegion
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return
        }

        let size = CGSize(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
        let now = Barcode.currentTimestamp()
        var barcodes = VisionBarcodeMapper.barcodes(
            from: request.results ?? [],
            requested: config.symbologies,
            imageSize: size,
            regionOfInterest: visionRegion,
            timestamp: now
        )
        // Prefer the codes closest to the centre of the region of interest.
        let centerX = Double(config.regionOfInterest.midX * size.width)
        let centerY = Double(config.regionOfInterest.midY * size.height)
        func distance(_ barcode: Barcode) -> Double {
            let c = barcode.location.center
            return (c.x - centerX) * (c.x - centerX) + (c.y - centerY) * (c.y - centerY)
        }
        barcodes.sort { distance($0) < distance($1) }
        if barcodes.count > config.maxResults {
            barcodes = Array(barcodes.prefix(config.maxResults))
        }

        var output = FrameOutput(detections: barcodes)
        for barcode in barcodes {
            if duplicates.shouldReport(barcode.dedupeKey, now: now, window: config.duplicateFilter) {
                output.scans.append(barcode)
            }
        }
        switch config.mode {
        case .single:
            if !output.scans.isEmpty {
                isEnabled = false
                output.completedSingleScan = true
            }
        case .continuous:
            break
        case .batch:
            let tracked = tracker.update(with: barcodes, now: now)
            if !tracked.isEmpty || hadTracks {
                output.tracked = tracked
            }
            hadTracks = !tracked.isEmpty
        }
        guard !output.detections.isEmpty || output.tracked != nil else { return }
        emit(output)
    }

    private func currentRequest(for symbologies: Set<Symbology>) throws -> VNDetectBarcodesRequest {
        if let request, requestSymbologies == symbologies {
            return request
        }
        let newRequest = try VisionBarcodeMapper.makeRequest(for: symbologies)
        request = newRequest
        requestSymbologies = symbologies
        return newRequest
    }

    private func emit(_ output: FrameOutput) {
        handlerLock.lock()
        let handler = outputHandler
        handlerLock.unlock()
        handler?(output)
    }

    /// Capture-device rect (origin top-left) to Vision's normalized rect (origin bottom-left).
    static func visionRegion(fromDeviceRect rect: CGRect) -> CGRect {
        guard let clamped = BarcodeScanner.clampToUnit(rect) else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
        return CGRect(x: clamped.minX, y: 1 - clamped.maxY, width: clamped.width, height: clamped.height)
    }
}

// MARK: - Capture session

/// Owns the `AVCaptureSession`. Every session and device call runs on a private serial queue.
final class CaptureController: NSObject, @unchecked Sendable {
    struct DeviceInfo: Sendable {
        var deviceID: String
        var hasTorch: Bool
        var maxZoom: CGFloat
    }

    enum Event: Sendable {
        case runtimeError(String)
        case interrupted(cameraInUse: Bool)
        case interruptionEnded
    }

    let session = AVCaptureSession()

    private let queue = DispatchQueue(label: "dev.qrgen.scanner.session")
    private let videoOutput = AVCaptureVideoDataOutput()
    private var input: AVCaptureDeviceInput?
    private var isConfigured = false
    private var wantsRunning = false
    /// Zoom factor that corresponds to "1x" (the wide camera) on virtual multi-camera devices.
    private var baseZoom: CGFloat = 1

    private let handlerLock = NSLock()
    private var eventHandler: (@Sendable (Event) -> Void)?

    // The Swift spelling of these notification names changed across SDKs
    // (`.AVCaptureSessionRuntimeError` vs `AVCaptureSession.runtimeErrorNotification`);
    // the underlying string values are stable, so use them directly.
    private static let runtimeErrorNotification = Notification.Name("AVCaptureSessionRuntimeErrorNotification")
    private static let wasInterruptedNotification = Notification.Name("AVCaptureSessionWasInterruptedNotification")
    private static let interruptionEndedNotification = Notification.Name("AVCaptureSessionInterruptionEndedNotification")

    override init() {
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(sessionRuntimeError(_:)),
                           name: CaptureController.runtimeErrorNotification, object: session)
        #if os(iOS)
        center.addObserver(self, selector: #selector(sessionWasInterrupted(_:)),
                           name: CaptureController.wasInterruptedNotification, object: session)
        center.addObserver(self, selector: #selector(sessionInterruptionEnded(_:)),
                           name: CaptureController.interruptionEndedNotification, object: session)
        #endif
    }

    func setEventHandler(_ handler: @escaping @Sendable (Event) -> Void) {
        handlerLock.lock()
        eventHandler = handler
        handlerLock.unlock()
    }

    private func emit(_ event: Event) {
        handlerLock.lock()
        let handler = eventHandler
        handlerLock.unlock()
        handler?(event)
    }

    // MARK: Session control

    func start(
        camera: ScannerOptions.Camera,
        processor: FrameProcessor,
        completion: @escaping @Sendable (Result<DeviceInfo, QRGenError>) -> Void
    ) {
        queue.async { [self] in
            wantsRunning = true
            do {
                if isConfigured {
                    if let device = CaptureController.device(for: camera), device.uniqueID != input?.device.uniqueID {
                        try replaceInput(with: device)
                    }
                } else {
                    try configure(camera: camera, processor: processor)
                }
                if !session.isRunning {
                    session.startRunning()
                }
                guard session.isRunning else { throw QRGenError.cameraInUse }
                guard let device = input?.device else { throw QRGenError.cameraNotFound }
                completion(.success(info(for: device)))
            } catch {
                completion(.failure(error as? QRGenError ?? .unknown(error.localizedDescription)))
            }
        }
    }

    func stop() {
        queue.async { [self] in
            wantsRunning = false
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    func switchCamera(to camera: ScannerOptions.Camera, completion: @escaping @Sendable (Result<DeviceInfo, QRGenError>) -> Void) {
        queue.async { [self] in
            guard isConfigured else { return }
            guard let device = CaptureController.device(for: camera) else {
                completion(.failure(.cameraNotFound))
                return
            }
            do {
                if device.uniqueID != input?.device.uniqueID {
                    try replaceInput(with: device)
                }
                completion(.success(info(for: device)))
            } catch {
                completion(.failure(error as? QRGenError ?? .unknown(error.localizedDescription)))
            }
        }
    }

    func setTorch(_ on: Bool, completion: @escaping @Sendable (Bool) -> Void) {
        queue.async { [self] in
            guard let device = input?.device, device.hasTorch, device.isTorchModeSupported(on ? .on : .off) else {
                completion(false)
                return
            }
            do {
                try device.lockForConfiguration()
                device.torchMode = on ? .on : .off
                device.unlockForConfiguration()
            } catch {
                // Keep whatever state the device reports.
            }
            completion(device.torchMode == .on)
        }
    }

    func setZoom(_ factor: CGFloat, completion: @escaping @Sendable (CGFloat) -> Void) {
        queue.async { [self] in
            #if os(iOS)
            guard let device = input?.device else {
                completion(1)
                return
            }
            let target = min(max(baseZoom * factor, device.minAvailableVideoZoomFactor),
                             min(device.maxAvailableVideoZoomFactor, baseZoom * 10))
            do {
                try device.lockForConfiguration()
                device.videoZoomFactor = target
                device.unlockForConfiguration()
            } catch {
                // Zoom unchanged.
            }
            completion(device.videoZoomFactor / baseZoom)
            #else
            completion(1)
            #endif
        }
    }

    // MARK: Configuration (session queue only)

    private func configure(camera: ScannerOptions.Camera, processor: FrameProcessor) throws {
        guard let device = CaptureController.device(for: camera) else { throw QRGenError.cameraNotFound }
        let newInput = try CaptureController.makeInput(device)

        session.beginConfiguration()
        do {
            if session.canSetSessionPreset(.hd1920x1080) {
                session.sessionPreset = .hd1920x1080
            } else if session.canSetSessionPreset(.high) {
                session.sessionPreset = .high
            }
            guard session.canAddInput(newInput) else { throw QRGenError.cameraInUse }
            session.addInput(newInput)
            input = newInput

            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            ]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.setSampleBufferDelegate(processor, queue: processor.queue)
            guard session.canAddOutput(videoOutput) else {
                throw QRGenError.engineLoadFailed("The camera video output could not be added to the capture session.")
            }
            session.addOutput(videoOutput)
            configureConnection()
            session.commitConfiguration()
        } catch {
            for existing in session.inputs { session.removeInput(existing) }
            for existing in session.outputs { session.removeOutput(existing) }
            input = nil
            session.commitConfiguration()
            throw error
        }
        configureDevice(device)
        isConfigured = true
    }

    private func replaceInput(with device: AVCaptureDevice) throws {
        let newInput = try CaptureController.makeInput(device)
        session.beginConfiguration()
        let oldInput = input
        if let oldInput { session.removeInput(oldInput) }
        guard session.canAddInput(newInput) else {
            if let oldInput, session.canAddInput(oldInput) { session.addInput(oldInput) }
            session.commitConfiguration()
            throw QRGenError.cameraInUse
        }
        session.addInput(newInput)
        input = newInput
        configureConnection()
        session.commitConfiguration()
        configureDevice(device)
    }

    /// Keeps frames in the sensor's native orientation and unmirrored, so Vision coordinates equal
    /// capture-device coordinates (what `AVCaptureVideoPreviewLayer` conversions expect).
    private func configureConnection() {
        guard let connection = videoOutput.connection(with: .video) else { return }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = false
        }
    }

    private func configureDevice(_ device: AVCaptureDevice) {
        baseZoom = 1
        do {
            try device.lockForConfiguration()
        } catch {
            return
        }
        defer { device.unlockForConfiguration() }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        #if os(iOS)
        if device.isSmoothAutoFocusSupported {
            device.isSmoothAutoFocusEnabled = false
        }
        // Virtual devices whose zoom 1.0 is the ultra-wide camera: start at the wide camera ("1x").
        if device.deviceType == .builtInTripleCamera || device.deviceType == .builtInDualWideCamera,
           let wide = device.virtualDeviceSwitchOverVideoZoomFactors.first {
            baseZoom = CGFloat(truncating: wide)
        }
        device.videoZoomFactor = min(max(baseZoom, device.minAvailableVideoZoomFactor), device.maxAvailableVideoZoomFactor)
        #endif
    }

    private func info(for device: AVCaptureDevice) -> DeviceInfo {
        #if os(iOS)
        let maxZoom = max(1, min(device.maxAvailableVideoZoomFactor, baseZoom * 10) / baseZoom)
        #else
        let maxZoom: CGFloat = 1
        #endif
        return DeviceInfo(
            deviceID: device.uniqueID,
            hasTorch: device.hasTorch && device.isTorchModeSupported(.on),
            maxZoom: maxZoom
        )
    }

    static func makeInput(_ device: AVCaptureDevice) throws -> AVCaptureDeviceInput {
        do {
            return try AVCaptureDeviceInput(device: device)
        } catch {
            if AVCaptureDevice.authorizationStatus(for: .video) != .authorized {
                throw QRGenError.cameraPermissionDenied
            }
            throw QRGenError.cameraInUse
        }
    }

    static func device(for camera: ScannerOptions.Camera) -> AVCaptureDevice? {
        switch camera {
        case .device(let id):
            return AVCaptureDevice(uniqueID: id)
        case .back:
            return discover(position: .back)
        case .front:
            return discover(position: .front)
        }
    }

    private static func discover(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        #if os(iOS)
        let types: [AVCaptureDevice.DeviceType] = position == .front
            ? [.builtInWideAngleCamera]
            : [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: position).devices
        for type in types {
            if let device = devices.first(where: { $0.deviceType == type }) {
                return device
            }
        }
        return devices.first ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        #else
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
            mediaType: .video,
            position: .unspecified
        ).devices
        return devices.first(where: { $0.position == position }) ?? devices.first ?? AVCaptureDevice.default(for: .video)
        #endif
    }

    // MARK: Notifications

    @objc private func sessionRuntimeError(_ notification: Notification) {
        let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
        #if os(iOS)
        if error?.code == AVError.Code.mediaServicesWereReset.rawValue {
            // Media services were reset: restart silently, as Apple's AVCam sample does.
            queue.async { [self] in
                if wantsRunning, !session.isRunning { session.startRunning() }
            }
            return
        }
        #endif
        emit(.runtimeError(error?.localizedDescription ?? "The camera stopped unexpectedly."))
    }

    #if os(iOS)
    @objc private func sessionWasInterrupted(_ notification: Notification) {
        var cameraInUse = false
        if let value = notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int,
           let reason = AVCaptureSession.InterruptionReason(rawValue: value) {
            cameraInUse = reason == .videoDeviceInUseByAnotherClient
                || reason == .videoDeviceNotAvailableWithMultipleForegroundApps
        }
        emit(.interrupted(cameraInUse: cameraInUse))
    }

    @objc private func sessionInterruptionEnded(_ notification: Notification) {
        emit(.interruptionEnded)
    }
    #endif
}
#endif
