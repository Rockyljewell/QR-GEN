// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if os(iOS) || os(macOS)
import Foundation
#if os(iOS)
import AudioToolbox
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Scan feedback: a short tone and a success haptic.
///
/// ``BarcodeScanner`` calls this automatically according to ``ScannerOptions/beep`` and
/// ``ScannerOptions/vibrate``; custom UIs can call it directly.
@MainActor
public enum ScanFeedback {
    /// System sound played on scan (1057, the short "Tink" keypad sound).
    public static var soundID: UInt32 = 1057

    #if os(iOS)
    private static var haptics: UINotificationFeedbackGenerator?
    #endif

    /// Prepares the haptic engine to reduce latency of the first scan.
    public static func prepare() {
        #if os(iOS)
        let generator = haptics ?? UINotificationFeedbackGenerator()
        generator.prepare()
        haptics = generator
        #endif
    }

    /// Plays the scan feedback.
    public static func play(beep: Bool, vibrate: Bool) {
        if beep { playBeep() }
        if vibrate { playHaptic() }
    }

    /// Plays the scan tone (on macOS, the "Tink" system sound).
    public static func playBeep() {
        #if os(iOS)
        AudioServicesPlaySystemSound(SystemSoundID(soundID))
        #elseif canImport(AppKit)
        if let sound = NSSound(named: NSSound.Name("Tink")) {
            sound.play()
        } else {
            NSSound.beep()
        }
        #endif
    }

    /// Plays a success haptic (iPhone only; a no-op elsewhere).
    public static func playHaptic() {
        #if os(iOS)
        let generator = haptics ?? UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        generator.prepare()
        haptics = generator
        #endif
    }
}
#endif
