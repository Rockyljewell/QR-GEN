package dev.qrgen

import java.math.BigDecimal
import java.math.BigInteger

/**
 * One GS1 element: an Application Identifier and its value (SPEC §3.2).
 *
 * @property ai the Application Identifier, for example `"01"` or `"3103"`.
 * @property title the GS1 data title, for example `"GTIN"`; `""` for AIs QRGen does not know.
 * @property value the value as encoded (GTINs from Digital Link URLs are zero padded to 14 digits).
 * @property raw the value exactly as it appeared in the input, only when it differs from [value]
 *   (for example an un-padded GTIN or a percent-encoded Digital Link segment).
 * @property date ISO date (`YYYY-MM-DD`) for date AIs such as 11, 13, 15, 16 and 17 (day `00`
 *   means the last day of the month), or ISO date-time (`YYYY-MM-DDTHH:MM`) for 7003 and 8008.
 * @property number numeric value for decimal AIs (310n–369n, 390n–395n), with `n` decimals applied.
 */
public data class Gs1Element(
    public val ai: String,
    public val title: String,
    public val value: String,
    public val raw: String? = null,
    public val date: String? = null,
    public val number: Double? = null,
) {
    public fun toMap(): Map<String, Any?> = linkedMapOf<String, Any?>("ai" to ai, "title" to title, "value" to value).apply {
        if (raw != null) put("raw", raw)
        if (date != null) put("date", date)
        if (number != null) put("number", number)
    }
}

/**
 * A parsed GS1 element string (SPEC §3.2): `{ elements: [...], values: { ai: value } }`.
 */
public data class Gs1Result(public val elements: List<Gs1Element>) {
    /** Values by AI, in input order (the first occurrence wins when an AI repeats). */
    public val values: Map<String, String> by lazy(LazyThreadSafetyMode.PUBLICATION) {
        val map = LinkedHashMap<String, String>()
        for (e in elements) map.putIfAbsent(e.ai, e.value)
        java.util.Collections.unmodifiableMap(map)
    }

    /** Value of [ai], or `null`. */
    public operator fun get(ai: String): String? = values[ai]

    /** The first element with [ai], or `null`. */
    public fun element(ai: String): Gs1Element? = elements.firstOrNull { it.ai == ai }

    /** GTIN (AI 01), 14 digits. */
    public val gtin: String? get() = values["01"]

    /** SSCC (AI 00), 18 digits. */
    public val sscc: String? get() = values["00"]

    /** Batch or lot number (AI 10). */
    public val batch: String? get() = values["10"]

    /** Serial number (AI 21). */
    public val serial: String? get() = values["21"]

    /** Expiry date (AI 17) as ISO `YYYY-MM-DD`. */
    public val expiryDate: String? get() = element("17")?.date

    /** Human readable interpretation: `(01)09501101530003(17)250101(10)ABC123`. */
    public fun toHri(): String = elements.joinToString("") { "(${it.ai})${it.value}" }

    /**
     * The element string with ASCII 29 (GS) separators after variable-length values, as
     * encoded in a symbol (without the leading FNC1 / symbology identifier).
     */
    public fun toElementString(): String {
        val sb = StringBuilder()
        elements.forEachIndexed { i, e ->
            sb.append(e.ai).append(e.value)
            if (i < elements.size - 1 && !GS1.isPredefinedLength(e.ai)) sb.append(GS1.GS)
        }
        return sb.toString()
    }

    public fun toMap(): Map<String, Any?> = linkedMapOf(
        "elements" to elements.map { it.toMap() },
        "values" to values,
    )

    public fun toJson(): String = Json.stringify(toMap())
}

/**
 * GS1 element string parser (SPEC §3.2). Accepts:
 *
 * - HRI form: `(01)09501101530003(17)250101(10)ABC123`
 * - raw form with ASCII 29 (GS) separators, optionally prefixed by a GS1 symbology identifier
 *   (`]C1`, `]d2`, `]Q3`, `]e0`, `]J1`) or a leading GS standing for FNC1
 * - raw form without separators, when it parses unambiguously with known AIs
 * - GS1 Digital Link URLs: `https://id.gs1.org/01/09501101530003/10/ABC123?17=250101`
 *
 * Never throws; returns `null` when the input is not GS1.
 */
public object GS1 {
    /** ASCII 29, the GS1 field separator (FNC1 in symbols). */
    public const val GS: Char = '\u001D'

    /** Symbology identifiers that announce GS1 data. */
    @JvmField
    public val GS1_SYMBOLOGY_IDENTIFIERS: List<String> = listOf("]C1", "]d2", "]Q3", "]e0", "]J1")

    internal enum class DateKind { NONE, YYMMDD, YYMMDDHHMM, YYMMDDHH_OPT, YYYYMMDD }

    internal class Part(val numeric: Boolean, val min: Int, val max: Int)

    internal class Def(val ai: String, val title: String, format: String, val dateKind: DateKind, val decimal: Boolean) {
        val parts: List<Part> = format.split('+').mapIndexed { index, p -> parsePart(p, index) }
        val minLength: Int = parts.sumOf { it.min }
        val maxLength: Int = parts.sumOf { it.max }
        val fixedLength: Int? = if (minLength == maxLength) maxLength else null

        fun validate(value: String): Boolean {
            if (value.length < minLength.coerceAtLeast(1) || value.length > maxLength) return false
            var p = 0
            for (part in parts) {
                val take = minOf(part.max, value.length - p)
                if (take < part.min) return false
                val chunk = value.substring(p, p + take)
                if (part.numeric && !chunk.all { it in '0'..'9' }) return false
                if (!part.numeric && !chunk.all { it.code in 0x21..0x7E }) return false
                p += take
            }
            return p == value.length
        }

        private fun parsePart(p: String, index: Int): Part {
            val numeric = p[0] == 'N'
            val spec = p.substring(1)
            return when {
                spec.startsWith("..") -> Part(numeric, if (index == 0) 1 else 0, spec.substring(2).toInt())
                spec.contains("..") -> {
                    val (a, b) = spec.split("..")
                    Part(numeric, a.toInt(), b.toInt())
                }
                else -> Part(numeric, spec.toInt(), spec.toInt())
            }
        }
    }

    private val definitions: Map<String, Def> = buildDefinitions()

    /** AI length by its first two digits (GS1 General Specifications, AI prefix table). */
    private fun aiLength(prefix: String): Int? {
        val n = prefix.toIntOrNull() ?: return null
        return when (n) {
            in 0..4, in 10..22, 30, 37, in 90..99 -> 2
            in 23..25, in 40..42, 71 -> 3
            in 31..36, 39, 43, 70, 72, in 80..82 -> 4
            else -> null
        }
    }

    /** Data length for AIs whose length is predefined and need no separator (by prefix). */
    private val predefinedDataLength: Map<String, Int> = mapOf(
        "00" to 18, "01" to 14, "02" to 14, "03" to 14, "04" to 16,
        "11" to 6, "12" to 6, "13" to 6, "14" to 6, "15" to 6, "16" to 6, "17" to 6, "18" to 6, "19" to 6,
        "20" to 2, "31" to 6, "32" to 6, "33" to 6, "34" to 6, "35" to 6, "36" to 6, "41" to 13,
    )

    /** `true` when [ai] has a predefined length and never needs a GS separator after it. */
    @JvmStatic
    public fun isPredefinedLength(ai: String): Boolean = ai.length >= 2 && ai.substring(0, 2) in predefinedDataLength

    /** The GS1 data title of [ai] (`"GTIN"` for `"01"`), or `null` when unknown. */
    @JvmStatic
    public fun title(ai: String): String? = definitions[ai]?.title

    /** `true` when [ai] is in QRGen's AI table. */
    @JvmStatic
    public fun isKnownAi(ai: String): Boolean = ai in definitions

    /** Parses [data] (HRI, raw, or Digital Link). Returns `null` when it is not GS1. */
    @JvmStatic
    @JvmOverloads
    public fun parse(data: String, today: CalendarDate = CalendarDate.today()): Gs1Result? = try {
        parseInternal(data, today)
    } catch (_: RuntimeException) {
        null
    }

    private fun parseInternal(data: String, today: CalendarDate): Gs1Result? {
        val s = data.trim { it == ' ' || it == '\n' || it == '\r' || it == '\t' }
        if (s.isEmpty()) return null
        if (s[0] == '(') return parseHri(s, today)
        if (s.startsWith("http://", ignoreCase = true) || s.startsWith("https://", ignoreCase = true)) {
            return parseDigitalLink(s, today)
        }
        var body = s
        var explicit = false
        if (body.length >= 3 && body[0] == ']') {
            if (body.substring(0, 3) !in GS1_SYMBOLOGY_IDENTIFIERS) return null
            body = body.substring(3)
            explicit = true
        }
        while (body.isNotEmpty() && body[0] == GS) {
            body = body.substring(1)
            explicit = true
        }
        if (body.isEmpty()) return null
        val strict = !explicit && body.indexOf(GS) < 0
        return parseElementString(body, strict, today)
    }

    /**
     * Heuristic used by scanning engines: returns the GS1 interpretation of a decoded payload
     * when the symbology can carry GS1 data and the payload is marked as GS1 (symbology
     * identifier, leading FNC1/GS, embedded GS separators) or unambiguously starts with a
     * valid SSCC/GTIN element (`00`, `01`, `02` with a correct check digit).
     */
    @JvmStatic
    @JvmOverloads
    public fun detect(data: String, symbology: Symbology?, today: CalendarDate = CalendarDate.today()): Gs1Result? {
        if (data.isEmpty()) return null
        if (symbology != null && !symbology.isGS1Capable) return null
        if (symbology == Symbology.DATABAR || symbology == Symbology.DATABAR_LIMITED) {
            // Engines often return only the 14-digit GTIN for DataBar Omni/Limited.
            if (data.length in 13..14 && data.all { it in '0'..'9' }) return parse("(01)" + data.padStart(14, '0'), today)
        }
        val explicit = data[0] == GS || data.indexOf(GS) >= 0 ||
            (data.length >= 3 && data.substring(0, 3) in GS1_SYMBOLOGY_IDENTIFIERS) ||
            symbology == Symbology.DATABAR_EXPANDED
        if (explicit) return parse(data, today)
        if (data[0] == '(') return parse(data, today)
        val result = try {
            parseElementString(data, strict = true, today = today)
        } catch (_: RuntimeException) {
            null
        } ?: return null
        val first = result.elements.first()
        return if (first.ai in setOf("00", "01", "02") && Gtin.isValid(first.value)) result else null
    }

    /**
     * Converts GS1 input (HRI or raw) into the element string to encode in a symbol, with GS
     * separators after variable-length values. Returns `null` when [data] is not GS1.
     */
    @JvmStatic
    public fun toElementString(data: String): String? = parse(data)?.toElementString()

    private fun parseHri(s: String, today: CalendarDate): Gs1Result? {
        val matches = HRI_AI.findAll(s).filter { m ->
            val ai = m.groupValues[1]
            aiLength(ai.substring(0, 2)) == ai.length
        }.toList()
        if (matches.isEmpty() || matches[0].range.first != 0) return null
        val elements = ArrayList<Gs1Element>(matches.size)
        for ((i, m) in matches.withIndex()) {
            val ai = m.groupValues[1]
            val end = if (i + 1 < matches.size) matches[i + 1].range.first else s.length
            val value = s.substring(m.range.last + 1, end).trim { it == ' ' }
            if (value.isEmpty()) return null
            elements += element(ai, value, today)
        }
        return Gs1Result(elements)
    }

    private fun parseElementString(body: String, strict: Boolean, today: CalendarDate): Gs1Result? {
        val elements = ArrayList<Gs1Element>()
        var p = 0
        while (p < body.length) {
            if (body[p] == GS) {
                p++
                continue
            }
            if (p + 2 > body.length) return null
            val prefix = body.substring(p, p + 2)
            val aiLen = aiLength(prefix) ?: return null
            if (p + aiLen > body.length) return null
            val ai = body.substring(p, p + aiLen)
            if (!ai.all { it in '0'..'9' }) return null
            val def = definitions[ai]
            if (strict && def == null) return null
            p += aiLen
            val nextGs = body.indexOf(GS, p).let { if (it < 0) body.length else it }
            val fixed = def?.fixedLength ?: predefinedDataLength[prefix]
            val value: String
            if (fixed != null) {
                if (p + fixed > nextGs) {
                    if (strict) return null
                    value = body.substring(p, nextGs)
                    p = nextGs
                } else {
                    value = body.substring(p, p + fixed)
                    p += fixed
                }
            } else {
                value = body.substring(p, nextGs)
                p = nextGs
            }
            if (value.isEmpty()) return null
            if (strict && def != null && !def.validate(value)) return null
            val el = element(ai, value, today)
            if (strict && def != null && def.dateKind != DateKind.NONE && el.date == null) return null
            elements += el
        }
        return if (elements.isEmpty()) null else Gs1Result(elements)
    }

    /** Parses a GS1 Digital Link URL (any domain). Returns `null` when [url] is not one. */
    @JvmStatic
    @JvmOverloads
    public fun parseDigitalLink(url: String, today: CalendarDate = CalendarDate.today()): Gs1Result? = try {
        parseDigitalLinkInternal(url.trim(), today)
    } catch (_: RuntimeException) {
        null
    }

    /** `true` if [url] is a GS1 Digital Link URL. */
    @JvmStatic
    public fun isDigitalLink(url: String): Boolean = parseDigitalLink(url) != null

    private fun parseDigitalLinkInternal(url: String, today: CalendarDate): Gs1Result? {
        val m = DIGITAL_LINK.matchEntire(url) ?: return null
        val path = m.groupValues[1]
        val query = m.groupValues[2].removePrefix("?")
        val segments = path.split('/').filter { it.isNotEmpty() }
        var start = -1
        for (i in 0 until segments.size - 1) {
            val ai = digitalLinkAi(segments[i]) ?: continue
            if (ai in PRIMARY_KEYS && isValidPrimaryKey(ai, percentDecode(segments[i + 1], plusIsSpace = false))) {
                start = i
                break
            }
        }
        if (start < 0) return null
        val elements = ArrayList<Gs1Element>()
        var i = start
        while (i + 1 < segments.size) {
            val ai = digitalLinkAi(segments[i]) ?: break
            elements += digitalLinkElement(ai, segments[i + 1], today)
            i += 2
        }
        if (query.isNotEmpty()) {
            for (pair in query.split('&')) {
                val eq = pair.indexOf('=')
                if (eq <= 0) continue
                val ai = digitalLinkAi(pair.substring(0, eq)) ?: continue
                if (elements.any { it.ai == ai }) continue
                val rawValue = pair.substring(eq + 1)
                if (rawValue.isEmpty()) continue
                elements += digitalLinkElement(ai, rawValue, today)
            }
        }
        return Gs1Result(elements)
    }

    private fun digitalLinkElement(ai: String, encoded: String, today: CalendarDate): Gs1Element {
        val decoded = percentDecode(encoded, plusIsSpace = false)
        val value = if (ai == "01" || ai == "02") decoded.padStart(14, '0') else decoded
        val el = element(ai, value, today)
        return if (value != encoded) el.copy(raw = encoded) else el
    }

    private fun digitalLinkAi(segment: String): String? {
        if (segment.isNotEmpty() && segment.all { it in '0'..'9' }) {
            return if (segment.length >= 2 && aiLength(segment.substring(0, 2)) == segment.length) segment else null
        }
        return DL_CONVENIENCE[segment.lowercase()]
    }

    private fun isValidPrimaryKey(ai: String, value: String): Boolean {
        val digits = value.all { it in '0'..'9' }
        return when (ai) {
            "01" -> digits && value.length in setOf(8, 12, 13, 14)
            "00" -> digits && value.length == 18
            "414", "417" -> digits && value.length == 13
            "8006", "8017", "8018" -> digits && value.length == 18
            "253", "255" -> value.length >= 13 && value.substring(0, 13).all { it in '0'..'9' }
            else -> value.isNotEmpty()
        }
    }

    private fun element(ai: String, value: String, today: CalendarDate): Gs1Element {
        val def = definitions[ai]
        val date = when (def?.dateKind) {
            DateKind.YYMMDD -> yymmdd(value, today)
            DateKind.YYMMDDHHMM -> yymmddhhmm(value, today)
            DateKind.YYMMDDHH_OPT -> yymmddhhOpt(value, today)
            DateKind.YYYYMMDD -> yyyymmdd(value)
            else -> null
        }
        val number = if (def?.decimal == true) decimalValue(ai, value) else null
        return Gs1Element(ai, def?.title ?: "", value, null, date, number)
    }

    private fun decimalValue(ai: String, value: String): Double? {
        val decimals = ai.last() - '0'
        val digits = if (ai.startsWith("391") || ai.startsWith("393")) value.drop(3) else value
        if (digits.isEmpty() || !digits.all { it in '0'..'9' }) return null
        return BigDecimal(BigInteger(digits), decimals).toDouble()
    }

    /** GS1 century rule (General Specifications 7.12) for two-digit years. */
    private fun fullYear(yy: Int, today: CalendarDate): Int {
        val currentYy = today.year % 100
        val century = today.year - currentYy
        val diff = yy - currentYy
        return when {
            diff in 51..99 -> century - 100 + yy
            diff in -99..-50 -> century + 100 + yy
            else -> century + yy
        }
    }

    internal fun yymmdd(value: String, today: CalendarDate): String? {
        if (value.length < 6 || !value.substring(0, 6).all { it in '0'..'9' }) return null
        val yy = value.substring(0, 2).toInt()
        val mm = value.substring(2, 4).toInt()
        val dd = value.substring(4, 6).toInt()
        if (mm !in 1..12) return null
        val year = fullYear(yy, today)
        val last = CalendarDate.daysInMonth(year, mm)
        val day = if (dd == 0) last else dd
        if (day > last) return null
        return CalendarDate.iso(year, mm, day)
    }

    private fun yymmddhhmm(value: String, today: CalendarDate): String? {
        if (value.length != 10 || !value.all { it in '0'..'9' }) return null
        val date = yymmdd(value, today) ?: return null
        val hh = value.substring(6, 8).toInt()
        val mi = value.substring(8, 10).toInt()
        if (hh > 23 || mi > 59) return null
        return date + "T" + value.substring(6, 8) + ":" + value.substring(8, 10)
    }

    private fun yymmddhhOpt(value: String, today: CalendarDate): String? {
        if (value.length < 8 || !value.all { it in '0'..'9' }) return null
        val date = yymmdd(value, today) ?: return null
        val hh = value.substring(6, 8)
        if (hh.toInt() > 23) return null
        val mm = if (value.length >= 10) value.substring(8, 10) else "00"
        val ss = if (value.length >= 12) ":" + value.substring(10, 12) else ""
        return date + "T" + hh + ":" + mm + ss
    }

    private fun yyyymmdd(value: String): String? {
        if (value.length < 8 || !value.substring(0, 8).all { it in '0'..'9' }) return null
        return CalendarDate.of(value.substring(0, 4).toInt(), value.substring(4, 6).toInt(), value.substring(6, 8).toInt())?.toString()
    }

    internal fun percentDecode(s: String, plusIsSpace: Boolean): String {
        if (s.indexOf('%') < 0 && (!plusIsSpace || s.indexOf('+') < 0)) return s
        val out = java.io.ByteArrayOutputStream(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%' && i + 2 < s.length && isHex(s[i + 1]) && isHex(s[i + 2])) {
                out.write(s.substring(i + 1, i + 3).toInt(16))
                i += 3
            } else {
                val ch = if (plusIsSpace && c == '+') " " else c.toString()
                val bytes = ch.toByteArray(Charsets.UTF_8)
                out.write(bytes, 0, bytes.size)
                i++
            }
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    private fun isHex(c: Char) = c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'

    private val HRI_AI = Regex("\\((\\d{2,4})\\)")
    private val DIGITAL_LINK = Regex("^https?://[^/?#\\s]+(/[^?#\\s]*)?(\\?[^#\\s]*)?(#\\S*)?$", RegexOption.IGNORE_CASE)
    private val PRIMARY_KEYS = setOf("01", "00", "253", "255", "401", "402", "414", "417", "8003", "8004", "8006", "8010", "8013", "8017", "8018")
    private val DL_CONVENIENCE = mapOf(
        "gtin" to "01", "itip" to "8006", "cpv" to "22", "lot" to "10", "ser" to "21", "sscc" to "00",
        "gln" to "414", "party" to "417", "gsrnp" to "8017", "gsrn" to "8018", "grai" to "8003",
        "giai" to "8004", "gdti" to "253", "gcn" to "255", "ginc" to "401", "gsin" to "402",
        "cpid" to "8010", "gmn" to "8013", "glnx" to "254", "exp" to "17", "srin" to "8019",
    )

    private fun buildDefinitions(): Map<String, Def> {
        val map = HashMap<String, Def>(1024)
        fun add(ai: String, title: String, format: String, date: DateKind = DateKind.NONE, decimal: Boolean = false) {
            map[ai] = Def(ai, title, format, date, decimal)
        }
        fun family(prefix: String, title: String, format: String, decimal: Boolean = true) {
            for (n in 0..9) add(prefix + n, title, format, decimal = decimal)
        }

        add("00", "SSCC", "N18")
        add("01", "GTIN", "N14")
        add("02", "CONTENT", "N14")
        add("03", "MTO GTIN", "N14")
        add("10", "BATCH/LOT", "X..20")
        add("11", "PROD DATE", "N6", DateKind.YYMMDD)
        add("12", "DUE DATE", "N6", DateKind.YYMMDD)
        add("13", "PACK DATE", "N6", DateKind.YYMMDD)
        add("15", "BEST BEFORE or BEST BY", "N6", DateKind.YYMMDD)
        add("16", "SELL BY", "N6", DateKind.YYMMDD)
        add("17", "USE BY or EXPIRY", "N6", DateKind.YYMMDD)
        add("20", "VARIANT", "N2")
        add("21", "SERIAL", "X..20")
        add("22", "CPV", "X..20")
        add("235", "TPX", "X..28")
        add("240", "ADDITIONAL ID", "X..30")
        add("241", "CUST. PART No.", "X..30")
        add("242", "MTO VARIANT", "N..6")
        add("243", "PCN", "X..20")
        add("250", "SECONDARY SERIAL", "X..30")
        add("251", "REF. TO SOURCE", "X..30")
        add("253", "GDTI", "N13+X..17")
        add("254", "GLN EXTENSION COMPONENT", "X..20")
        add("255", "GCN", "N13+N..12")
        add("30", "VAR. COUNT", "N..8")

        // Trade measures (metric), n = implied decimal places.
        family("310", "NET WEIGHT (kg)", "N6")
        family("311", "LENGTH (m)", "N6")
        family("312", "WIDTH (m)", "N6")
        family("313", "HEIGHT (m)", "N6")
        family("314", "AREA (m²)", "N6")
        family("315", "NET VOLUME (l)", "N6")
        family("316", "NET VOLUME (m³)", "N6")
        // Trade measures (imperial) and logistic measures.
        family("320", "NET WEIGHT (lb)", "N6")
        family("321", "LENGTH (in)", "N6")
        family("322", "LENGTH (ft)", "N6")
        family("323", "LENGTH (yd)", "N6")
        family("324", "WIDTH (in)", "N6")
        family("325", "WIDTH (ft)", "N6")
        family("326", "WIDTH (yd)", "N6")
        family("327", "HEIGHT (in)", "N6")
        family("328", "HEIGHT (ft)", "N6")
        family("329", "HEIGHT (yd)", "N6")
        family("330", "GROSS WEIGHT (kg)", "N6")
        family("331", "LENGTH (m), log", "N6")
        family("332", "WIDTH (m), log", "N6")
        family("333", "HEIGHT (m), log", "N6")
        family("334", "AREA (m²), log", "N6")
        family("335", "VOLUME (l), log", "N6")
        family("336", "VOLUME (m³), log", "N6")
        family("337", "KG PER m²", "N6")
        family("340", "GROSS WEIGHT (lb)", "N6")
        family("341", "LENGTH (in), log", "N6")
        family("342", "LENGTH (ft), log", "N6")
        family("343", "LENGTH (yd), log", "N6")
        family("344", "WIDTH (in), log", "N6")
        family("345", "WIDTH (ft), log", "N6")
        family("346", "WIDTH (yd), log", "N6")
        family("347", "HEIGHT (in), log", "N6")
        family("348", "HEIGHT (ft), log", "N6")
        family("349", "HEIGHT (yd), log", "N6")
        family("350", "AREA (in²)", "N6")
        family("351", "AREA (ft²)", "N6")
        family("352", "AREA (yd²)", "N6")
        family("353", "AREA (in²), log", "N6")
        family("354", "AREA (ft²), log", "N6")
        family("355", "AREA (yd²), log", "N6")
        family("356", "NET WEIGHT (troy oz)", "N6")
        family("357", "NET VOLUME (oz)", "N6")
        family("360", "NET VOLUME (qt)", "N6")
        family("361", "NET VOLUME (gal.)", "N6")
        family("362", "VOLUME (qt), log", "N6")
        family("363", "VOLUME (gal.), log", "N6")
        family("364", "VOLUME (in³)", "N6")
        family("365", "VOLUME (ft³)", "N6")
        family("366", "VOLUME (yd³)", "N6")
        family("367", "VOLUME (in³), log", "N6")
        family("368", "VOLUME (ft³), log", "N6")
        family("369", "VOLUME (yd³), log", "N6")
        add("37", "COUNT", "N..8")
        family("390", "AMOUNT", "N..15")
        family("391", "AMOUNT", "N3+N..15")
        family("392", "PRICE", "N..15")
        family("393", "PRICE", "N3+N..15")
        family("394", "PRCNT OFF", "N4")
        family("395", "PRICE/UoM", "N6")

        add("400", "ORDER NUMBER", "X..30")
        add("401", "GINC", "X..30")
        add("402", "GSIN", "N17")
        add("403", "ROUTE", "X..30")
        add("410", "SHIP TO LOC", "N13")
        add("411", "BILL TO", "N13")
        add("412", "PURCHASE FROM", "N13")
        add("413", "SHIP FOR LOC", "N13")
        add("414", "LOC No.", "N13")
        add("415", "PAY TO", "N13")
        add("416", "PROD/SERV LOC", "N13")
        add("417", "PARTY", "N13")
        add("420", "SHIP TO POST", "X..20")
        add("421", "SHIP TO POST", "N3+X..9")
        add("422", "ORIGIN", "N3")
        add("423", "COUNTRY - INITIAL PROCESS.", "N3+N..12")
        add("424", "COUNTRY - PROCESS.", "N3")
        add("425", "COUNTRY - DISASSEMBLY", "N3+N..12")
        add("426", "COUNTRY - FULL PROCESS", "N3")
        add("427", "ORIGIN SUBDIVISION", "X..3")

        add("4300", "SHIP TO COMP", "X..35")
        add("4301", "SHIP TO NAME", "X..35")
        add("4302", "SHIP TO ADD1", "X..70")
        add("4303", "SHIP TO ADD2", "X..70")
        add("4304", "SHIP TO SUB", "X..70")
        add("4305", "SHIP TO LOC", "X..70")
        add("4306", "SHIP TO REG", "X..70")
        add("4307", "SHIP TO COUNTRY", "X2")
        add("4308", "SHIP TO PHONE", "X..30")
        add("4309", "SHIP TO GEO", "N20")
        add("4310", "RTN TO COMP", "X..35")
        add("4311", "RTN TO NAME", "X..35")
        add("4312", "RTN TO ADD1", "X..70")
        add("4313", "RTN TO ADD2", "X..70")
        add("4314", "RTN TO SUB", "X..70")
        add("4315", "RTN TO LOC", "X..70")
        add("4316", "RTN TO REG", "X..70")
        add("4317", "RTN TO COUNTRY", "X2")
        add("4318", "RTN TO POST", "X..20")
        add("4319", "RTN TO PHONE", "X..30")
        add("4320", "SRV DESCRIPTION", "X..35")
        add("4321", "DANGEROUS GOODS", "N1")
        add("4322", "AUTH LEAVE", "N1")
        add("4323", "SIG REQUIRED", "N1")
        add("4324", "NBEF DEL DT", "N10", DateKind.YYMMDDHHMM)
        add("4325", "NAFT DEL DT", "N10", DateKind.YYMMDDHHMM)
        add("4326", "REL DATE", "N6", DateKind.YYMMDD)

        add("7001", "NSN", "N13")
        add("7002", "MEAT CUT", "X..30")
        add("7003", "EXPIRY TIME", "N10", DateKind.YYMMDDHHMM)
        add("7004", "ACTIVE POTENCY", "N..4")
        add("7005", "CATCH AREA", "X..12")
        add("7006", "FIRST FREEZE DATE", "N6", DateKind.YYMMDD)
        add("7007", "HARVEST DATE", "N6..12", DateKind.YYMMDD)
        add("7008", "AQUATIC SPECIES", "X..3")
        add("7009", "FISHING GEAR TYPE", "X..10")
        add("7010", "PROD METHOD", "X..2")
        add("7011", "TEST BY DATE", "N6..10", DateKind.YYMMDD)
        add("7020", "REFURB LOT", "X..20")
        add("7021", "FUNC STAT", "X..20")
        add("7022", "REV STAT", "X..20")
        add("7023", "GIAI - ASSEMBLY", "X..30")
        for (n in 0..9) add("703$n", "PROCESSOR # $n", "N3+X..27")
        add("7040", "UIC+EXT", "N1+X3")
        add("710", "NHRN PZN", "X..20")
        add("711", "NHRN CIP", "X..20")
        add("712", "NHRN CN", "X..20")
        add("713", "NHRN DRN", "X..20")
        add("714", "NHRN AIM", "X..20")
        add("715", "NHRN NDC", "X..20")
        add("716", "NHRN AIC", "X..20")
        for (n in 0..9) add("723$n", "CERT # ${n + 1}", "X2+X..28")
        add("7240", "PROTOCOL", "X..20")
        add("7241", "AIDC MEDIA TYPE", "N2")
        add("7242", "VCN", "X..25")
        add("7250", "DOB", "N8", DateKind.YYYYMMDD)
        add("7251", "DOB TIME", "N12", DateKind.YYYYMMDD)
        add("7252", "BIO SEX", "N1")
        add("7253", "FAMILY NAME", "X..40")
        add("7254", "GIVEN NAME", "X..40")
        add("7255", "SUFFIX", "X..10")
        add("7256", "FULL NAME", "X..90")
        add("7257", "PERSON ADDR", "X..70")
        add("7258", "BIRTH SEQUENCE", "N1+X1+N1")
        add("7259", "BABY", "X..40")

        add("8001", "DIMENSIONS", "N14")
        add("8002", "CMT No.", "X..20")
        add("8003", "GRAI", "N14+X..16")
        add("8004", "GIAI", "X..30")
        add("8005", "PRICE PER UNIT", "N6")
        add("8006", "ITIP", "N14+N2+N2")
        add("8007", "IBAN", "X..34")
        add("8008", "PROD TIME", "N8+N..4", DateKind.YYMMDDHH_OPT)
        add("8009", "OPTSEN", "X..50")
        add("8010", "CPID", "X..30")
        add("8011", "CPID SERIAL", "N..12")
        add("8012", "VERSION", "X..20")
        add("8013", "GMN", "X..25")
        add("8014", "MUDI", "X..25")
        add("8017", "GSRN - PROVIDER", "N18")
        add("8018", "GSRN - RECIPIENT", "N18")
        add("8019", "SRIN", "N..10")
        add("8020", "REF No.", "X..25")
        add("8026", "ITIP CONTENT", "N14+N2+N2")
        add("8030", "DIGSIG", "X..90")
        add("8110", "COUPON", "X..70")
        add("8111", "POINTS", "N4")
        add("8112", "COUPON", "X..70")
        add("8200", "PRODUCT URL", "X..70")
        add("90", "INTERNAL", "X..30")
        for (n in 91..99) add(n.toString(), "INTERNAL", "X..90")
        return map
    }
}

/** GTIN / EAN / UPC helpers (GS1 mod-10 check digits). */
public object Gtin {
    /** The GS1 mod-10 check digit for [body] (all digits except the check digit). */
    @JvmStatic
    public fun checkDigit(body: String): Int {
        require(body.isNotEmpty() && body.all { it in '0'..'9' }) { "digits expected" }
        var sum = 0
        var weight3 = true
        for (i in body.indices.reversed()) {
            val d = body[i] - '0'
            sum += if (weight3) d * 3 else d
            weight3 = !weight3
        }
        return (10 - sum % 10) % 10
    }

    /** `true` when [code] (8–18 digits, check digit last) has a valid GS1 check digit. */
    @JvmStatic
    public fun isValid(code: String): Boolean {
        if (code.length < 2 || !code.all { it in '0'..'9' }) return false
        return checkDigit(code.dropLast(1)) == code.last() - '0'
    }

    /** Expands an 8-digit UPC-E (number system, 6 digits, check digit) into the 12-digit UPC-A. */
    @JvmStatic
    public fun upceToUpca(upce: String): String? {
        if (upce.length != 8 || !upce.all { it in '0'..'9' }) return null
        val ns = upce[0]
        if (ns != '0' && ns != '1') return null
        val d = upce.substring(1, 7)
        val check = upce[7]
        val body = when (d[5]) {
            '0', '1', '2' -> d.substring(0, 2) + d[5] + "0000" + d.substring(2, 5)
            '3' -> d.substring(0, 3) + "00000" + d.substring(3, 5)
            '4' -> d.substring(0, 4) + "00000" + d[4]
            else -> d.substring(0, 5) + "0000" + d[5]
        }
        return "$ns$body$check"
    }

    /** Zero pads an 8, 12, 13 or 14 digit code to a GTIN-14, or returns `null`. */
    @JvmStatic
    public fun toGtin14(code: String): String? =
        if (code.all { it in '0'..'9' } && code.length in setOf(8, 12, 13, 14)) code.padStart(14, '0') else null
}
