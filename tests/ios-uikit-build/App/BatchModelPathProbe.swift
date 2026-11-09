import AVFoundation
import Foundation
import QRGenKit
import UIKit

/// Separate, opt-in UI-consumer selection witness. It reads synchronous model paths,
/// including fractional native no-input projection; it makes no visible-overlay claim.
@MainActor
final class BatchModelPathProbe {
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
    private var activeController: ModelPathScanner?
    private var semanticCasesRun = 0
    private let semanticNames = ["ordinary_batch_model_path", "backward_epoch_batch_model_path", "source_clear_detaches_model_paths"]
    private let wallStart: Int64 = 1_700_000_000_000

    init(window: UIWindow) {
        self.window = window
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--qrgen-probe-token"), args.indices.contains(index + 1) {
            probeToken = args[index + 1]
        } else { probeToken = "manual-unbound" }
    }
    private func finite(_ value: CGFloat) -> Any {
        guard value.isFinite else { return NSNull() }
        return Double(value)
    }
    private func pointsJSON(_ points: [CGPoint]) -> [[String: Any]] { points.map { ["x": finite($0.x), "y": finite($0.y)] } }
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
            "visibleOverlayClaim": false, "presentationInspected": false, "nativeSessionExecuted": false, "modelTimesControlled": true,
            "scope": "Actual UIKit UI-consumer record selection via synchronous CAShapeLayer.model.path snapshots at the public accepted-callback boundary. Controlled nominal paired model inputs0/40/220ms match separately tested native session output. Existing native preview conversion is used unchanged, including fractional no-input results. No presentation, visible overlay, pixels, live elapsed/cadence, camera acquisition, native session execution, OS-clock adjustment or field/parity claim.",
        ]
        do {
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: documents.appendingPathComponent("qrgen-batch-model-path.json"), options: .atomic)
            print("QRGEN_BATCH_MODEL_PATH_PROBE phase=\(phase) checks=\(checks.count) pass=\(receipt["pass"]!)")
        } catch { print("QRGEN_BATCH_MODEL_PATH_PROBE_WRITE_ERROR \(error)") }
    }
    private func record(_ name: String, kind: String, passed: Bool, details: [String: Any]) {
        checks.append(["name": name, "kind": kind, "passed": passed, "details": details])
        if kind != "capability" { semanticCasesRun += 1 }
        persist("running")
    }
    private func waitUntil(timeout: TimeInterval, _ predicate: () -> Bool) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while !predicate(), ProcessInfo.processInfo.systemUptime < deadline, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return predicate()
    }
    private func observe(_ controller: ModelPathScanner) {
        scannerStates.append(controller.scanner.state.rawValue)
        if controller.scanner.state != .idle && controller.scanner.state != .stopped { cameraStarted = true }
        if controller.scanner.captureSession.isRunning || !controller.scanner.captureSession.inputs.isEmpty { cameraStarted = true }
    }
    private func mount() async -> ModelPathScanner? {
        let controller = ModelPathScanner(options: ScannerOptions(symbologies: ["qr"], mode: .batch, beep: false, vibrate: false))
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
            harnessErrors.append("Actual UIKit appearance, bound callbacks or no-camera precondition failed"); return nil
        }
        return controller
    }
    private func cleanup() async {
        guard let controller = activeController else { return }
        let before = controller.didDisappearCount
        window.rootViewController = UIViewController()
        let cleaned = await waitUntil(timeout: 2) { controller.didDisappearCount > before && controller.view.window == nil }
        cleanupComplete = cleanupComplete && cleaned
        if !cleaned { harnessErrors.append("Actual UIKit cleanup disappearance failed") }
        observe(controller)
        activeController = nil
    }
    private func descendants(_ root: CALayer) -> [CALayer] { [root] + (root.sublayers ?? []).flatMap { descendants($0) } }
    private func shapes(_ controller: ModelPathScanner) -> [CAShapeLayer] { descendants(controller.view.layer).compactMap { $0 as? CAShapeLayer } }
    private func preview(_ controller: ModelPathScanner) -> AVCaptureVideoPreviewLayer? {
        let found = descendants(controller.view.layer).compactMap { $0 as? AVCaptureVideoPreviewLayer }
        return found.count == 1 ? found.first : nil
    }
    private func a(_ epoch: Int64, moved: Bool = false) -> Barcode { barcode("BATCH-PROBE-A", x: moved ? 922 : 768, y: 454, epoch: epoch) }
    private func b(_ epoch: Int64) -> Barcode { barcode("BATCH-PROBE-B", x: 1056, y: 562, epoch: epoch) }
    private func barcode(_ payload: String, x: Double, y: Double, epoch: Int64) -> Barcode {
        Barcode(data: payload, symbology: .qr,
                location: .init(topLeft: .init(x: x, y: y), topRight: .init(x: x + 96, y: y),
                                bottomRight: .init(x: x + 96, y: y + 54), bottomLeft: .init(x: x, y: y + 54)),
                frameSize: .init(width: 1920, height: 1080), timestamp: epoch)
    }
    private func inject(_ controller: ModelPathScanner, detections: [Barcode], tracks: [TrackedBarcode], label: String, modelElapsedMS: Int) {
        // Replay separately validated accepted-frame models, with controlled times.
        // Native nonempty detections precede tracks. No empty camera frame is synthesized.
        callbackTrace.append(["callback": "onDetections", "label": label, "modelElapsedMilliseconds": modelElapsedMS, "detections": encoded(detections)])
        controller.scanner.onDetections?(detections)
        callbackTrace.append(["callback": "onTrack", "label": label, "modelElapsedMilliseconds": modelElapsedMS, "tracks": encoded(tracks)])
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
    private func modelPoints(_ layer: CAShapeLayer) -> [CGPoint] { pathPoints(layer.path).map { layer.convert($0, to: window.layer) } }
    private func projected(_ code: Barcode, preview: AVCaptureVideoPreviewLayer) -> [CGPoint] { preview.layerPoints(for: code).map { preview.convert($0, to: window.layer) } }
    private func area(_ points: [CGPoint]) -> CGFloat {
        guard points.count == 4 else { return 0 }
        return abs(points.indices.reduce(CGFloat.zero) { sum, i in
            let next = (i + 1) % points.count
            return sum + points[i].x * points[next].y - points[next].x * points[i].y
        }) / 2
    }
    private func bounds(_ points: [CGPoint]) -> CGRect {
        guard !points.isEmpty else { return .null }
        let xs = points.map(\.x), ys = points.map(\.y)
        guard let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max() else { return .null }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
    private func distance(_ left: [CGPoint], _ right: [CGPoint]) -> CGFloat {
        guard left.count == 4 && right.count == 4 else { return .infinity }
        return zip(left, right).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? .infinity
    }
    private func gap(_ left: [CGPoint], _ right: [CGPoint]) -> CGFloat {
        let a = bounds(left), b = bounds(right)
        return hypot(max(0, max(a.minX - b.maxX, b.minX - a.maxX)), max(0, max(a.minY - b.maxY, b.minY - a.maxY)))
    }
    private func usable(_ points: [CGPoint], tolerance: CGFloat) -> Bool {
        points.count == 4 && points.allSatisfy { $0.x.isFinite && $0.y.isFinite } &&
            bounds(points).width > 64 * tolerance && bounds(points).height > 64 * tolerance && area(points) > pow(64 * tolerance, 2)
    }
    private func state(_ layer: CAShapeLayer) -> [String: Any] {
        ["identity": String(describing: ObjectIdentifier(layer)), "attached": layer.superlayer != nil,
         "rawModelPoints": pointsJSON(pathPoints(layer.path)), "modelPointsInWindow": pointsJSON(modelPoints(layer))]
    }
    private struct Seed {
        let controller: ModelPathScanner
        let layerA: CAShapeLayer
        let layerB: CAShapeLayer
        let expectedA: [CGPoint]
        let expectedMovedA: [CGPoint]
        let expectedB: [CGPoint]
        let tolerance: CGFloat
    }
    private func seed(_ controller: ModelPathScanner, label: String) -> Seed? {
        guard let preview = preview(controller) else { inconclusiveReasons.append("No unique native preview layer"); return nil }
        let expectedA = projected(a(wallStart), preview: preview)
        let expectedMovedA = projected(a(wallStart, moved: true), preview: preview)
        let expectedB = projected(b(wallStart), preview: preview)
        let coordinates = (expectedA + expectedMovedA + expectedB).flatMap { [abs($0.x), abs($0.y)] }
        let scale = coordinates.filter(\.isFinite).max() ?? 0
        let tolerance = max(CGFloat(1e-9), scale * 1e-7)
        let capable = usable(expectedA, tolerance: tolerance) && usable(expectedMovedA, tolerance: tolerance) && usable(expectedB, tolerance: tolerance) &&
            distance(expectedA, expectedMovedA) > 64 * tolerance && gap(expectedA, expectedB) > 64 * tolerance && gap(expectedMovedA, expectedB) > 64 * tolerance
        callbackTrace.append(["callback": "model-path-capability", "label": label, "connectionPresent": preview.connection != nil,
                              "captureInputs": controller.scanner.captureSession.inputs.count, "a": pointsJSON(expectedA),
                              "movedA": pointsJSON(expectedMovedA), "b": pointsJSON(expectedB), "tolerance": finite(tolerance),
                              "scale": finite(scale), "usable": capable, "movement": finite(distance(expectedA, expectedMovedA))])
        guard capable else { inconclusiveReasons.append("Native model projection lacks finite nonzero distinct geometry at scale-relative tolerance (\(label))"); return nil }
        let before = Set(shapes(controller).map(ObjectIdentifier.init))
        inject(controller, detections: [a(wallStart)], tracks: [.init(id: "1", barcode: a(wallStart), firstSeen: wallStart, lastSeen: wallStart, count: 1)], label: label + "-A", modelElapsedMS: 0)
        let newA = shapes(controller).filter { !before.contains(ObjectIdentifier($0)) }
        guard newA.count == 1 else { inconclusiveReasons.append("First model did not identify one new A shape (\(label))"); return nil }
        let second = wallStart + 40
        let beforeB = Set(shapes(controller).map(ObjectIdentifier.init))
        inject(controller, detections: [a(second), b(second)], tracks: [
            .init(id: "1", barcode: a(second), firstSeen: wallStart, lastSeen: second, count: 2),
            .init(id: "2", barcode: b(second), firstSeen: second, lastSeen: second, count: 1),
        ], label: label + "-AB", modelElapsedMS: 40)
        let newB = shapes(controller).filter { !beforeB.contains(ObjectIdentifier($0)) }
        guard newB.count == 1, newA[0].superlayer === newB[0].superlayer,
              distance(modelPoints(newA[0]), expectedA) <= tolerance, distance(modelPoints(newB[0]), expectedB) <= tolerance else {
            inconclusiveReasons.append("Seed shape identity/model paths do not match independent native projection (\(label))"); return nil
        }
        callbackTrace.append(["callback": "seed-model-paths", "label": label, "a": state(newA[0]), "b": state(newB[0])])
        return Seed(controller: controller, layerA: newA[0], layerB: newB[0], expectedA: expectedA,
                    expectedMovedA: expectedMovedA, expectedB: expectedB, tolerance: tolerance)
    }
    private func movement(_ seed: Seed, backward: Bool) {
        let name = backward ? "backward_epoch_batch_model_path" : "ordinary_batch_model_path"
        let current = wallStart + 220 - (backward ? 60_000 : 0)
        let beforeA = state(seed.layerA), beforeB = state(seed.layerB)
        inject(seed.controller, detections: [a(current, moved: true)], tracks: [
            .init(id: "1", barcode: a(current, moved: true), firstSeen: wallStart, lastSeen: current, count: 3),
            .init(id: "2", barcode: b(wallStart + 40), firstSeen: wallStart + 40, lastSeen: wallStart + 40, count: 1),
        ], label: name + "-movedA-retainedB", modelElapsedMS: 220)
        // No await, presentation read, visibility assertion or target-success polling.
        let afterA = state(seed.layerA), afterB = state(seed.layerB)
        let moved = seed.layerA.superlayer != nil && distance(modelPoints(seed.layerA), seed.expectedMovedA) <= seed.tolerance
        let stationaryB = seed.layerB.superlayer != nil && distance(modelPoints(seed.layerB), seed.expectedB) <= seed.tolerance
        record(name, kind: backward ? "target" : "control", passed: moved && stationaryB,
               details: ["liveAModelPathMoved": moved, "retainedBModelPathUnchanged": stationaryB,
                         "aBefore": beforeA, "bBefore": beforeB, "aAfter": afterA, "bAfter": afterB,
                         "expectedMovedA": pointsJSON(seed.expectedMovedA), "expectedB": pointsJSON(seed.expectedB),
                         "tolerance": finite(seed.tolerance), "modelElapsedMilliseconds": 220, "retainedBModelAgeMilliseconds": 180,
                         "aCurrentEpoch": current, "bRetainedEpoch": wallStart + 40, "epochCorrectionMilliseconds": backward ? -60_000 : 0])
    }
    private func sourceClear(_ seed: Seed) {
        let beforeA = state(seed.layerA), beforeB = state(seed.layerB)
        // Explicit native source-reset callback pair; not an empty camera frame.
        callbackTrace.append(["callback": "source-clear-onDetections", "detections": []])
        seed.controller.scanner.onDetections?([])
        callbackTrace.append(["callback": "source-clear-onTrack", "tracks": []])
        seed.controller.scanner.onTrack?([])
        record("source_clear_detaches_model_paths", kind: "control", passed: seed.layerA.superlayer == nil && seed.layerB.superlayer == nil,
               details: ["aBefore": beforeA, "bBefore": beforeB, "aDetached": seed.layerA.superlayer == nil,
                         "bDetached": seed.layerB.superlayer == nil, "sourceClearPairOnly": true])
        observe(seed.controller)
    }
    func run() async {
        persist("running")
        if let controller = await mount() {
            capabilityPassed = seed(controller, label: "capability") != nil
            record("model_path_capability", kind: "capability", passed: capabilityPassed, details: ["nativeModelPathGeometryUsable": capabilityPassed])
        }
        await cleanup()
        if capabilityPassed {
            if let controller = await mount(), let seeded = seed(controller, label: "ordinary") { movement(seeded, backward: false) }
            await cleanup()
            if let controller = await mount(), let seeded = seed(controller, label: "backward") { movement(seeded, backward: true) }
            await cleanup()
            if let controller = await mount(), let seeded = seed(controller, label: "source-clear") { sourceClear(seeded) }
            await cleanup()
        }
        if cameraStarted { harnessErrors.append("Unexpected scanner/camera startup") }
        persist(!harnessErrors.isEmpty ? "harness-error" : !inconclusiveReasons.isEmpty ? "harness-inconclusive" : "complete")
    }
}

@MainActor
private final class ModelPathScanner: QRGenScannerViewController {
    var didAppearCount = 0
    var didDisappearCount = 0
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); didAppearCount += 1 }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); didDisappearCount += 1 }
}
