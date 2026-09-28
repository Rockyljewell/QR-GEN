// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

/**
 * Parsed North American driver license / ID card (SPEC §3.3).
 *
 * String fields are `""` when absent. Dates are ISO `YYYY-MM-DD`. [age], [isExpired] and
 * [isUnder21] are `null` when the relevant date is missing or invalid, so an unknown value is
 * never mistaken for a pass in age or validity checks.
 *
 * @property fields every data element by its three-letter AAMVA code (`DAQ`, `DCS`, ...),
 *   including jurisdiction-specific subfiles (`ZCA`, ...).
 */
public data class AamvaResult(
    public val issuerId: String,
    public val aamvaVersion: Int,
    public val jurisdictionVersion: Int,
    public val documentType: String,
    public val firstName: String,
    public val middleName: String,
    public val lastName: String,
    public val suffix: String,
    public val fullName: String,
    public val dateOfBirth: String,
    public val issueDate: String,
    public val expiryDate: String,
    public val sex: String,
    public val documentNumber: String,
    public val street: String,
    public val city: String,
    public val state: String,
    public val postalCode: String,
    public val country: String,
    public val eyeColor: String,
    public val height: String,
    public val age: Int?,
    public val isExpired: Boolean?,
    public val isUnder21: Boolean?,
    public val fields: Map<String, String>,
) {
    public fun toMap(): Map<String, Any?> = linkedMapOf(
        "issuerId" to issuerId,
        "aamvaVersion" to aamvaVersion,
        "jurisdictionVersion" to jurisdictionVersion,
        "documentType" to documentType,
        "firstName" to firstName,
        "middleName" to middleName,
        "lastName" to lastName,
        "suffix" to suffix,
        "fullName" to fullName,
        "dateOfBirth" to dateOfBirth,
        "issueDate" to issueDate,
        "expiryDate" to expiryDate,
        "sex" to sex,
        "documentNumber" to documentNumber,
        "street" to street,
        "city" to city,
        "state" to state,
        "postalCode" to postalCode,
        "country" to country,
        "eyeColor" to eyeColor,
        "height" to height,
        "age" to age,
        "isExpired" to isExpired,
        "isUnder21" to isUnder21,
        "fields" to fields,
    )

    public fun toJson(): String = Json.stringify(toMap())
}

/**
 * Parser for the AAMVA DL/ID card design standard (PDF417 on the back of US and Canadian
 * driver licenses and ID cards), versions 1 through 10. Never throws; returns `null` when the
 * input is not an AAMVA payload.
 *
 * Handles the header (`@`, LF, RS, CR, `ANSI ` or `AAMVA`, IIN, versions, subfile directory),
 * tolerates wrong subfile offsets (common in the field), legacy version 1 name elements
 * (`DAA`, `DAB`), and both date layouts: `MMDDCCYY` for the USA and `CCYYMMDD` for Canada
 * (detected from `DCG`, the jurisdiction, or by plausibility).
 */
public object AAMVA {
    private val CANADIAN_JURISDICTIONS = setOf("AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT")
    private val PLACEHOLDERS = setOf("NONE", "UNAVL", "UNAVAILABLE", "N/A", "NA")
    private val ELEMENT_CODE = Regex("^[A-Z][A-Z0-9]{2}")

    /**
     * Parses [data].
     *
     * @param today the date used for [AamvaResult.age], [AamvaResult.isExpired] and
     *   [AamvaResult.isUnder21]; inject a fixed date in tests.
     */
    @JvmStatic
    @JvmOverloads
    public fun parse(data: String, today: CalendarDate = CalendarDate.today()): AamvaResult? = try {
        parseInternal(data, today)
    } catch (_: RuntimeException) {
        null
    }

    /** Cheap check used by content detection: does [data] look like an AAMVA payload? */
    @JvmStatic
    public fun looksLikeAamva(data: String): Boolean {
        val head = data.take(40)
        return (head.startsWith("@") && (head.contains("ANSI ") || head.contains("AAMVA"))) ||
            head.trimStart().startsWith("ANSI 6") || head.trimStart().startsWith("AAMVA6")
    }

    private class Entry(val type: String, val offset: Int, val length: Int)

    private class Header(val issuerId: String, val version: Int, val jurisdictionVersion: Int, val entries: List<Entry>, val end: Int)

    private fun parseInternal(text: String, today: CalendarDate): AamvaResult? {
        if (text.isEmpty()) return null
        val header = parseHeader(text)
        val fields = LinkedHashMap<String, String>()
        var documentType = ""

        if (header != null) {
            var searchFrom = header.end
            for (entry in header.entries) {
                val start = when {
                    entry.offset >= header.end && entry.offset + 2 <= text.length &&
                        text.startsWith(entry.type, entry.offset) -> entry.offset
                    else -> text.indexOf(entry.type, searchFrom)
                }
                if (start < 0) continue
                val bodyStart = start + 2
                val cr = text.indexOf('\r', bodyStart)
                val end = when {
                    cr >= 0 -> cr
                    entry.length > 2 && start + entry.length <= text.length -> start + entry.length
                    else -> text.length
                }
                parseElements(text.substring(bodyStart, end), fields)
                if (documentType.isEmpty() && (entry.type == "DL" || entry.type == "ID" || entry.type == "EN")) {
                    documentType = entry.type
                }
                searchFrom = end
            }
        }

        if (fields.isEmpty()) {
            // No usable header: accept bare element lists ("DAQ...\nDCS...\n") with a leading
            // subfile type stripped.
            val tokens = text.split('\n', '\r', '\u001e')
            for (raw in tokens) {
                var token = raw.trim()
                if (token.length >= 5 && (token.startsWith("DL") || token.startsWith("ID")) && ELEMENT_CODE.containsMatchIn(token.substring(2)) && token[2] == 'D') {
                    if (documentType.isEmpty()) documentType = token.substring(0, 2)
                    token = token.substring(2)
                }
                addElement(token, fields)
            }
        }

        val known = listOf("DAQ", "DCS", "DAC", "DAA", "DAB", "DBB", "DBA")
        if (known.count { it in fields } < 2) return null

        val version = header?.version ?: 0
        val country = fields["DCG"]?.trim()?.uppercase().orEmpty()
        val state = fields["DAJ"]?.trim()?.uppercase().orEmpty()
        val canadian = country == "CAN" || (country.isEmpty() && state in CANADIAN_JURISDICTIONS)
        val preferYmd = canadian || version == 1

        val names = names(fields)
        val dob = date(fields["DBB"], preferYmd)
        val issue = date(fields["DBD"], preferYmd)
        val expiry = date(fields["DBA"], preferYmd)
        val age = dob?.yearsUntil(today)

        return AamvaResult(
            issuerId = header?.issuerId.orEmpty(),
            aamvaVersion = version,
            jurisdictionVersion = header?.jurisdictionVersion ?: 0,
            documentType = documentType,
            firstName = names.first,
            middleName = names.middle,
            lastName = names.last,
            suffix = names.suffix,
            fullName = listOf(names.first, names.middle, names.last, names.suffix).filter { it.isNotEmpty() }.joinToString(" "),
            dateOfBirth = dob?.toString().orEmpty(),
            issueDate = issue?.toString().orEmpty(),
            expiryDate = expiry?.toString().orEmpty(),
            sex = sex(fields["DBC"]),
            documentNumber = clean(fields["DAQ"]),
            street = clean(fields["DAG"]),
            city = clean(fields["DAI"]),
            state = state,
            postalCode = postalCode(fields["DAK"]),
            country = country.ifEmpty { if (canadian) "CAN" else if (state.isNotEmpty()) "USA" else "" },
            eyeColor = clean(fields["DAY"]),
            height = clean(fields["DAU"]),
            age = age,
            isExpired = expiry?.let { it < today },
            isUnder21 = age?.let { it < 21 },
            fields = java.util.Collections.unmodifiableMap(fields),
        )
    }

    private fun parseHeader(text: String): Header? {
        var idx = text.indexOf("ANSI ")
        var markerLength = 5
        if (idx < 0 || idx > 16) {
            idx = text.indexOf("AAMVA")
            markerLength = 5
        }
        if (idx < 0 || idx > 16) return null
        val p = idx + markerLength
        if (p + 10 > text.length) return null
        val issuerId = text.substring(p, p + 6)
        if (!issuerId.all { it in '0'..'9' }) return null
        val version = text.substring(p + 6, p + 8).toIntOrNull() ?: return null
        // Version 1 has no jurisdiction version; later versions do. Try the expected layout
        // first, then the other one (some version 1 cards include it anyway).
        val withJurisdiction = version >= 2
        return readDirectory(text, issuerId, version, p + 8, withJurisdiction)
            ?: readDirectory(text, issuerId, version, p + 8, !withJurisdiction)
    }

    private fun readDirectory(text: String, issuerId: String, version: Int, from: Int, withJurisdiction: Boolean): Header? {
        var p = from
        var jurisdictionVersion = 0
        if (withJurisdiction) {
            if (p + 2 > text.length) return null
            jurisdictionVersion = text.substring(p, p + 2).toIntOrNull() ?: return null
            p += 2
        }
        if (p + 2 > text.length) return null
        val count = text.substring(p, p + 2).toIntOrNull() ?: return null
        p += 2
        if (count !in 1..20) return null
        val entries = ArrayList<Entry>(count)
        repeat(count) {
            if (p + 10 > text.length) return null
            val type = text.substring(p, p + 2)
            if (!type.all { it in 'A'..'Z' }) return null
            val offset = text.substring(p + 2, p + 6).toIntOrNull() ?: return null
            val length = text.substring(p + 6, p + 10).toIntOrNull() ?: return null
            entries += Entry(type, offset, length)
            p += 10
        }
        return Header(issuerId, version, jurisdictionVersion, entries, p)
    }

    private fun parseElements(body: String, into: MutableMap<String, String>) {
        for (token in body.split('\n', '\r')) addElement(token.trim(), into)
    }

    private fun addElement(token: String, into: MutableMap<String, String>) {
        if (token.length < 3 || !ELEMENT_CODE.containsMatchIn(token)) return
        val code = token.substring(0, 3)
        into.putIfAbsent(code, token.substring(3).trim())
    }

    private data class Names(val first: String, val middle: String, val last: String, val suffix: String)

    private fun names(f: Map<String, String>): Names {
        var last = clean(f["DCS"]).ifEmpty { clean(f["DAB"]) }
        var first = clean(f["DAC"])
        var middle = clean(f["DAD"])
        var suffix = clean(f["DCU"]).ifEmpty { clean(f["DAE"]) }

        if (first.isEmpty()) {
            val given = clean(f["DCT"])
            if (given.isNotEmpty()) {
                val parts = given.split(',', ' ', '$').filter { it.isNotBlank() }
                first = parts.firstOrNull().orEmpty()
                if (middle.isEmpty()) middle = parts.drop(1).joinToString(" ")
            }
        }

        val full = clean(f["DAA"])
        if ((first.isEmpty() || last.isEmpty()) && full.isNotEmpty()) {
            val separated = full.replace('$', ',')
            if (separated.contains(',')) {
                // "LAST,FIRST,MIDDLE,SUFFIX" (AAMVA 2000)
                val parts = separated.split(',').map { it.trim() }
                if (last.isEmpty()) last = parts.getOrNull(0).orEmpty()
                if (first.isEmpty()) {
                    val given = parts.getOrNull(1).orEmpty().split(' ').filter { it.isNotBlank() }
                    first = given.firstOrNull().orEmpty()
                    if (middle.isEmpty()) middle = (given.drop(1) + listOfNotNull(parts.getOrNull(2))).filter { it.isNotBlank() }.joinToString(" ")
                }
                if (suffix.isEmpty()) suffix = parts.getOrNull(3).orEmpty()
            } else {
                // "FIRST MIDDLE LAST"
                val parts = full.split(' ').filter { it.isNotBlank() }
                if (first.isEmpty()) first = parts.firstOrNull().orEmpty()
                if (last.isEmpty() && parts.size > 1) last = parts.last()
                if (middle.isEmpty() && parts.size > 2) middle = parts.subList(1, parts.size - 1).joinToString(" ")
            }
        }
        return Names(clean(first), clean(middle), clean(last), clean(suffix))
    }

    private fun clean(value: String?): String {
        val v = value?.trim()?.trimEnd(',')?.trim().orEmpty()
        return if (v.uppercase() in PLACEHOLDERS) "" else v
    }

    private fun sex(value: String?): String = when (value?.trim()?.uppercase()) {
        "1", "M" -> "M"
        "2", "F" -> "F"
        "9", "X" -> "X"
        else -> ""
    }

    private fun postalCode(value: String?): String {
        val v = value?.trim().orEmpty()
        val digits = v.replace("-", "").replace(" ", "")
        if (digits.all { it in '0'..'9' }) {
            return when {
                digits.length >= 9 -> {
                    val zip = digits.substring(0, 5)
                    val plus4 = digits.substring(5, 9)
                    if (plus4 == "0000") zip else "$zip-$plus4"
                }
                digits.length >= 5 -> digits.substring(0, 5)
                else -> digits
            }
        }
        return v.replace(Regex("\\s+"), " ")
    }

    /** Parses an 8-digit AAMVA date, trying the preferred layout first. */
    internal fun date(value: String?, preferYmd: Boolean): CalendarDate? {
        val v = value?.trim().orEmpty()
        if (v.length < 8 || !v.substring(0, 8).all { it in '0'..'9' }) return null
        val d = v.substring(0, 8)
        val mdy = { CalendarDate.of(d.substring(4, 8).toInt(), d.substring(0, 2).toInt(), d.substring(2, 4).toInt())?.takeIf { it.year in 1900..2199 } }
        val ymd = { CalendarDate.of(d.substring(0, 4).toInt(), d.substring(4, 6).toInt(), d.substring(6, 8).toInt())?.takeIf { it.year in 1900..2199 } }
        return if (preferYmd) ymd() ?: mdy() else mdy() ?: ymd()
    }
}
