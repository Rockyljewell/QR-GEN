// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// One camera-processing sample: public epoch metadata and private duration time.
struct CameraFrameTime: Sendable {
    var timestamp: Int64
    var elapsedTime: Int64
}

/// Apple continuous time includes sleep. The non-Apple fallback supports pure
/// Swift tooling only; its uptime source makes no suspend-time guarantee.
enum CameraFrameClock {
#if canImport(Darwin)
    private static let millisecondsPerTick: Double = {
        var timebase = mach_timebase_info_data_t()
        _ = mach_timebase_info(&timebase)
        return Double(timebase.numer) / Double(timebase.denom) / 1_000_000
    }()
#endif

    static func sample() -> CameraFrameTime {
        let timestamp = Barcode.currentTimestamp()
#if canImport(Darwin)
        let elapsed = Double(mach_continuous_time()) * millisecondsPerTick
#else
        let elapsed = ProcessInfo.processInfo.systemUptime * 1000
#endif
        return CameraFrameTime(timestamp: timestamp, elapsedTime: Int64(elapsed.rounded(.down)))
    }
}
