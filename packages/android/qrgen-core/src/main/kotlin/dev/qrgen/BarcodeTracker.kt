package dev.qrgen

/**
 * Follows barcodes across frames for batch mode (SPEC §4 `track` event).
 *
 * Each call to [update] matches the frame's detections to existing tracks:
 *
 * 1. by symbology + data (when several tracks share a key, the one with the most overlap,
 *    then the nearest, wins);
 * 2. for detections left over, by bounding-box overlap (intersection over union of at least
 *    [overlapThreshold]) with a track not matched yet, which absorbs occasional misreads;
 * 3. remaining detections start new tracks with fresh, increasing ids.
 *
 * Tracks not seen for more than [maxAgeMs] are dropped. Ids are stable for the lifetime of a
 * track. Thread-safe.
 */
public class BarcodeTracker @JvmOverloads constructor(
    public val maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
    public val overlapThreshold: Float = DEFAULT_OVERLAP_THRESHOLD,
) {
    private class Track(val id: Int, var barcode: Barcode, val firstSeen: Long, var lastSeen: Long, var count: Int) {
        fun snapshot() = TrackedBarcode(id, barcode, firstSeen, lastSeen, count)
    }

    private val lock = Any()
    private val tracks = ArrayList<Track>()
    private var nextId = 1

    /** Result of one [update]. */
    public data class Update(
        /** Every live track after this frame, ordered by id. */
        public val tracked: List<TrackedBarcode>,
        /** Tracks created in this frame. */
        public val added: List<TrackedBarcode>,
        /** Tracks dropped in this frame because they were not seen for more than `maxAgeMs`. */
        public val removed: List<TrackedBarcode>,
    )

    /** Feeds one frame's detections and returns the tracking state. */
    @JvmOverloads
    public fun update(detections: List<Barcode>, now: Long = System.currentTimeMillis()): Update = synchronized(lock) {
        // 1. Expire stale tracks before matching, so a code that re-appears later is a new track.
        val removed = ArrayList<TrackedBarcode>()
        val iterator = tracks.iterator()
        while (iterator.hasNext()) {
            val t = iterator.next()
            if (now - t.lastSeen > maxAgeMs) {
                removed += t.snapshot()
                iterator.remove()
            }
        }

        val matchedTrack = BooleanArray(tracks.size)
        val assignment = arrayOfNulls<Track>(detections.size)

        // 2. Match by symbology + data.
        val keyPairs = ArrayList<Candidate>()
        for ((di, d) in detections.withIndex()) {
            for ((ti, t) in tracks.withIndex()) {
                if (t.barcode.key == d.key) {
                    keyPairs += Candidate(di, ti, overlap(d, t.barcode), distance(d, t.barcode))
                }
            }
        }
        assign(keyPairs, assignment, matchedTrack)

        // 3. Fall back to box overlap for the rest.
        val overlapPairs = ArrayList<Candidate>()
        for ((di, d) in detections.withIndex()) {
            if (assignment[di] != null || d.location.isEmpty) continue
            for ((ti, t) in tracks.withIndex()) {
                if (matchedTrack[ti] || t.barcode.location.isEmpty) continue
                val iou = overlap(d, t.barcode)
                if (iou >= overlapThreshold) overlapPairs += Candidate(di, ti, iou, distance(d, t.barcode))
            }
        }
        assign(overlapPairs, assignment, matchedTrack)

        // 4. Update matched tracks and create new ones.
        val added = ArrayList<TrackedBarcode>()
        for ((di, d) in detections.withIndex()) {
            val t = assignment[di]
            if (t != null) {
                t.barcode = d
                t.lastSeen = now
                t.count++
            } else {
                val nt = Track(nextId++, d, now, now, 1)
                tracks += nt
                added += nt.snapshot()
            }
        }

        Update(tracks.sortedBy { it.id }.map { it.snapshot() }, added, removed)
    }

    /** The live tracks, ordered by id. */
    public val tracked: List<TrackedBarcode>
        get() = synchronized(lock) { tracks.sortedBy { it.id }.map { it.snapshot() } }

    /** Drops every track. Ids keep increasing so they stay unique within the tracker. */
    public fun reset() {
        synchronized(lock) { tracks.clear() }
    }

    private class Candidate(val detection: Int, val track: Int, val overlap: Float, val distance: Float)

    private fun assign(candidates: MutableList<Candidate>, assignment: Array<Track?>, matchedTrack: BooleanArray) {
        candidates.sortWith(compareByDescending<Candidate> { it.overlap }.thenBy { it.distance })
        for (c in candidates) {
            if (assignment[c.detection] != null || matchedTrack[c.track]) continue
            assignment[c.detection] = tracks[c.track]
            matchedTrack[c.track] = true
        }
    }

    private fun overlap(a: Barcode, b: Barcode): Float =
        if (a.location.isEmpty || b.location.isEmpty) 0f else a.location.overlap(b.location)

    private fun distance(a: Barcode, b: Barcode): Float =
        if (a.location.isEmpty || b.location.isEmpty) 0f else a.location.center.distanceTo(b.location.center)

    public companion object {
        /** Tracks unseen for longer than this are dropped (SPEC: 500 ms). */
        public const val DEFAULT_MAX_AGE_MS: Long = 500L

        /** Minimum intersection-over-union for the overlap fallback. */
        public const val DEFAULT_OVERLAP_THRESHOLD: Float = 0.3f
    }
}
