import Foundation
import QRGenKit
import UIKit

// The normal launch remains the compile-only host. Runtime probes are opt-in.
@main
@MainActor
final class BuildAppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting session: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Build", sessionRole: session.role)
        configuration.delegateClass = BuildSceneDelegate.self
        return configuration
    }
}

@MainActor
final class BuildSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var toastProbe: ToastLifecycleProbe?
    private var batchProbe: BatchOverlayProbe?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let scannerOptions = ScannerOptions(symbologies: ["qr"], beep: false, vibrate: false)
        if ProcessInfo.processInfo.arguments.contains("--qrgen-batch-overlay-probe") {
            window.rootViewController = UIViewController()
            let probe = BatchOverlayProbe(window: window)
            batchProbe = probe
            self.window = window
            window.makeKeyAndVisible()
            Task { await probe.run() }
        } else if ProcessInfo.processInfo.arguments.contains("--qrgen-toast-lifecycle-probe") {
            let scanner = LifecycleScanner(options: scannerOptions)
            scanner.startsAutomatically = false
            scanner.toastDuration = 0.5
            let navigation = UINavigationController(rootViewController: scanner)
            navigation.setNavigationBarHidden(true, animated: false)
            window.rootViewController = navigation
            let probe = ToastLifecycleProbe(window: window, navigation: navigation, scanner: scanner)
            toastProbe = probe
            self.window = window
            window.makeKeyAndVisible()
            Task { await probe.run() }
        } else {
            let scanner = QRGenScannerViewController(options: scannerOptions)
            scanner.startsAutomatically = false
            window.rootViewController = scanner
            self.window = window
            window.makeKeyAndVisible()
        }
    }
}

/// Counts actual UIKit appearance callbacks while retaining the real controller.
@MainActor
private final class LifecycleScanner: QRGenScannerViewController {
    var willAppearCount = 0
    var didAppearCount = 0
    var didDisappearCount = 0
    var lastDidAppear: TimeInterval?
    var lastDidDisappear: TimeInterval?

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        willAppearCount += 1
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        didAppearCount += 1
        lastDidAppear = ProcessInfo.processInfo.systemUptime
    }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        didDisappearCount += 1
        lastDidDisappear = ProcessInfo.processInfo.systemUptime
    }
}

@MainActor
private final class ToastLifecycleProbe {
    private let window: UIWindow
    private let navigation: UINavigationController
    private let controller: LifecycleScanner
    private let probeToken: String
    private var checks: [[String: Any]] = []
    private var harnessErrors: [String] = []
    private var scannerStates: [String] = []
    private var cameraStarted = false
    private var cleanupComplete = false

    init(window: UIWindow, navigation: UINavigationController, scanner: LifecycleScanner) {
        self.window = window
        self.navigation = navigation
        self.controller = scanner
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "--qrgen-probe-token"), arguments.indices.contains(index + 1) {
            probeToken = arguments[index + 1]
        } else {
            probeToken = "manual-unbound"
        }
        observe(scanner.scanner.state)
        scanner.scanner.onStateChange = { [weak self] state in self?.observe(state) }
    }

    private func observe(_ state: BarcodeScanner.State) {
        scannerStates.append(state.rawValue)
        if state == .starting || state == .running || state == .paused { cameraStarted = true }
    }

    private func lifecycle() -> [String: Any] {
        ["willAppear": controller.willAppearCount, "didAppear": controller.didAppearCount,
         "didDisappear": controller.didDisappearCount,
         "lastDidAppear": controller.lastDidAppear.map { $0 as Any } ?? NSNull(),
         "lastDidDisappear": controller.lastDidDisappear.map { $0 as Any } ?? NSNull()]
    }

    private func persist(_ phase: String) {
        let receipt: [String: Any] = [
            "schemaVersion": 1, "probeToken": probeToken, "phase": phase,
            "pass": phase == "complete" && checks.count == 3 && checks.allSatisfy { $0["passed"] as? Bool == true },
            "checks": checks, "harnessErrors": harnessErrors, "skippedCases": 0,
            "cameraStarted": cameraStarted, "scannerStates": scannerStates,
            "startsAutomatically": controller.startsAutomatically, "lifecycle": lifecycle(), "cleanupComplete": cleanupComplete,
            "scope": "Actual UIKit controller/navigation and public callback-driven toast lifecycle; no camera acquisition, native pixels or OS-clock adjustment.",
        ]
        do {
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: documents.appendingPathComponent("qrgen-toast-lifecycle.json"), options: .atomic)
            print("QRGEN_TOAST_PROBE phase=\(phase) checks=\(checks.count) pass=\(receipt["pass"]!)")
        } catch {
            print("QRGEN_TOAST_PROBE_WRITE_ERROR \(error)")
        }
    }

    private func calibrate(_ valid: Bool, _ message: String) {
        if !valid { harnessErrors.append(message) }
    }

    private func record(_ name: String, kind: String, passed: Bool, details: [String: Any]) {
        checks.append(["name": name, "kind": kind, "passed": passed, "details": details])
        persist("running")
    }

    private func delay(_ seconds: TimeInterval) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private func waitUntil(timeout: TimeInterval, _ predicate: () -> Bool) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while !predicate(), ProcessInfo.processInfo.systemUptime < deadline, !Task.isCancelled {
            await delay(0.02)
        }
        return predicate()
    }

    private func toast(_ payload: String) -> UIView? {
        func find(_ view: UIView) -> UIView? {
            if view.accessibilityLabel == "Probe: \(payload)" { return view }
            for child in view.subviews { if let found = find(child) { return found } }
            return nil
        }
        return find(controller.view)
    }

    private func visible(_ view: UIView?) -> Bool {
        guard let view, view.window != nil else { return false }
        var ancestor: UIView? = view
        while let current = ancestor {
            if current.isHidden || current.alpha <= 0.01 { return false }
            ancestor = current.superview
        }
        return true
    }

    private func viewState(_ view: UIView?) -> [String: Any] {
        guard let view else { return ["found": false, "visible": false] }
        return ["found": true, "identity": String(describing: ObjectIdentifier(view)),
                "visible": visible(view), "isHidden": view.isHidden,
                "alpha": Double(view.alpha), "attachedToWindow": view.window != nil,
                "accessibilityLabel": view.accessibilityLabel ?? ""]
    }

    private func toastState(_ payload: String) -> [String: Any] {
        viewState(toast(payload))
    }

    private func inject(_ payload: String) {
        calibrate(controller.scanner.onScan != nil, "Real controller scan callback was not bound")
        controller.scanner.onScan?([Barcode(data: payload, symbology: .qr, symbologyName: "Probe")])
        observe(controller.scanner.state)
    }

    func run() async {
        persist("running")
        let ready = await waitUntil(timeout: 5) {
            self.controller.didAppearCount >= 1 && self.controller.view.window === self.window &&
                UIApplication.shared.applicationState == .active
        }
        calibrate(ready, "Initial real UIKit appearance/active window did not complete")
        calibrate(!controller.startsAutomatically && !cameraStarted, "Camera-free fixture precondition failed")

        let ordinary = "TOAST-PROBE-ORDINARY"
        inject(ordinary)
        let ordinaryVisible = visible(toast(ordinary))
        let ordinaryStart = ProcessInfo.processInfo.systemUptime
        let ordinaryHidden = await waitUntil(timeout: 3) { self.toast(ordinary)?.isHidden == true }
        record("ordinary_toast_hides", kind: "control", passed: ordinaryVisible && ordinaryHidden,
               details: ["visibleBeforeWait": ordinaryVisible, "hiddenAfterWait": ordinaryHidden,
                         "elapsedSeconds": ProcessInfo.processInfo.systemUptime - ordinaryStart, "toast": toastState(ordinary)])

        let old = "TOAST-PROBE-OLD"
        inject(old)
        let shownAt = ProcessInfo.processInfo.systemUptime
        let oldToast = toast(old)
        let oldVisible = visible(oldToast)
        let oldToastBefore = viewState(oldToast)
        let before = lifecycle()
        let appearances = controller.didAppearCount
        let disappearances = controller.didDisappearCount
        navigation.pushViewController(UIViewController(), animated: false)
        let disappeared = await waitUntil(timeout: 2) { self.controller.didDisappearCount > disappearances }
        let disappearedAt = controller.lastDidDisappear
        navigation.popViewController(animated: false)
        let returned = await waitUntil(timeout: 2) {
            self.controller.didAppearCount > appearances && self.navigation.topViewController === self.controller &&
                self.controller.view.window === self.window
        }
        let returnedAt = controller.lastDidAppear
        let disappearanceDelay = disappearedAt.map { $0 - shownAt }
        let returnDelay = returnedAt.map { $0 - shownAt }
        let disappearedBeforeDeadline = disappearanceDelay.map { $0 >= 0 && $0 < 0.5 } ?? false
        let returnedBeforeDeadline = returnDelay.map { $0 >= 0 && $0 < 0.5 } ?? false
        let sameController = navigation.viewControllers.first === controller && navigation.topViewController === controller
        let calibrated = oldVisible && disappeared && returned && sameController &&
            disappearedBeforeDeadline && returnedBeforeDeadline
        calibrate(calibrated, "Navigation/visibility did not establish disappearance and return before the original toast deadline")
        let waitStart = ProcessInfo.processInfo.systemUptime
        await delay(1.2)
        let waited = ProcessInfo.processInfo.systemUptime - waitStart
        calibrate(waited >= 1, "Returned-view observation occurred before the original toast duration elapsed")
        let observationCalibrated = navigation.topViewController === controller && controller.view.window === window &&
            UIApplication.shared.applicationState == .active
        calibrate(observationCalibrated, "Returned controller/window was not active at the final toast observation")
        let staleVisible = visible(oldToast)
        record("reappearance_clears_old_toast", kind: "target", passed: calibrated && waited >= 1 && observationCalibrated && !staleVisible,
               details: ["visibleBeforePush": oldVisible, "disappeared": disappeared, "returned": returned,
                         "sameController": sameController, "calibrated": calibrated,
                         "disappearanceDelaySeconds": disappearanceDelay.map { $0 as Any } ?? NSNull(),
                         "returnDelaySeconds": returnDelay.map { $0 as Any } ?? NSNull(),
                         "waitAfterReturnSeconds": waited, "observationCalibrated": observationCalibrated,
                         "lifecycleBefore": before, "lifecycleAfter": lifecycle(),
                         "capturedOldToastBefore": oldToastBefore, "capturedOldToastAfter": viewState(oldToast),
                         "lookupToastAfter": toastState(old)])

        let fresh = "TOAST-PROBE-FRESH"
        inject(fresh)
        let freshVisible = visible(toast(fresh))
        let freshStart = ProcessInfo.processInfo.systemUptime
        let freshHidden = await waitUntil(timeout: 3) { self.toast(fresh)?.isHidden == true }
        record("fresh_toast_hides", kind: "control", passed: freshVisible && freshHidden,
               details: ["visibleBeforeWait": freshVisible, "hiddenAfterWait": freshHidden,
                         "elapsedSeconds": ProcessInfo.processInfo.systemUptime - freshStart, "toast": toastState(fresh)])
        observe(controller.scanner.state)
        calibrate(!cameraStarted, "Unexpected scanner startup was observed")
        let cleanupDisappearances = controller.didDisappearCount
        window.rootViewController = UIViewController()
        cleanupComplete = await waitUntil(timeout: 2) {
            self.controller.didDisappearCount > cleanupDisappearances && self.controller.view.window == nil
        }
        calibrate(cleanupComplete, "Real UIKit cleanup disappearance did not complete")
        observe(controller.scanner.state)
        persist(harnessErrors.isEmpty ? "complete" : "harness-error")
    }
}
