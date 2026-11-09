import AVFoundation
import Foundation
import QRGenKit
import UIKit

/// Opt-in renderer witness. Inputs are public models conforming to the native batch
/// tracker contract, not camera frames or outputs from a session executed by this app.
@MainActor
final class BatchOverlayProbe {
    private let window: UIWindow
    private let probeToken: String
    private var checks: [[String: Any]] = []
    private var harnessErrors: [String] = []
    private var inconclusiveReasons: [String] = []
    private var scannerStates: [String] = []
    private var callbackTrace: [[String: Any]] = []
    private var cameraStarted = false
    private var cleanupComplete = true
    private var capabilityPassed = false
    private var activeController: BatchProbeScanner?
    private let semanticNames = ["ordinary_batch_movement", "backward_epoch_live_overlay", "source_clear_removes_overlays"]
    private var semanticCasesRun = 0

    init(window: UIWindow) {
        self.window = window
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--qrgen-probe-token"), args.indices.contains(index + 1) {
            probeToken = args[index + 1]
        } else {
            probeToken = "manual-unbound"
        }
    }

    private func finite(_ value: CGFloat) -> Any {
        guard value.isFinite else { return NSNull() }
        return Double(value)
    }
    private func pointsJSON(_ points: [CGPoint]) -> [[String: Any]] {
        points.map { ["x": finite($0.x), "y": finite($0.y)] }
    }
    private func encoded<T: Encodable>(_ value: T) -> Any {
        do { return try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
        catch { harnessErrors.append("Public model receipt encoding failed: \(error)"); return NSNull() }
    }
    private func persist(_ phase: String) {
        let completed = Set(checks.compactMap { $0["name"] as? String })
        let receipt: [String: Any] = [
            "schemaVersion": 1, "probeToken": probeToken, "phase": phase,
            "pass": phase == "complete" && checks.count == 4 && checks.allSatisfy { $0["passed"] as? Bool == true },
            "checks": checks, "capabilityPassed": capabilityPassed,
            "semanticCasesRun": semanticCasesRun, "semanticCasesNotRun": semanticNames.filter { !completed.contains($0) },
            "harnessErrors": harnessErrors, "inconclusiveReasons": inconclusiveReasons, "skippedCases": 0,
            "cameraStarted": cameraStarted, "startsAutomatically": false, "scannerStates": scannerStates,
            "cleanupComplete": cleanupComplete, "callbackTrace": callbackTrace,
            "scope": "Actual UIKit controller and visible CALayer geometry driven at the public accepted-callback boundary. Public track fixtures follow exact-payload association, observation counts and <500ms retained-track grace. No CameraFrameSession execution, camera acquisition, pixels, source admission or OS-clock adjustment.",
        ]
        do {
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: documents.appendingPathComponent("qrgen-batch-overlay.json"), options: .atomic)
            print("QRGEN_BATCH_OVERLAY_PROBE phase=\(phase) checks=\(checks.count) pass=\(receipt["pass"]!)")
        } catch { print("QRGEN_BATCH_OVERLAY_PROBE_WRITE_ERROR \(error)") }
    }
    private func record(_ name: String, kind: String, passed: Bool, details: [String: Any]) {
        checks.append(["name": name, "kind": kind, "passed": passed, "details": details])
        if kind != "capability" { semanticCasesRun += 1 }
        persist("running")
    }
    private func delay(_ seconds: TimeInterval) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }
    private func waitUntil(timeout: TimeInterval, _ predicate: () -> Bool) async -> Bool {
        let deadline = CACurrentMediaTime() + timeout
        while !predicate(), CACurrentMediaTime() < deadline, !Task.isCancelled { await delay(0.01) }
        return predicate()
    }
    private func observe(_ controller: BatchProbeScanner) {
        scannerStates.append(controller.scanner.state.rawValue)
        if controller.scanner.state != .idle && controller.scanner.state != .stopped { cameraStarted = true }
        if controller.scanner.captureSession.isRunning || !controller.scanner.captureSession.inputs.isEmpty { cameraStarted = true }
    }
    private func mount() async -> BatchProbeScanner? {
        let controller = BatchProbeScanner(options: ScannerOptions(symbologies: ["qr"], mode: .batch, beep: false, vibrate: false))
        controller.startsAutomatically = false
        controller.showsToast = false
        activeController = controller
        observe(controller)
        controller.scanner.onStateChange = { [weak self, weak controller] _ in
            guard let self, let controller else { return }; self.observe(controller)
        }
        controller.onTrack = { [weak self] tracks in
            guard let self else { return }
            self.callbackTrace.append(["callback": "controller.onTrack", "tracks": self.encoded(tracks)])
        }
        window.rootViewController = controller
        let ready = await waitUntil(timeout: 5) {
            controller.didAppearCount > 0 && controller.view.window === self.window && UIApplication.shared.applicationState == .active
        }
        controller.view.layoutIfNeeded()
        observe(controller)
        guard ready && !cameraStarted && controller.scanner.onDetections != nil && controller.scanner.onTrack != nil else {
            harnessErrors.append("Real UIKit appearance, bound callbacks or camera-free preconditions failed")
            return nil
        }
        return controller
    }
    private func cleanup() async {
        guard let controller = activeController else { return }
        let before = controller.didDisappearCount
        window.rootViewController = UIViewController()
        let cleaned = await waitUntil(timeout: 2) { controller.didDisappearCount > before && controller.view.window == nil }
        cleanupComplete = cleanupComplete && cleaned
        if !cleaned { harnessErrors.append("Real UIKit controller cleanup disappearance failed") }
        observe(controller)
        activeController = nil
    }
    private func descendants(_ root: CALayer) -> [CALayer] {
        [root] + (root.sublayers ?? []).flatMap { descendants($0) }
    }
    private func preview(_ controller: BatchProbeScanner) -> AVCaptureVideoPreviewLayer? {
        let candidates = descendants(controller.view.layer).compactMap { $0 as? AVCaptureVideoPreviewLayer }
        return candidates.count == 1 ? candidates.first : nil
    }
    private func shapes(_ controller: BatchProbeScanner) -> [CAShapeLayer] {
        descendants(controller.view.layer).compactMap { $0 as? CAShapeLayer }
    }
    private func barcode(_ payload: String, x: Double, y: Double, epoch: Int64) -> Barcode {
        Barcode(data: payload, symbology: .qr,
                location: .init(topLeft: .init(x: x, y: y), topRight: .init(x: x + 96, y: y),
                                bottomRight: .init(x: x + 96, y: y + 54), bottomLeft: .init(x: x, y: y + 54)),
                frameSize: .init(width: 1920, height: 1080), timestamp: epoch)
    }
    private func a(_ epoch: Int64, moved: Bool = false) -> Barcode {
        barcode("BATCH-PROBE-A", x: moved ? 922 : 768, y: 454, epoch: epoch)
    }
    private func b(_ epoch: Int64) -> Barcode { barcode("BATCH-PROBE-B", x: 1056, y: 562, epoch: epoch) }
    private func inject(_ controller: BatchProbeScanner, detections: [Barcode], tracks: [TrackedBarcode], label: String) {
        // BarcodeScanner.handle calls nonempty onDetections before onTrack. No blank frame is synthesized.
        callbackTrace.append(["callback": "onDetections", "label": label, "detections": encoded(detections), "monotonic": CACurrentMediaTime()])
        controller.scanner.onDetections?(detections)
        callbackTrace.append(["callback": "onTrack", "label": label, "tracks": encoded(tracks), "monotonic": CACurrentMediaTime()])
        controller.scanner.onTrack?(tracks)
        observe(controller)
    }
    private func pathPoints(_ path: CGPath?) -> [CGPoint] {
        guard let path else { return [] }
        var points: [CGPoint] = []
        var supported = true
        path.applyWithBlock { element in
            switch element.pointee.type {
            case .moveToPoint, .addLineToPoint: points.append(element.pointee.points[0])
            case .closeSubpath: break
            default: supported = false
            }
        }
        return supported ? points : []
    }
    private func inWindow(_ points: [CGPoint], from layer: CALayer) -> [CGPoint] {
        points.map { layer.convert($0, to: window.layer) }
    }
    private func projected(_ barcode: Barcode, preview: AVCaptureVideoPreviewLayer) -> [CGPoint] {
        inWindow(preview.layerPoints(for: barcode), from: preview)
    }
    private func area(_ points: [CGPoint]) -> CGFloat {
        guard points.count == 4 else { return 0 }
        return abs(points.indices.reduce(CGFloat.zero) { sum, index in
            let next = (index + 1) % points.count
            return sum + points[index].x * points[next].y - points[next].x * points[index].y
        }) / 2
    }
    private func bounds(_ points: [CGPoint]) -> CGRect {
        guard !points.isEmpty else { return .null }
        let xs = points.map(\.x), ys = points.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return .null }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
    private func usable(_ points: [CGPoint]) -> Bool {
        points.count == 4 && points.allSatisfy { $0.x.isFinite && $0.y.isFinite } && area(points) >= 16 &&
            bounds(points).width >= 2 && bounds(points).height >= 2 && window.bounds.contains(bounds(points))
    }
    private func distance(_ left: [CGPoint], _ right: [CGPoint]) -> CGFloat {
        guard left.count == 4 && right.count == 4 else { return .infinity }
        return zip(left, right).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? .infinity
    }
    private func effectivelyVisible(_ layer: CAShapeLayer) -> Bool {
        guard let presentation = layer.presentation() as? CAShapeLayer else { return false }
        var current: CALayer? = layer
        var opacity: Float = 1
        var attached = false
        while let item = current {
            if item.isHidden || item.presentation()?.isHidden == true { return false }
            opacity *= item.presentation()?.opacity ?? item.opacity
            if item === window.layer { attached = true; break }
            current = item.superlayer
        }
        let painted = (layer.strokeColor?.alpha ?? 0) > 0 && layer.lineWidth > 0 || (layer.fillColor?.alpha ?? 0) > 0
        return attached && opacity > 0.05 && painted && usable(inWindow(pathPoints(presentation.path), from: layer))
    }
    private func state(_ layer: CAShapeLayer) -> [String: Any] {
        let presentation = layer.presentation() as? CAShapeLayer
        return ["identity": String(describing: ObjectIdentifier(layer)), "attached": layer.superlayer != nil,
                "visible": effectivelyVisible(layer), "hasPresentation": presentation != nil,
                "modelPointsInWindow": pointsJSON(inWindow(pathPoints(layer.path), from: layer)),
                "presentationPointsInWindow": pointsJSON(inWindow(pathPoints(presentation?.path), from: layer)),
                "opacity": Double(layer.opacity), "presentationOpacity": presentation.map { Double($0.opacity) as Any } ?? NSNull()]
    }

    private struct Seed {
        let controller: BatchProbeScanner
        let preview: AVCaptureVideoPreviewLayer
        let layerA: CAShapeLayer
        let layerB: CAShapeLayer
        let aFirst: Int64
        let bSeen: Int64
        let started: CFTimeInterval
        let bObserved: CFTimeInterval
        let expectedA: [CGPoint]
        let expectedB: [CGPoint]
        let expectedMovedA: [CGPoint]
    }
    private func seed(_ controller: BatchProbeScanner, label: String) async -> Seed? {
        guard let preview = preview(controller) else { inconclusiveReasons.append("No unique real preview layer"); return nil }
        let first: Int64 = 1_700_000_000_000
        let expectedA = projected(a(first), preview: preview)
        let expectedB = projected(b(first), preview: preview)
        let expectedMovedA = projected(a(first, moved: true), preview: preview)
        let geometryOK = usable(expectedA) && usable(expectedB) && usable(expectedMovedA) &&
            distance(expectedA, expectedMovedA) >= 4 && !bounds(expectedA).intersects(bounds(expectedB)) &&
            !bounds(expectedMovedA).intersects(bounds(expectedB))
        callbackTrace.append(["callback": "projection-capability", "label": label,
                              "connectionPresent": preview.connection != nil, "captureInputs": controller.scanner.captureSession.inputs.count,
                              "a": pointsJSON(expectedA), "b": pointsJSON(expectedB), "movedA": pointsJSON(expectedMovedA), "usable": geometryOK])
        guard geometryOK else { inconclusiveReasons.append("Unconfigured preview projection is nonfinite, degenerate, off-window or insufficiently distinct (\(label))"); return nil }
        let before = Set(shapes(controller).map(ObjectIdentifier.init))
        let started = CACurrentMediaTime()
        inject(controller, detections: [a(first)], tracks: [.init(id: "1", barcode: a(first), firstSeen: first, lastSeen: first, count: 1)], label: label + "-A")
        let newA = shapes(controller).filter { !before.contains(ObjectIdentifier($0)) }
        guard newA.count == 1 else { inconclusiveReasons.append("A callback did not create one identifiable shape layer (\(label))"); return nil }
        await delay(0.04)
        let observedB = CACurrentMediaTime()
        let second = first + Int64(((observedB - started) * 1000).rounded())
        let beforeB = Set(shapes(controller).map(ObjectIdentifier.init))
        inject(controller, detections: [a(second), b(second)], tracks: [
            .init(id: "1", barcode: a(second), firstSeen: first, lastSeen: second, count: 2),
            .init(id: "2", barcode: b(second), firstSeen: second, lastSeen: second, count: 1),
        ], label: label + "-AB")
        let newB = shapes(controller).filter { !beforeB.contains(ObjectIdentifier($0)) }
        guard newB.count == 1, newA[0].superlayer === newB[0].superlayer else {
            inconclusiveReasons.append("B callback did not create one sibling shape layer (\(label))"); return nil
        }
        await delay(0.18)
        let modelA = inWindow(pathPoints(newA[0].path), from: newA[0])
        let modelB = inWindow(pathPoints(newB[0].path), from: newB[0])
        let rendered = effectivelyVisible(newA[0]) && effectivelyVisible(newB[0]) &&
            distance(modelA, expectedA) <= 1 && distance(modelB, expectedB) <= 1 &&
            distance(inWindow(pathPoints((newA[0].presentation() as? CAShapeLayer)?.path), from: newA[0]), expectedA) <= 1 &&
            distance(inWindow(pathPoints((newB[0].presentation() as? CAShapeLayer)?.path), from: newB[0]), expectedB) <= 1
        let beforeGrace = CACurrentMediaTime() - started < 0.45
        callbackTrace.append(["callback": "seed-visible", "label": label, "a": state(newA[0]), "b": state(newB[0]),
                              "rendered": rendered, "before500msGrace": beforeGrace, "ageSeconds": CACurrentMediaTime() - observedB])
        guard rendered && beforeGrace else { inconclusiveReasons.append("Initial actual visible layers or measured retention grace failed calibration (\(label))"); return nil }
        return Seed(controller: controller, preview: preview, layerA: newA[0], layerB: newB[0], aFirst: first,
                    bSeen: second, started: started, bObserved: observedB, expectedA: expectedA, expectedB: expectedB, expectedMovedA: expectedMovedA)
    }
    private func movement(_ seed: Seed, backward: Bool) async {
        let name = backward ? "backward_epoch_live_overlay" : "ordinary_batch_movement"
        let observed = CACurrentMediaTime()
        let elapsedMS = Int64(((observed - seed.started) * 1000).rounded())
        let current = seed.aFirst + elapsedMS - (backward ? 60_000 : 0)
        let beforeA = state(seed.layerA)
        let beforeB = state(seed.layerB)
        inject(seed.controller, detections: [a(current, moved: true)], tracks: [
            .init(id: "1", barcode: a(current, moved: true), firstSeen: seed.aFirst, lastSeen: current, count: 3),
            .init(id: "2", barcode: b(seed.bSeen), firstSeen: seed.bSeen, lastSeen: seed.bSeen, count: 1),
        ], label: name + "-A-moved-B-retained")
        await delay(0.18)
        let actualA = inWindow(pathPoints(seed.layerA.path), from: seed.layerA)
        let presentedA = inWindow(pathPoints((seed.layerA.presentation() as? CAShapeLayer)?.path), from: seed.layerA)
        let actualB = inWindow(pathPoints(seed.layerB.path), from: seed.layerB)
        let afterA = state(seed.layerA)
        let afterB = state(seed.layerB)
        let finalAge = CACurrentMediaTime() - seed.bObserved
        let calibrated = observed - seed.bObserved >= 0.18 && finalAge < 0.5 &&
            seed.controller.view.window === window && UIApplication.shared.applicationState == .active &&
            distance(projected(a(current, moved: true), preview: seed.preview), seed.expectedMovedA) <= 1 &&
            distance(projected(b(seed.bSeen), preview: seed.preview), seed.expectedB) <= 1
        if !calibrated { inconclusiveReasons.append("Movement observation missed real <500ms grace, animation settling or stable active projection (\(name))") }
        let moved = distance(actualA, seed.expectedMovedA) <= 1 && distance(presentedA, seed.expectedMovedA) <= 1 && afterA["visible"] as? Bool == true
        let retainedBStationary = distance(actualB, seed.expectedB) <= 1
        record(name, kind: backward ? "target" : "control", passed: calibrated && moved && retainedBStationary,
               details: ["calibrated": calibrated, "liveAMovedAndVisible": moved, "retainedBGeometryUnchanged": retainedBStationary,
                         "aBefore": beforeA, "bBefore": beforeB, "aAfter": afterA, "bAfter": afterB,
                         "expectedMovedA": pointsJSON(seed.expectedMovedA), "expectedB": pointsJSON(seed.expectedB),
                         "observedElapsedMilliseconds": elapsedMS, "retainedBAgeAtFinalSeconds": finalAge,
                         "aCurrentEpoch": current, "bRetainedEpoch": seed.bSeen, "epochCorrectionMilliseconds": backward ? -60_000 : 0])
    }
    private func sourceClear(_ seed: Seed) {
        let beforeA = state(seed.layerA)
        let beforeB = state(seed.layerB)
        let ageBeforeClear = CACurrentMediaTime() - seed.bObserved
        let calibrated = ageBeforeClear < 0.35 && beforeA["visible"] as? Bool == true && beforeB["visible"] as? Bool == true
        if !calibrated { inconclusiveReasons.append("Independent source-clear control did not begin with both live visible layers before350ms pruning") }
        // This is the documented source-reset clear pair, NOT an empty camera frame.
        callbackTrace.append(["callback": "source-clear-onDetections", "detections": []])
        seed.controller.scanner.onDetections?([])
        callbackTrace.append(["callback": "source-clear-onTrack", "tracks": []])
        seed.controller.scanner.onTrack?([])
        record("source_clear_removes_overlays", kind: "control",
               passed: calibrated && seed.layerA.superlayer == nil && seed.layerB.superlayer == nil,
               details: ["calibrated": calibrated, "ageBeforeClearSeconds": ageBeforeClear,
                         "aBefore": beforeA, "bBefore": beforeB, "aDetached": seed.layerA.superlayer == nil,
                         "bDetached": seed.layerB.superlayer == nil, "sourceClearPairOnly": true])
        observe(seed.controller)
    }
    func run() async {
        persist("running")
        if let controller = await mount() {
            let seeded = await seed(controller, label: "capability")
            capabilityPassed = seeded != nil
            record("projection_capability", kind: "capability", passed: capabilityPassed,
                   details: ["projectionAndActualPresentationUsable": capabilityPassed, "connectionPresent": preview(controller)?.connection != nil])
        }
        await cleanup()
        if capabilityPassed {
            if let controller = await mount(), let seeded = await seed(controller, label: "ordinary") { await movement(seeded, backward: false) }
            await cleanup()
            if let controller = await mount(), let seeded = await seed(controller, label: "backward") {
                await movement(seeded, backward: true)
            }
            await cleanup()
            if let controller = await mount(), let seeded = await seed(controller, label: "source-clear") { sourceClear(seeded) }
            await cleanup()
        }
        if cameraStarted { harnessErrors.append("Unexpected camera/session startup was observed") }
        let phase = !harnessErrors.isEmpty ? "harness-error" : !inconclusiveReasons.isEmpty ? "harness-inconclusive" : "complete"
        persist(phase)
    }
}

@MainActor
private final class BatchProbeScanner: QRGenScannerViewController {
    var didAppearCount = 0
    var didDisappearCount = 0
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); didAppearCount += 1 }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); didDisappearCount += 1 }
}
