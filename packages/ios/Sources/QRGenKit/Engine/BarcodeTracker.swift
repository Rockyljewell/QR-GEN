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

        // Preserve the existing score preference, including exact-payload priority.
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
        if candidates.isEmpty {
            for detection in detections {
                tracks.append(TrackedBarcode(id: String(nextID), barcode: detection, firstSeen: now, lastSeen: now, count: 1))
                nextID += 1
            }
            return tracks
        }

        var detectionTrack = Array(repeating: -1, count: detections.count)
        var trackOwner = Array(repeating: -1, count: tracks.count)
        var exactDetections = Array(repeating: false, count: detections.count)
        var exactTracks = Array(repeating: false, count: tracks.count)
        for candidate in candidates
        where detectionTrack[candidate.detection] < 0 && trackOwner[candidate.track] < 0 {
            detectionTrack[candidate.detection] = candidate.track
            trackOwner[candidate.track] = candidate.detection
            if detections[candidate.detection].dedupeKey == tracks[candidate.track].barcode.dedupeKey {
                exactDetections[candidate.detection] = true
                exactTracks[candidate.track] = true
            }
        }

        // Only fallback assignments may move. An alternating path can free an
        // eligible old track instead of inventing an extra observed item.
        var fallbackTracks = Array(repeating: [Int](), count: detections.count)
        for candidate in candidates
        where detections[candidate.detection].dedupeKey != tracks[candidate.track].barcode.dedupeKey
            && !exactDetections[candidate.detection] && !exactTracks[candidate.track] {
            fallbackTracks[candidate.detection].append(candidate.track)
        }
        let fallbackOrder = detections.indices.sorted { left, right in
            let a = detections[left].location.bounds
            let b = detections[right].location.bounds
            if a.minX != b.minX { return a.minX < b.minX }
            if a.minY != b.minY { return a.minY < b.minY }
            if a.maxX != b.maxX { return a.maxX < b.maxX }
            if a.maxY != b.maxY { return a.maxY < b.maxY }
            if detections[left].dedupeKey != detections[right].dedupeKey {
                return detections[left].dedupeKey < detections[right].dedupeKey
            }
            return left < right
        }
        for root in fallbackOrder where detectionTrack[root] < 0 && !fallbackTracks[root].isEmpty {
            var queue = [root]
            var cursor = 0
            var seenDetections = Array(repeating: false, count: detections.count)
            seenDetections[root] = true
            var predecessorTrack = Array(repeating: -1, count: tracks.count)
            var freeTrack = -1
            while cursor < queue.count && freeTrack < 0 {
                let detection = queue[cursor]
                cursor += 1
                for track in fallbackTracks[detection] where predecessorTrack[track] < 0 {
                    predecessorTrack[track] = detection
                    let owner = trackOwner[track]
                    if owner < 0 {
                        freeTrack = track
                        break
                    }
                    if !seenDetections[owner] {
                        seenDetections[owner] = true
                        queue.append(owner)
                    }
                }
            }
            // Flip the path backwards; all previously matched detections stay matched.
            while freeTrack >= 0 {
                let detection = predecessorTrack[freeTrack]
                let previousTrack = detectionTrack[detection]
                detectionTrack[detection] = freeTrack
                trackOwner[freeTrack] = detection
                freeTrack = previousTrack
            }
        }

        // Apply each observation once, after the association graph is final.
        for (d, detection) in detections.enumerated() where detectionTrack[d] >= 0 {
            let track = detectionTrack[d]
            tracks[track].barcode = detection
            tracks[track].lastSeen = now
            tracks[track].count += 1
        }
        for (d, detection) in detections.enumerated() where detectionTrack[d] < 0 {
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
