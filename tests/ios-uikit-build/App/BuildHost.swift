import QRGenKit
import UIKit

// Compile-only host for the current checkout's public UIKit scanner.
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

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let scanner = QRGenScannerViewController(
            options: ScannerOptions(symbologies: ["qr"], beep: false, vibrate: false)
        )
        scanner.startsAutomatically = false
        window.rootViewController = scanner
        self.window = window
        window.makeKeyAndVisible()
    }
}
