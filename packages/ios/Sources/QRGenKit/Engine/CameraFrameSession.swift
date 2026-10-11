// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Result of one processed frame. The captured source travels with queued callbacks.
struct FrameOutput: Sendable {
    var source: UInt64
    var detections: [Barcode] = []
    var scans: [Barcode] = []
    var tracked: [TrackedBarcode]?
    var completedSingleScan = false
    var error: QRGenError?
}

/// Owns spatial state independently of camera/decoder APIs so source changes can invalidate
/// in-flight work atomically. A camera replacement starts fresh tracks but keeps scan deduplication.
final class CameraFrameSession: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var duplicates = DuplicateFilter()
    private var tracker = BarcodeTracker()
    private var hadTracks = false
    private var pendingClear = false

    var source: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    /// Invalidates captured frames before clearing their spatial state. IDs are never reused.
    @discardableResult
    func beginSource(resetDuplicateHistory: Bool = false) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        generation += 1
        pendingClear = pendingClear || hadTracks
        tracker.reset()
        hadTracks = false
        if resetDuplicateHistory { duplicates.reset() }
        return generation
    }

    func isCurrent(_ source: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return source == generation
    }

    func resetTracking() {
        lock.lock()
        defer { lock.unlock() }
        pendingClear = pendingClear || hadTracks
        tracker.reset()
        hadTracks = false
    }

    /// Consumes the clear before a user callback can reenter a source change.
    func takeTrackClear(source: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard source == generation, pendingClear else { return false }
        pendingClear = false
        return true
    }

    /// Rejects stale frames before either the duplicate filter or spatial tracker can change.
    func process(
        _ barcodes: [Barcode], source: UInt64, now: Int64,
        mode: ScannerOptions.Mode, duplicateWindow: Int
    ) -> FrameOutput? {
        lock.lock()
        defer { lock.unlock() }
        guard source == generation else { return nil }
        var output = FrameOutput(source: source, detections: barcodes)
        for barcode in barcodes {
            if duplicates.shouldReport(barcode.dedupeKey, now: now, window: duplicateWindow) {
                output.scans.append(barcode)
            }
        }
        switch mode {
        case .single:
            output.completedSingleScan = !output.scans.isEmpty
        case .continuous:
            break
        case .batch:
            let tracked = tracker.update(with: barcodes, now: now)
            if !tracked.isEmpty || hadTracks || pendingClear { output.tracked = tracked }
            hadTracks = !tracked.isEmpty
        }
        pendingClear = false
        return output.detections.isEmpty && output.tracked == nil ? nil : output
    }
}
