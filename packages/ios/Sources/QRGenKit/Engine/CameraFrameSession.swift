// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Decode-only packet. It cannot change tracking or report history until accepted for delivery.
struct DecodedCameraFrame: Sendable {
    var source: UInt64
    var epoch: UInt64
    var detections: [Barcode] = []
    var timestamp: Int64 = 0
    var mode: ScannerOptions.Mode = .continuous
    var duplicateWindow: Int = 1000
    var error: QRGenError?
}

/// Result of one accepted frame. Source and processing ownership travel with every callback.
struct FrameOutput: Sendable {
    var source: UInt64
    var epoch: UInt64
    var detections: [Barcode] = []
    var scans: [Barcode] = []
    var tracked: [TrackedBarcode]?
    var completedSingleScan = false
}

/// Owns spatial state independently of camera/decoder APIs so source changes can invalidate
/// in-flight work atomically. A camera replacement starts fresh tracks but keeps scan deduplication.
final class CameraFrameSession: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var epoch: UInt64 = 0
    private var duplicates = DuplicateFilter()
    private var tracker = BarcodeTracker()
    private var hadTracks = false
    private var pendingClear = false

    var source: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return generation
    }

    var processingEpoch: UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return epoch
    }

    /// Pause/resume and option changes discard old processing while keeping spatial/report history.
    @discardableResult
    func invalidateProcessing() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        epoch += 1
        return epoch
    }

    /// Invalidates captured frames before clearing their spatial state. IDs are never reused.
    @discardableResult
    func beginSource(resetDuplicateHistory: Bool = false) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        generation += 1
        epoch += 1
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

    func isCurrent(source: UInt64, epoch: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return source == generation && epoch == self.epoch
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

    /// Rejects stale frames before spatial state changes. Report eligibility is provisional:
    /// detections/track/single-pause callbacks may cancel delivery without consuming reports.
    func process(
        _ barcodes: [Barcode], source: UInt64, epoch: UInt64, now: Int64,
        mode: ScannerOptions.Mode, duplicateWindow: Int
    ) -> FrameOutput? {
        lock.lock()
        defer { lock.unlock() }
        guard source == generation, epoch == self.epoch else { return nil }
        var output = FrameOutput(source: source, epoch: epoch, detections: barcodes)
        var preview = duplicates
        for barcode in barcodes {
            if preview.shouldReport(barcode.dedupeKey, now: now, window: duplicateWindow) {
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

    /// Called immediately before scan delivery, after every earlier user callback has retained
    /// ownership. Recompute against current history so an abandoned frame never loses a report.
    func commitScans(_ output: FrameOutput, now: Int64, duplicateWindow: Int) -> [Barcode]? {
        lock.lock()
        defer { lock.unlock() }
        guard output.source == generation, output.epoch == epoch else { return nil }
        return output.scans.filter { duplicates.shouldReport($0.dedupeKey, now: now, window: duplicateWindow) }
    }
}
