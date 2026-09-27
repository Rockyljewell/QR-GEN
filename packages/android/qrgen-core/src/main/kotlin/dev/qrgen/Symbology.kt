package dev.qrgen

/**
 * Every barcode symbology known to QRGen (SPEC §1).
 *
 * [id] is the stable, lowercase identifier used across all QRGen platforms
 * (`"qr"`, `"micro-qr"`, `"ean13"`, ...). Use [Symbology.resolve] or [Symbology.fromName]
 * to turn user input (ids, aliases or group names, in any case or punctuation) into values.
 *
 * Not every engine reads every symbology: the Android scanner, for example, reports what
 * it can read through `QRGen.supportedSymbologies()` and silently skips the rest.
 */
public enum class Symbology(
    /** Stable SPEC id, for example `"data-matrix"`. */
    public val id: String,
    /** Human readable name, for example `"Data Matrix"`. */
    public val displayName: String,
    /** `true` for 1D (linear) symbologies, `false` for 2D/stacked ones. */
    public val isLinear: Boolean,
    private val aliasList: List<String> = emptyList(),
) {
    QR("qr", "QR Code", false, listOf("qrcode")),
    MICRO_QR("micro-qr", "Micro QR Code", false, listOf("microqrcode")),
    RMQR("rmqr", "rMQR Code", false, listOf("rmqrcode")),
    DATA_MATRIX("data-matrix", "Data Matrix", false, listOf("datamatrix", "dm")),
    AZTEC("aztec", "Aztec", false, listOf("azteccode")),
    PDF417("pdf417", "PDF417", false, listOf("compactpdf417")),
    MICRO_PDF417("micro-pdf417", "MicroPDF417", false, listOf("micropdf417")),
    MAXICODE("maxicode", "MaxiCode", false),
    EAN13("ean13", "EAN-13", true, listOf("ean", "jan", "gtin13")),
    EAN8("ean8", "EAN-8", true, listOf("gtin8")),
    UPCA("upca", "UPC-A", true, listOf("upc")),
    UPCE("upce", "UPC-E", true),
    ISBN("isbn", "ISBN", true, listOf("isbn13")),
    CODE128("code128", "Code 128", true, listOf("gs1128", "ean128")),
    CODE39("code39", "Code 39", true, listOf("code3of9")),
    CODE93("code93", "Code 93", true),
    CODABAR("codabar", "Codabar", true, listOf("nw7")),
    ITF("itf", "Interleaved 2 of 5", true, listOf("interleaved2of5", "i2of5")),
    ITF14("itf14", "ITF-14", true),
    DATABAR("databar", "GS1 DataBar", true, listOf("rss14", "databaromni")),
    DATABAR_EXPANDED("databar-expanded", "GS1 DataBar Expanded", true, listOf("rssexpanded")),
    DATABAR_LIMITED("databar-limited", "GS1 DataBar Limited", true, listOf("rsslimited")),
    CODE32("code32", "Code 32 (Italian Pharmacode)", true),
    PZN("pzn", "PZN", true),
    TELEPEN("telepen", "Telepen", true),
    DX_FILM_EDGE("dx-film-edge", "DX Film Edge", true),
    ;

    /** Extra names accepted for this symbology (SPEC §1 "Aliases accepted"). */
    public val aliases: List<String> get() = aliasList

    /** Whether this symbology can carry GS1 element strings (member of the `gs1` group). */
    public val isGS1Capable: Boolean get() = this in GS1_GROUP

    /**
     * The AIM symbology identifier (ISO/IEC 15424) most engines report for this symbology,
     * for example `"]Q1"` for QR Code or `"]C1"` for GS1-128. Returns `""` when unknown.
     *
     * @param gs1 `true` when the symbol carries GS1 data (FNC1 in first position).
     */
    public fun aimIdentifier(gs1: Boolean = false): String = when (this) {
        QR -> if (gs1) "]Q3" else "]Q1"
        MICRO_QR, RMQR -> if (gs1) "]Q3" else "]Q1"
        DATA_MATRIX -> if (gs1) "]d2" else "]d1"
        AZTEC -> if (gs1) "]z1" else "]z0"
        PDF417, MICRO_PDF417 -> "]L2"
        MAXICODE -> "]U0"
        EAN13, UPCA, UPCE, ISBN -> "]E0"
        EAN8 -> "]E4"
        CODE128 -> if (gs1) "]C1" else "]C0"
        CODE39 -> "]A0"
        CODE93 -> "]G0"
        CODABAR -> "]F0"
        ITF, ITF14 -> "]I0"
        DATABAR, DATABAR_EXPANDED, DATABAR_LIMITED -> "]e0"
        CODE32, PZN, TELEPEN, DX_FILM_EDGE -> ""
    }

    override fun toString(): String = id

    public companion object {
        /** Every symbology (the `all` group). */
        @JvmField
        public val ALL: Set<Symbology> = entries.toSortedSetOf()

        /** 1D symbologies (the `linear` / `1d` group). */
        @JvmField
        public val LINEAR: Set<Symbology> = entries.filter { it.isLinear }.toSortedSetOf()

        /** 2D and stacked symbologies (the `matrix` / `2d` group). */
        @JvmField
        public val MATRIX: Set<Symbology> = entries.filter { !it.isLinear }.toSortedSetOf()

        /** Retail symbologies (the `retail` group). */
        @JvmField
        public val RETAIL: Set<Symbology> = listOf(
            EAN13, EAN8, UPCA, UPCE, ISBN, DATABAR, DATABAR_EXPANDED, DATABAR_LIMITED,
        ).toSortedSetOf()

        /** Industrial / logistics symbologies (the `industrial` group). */
        @JvmField
        public val INDUSTRIAL: Set<Symbology> = listOf(
            CODE128, CODE39, CODE93, CODABAR, ITF, ITF14, DATA_MATRIX,
        ).toSortedSetOf()

        /** Symbologies that can carry GS1 data (the `gs1` group). */
        @JvmField
        public val GS1_GROUP: Set<Symbology> = listOf(
            CODE128, DATA_MATRIX, QR, DATABAR, DATABAR_EXPANDED, DATABAR_LIMITED,
        ).toSortedSetOf()

        /** Group names (normalized) and what they expand to (SPEC §1 "Groups"). */
        @JvmField
        public val GROUPS: Map<String, Set<Symbology>> = linkedMapOf(
            "all" to ALL,
            "linear" to LINEAR,
            "1d" to LINEAR,
            "matrix" to MATRIX,
            "2d" to MATRIX,
            "retail" to RETAIL,
            "industrial" to INDUSTRIAL,
            "gs1" to GS1_GROUP,
        )

        private val byName: Map<String, Symbology> = buildMap {
            for (s in Symbology.entries) {
                put(normalize(s.id), s)
                put(normalize(s.name), s)
                for (alias in s.aliasList) put(normalize(alias), s)
            }
        }

        /**
         * Normalizes user input the way SPEC §1 requires: lowercase, then drop everything
         * except `[a-z0-9]`. `"QR-Code"` becomes `"qrcode"`.
         */
        @JvmStatic
        public fun normalize(name: String): String {
            val sb = StringBuilder(name.length)
            for (c in name) {
                val lc = if (c in 'A'..'Z') c + ('a' - 'A') else c
                if (lc in 'a'..'z' || lc in '0'..'9') sb.append(lc)
            }
            return sb.toString()
        }

        /**
         * Looks up a single symbology by id, alias or enum name (case and punctuation
         * insensitive). Returns `null` for group names and unknown input.
         */
        @JvmStatic
        public fun fromName(name: String): Symbology? = byName[normalize(name)]

        /** Returns the members of a group (`all`, `linear`, `1d`, `matrix`, `2d`, `retail`, `industrial`, `gs1`), or `null`. */
        @JvmStatic
        public fun group(name: String): Set<Symbology>? = GROUPS[normalize(name)]

        /**
         * Resolves ids, aliases and group names into a set of symbologies (SPEC §1).
         *
         * - Matching is case-insensitive and ignores everything except `[a-z0-9]`.
         * - Group names expand to their members.
         * - Unknown names are ignored.
         * - An empty list means the default, `all`.
         *
         * The result iterates in declaration order.
         */
        @JvmStatic
        public fun resolve(names: List<String>): Set<Symbology> {
            if (names.isEmpty()) return ALL
            val out = java.util.EnumSet.noneOf(Symbology::class.java)
            for (raw in names) {
                // Accept comma separated lists too ("qr,ean13").
                for (part in raw.split(',', ';')) {
                    if (part.isBlank()) continue
                    val single = fromName(part)
                    if (single != null) {
                        out += single
                    } else {
                        group(part)?.let { out += it }
                    }
                }
            }
            return java.util.Collections.unmodifiableSet(out)
        }

        /** Vararg convenience for [resolve]. */
        @JvmStatic
        public fun resolve(vararg names: String): Set<Symbology> = resolve(names.toList())

        /** Returns the names in [names] that are neither a symbology nor a group. */
        @JvmStatic
        public fun unknownNames(names: List<String>): List<String> = names
            .flatMap { it.split(',', ';') }
            .filter { it.isNotBlank() && fromName(it) == null && group(it) == null }

        /** `true` if every member of [symbologies] is linear (used for the default `line` viewfinder). */
        @JvmStatic
        public fun allLinear(symbologies: Collection<Symbology>): Boolean =
            symbologies.isNotEmpty() && symbologies.all { it.isLinear }

        /**
         * Refines a symbology reported by an engine that cannot tell retail variants apart,
         * and filters out results that were not requested.
         *
         * - EAN-13 with a `978`/`979` prefix becomes [ISBN] when ISBN was requested.
         * - EAN-13 with a leading `0` becomes [UPCA] (12 digits) when UPC-A was requested.
         * - UPC-A becomes [EAN13] (13 digits, leading `0`) when only EAN-13 was requested.
         * - ITF with 14 digits becomes [ITF14] when ITF-14 was requested.
         *
         * @return the refined symbology and data, or `null` when the result is not in [requested].
         */
        @JvmStatic
        public fun refine(detected: Symbology, data: String, requested: Set<Symbology>): RefinedSymbology? {
            val digits = data.isNotEmpty() && data.all { it in '0'..'9' }
            return when (detected) {
                EAN13 -> when {
                    digits && data.length == 13 && (data.startsWith("978") || data.startsWith("979")) && ISBN in requested ->
                        RefinedSymbology(ISBN, data)
                    digits && data.length == 13 && data[0] == '0' && UPCA in requested ->
                        RefinedSymbology(UPCA, data.substring(1))
                    EAN13 in requested -> RefinedSymbology(EAN13, data)
                    else -> null
                }
                UPCA -> when {
                    UPCA in requested -> RefinedSymbology(UPCA, data)
                    EAN13 in requested && digits && data.length == 12 -> RefinedSymbology(EAN13, "0$data")
                    else -> null
                }
                ISBN -> when {
                    ISBN in requested -> RefinedSymbology(ISBN, data)
                    EAN13 in requested -> RefinedSymbology(EAN13, data)
                    else -> null
                }
                ITF -> when {
                    digits && data.length == 14 && ITF14 in requested -> RefinedSymbology(ITF14, data)
                    ITF in requested -> RefinedSymbology(ITF, data)
                    else -> null
                }
                ITF14 -> when {
                    ITF14 in requested -> RefinedSymbology(ITF14, data)
                    ITF in requested -> RefinedSymbology(ITF, data)
                    else -> null
                }
                else -> if (detected in requested) RefinedSymbology(detected, data) else null
            }
        }

        private fun Iterable<Symbology>.toSortedSetOf(): Set<Symbology> {
            val set = java.util.EnumSet.noneOf(Symbology::class.java)
            for (s in this) set += s
            return java.util.Collections.unmodifiableSet(set)
        }
    }
}

/** Result of [Symbology.refine]: the symbology to report and the (possibly adjusted) data. */
public data class RefinedSymbology(public val symbology: Symbology, public val data: String)
