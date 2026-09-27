import Foundation

/// Implements the `duplicateFilter` option (SPEC section 4).
///
/// - `window > 0`: a key is not reported again until `window` ms after it was last reported.
/// - `window == 0`: every detection is reported.
/// - `window < 0`: each key is reported once until ``reset()``.
struct DuplicateFilter: Sendable {
    private var lastReported: [String: Int64] = [:]

    /// Returns `true` when `key` should be reported at time `now` (ms) and records the report.
    mutating func shouldReport(_ key: String, now: Int64, window: Int) -> Bool {
        if window == 0 { return true }
        if window < 0 {
            guard lastReported[key] == nil else { return false }
            lastReported[key] = now
            return true
        }
        if let last = lastReported[key], now - last < Int64(window) {
            return false
        }
        lastReported[key] = now
        if lastReported.count > 512 {
            let threshold = now - Int64(window)
            lastReported = lastReported.filter { $0.value > threshold }
        }
        return true
    }

    /// Forgets every reported key (new session).
    mutating func reset() {
        lastReported.removeAll()
    }
}
