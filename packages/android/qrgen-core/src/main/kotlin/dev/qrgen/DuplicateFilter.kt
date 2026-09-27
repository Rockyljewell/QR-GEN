package dev.qrgen

/**
 * Suppresses repeated reports of the same code (same symbology and data), implementing the
 * SPEC §4 `duplicateFilter` option:
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
    private val lastReported = HashMap<String, Long>()

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

    /** Returns `true` if [barcode] should be reported now, and records it if so. */
    @JvmOverloads
    public fun accept(barcode: Barcode, now: Long = System.currentTimeMillis()): Boolean = accept(barcode.key, now)

    /** Returns `true` if the code identified by [symbology] and [data] should be reported now. */
    @JvmOverloads
    public fun accept(symbology: Symbology, data: String, now: Long = System.currentTimeMillis()): Boolean =
        accept(symbology.id + '\u0000' + data, now)

    private fun accept(key: String, now: Long): Boolean {
        val window = windowMs
        if (window == 0L) return true
        synchronized(lock) {
            val last = lastReported[key]
            if (window < 0) {
                if (last != null) return false
                lastReported[key] = now
                return true
            }
            if (last != null && now - last < window) return false
            lastReported[key] = now
            if (lastReported.size > PRUNE_THRESHOLD) prune(now, window)
            return true
        }
    }

    /** Filters a frame's detections, keeping those that should be reported now (in order). */
    @JvmOverloads
    public fun filter(barcodes: List<Barcode>, now: Long = System.currentTimeMillis()): List<Barcode> {
        if (barcodes.isEmpty()) return emptyList()
        if (windowMs == 0L) return barcodes.toList()
        return barcodes.filter { accept(it, now) }
    }

    /** Forgets every code (starts a new session). */
    public fun reset() {
        synchronized(lock) { lastReported.clear() }
    }

    /** Number of codes currently remembered. */
    public val size: Int get() = synchronized(lock) { lastReported.size }

    private fun prune(now: Long, window: Long) {
        val it = lastReported.entries.iterator()
        while (it.hasNext()) if (now - it.next().value >= window) it.remove()
    }

    private companion object {
        const val PRUNE_THRESHOLD = 256
    }
}
