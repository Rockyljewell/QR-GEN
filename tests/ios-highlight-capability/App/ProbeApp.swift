import UIKit

// Test host only. QRGenKit is linked into the hosted XCTest bundle, so the
// application does not duplicate the package's static code in two images.
@main
final class ProbeAppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting session: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Capability", sessionRole: session.role)
        configuration.delegateClass = ProbeSceneDelegate.self
        return configuration
    }
}

final class ProbeSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let root = UIViewController()
        root.view.backgroundColor = .black
        window.rootViewController = root
        self.window = window
        window.makeKeyAndVisible()
    }
}
