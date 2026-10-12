import AVFoundation
import CryptoKit
import QuartzCore
import QRGenKit
import UIKit
import XCTest

// Uncompiled private draft. Only native app/window, time and decoder delivery
// boundaries belong to the fixture. All QRGen geometry and drawing stay real.
private enum ProbeFailure: Error {
    case harness(String)
    case capabilityNotEstablished(String)
}

@MainActor
private final class AppearanceCounts {
    var appeared = 0
    var disappeared = 0
}

@MainActor
private final class ObservedScannerController: QRGenScannerViewController {
    let appearances = AppearanceCounts()

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        appearances.appeared += 1
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        appearances.disappeared += 1
    }
}

final class HighlightCapabilityTests: XCTestCase {
    @MainActor
    func testActualUIKitOutlineCapability() async throws {
        var receipt: [String: Any] = [
            "schemaVersion": 1,
            "probe": "actual-uikit-inputless-preview-outline-capability",
            "runID": UUID().uuidString,
            "baseSha": "978214dcaf20451b72a185e1066cc09eabd0a30f",
            "status": "harness_started",
            "regressionAssertions": 0,
            "boundary": "actual Vision image geometry delivered through the already-bound public onDetections callback",
            "physicalCameraClaim": false,
            "trackerClaim": false,
            "systemVersion": UIDevice.current.systemVersion,
            "process": ProcessInfo.processInfo.processName,
        ]
        var controller: ObservedScannerController?
        weak var weakController: ObservedScannerController?
        var window: UIWindow?
        var previousKeyWindow: UIWindow?
        var appearances: AppearanceCounts?
        var caughtError: Error?

        do {
            guard let scene = try await Probe.foregroundScene() else {
                throw ProbeFailure.harness("No real foreground UIWindowScene from the hosted app")
            }
            previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
            let probe = ObservedScannerController(options: ScannerOptions(
                symbologies: ["qr"], mode: .continuous, beep: false, vibrate: false,
                viewfinder: ScannerOptions.Viewfinder.none
            ))
            probe.startsAutomatically = false
            probe.showsCloseButton = false
            probe.showsTorchButton = false
            probe.showsToast = false
            controller = probe
            weakController = probe
            appearances = probe.appearances
            let probeWindow = UIWindow(windowScene: scene)
            probeWindow.frame = scene.coordinateSpace.bounds
            probeWindow.rootViewController = probe
            window = probeWindow
            probeWindow.makeKeyAndVisible()
            probeWindow.layoutIfNeeded()
            let mounted = try await Probe.waitUntil(seconds: 3) {
                probe.appearances.appeared > 0 && probe.viewIfLoaded?.window === probeWindow
            }
            guard mounted, !probeWindow.isHidden, probeWindow.bounds.width > 0,
                  probeWindow.bounds.height > 0 else {
                throw ProbeFailure.harness("Actual visible controller appearance/layout did not complete")
            }
            let previewLayers = Probe.views(probe.view).compactMap { $0.layer as? AVCaptureVideoPreviewLayer }
            guard previewLayers.count == 1, let preview = previewLayers.first,
                  preview.session === probe.scanner.captureSession else {
                throw ProbeFailure.harness("Missing or ambiguous actual controller preview/session identity")
            }
            let session = probe.scanner.captureSession
            guard !session.isRunning, session.inputs.isEmpty, session.outputs.isEmpty,
                  probe.scanner.state == .idle, let deliver = probe.scanner.onDetections else {
                throw ProbeFailure.harness("Camera-free idle session or original bound delivery precondition failed")
            }
            receipt["mount"] = [
                "sceneActivation": scene.activationState.rawValue,
                "window": Probe.rect(probeWindow.bounds), "windowHidden": probeWindow.isHidden,
                "windowAlpha": Double(probeWindow.alpha), "appeared": probe.appearances.appeared,
                "controllerClass": String(reflecting: type(of: probe)),
                "scannerClass": String(reflecting: type(of: probe.scanner)),
                "previewClass": String(reflecting: type(of: preview)),
                "sameActualCaptureSession": true, "previewFrame": Probe.rect(preview.frame),
                "previewBounds": Probe.rect(preview.bounds), "videoGravity": preview.videoGravity.rawValue,
                "previewConnectionPresent": preview.connection != nil,
                "inputCount": session.inputs.count, "outputCount": session.outputs.count,
                "captureRunning": session.isRunning,
            ]

            // Raster composition is an image-input fixture, never barcode geometry.
            // The generated QR is deliberately never displayed in the app window.
            let payload = "qrgen-ios-native-highlight-capability-978214d"
            let generated = try QRGen.generate(payload, symbology: .qr, scale: 8, ecLevel: "M")
            let image = try Probe.centralImage(generated)
            let inputPNG = try Probe.png(UIImage(cgImage: image))
            Probe.attach(inputPNG, name: "generated-image-input-not-displayed.png", type: "public.png", to: self)
            let decoded = try await QRGen.scan(image: image, symbologies: ["qr"])
            guard let barcode = decoded.first(where: { $0.data == payload && $0.symbology == .qr }),
                  barcode.frameSize.width > 0, barcode.frameSize.height > 0,
                  barcode.location.points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }),
                  Probe.area(barcode.location.points.map { CGPoint(x: $0.x, y: $0.y) }) > 0 else {
                throw ProbeFailure.capabilityNotEstablished("Actual Vision decode did not yield the expected positive-area barcode")
            }
            receipt["decodedBarcode"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(barcode))
            receipt["inputPNG_SHA256"] = SHA256.hash(data: inputPNG).map { String(format: "%02x", $0) }.joined()
            receipt["actualPreviewConvertedCorners"] = preview.layerPoints(for: barcode).map(Probe.point)
            receipt["actualPreviewConvertedArea"] = Probe.scalar(Probe.area(preview.layerPoints(for: barcode)))
            let beforeIDs = Set(Probe.layers(probeWindow.layer).map(ObjectIdentifier.init))
            let before = try Probe.capture(probeWindow)
            guard before.drawSucceeded else { throw ProbeFailure.harness("Window baseline drawHierarchy failed") }
            Probe.attach(before.png, name: "window-before-detection.png", type: "public.png", to: self)
            let baselinePixels = try Probe.accentPixels(before.image, accent: probe.accentColor)
            receipt["baselineAccentPixels"] = baselinePixels
            let started = CACurrentMediaTime()
            var samples: [[String: Any]] = []
            var established = false
            var lastCapture = before
            var deliveries = 0

            // Repeated, explicitly modeled decoder deliveries keep the production
            // freshness clock live while real Core Animation can present. No
            // private clock, appearance method, animation or geometry is replaced.
            while CACurrentMediaTime() - started < 2, samples.count < 40 {
                deliver([barcode])
                deliveries += 1
                try await Task.sleep(nanoseconds: 50_000_000)
                let capture = try Probe.capture(probeWindow)
                lastCapture = capture
                let emitted = Probe.layers(probeWindow.layer).compactMap { layer -> CAShapeLayer? in
                    guard !beforeIDs.contains(ObjectIdentifier(layer)) else { return nil }
                    return layer as? CAShapeLayer
                }
                let observations = emitted.map { Probe.observe($0, in: probeWindow) }
                let accentPixels = try Probe.accentPixels(capture.image, accent: probe.accentColor)
                let positiveShapes = observations.filter { ($0["positiveVisiblePresentation"] as? Bool) == true }
                let positiveRaster = capture.drawSucceeded && accentPixels > baselinePixels + 8
                samples.append([
                    "elapsed": CACurrentMediaTime() - started, "manualDecoderDeliveries": deliveries,
                    "newShapeLayers": observations, "windowDrawSucceeded": capture.drawSucceeded,
                    "accentPixels": accentPixels, "accentPixelIncrease": accentPixels - baselinePixels,
                    "positiveRaster": positiveRaster,
                ])
                if !positiveShapes.isEmpty && positiveRaster { established = true; break }
            }
            receipt["samples"] = samples
            receipt["manualDecoderDeliveries"] = deliveries
            receipt["newLayerIdentityRequired"] = true
            receipt["generatedInputDisplayed"] = false
            Probe.attach(lastCapture.png, name: "window-after-decoder-delivery.png", type: "public.png", to: self)
            guard established else {
                throw ProbeFailure.capabilityNotEstablished("Inputless actual preview/renderer did not establish a positive visible outline and matching raster within the bounded probe")
            }
            guard !session.isRunning, session.inputs.isEmpty, session.outputs.isEmpty else {
                throw ProbeFailure.harness("Unexpected capture startup during the camera-free capability probe")
            }
            receipt["status"] = "supported"
        } catch ProbeFailure.capabilityNotEstablished(let reason) {
            receipt["status"] = "capability_not_established"
            receipt["reason"] = reason
        } catch {
            receipt["status"] = "harness_failure"
            receipt["reason"] = String(describing: error)
            caughtError = error
        }

        // Close only this fixture-owned window. Actual UIKit disappearance must
        // run the controller's own cancellation path; no private tasks are read.
        controller?.scanner.onDetections?([])
        window?.rootViewController = UIViewController()
        do {
            _ = try await Probe.waitUntil(seconds: 2) { (appearances?.disappeared ?? 0) > 0 }
        } catch { caughtError = caughtError ?? error }
        // BarcodeScanner.stop deliberately keeps an already-idle scanner idle.
        let idleAfterDisappearance = controller?.scanner.state == .idle
        let captureQuietAfterDisappearance = controller.map {
            !$0.scanner.captureSession.isRunning && $0.scanner.captureSession.inputs.isEmpty
                && $0.scanner.captureSession.outputs.isEmpty
        } ?? true
        controller?.scanner.stop() // Bounded public cleanup even after a host failure.
        window?.isHidden = true
        window?.rootViewController = nil
        previousKeyWindow?.makeKeyAndVisible()
        let cleanupComplete = controller == nil || (
            (appearances?.disappeared ?? 0) > 0 && idleAfterDisappearance && captureQuietAfterDisappearance
                && window?.isHidden == true
                && window?.rootViewController == nil
        )
        receipt["cleanup"] = [
            "actualDisappearances": appearances?.disappeared ?? 0,
            "idleAfterActualDisappearance": idleAfterDisappearance,
            "captureQuietAfterActualDisappearance": captureQuietAfterDisappearance,
            "ownedWindowHidden": window?.isHidden ?? true,
            "ownedRootDetached": window?.rootViewController == nil,
            "completed": cleanupComplete,
        ]
        controller = nil
        window = nil
        await Task.yield()
        receipt["controllerReleasedAtFinalObservation"] = weakController == nil
        if !cleanupComplete || caughtError != nil {
            receipt["status"] = "harness_failure"
            receipt["cleanupFailure"] = !cleanupComplete
        }
        let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
        Probe.attach(data, name: "capability-receipt.json", type: "public.json", to: self)
        print("QRGEN_UIKIT_CAPABILITY_JSON:" + String(decoding: data, as: UTF8.self))
        if let caughtError { throw caughtError }
        guard cleanupComplete else { throw ProbeFailure.harness("Actual UIKit disappearance cleanup did not complete") }
        if receipt["status"] as? String == "capability_not_established" {
            throw XCTSkip(receipt["reason"] as? String ?? "Capability not established")
        }
        XCTAssertEqual(receipt["status"] as? String, "supported")
    }
}

@MainActor
private enum Probe {
    struct Capture { let image: UIImage; let png: Data; let drawSucceeded: Bool }

    static func waitUntil(seconds: CFTimeInterval, _ condition: () -> Bool) async throws -> Bool {
        let deadline = CACurrentMediaTime() + seconds
        repeat {
            if condition() { return true }
            try await Task.sleep(nanoseconds: 20_000_000)
        } while CACurrentMediaTime() < deadline
        return condition()
    }

    static func foregroundScene() async throws -> UIWindowScene? {
        _ = try await waitUntil(seconds: 5) {
            UIApplication.shared.connectedScenes.contains { $0.activationState == .foregroundActive && $0 is UIWindowScene }
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }

    static func views(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap(views) }
    static func layers(_ layer: CALayer) -> [CALayer] { [layer] + (layer.sublayers ?? []).flatMap(layers) }
    static func scalar(_ value: CGFloat) -> Any { value.isFinite ? Double(value) : String(describing: value) }
    static func point(_ value: CGPoint) -> [String: Any] { ["x": scalar(value.x), "y": scalar(value.y)] }
    static func rect(_ value: CGRect) -> [String: Any] {
        ["x": scalar(value.minX), "y": scalar(value.minY), "width": scalar(value.width), "height": scalar(value.height)]
    }

    static func area(_ points: [CGPoint]) -> CGFloat {
        guard points.count >= 3 else { return 0 }
        return abs(points.indices.reduce(CGFloat.zero) { total, index in
            let next = points[(index + 1) % points.count]
            return total + points[index].x * next.y - next.x * points[index].y
        }) / 2
    }

    static func pathPoints(_ path: CGPath?) -> [CGPoint] {
        var points: [CGPoint] = []
        path?.applyWithBlock { element in
            switch element.pointee.type {
            case .moveToPoint, .addLineToPoint: points.append(element.pointee.points[0])
            default: break
            }
        }
        return points
    }

    static func observe(_ shape: CAShapeLayer, in window: UIWindow) -> [String: Any] {
        let presentation = shape.presentation() as? CAShapeLayer
        let modelPoints = pathPoints(shape.path)
        let presentationPoints = pathPoints(presentation?.path)
        let modelBounds = shape.path?.boundingBoxOfPath ?? .zero
        var visible = window.layer.convert(modelBounds, from: shape).intersection(window.bounds)
        var opacity: Float = 1
        var hidden = false
        var ancestor: CALayer? = shape
        while let current = ancestor {
            hidden = hidden || current.isHidden
            opacity *= current.presentation()?.opacity ?? current.opacity
            if current.masksToBounds {
                visible = visible.intersection(window.layer.convert(current.bounds, from: current))
            }
            ancestor = current.superlayer
        }
        let strokeAlpha = shape.strokeColor?.alpha ?? 0
        let fillAlpha = shape.fillColor?.alpha ?? 0
        let finite = modelPoints.allSatisfy { $0.x.isFinite && $0.y.isFinite }
            && presentationPoints.allSatisfy { $0.x.isFinite && $0.y.isFinite }
        let positive = finite && modelPoints.count == 4 && presentationPoints.count == 4
            && area(modelPoints) > 1 && area(presentationPoints) > 1
            && !visible.isNull && visible.width > 1 && visible.height > 1
            && !hidden && opacity > 0.05 && presentation != nil
            && shape.lineWidth > 0 && strokeAlpha > 0 && fillAlpha > 0
        return [
            "identity": String(describing: ObjectIdentifier(shape)),
            "modelPoints": modelPoints.map(point), "modelArea": scalar(area(modelPoints)),
            "presentationPoints": presentationPoints.map(point), "presentationArea": scalar(area(presentationPoints)),
            "modelPathBounds": rect(modelBounds), "visibleIntersection": rect(visible),
            "presentationPresent": presentation != nil, "effectiveOpacity": Double(opacity),
            "hiddenAncestor": hidden, "lineWidth": scalar(shape.lineWidth),
            "strokeAlpha": scalar(strokeAlpha), "fillAlpha": scalar(fillAlpha),
            "positiveVisiblePresentation": positive,
        ]
    }

    static func centralImage(_ generated: CGImage) throws -> CGImage {
        guard let context = CGContext(data: nil, width: 720, height: 1280, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw ProbeFailure.harness("Could not compose the real generated QR image input")
        }
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: 720, height: 1280))
        context.interpolationQuality = .none
        context.draw(generated, in: CGRect(x: 220, y: 500, width: 280, height: 280))
        guard let image = context.makeImage() else { throw ProbeFailure.harness("Image raster creation failed") }
        return image
    }

    static func png(_ image: UIImage) throws -> Data {
        guard let data = image.pngData() else { throw ProbeFailure.harness("PNG encoding failed") }
        return data
    }

    static func capture(_ window: UIWindow) throws -> Capture {
        let format = UIGraphicsImageRendererFormat()
        format.scale = window.screen.scale
        format.opaque = true
        var succeeded = false
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            succeeded = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        return Capture(image: image, png: try png(image), drawSucceeded: succeeded)
    }

    static func accentPixels(_ image: UIImage, accent: UIColor) throws -> Int {
        guard let cgImage = image.cgImage else { throw ProbeFailure.harness("Window image lacks pixels") }
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard accent.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            throw ProbeFailure.harness("Actual accent color cannot be measured")
        }
        let expected = [red, green, blue].map { Int(($0 * 255).rounded()) }
        var bytes = Data(count: cgImage.width * cgImage.height * 4)
        let rendered = bytes.withUnsafeMutableBytes { storage -> Bool in
            guard let context = CGContext(data: storage.baseAddress, width: cgImage.width, height: cgImage.height,
                                          bitsPerComponent: 8, bytesPerRow: cgImage.width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: CGFloat(cgImage.width), height: CGFloat(cgImage.height)))
            return true
        }
        guard rendered else { throw ProbeFailure.harness("Window pixel measurement failed") }
        return bytes.withUnsafeBytes { (storage: UnsafeRawBufferPointer) -> Int in
            stride(from: 0, to: storage.count, by: 4).reduce(0) { total, offset in
                let matches = (0..<3).allSatisfy { abs(Int(storage[offset + $0]) - expected[$0]) <= 32 }
                return total + (matches && storage[offset + 3] > 200 ? 1 : 0)
            }
        }
    }

    static func attach(_ data: Data, name: String, type: String, to test: XCTestCase) {
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: type)
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)
    }
}
