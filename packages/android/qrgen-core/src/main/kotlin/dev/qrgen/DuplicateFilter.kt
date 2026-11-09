// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

/**
 * Suppresses repeated reports of the same code (same symbology and data), implementing the
 * SPEC Â§4 `duplicateFilter` option:
 *
 * - `windowMs > 0`: a code is reported again only when at least `windowMs` have passed since
 *   it was last reported.
 * - `windowMs == 0`: every detection is reported (every frame).
 * - `windowMs == -1`: each code is reported once until [reset] (once per session).
 *
 * Thread-safe.
 */
public class DuplicateFilter @JvmOverloads constructor(windowMs: Long = ScannerOptions.DEFAULT_DUPLICATE_FILTER_MS) {
    private val lock = Any()
    private val lastReported = HashMap<String, DurationMark>()
    private var clockBasis: Any? = null

    /** The filter window in milliseconds (see class docs). Changing it keeps the history. */
    @Volatile
    public var windowMs: Long = windowMs
        set(value) {
            require(value >= -1) { "windowMs must be >= -1 (was $value)" }
            field = value
        }

    init {
        require(windowMs >= -1) { "windowMs must be >= -1 (was $windowMs)" }
    }

    /**
     * Reports with an automatic elapsed clock when omitted. Explicit [Long.MIN_VALUE] is
     * reserved for automatic time; use [acceptAt] with [ClockSample.manual] for that value.
     */
    @JvmOverloads
    public fun accept(barcode: Barcode, now: Long = AUTOMATIC_CLOCK): Boolean = acceptAt(barcode, clockSample(now))

    /** Numeric manual clock; [Long.MIN_VALUE] selects automatic time (see [accept]). */
    @JvmOverloads
    public fun accept(symbology: Symbology, data: String, now: Long = AUTOMATIC_CLOCK): Boolean =
        acceptAt(symbology, data, clockSample(now))

    /** Report using an immutable paired clock sample. */
    public fun acceptAt(barcode: Barcode, clock: ClockSample): Boolean = acceptKeyAt(barcode.key, clock)

    /** Report a symbology/data pair using an immutable clock sample. */
    public fun acceptAt(symbology: Symbology, data: String, clock: ClockSample): Boolean =
        acceptKeyAt(symbology.id + '\u0000' + data, clock)

    private fun acceptKeyAt(key: String, clock: ClockSample): Boolean {
        val window = windowMs
        if (window == 0L) return true
        synchronized(lock) {
            if (clockBasis !== clock.basis) {
                lastReported.values.forEach { it.rebase(clock) }
                clockBasis = clock.basis
            }
            val last = lastReported[key]
            if (last != null && (window < 0 || last.compareAge(clock.elapsedMillis, window) < 0)) return false
            lastReported[key] = DurationMark(clock)
            if (window > 0 && lastReported.size > PRUNE_THRESHOLD) prune(clock.elapsedMillis, window)
            return true
        }
    }

    /** Filters a frame; omitted time is automatic, and explicit MIN is reserved as in [accept]. */
    @JvmOverloads
    public fun filter(barcodes: List<Barcode>, now: Long = AUTOMATIC_CLOCK): List<Barcode> = filterAt(barcodes, clockSample(now))

    /** Filters a frame against one shared paired clock sample. */
    public fun filterAt(barcodes: List<Barcode>, clock: ClockSample): List<Barcode> {
        if (barcodes.isEmpty()) return emptyList()
        if (windowMs == 0L) return barcodes.toList()
        return barcodes.filter { acceptAt(it, clock) }
    }

    /** Forgets every code (starts a new session). */
    public fun reset() {
        synchronized(lock) { lastReported.clear(); clockBasis = null }
    }

    /** Number of codes currently remembered. */
    public val size: Int get() = synchronized(lock) { lastReported.size }

    private fun prune(now: Long, window: Long) {
        val it = lastReported.entries.iterator()
        while (it.hasNext()) if (it.next().value.compareAge(now, window) >= 0) it.remove()
    }

    private companion object {
        const val PRUNE_THRESHOLD = 256
    }
}
