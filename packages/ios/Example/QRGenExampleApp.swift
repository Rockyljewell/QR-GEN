// QRGen example app (SwiftUI, iOS 15+).
//
// Drop this file and ContentView.swift into a new Xcode "App" project, add the QRGenKit
// package (https://github.com/Rockyljewell/QR-GEN) and set "Privacy - Camera Usage
// Description" (NSCameraUsageDescription) in the target's Info settings.
// See packages/ios/README.md for step-by-step instructions.

import SwiftUI

@main
struct QRGenExampleApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
