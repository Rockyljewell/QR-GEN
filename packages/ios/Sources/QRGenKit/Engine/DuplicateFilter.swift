// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Implements the `duplicateFilter` option (SPEC section 4).
///
/// - `window > 0`: a key is not reported again until `window` ms after it was last reported.
/// - `window == 0`: every detection is reported.
/// - `window < 0`: each key is reported once until ``reset()``.
struct DuplicateFilter: Sendable {
    private struct ReportTime: Sendable {
        var timestamp: Int64
        var elapsed: Int64
    }
    private var lastReported: [String: ReportTime] = [:]
    private var elapsedClock = false

    /// Returns `true` when `key` should be reported and records the report.
    /// Without `elapsedTime`, `now` keeps its explicit numeric duration semantics.
    mutating func shouldReport(_ key: String, now: Int64, window: Int, elapsedTime: Int64? = nil) -> Bool {
        if window == 0 { return true }
        let duration = elapsedTime ?? now
        let usesElapsedClock = elapsedTime != nil
        if usesElapsedClock != elapsedClock {
            for (key, value) in lastReported {
                lastReported[key]?.elapsed = usesElapsedClock ? duration - (now - value.timestamp) : value.timestamp
            }
            elapsedClock = usesElapsedClock
        }
        if window < 0 {
            guard lastReported[key] == nil else { return false }
            lastReported[key] = ReportTime(timestamp: now, elapsed: duration)
            return true
        }
        if let last = lastReported[key], duration - last.elapsed < Int64(window) {
            return false
        }
        lastReported[key] = ReportTime(timestamp: now, elapsed: duration)
        if lastReported.count > 512 {
            let threshold = duration - Int64(window)
            lastReported = lastReported.filter { $0.value.elapsed > threshold }
        }
        return true
    }

    /// Forgets every reported key (new session).
    mutating func reset() {
        lastReported.removeAll()
        elapsedClock = false
    }
}
