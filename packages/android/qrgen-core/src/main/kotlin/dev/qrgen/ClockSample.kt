// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import java.math.BigInteger

/** Immutable epoch metadata and elapsed time, sampled from one stable [ClockSource]. */
public class ClockSample internal constructor(
    public val timestamp: Long,
    public val elapsedMillis: Long,
    internal val basis: Any,
) {
    public companion object {
        private val manualBasis = Any()
        private val automaticBasis = Any()

        /** Full-range explicit numeric clock, including [Long.MIN_VALUE]. */
        @JvmStatic
        public fun manual(now: Long): ClockSample = ClockSample(now, now, manualBasis)

        /** Epoch metadata plus the pure JVM's monotonic nanoTime duration clock. */
        @JvmStatic
        public fun automatic(): ClockSample = ClockSample(System.currentTimeMillis(), System.nanoTime() / 1_000_000, automaticBasis)
    }
}

/**
 * A stable elapsed-clock identity. Keep one source while retaining filter/tracker history.
 * Android camera frames supply a sleep-inclusive elapsedRealtime provider; core stays Android-free.
 */
public class ClockSource(private val elapsedMillis: () -> Long) {
    /** Read the epoch timestamp and elapsed provider synchronously, without a queue boundary. */
    @JvmOverloads
    public fun sample(timestamp: Long = System.currentTimeMillis()): ClockSample = ClockSample(timestamp, elapsedMillis(), this)
}

// Preserves primitive-Long overloads and compiler-generated Kotlin default bridges.
internal const val AUTOMATIC_CLOCK: Long = Long.MIN_VALUE
internal fun clockSample(now: Long): ClockSample = if (now == AUTOMATIC_CLOCK) ClockSample.automatic() else ClockSample.manual(now)

/** Private duration history; epoch metadata is never rewritten when clocks change. */
internal class DurationMark(sample: ClockSample) {
    private val timestamp = sample.timestamp
    private var elapsed = sample.elapsedMillis
    // Only extreme cross-clock rebases need an origin outside Long's range.
    private var wideOrigin: BigInteger? = null

    fun rebase(sample: ClockSample) {
        val origin = BigInteger.valueOf(sample.elapsedMillis)
            .subtract(BigInteger.valueOf(sample.timestamp).subtract(BigInteger.valueOf(timestamp)))
        if (origin.bitLength() <= 63) {
            elapsed = origin.toLong()
            wideOrigin = null
        } else wideOrigin = origin
    }

    fun compareAge(now: Long, threshold: Long): Int {
        val origin = wideOrigin
        if (origin != null) return BigInteger.valueOf(now).subtract(origin).compareTo(BigInteger.valueOf(threshold))
        val difference = now - elapsed
        // Exact comparison even when the mathematical difference exceeds either Long limit.
        if (((now xor elapsed) and (now xor difference)) < 0) return if (now > elapsed) 1 else -1
        return difference.compareTo(threshold)
    }
}
