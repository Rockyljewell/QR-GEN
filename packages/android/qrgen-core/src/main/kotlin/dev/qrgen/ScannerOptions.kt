// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

/**
 * Scanner configuration shared by every QRGen platform (SPEC §4).
 *
 * ```kotlin
 * val options = ScannerOptions(
 *     symbologies = Symbology.resolve("qr", "retail"),
 *     mode = ScannerOptions.Mode.CONTINUOUS,
 *     duplicateFilter = 1500,
 *     scanArea = ScanArea.centered(0.8f, 0.4f),
 * )
 * ```
 *
 * Java callers can use [ScannerOptions.Builder].
 *
 * @property symbologies what to read (default: all; engines skip what they cannot read).
 * @property mode [Mode.SINGLE] stops after the first scan, [Mode.BATCH] tracks many codes.
 * @property duplicateFilter milliseconds during which the same symbology+data is not reported
 *   again after it was reported. `0` reports every frame, `-1` reports each code once per session.
 * @property beep play a short tone on scan.
 * @property vibrate haptic feedback on scan.
 * @property camera back or front camera.
 * @property cameraId a specific device camera id; overrides [camera] when set.
 * @property torch flashlight on/off.
 * @property viewfinder overlay style, or `null` for the default ([Viewfinder.LINE] when every
 *   requested symbology is linear, else [Viewfinder.FRAME]).
 * @property scanArea region of interest, normalized to the visible preview.
 * @property maxResults codes per frame, or `null` for the default (1, or 20 in batch mode).
 */
public data class ScannerOptions @JvmOverloads constructor(
    public val symbologies: Set<Symbology> = Symbology.ALL,
    public val mode: Mode = Mode.CONTINUOUS,
    public val duplicateFilter: Long = DEFAULT_DUPLICATE_FILTER_MS,
    public val beep: Boolean = true,
    public val vibrate: Boolean = true,
    public val camera: Camera = Camera.BACK,
    public val cameraId: String? = null,
    public val torch: Boolean = false,
    public val viewfinder: Viewfinder? = null,
    public val scanArea: ScanArea = ScanArea.FULL,
    public val maxResults: Int? = null,
) {
    init {
        require(duplicateFilter >= -1) { "duplicateFilter must be >= -1 (was $duplicateFilter)" }
        require(maxResults == null || maxResults >= 1) { "maxResults must be >= 1 (was $maxResults)" }
    }

    /** Scanning mode (SPEC §4 `mode`). */
    public enum class Mode(public val id: String) {
        /** Stop analysing after the first successful scan. */
        SINGLE("single"),

        /** Keep scanning; report codes as they appear, subject to the duplicate filter. */
        CONTINUOUS("continuous"),

        /** Track many codes at once and report `track` events every frame. */
        BATCH("batch"),
        ;

        override fun toString(): String = id

        public companion object {
            @JvmStatic
            public fun fromId(id: String): Mode? = entries.firstOrNull { it.id.equals(id.trim(), ignoreCase = true) }
        }
    }

    /** Camera selection (SPEC §4 `camera`). */
    public enum class Camera(public val id: String) {
        BACK("back"),
        FRONT("front"),
        ;

        override fun toString(): String = id

        public companion object {
            @JvmStatic
            public fun fromId(id: String): Camera? = entries.firstOrNull { it.id.equals(id.trim(), ignoreCase = true) }
        }
    }

    /** Overlay style (SPEC §4 `viewfinder`). */
    public enum class Viewfinder(public val id: String) {
        /** Rounded corner brackets around the scan area. */
        FRAME("frame"),

        /** A horizontal line, suited to 1D codes. */
        LINE("line"),

        /** No overlay. */
        NONE("none"),
        ;

        override fun toString(): String = id

        public companion object {
            @JvmStatic
            public fun fromId(id: String): Viewfinder? = entries.firstOrNull { it.id.equals(id.trim(), ignoreCase = true) }
        }
    }

    /** The viewfinder to draw, applying the SPEC default when [viewfinder] is `null`. */
    public val resolvedViewfinder: Viewfinder
        get() = viewfinder ?: if (Symbology.allLinear(symbologies)) Viewfinder.LINE else Viewfinder.FRAME

    /** Codes per frame, applying the SPEC default (1, or 20 in batch mode). */
    public val resolvedMaxResults: Int
        get() = maxResults ?: if (mode == Mode.BATCH) DEFAULT_BATCH_MAX_RESULTS else 1

    /** The options with SPEC §4 names, for bridges (`symbologies` as ids). */
    public fun toMap(): Map<String, Any?> = linkedMapOf(
        "symbologies" to symbologies.map { it.id },
        "mode" to mode.id,
        "duplicateFilter" to duplicateFilter,
        "beep" to beep,
        "vibrate" to vibrate,
        "camera" to (cameraId ?: camera.id),
        "torch" to torch,
        "viewfinder" to resolvedViewfinder.id,
        "scanArea" to scanArea.toMap(),
        "maxResults" to resolvedMaxResults,
    )

    public fun toJson(): String = Json.stringify(toMap())

    /** Java-friendly builder. */
    public class Builder {
        private var o = ScannerOptions()

        public fun symbologies(symbologies: Set<Symbology>): Builder = apply { o = o.copy(symbologies = symbologies) }
        public fun symbologies(vararg names: String): Builder = apply { o = o.copy(symbologies = Symbology.resolve(*names)) }
        public fun mode(mode: Mode): Builder = apply { o = o.copy(mode = mode) }
        public fun duplicateFilter(ms: Long): Builder = apply { o = o.copy(duplicateFilter = ms) }
        public fun beep(beep: Boolean): Builder = apply { o = o.copy(beep = beep) }
        public fun vibrate(vibrate: Boolean): Builder = apply { o = o.copy(vibrate = vibrate) }
        public fun camera(camera: Camera): Builder = apply { o = o.copy(camera = camera) }
        public fun cameraId(cameraId: String?): Builder = apply { o = o.copy(cameraId = cameraId) }
        public fun torch(torch: Boolean): Builder = apply { o = o.copy(torch = torch) }
        public fun viewfinder(viewfinder: Viewfinder?): Builder = apply { o = o.copy(viewfinder = viewfinder) }
        public fun scanArea(scanArea: ScanArea): Builder = apply { o = o.copy(scanArea = scanArea) }
        public fun maxResults(maxResults: Int?): Builder = apply { o = o.copy(maxResults = maxResults) }
        public fun build(): ScannerOptions = o
    }

    public companion object {
        public const val DEFAULT_DUPLICATE_FILTER_MS: Long = 1000L

        /** [duplicateFilter] value that reports a code on every frame. */
        public const val REPORT_EVERY_FRAME: Long = 0L

        /** [duplicateFilter] value that reports each code once per session. */
        public const val REPORT_ONCE_PER_SESSION: Long = -1L

        public const val DEFAULT_BATCH_MAX_RESULTS: Int = 20

        @JvmStatic
        public fun builder(): Builder = Builder()

        /**
         * Builds options from SPEC §4 names, as received over a bridge or query string.
         * Lists may be given as collections or comma-separated strings; unknown keys are ignored
         * and invalid values fall back to defaults.
         */
        @JvmStatic
        public fun fromMap(map: Map<String, Any?>): ScannerOptions {
            val d = ScannerOptions()
            fun bool(key: String, def: Boolean): Boolean = when (val v = map[key]) {
                is Boolean -> v
                is Number -> v.toInt() != 0
                is String -> v.trim().lowercase() in setOf("1", "true", "yes", "on")
                else -> def
            }
            fun num(key: String): Double? = when (val v = map[key]) {
                is Number -> v.toDouble()
                is String -> v.trim().toDoubleOrNull()
                else -> null
            }
            val symbologies = when (val v = map["symbologies"]) {
                is Collection<*> -> Symbology.resolve(v.map { it.toString() })
                is String -> Symbology.resolve(listOf(v))
                else -> d.symbologies
            }
            val cameraValue = map["camera"]?.toString()?.trim().orEmpty()
            val camera = Camera.fromId(cameraValue)
            val area = when (val v = map["scanArea"]) {
                is Map<*, *> -> runCatching {
                    fun f(k: String) = (v[k] as? Number)?.toFloat() ?: v[k]?.toString()?.toFloatOrNull()
                    ScanArea(f("x") ?: 0f, f("y") ?: 0f, f("width") ?: 1f, f("height") ?: 1f)
                }.getOrNull()
                else -> null
            } ?: d.scanArea
            return ScannerOptions(
                symbologies = symbologies,
                mode = map["mode"]?.toString()?.let { Mode.fromId(it) } ?: d.mode,
                duplicateFilter = num("duplicateFilter")?.toLong()?.coerceAtLeast(-1) ?: d.duplicateFilter,
                beep = bool("beep", d.beep),
                vibrate = bool("vibrate", d.vibrate),
                camera = camera ?: d.camera,
                cameraId = if (camera == null && cameraValue.isNotEmpty()) cameraValue else null,
                torch = bool("torch", d.torch),
                viewfinder = map["viewfinder"]?.toString()?.let { Viewfinder.fromId(it) },
                scanArea = area,
                maxResults = num("maxResults")?.toInt()?.takeIf { it >= 1 },
            )
        }
    }
}
