// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Follows barcodes across frames for batch mode.
///
/// Detections are matched to existing tracks by symbology + data (the closest track wins when the
/// same data appears several times), falling back to bounding-box overlap within the same symbology.
/// Tracks that have not been seen for ``maxAge`` milliseconds are dropped. Ids are stable for the
/// lifetime of a track.
struct BarcodeTracker: Sendable {
    /// Tracks unseen for longer than this (ms) are dropped.
    var maxAge: Int64 = 500
    /// Minimum intersection-over-union for the bounding-box fallback.
    var minimumOverlap: Double = 0.3

    private(set) var tracks: [TrackedBarcode] = []
    private var nextID = 1

    /// Updates the tracks with this frame's detections and returns every live track (oldest first).
    mutating func update(with detections: [Barcode], now: Int64) -> [TrackedBarcode] {
        tracks.removeAll { now - $0.lastSeen > maxAge }

        // Score every (detection, track) pair, then assign greedily from the best score.
        var candidates: [(score: Double, detection: Int, track: Int)] = []
        for (d, detection) in detections.enumerated() {
            for (t, track) in tracks.enumerated() {
                let overlap = Self.intersectionOverUnion(detection.location, track.barcode.location)
                if track.barcode.dedupeKey == detection.dedupeKey {
                    let closeness = 1 / (1 + Self.centerDistance(detection.location, track.barcode.location))
                    candidates.append((2 + overlap + closeness, d, t))
                } else if track.barcode.symbology == detection.symbology, overlap >= minimumOverlap {
                    candidates.append((overlap, d, t))
                }
            }
        }
        candidates.sort { $0.score > $1.score }

        var assignedDetections = Set<Int>()
        var assignedTracks = Set<Int>()
        for candidate in candidates
        where !assignedDetections.contains(candidate.detection) && !assignedTracks.contains(candidate.track) {
            assignedDetections.insert(candidate.detection)
            assignedTracks.insert(candidate.track)
            tracks[candidate.track].barcode = detections[candidate.detection]
            tracks[candidate.track].lastSeen = now
            tracks[candidate.track].count += 1
        }
        for (d, detection) in detections.enumerated() where !assignedDetections.contains(d) {
            tracks.append(TrackedBarcode(id: String(nextID), barcode: detection, firstSeen: now, lastSeen: now, count: 1))
            nextID += 1
        }
        return tracks
    }

    /// Drops every track (new session). Ids keep increasing so they are never reused.
    mutating func reset() {
        tracks.removeAll()
    }

    static func intersectionOverUnion(_ a: Barcode.Quadrilateral, _ b: Barcode.Quadrilateral) -> Double {
        let ba = a.bounds
        let bb = b.bounds
        let width = min(ba.maxX, bb.maxX) - max(ba.minX, bb.minX)
        let height = min(ba.maxY, bb.maxY) - max(ba.minY, bb.minY)
        guard width > 0, height > 0 else { return 0 }
        let intersection = width * height
        let areaA = (ba.maxX - ba.minX) * (ba.maxY - ba.minY)
        let areaB = (bb.maxX - bb.minX) * (bb.maxY - bb.minY)
        let union = areaA + areaB - intersection
        return union > 0 ? intersection / union : 0
    }

    static func centerDistance(_ a: Barcode.Quadrilateral, _ b: Barcode.Quadrilateral) -> Double {
        let ca = a.center
        let cb = b.center
        return ((ca.x - cb.x) * (ca.x - cb.x) + (ca.y - cb.y) * (ca.y - cb.y)).squareRoot()
    }
}
