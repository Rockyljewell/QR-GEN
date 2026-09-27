package dev.qrgen

/**
 * Classifies and parses barcode payloads (SPEC §3.1). Never throws: anything it does not
 * recognize becomes [ParsedContent.Text].
 *
 * ```kotlin
 * when (val c = ContentParser.parse("WIFI:T:WPA;S:Home;P:secret;;")) {
 *     is ParsedContent.Wifi -> connect(c.ssid, c.password)
 *     is ParsedContent.Url -> open(c.url)
 *     else -> show(c.toJson())
 * }
 * ```
 */
public object ContentParser {
    private val EMAIL = Regex("^[^\\s@:;,<>]+@[^\\s@:;,<>]+\\.[^\\s@:;,<>]+$")
    private val GENERIC_URI = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://\\S+$")
    private val OTHER_PAYMENT = setOf("litecoin", "bitcoincash", "dogecoin", "dash", "monero", "zcash", "solana", "lightning", "cardano", "tron")

    /** Parses [data] without symbology hints. */
    @JvmStatic
    public fun parse(data: String): ParsedContent = parse(data, null, false)

    /** Parses a scanned [barcode], using its symbology and GS1 flag as hints. */
    @JvmStatic
    public fun parse(barcode: Barcode): ParsedContent = parse(barcode.data, barcode.symbology, barcode.isGS1)

    /**
     * Parses [data]. [symbology] disambiguates product codes (an 8-digit UPC-E vs EAN-8) and
     * [isGS1] forces GS1 interpretation.
     */
    @JvmStatic
    @JvmOverloads
    public fun parse(data: String, symbology: Symbology?, isGS1: Boolean = false): ParsedContent = try {
        parseInternal(data, symbology, isGS1)
    } catch (_: RuntimeException) {
        ParsedContent.Text(data)
    }

    private fun parseInternal(data: String, symbology: Symbology?, isGS1: Boolean): ParsedContent {
        if (data.isBlank()) return ParsedContent.Text(data)
        if (AAMVA.looksLikeAamva(data)) AAMVA.parse(data)?.let { return ParsedContent.Aamva(it) }
        if (isGS1) GS1.parse(data)?.let { return ParsedContent.Gs1(it) }

        val s = data.trim()
        val lower = s.lowercase()
        val scheme = lower.substringBefore(':', "")

        when {
            lower.startsWith("http://") || lower.startsWith("https://") -> {
                GS1.parseDigitalLink(s)?.let { return ParsedContent.Gs1DigitalLink(s, it) }
                return ParsedContent.Url(s)
            }
            scheme == "mailto" -> return mailto(s)
            scheme == "matmsg" -> return matmsg(s)
            scheme == "tel" -> GS1.percentDecode(s.substring(4), plusIsSpace = false).trim().takeIf { it.isNotEmpty() }
                ?.let { return ParsedContent.Phone(it) }
            scheme == "sms" || scheme == "smsto" || scheme == "mms" || scheme == "mmsto" -> sms(s)?.let { return it }
            scheme == "wifi" -> wifi(s)?.let { return it }
            scheme == "geo" -> geo(s)?.let { return it }
            lower.startsWith("begin:vcard") -> return vcard(s)
            scheme == "mecard" -> return mecard(s)
            lower.startsWith("begin:vevent") || lower.startsWith("begin:vcalendar") -> return event(s)
            scheme == "bitcoin" -> return crypto(s, "bitcoin", "BTC")
            scheme == "ethereum" -> return ethereum(s)
            lower.startsWith("upi://pay") -> return upi(s)
            scheme in OTHER_PAYMENT -> return crypto(s, "other", null)
            scheme == "mebkm" -> meCardFields(s.substring(6)).firstOrNull { it.first.equals("URL", true) }?.let { return ParsedContent.Url(it.second) }
            scheme == "urlto" -> return ParsedContent.Url(s.substring(6).substringAfter(':', s.substring(6)).ifEmpty { s })
        }
        if (s.startsWith("BCD\n") || s.startsWith("BCD\r\n")) epc(s)?.let { return it }
        if (lower.startsWith("www.") && !s.contains(' ')) return ParsedContent.Url("https://$s")
        if (EMAIL.matches(s)) return ParsedContent.Email(s)

        if (s.all { it in '0'..'9' }) {
            product(s, symbology)?.let { return it }
            GS1.detect(s, null)?.let { return ParsedContent.Gs1(it) }
            return ParsedContent.Text(data)
        }
        val gs1Marked = s.startsWith("(") || data.indexOf(GS1.GS) >= 0 ||
            (s.length >= 3 && s.substring(0, 3) in GS1.GS1_SYMBOLOGY_IDENTIFIERS)
        if (gs1Marked) GS1.parse(data)?.let { return ParsedContent.Gs1(it) }
        if (GENERIC_URI.matches(s)) return ParsedContent.Url(s)
        return ParsedContent.Text(data)
    }

    // ---- products -------------------------------------------------------------------------

    private fun product(s: String, symbology: Symbology?): ParsedContent.Product? = when (s.length) {
        8 -> if (symbology == Symbology.UPCE) {
            val upca = Gtin.upceToUpca(s)
            if (upca != null) ParsedContent.Product(upca.padStart(14, '0'), "upce", Gtin.isValid(upca)) else null
        } else {
            ParsedContent.Product(s.padStart(14, '0'), "ean8", Gtin.isValid(s))
        }
        12 -> ParsedContent.Product(s.padStart(14, '0'), "upca", Gtin.isValid(s))
        13 -> ParsedContent.Product(
            s.padStart(14, '0'),
            if (s.startsWith("978") || s.startsWith("979")) "isbn" else "ean13",
            Gtin.isValid(s),
        )
        14 -> ParsedContent.Product(s, "gtin14", Gtin.isValid(s))
        else -> null
    }

    // ---- e-mail, phone, sms ---------------------------------------------------------------

    private fun mailto(s: String): ParsedContent.Email {
        val rest = s.substring(7)
        val to = GS1.percentDecode(rest.substringBefore('?'), plusIsSpace = false).trim()
        val q = query(rest.substringAfter('?', ""))
        val recipients = listOfNotNull(to.ifEmpty { null }, q["to"]?.ifEmpty { null }).joinToString(",")
        return ParsedContent.Email(recipients, q["subject"], q["body"])
    }

    private fun matmsg(s: String): ParsedContent.Email {
        val f = meCardFields(s.substring(7)).associate { it.first.uppercase() to it.second }
        return ParsedContent.Email(f["TO"].orEmpty(), f["SUB"]?.ifEmpty { null }, f["BODY"]?.ifEmpty { null })
    }

    private fun sms(s: String): ParsedContent.Sms? {
        val colon = s.indexOf(':')
        val scheme = s.substring(0, colon).lowercase()
        val rest = s.substring(colon + 1)
        if (scheme == "smsto" || scheme == "mmsto") {
            // SMSTO:number:body (legacy) or smsto:number?body=...
            if (!rest.contains('?')) {
                val number = rest.substringBefore(':').trim()
                val body = rest.substringAfter(':', "").ifEmpty { null }
                return if (number.isEmpty()) null else ParsedContent.Sms(number, body)
            }
        }
        val number = GS1.percentDecode(rest.substringBefore('?'), plusIsSpace = false).trim()
        val q = query(rest.substringAfter('?', ""))
        return if (number.isEmpty() && q["body"] == null) null else ParsedContent.Sms(number, q["body"])
    }

    // ---- wifi, geo ------------------------------------------------------------------------

    private fun wifi(s: String): ParsedContent.Wifi? {
        val fields = meCardFields(s.substring(5))
        fun get(key: String) = fields.firstOrNull { it.first.equals(key, ignoreCase = true) }?.second
        val ssid = get("S")?.let(::unquote) ?: return null
        val security = get("T")?.trim().orEmpty().ifEmpty { "nopass" }
        val password = get("P")?.let(::unquote)?.ifEmpty { null }
        val hidden = get("H")?.trim()?.lowercase().let { it == "true" || it == "1" || it == "yes" }
        return ParsedContent.Wifi(ssid, password, security, hidden)
    }

    private fun unquote(v: String): String = if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v.substring(1, v.length - 1) else v

    private fun geo(s: String): ParsedContent.Geo? {
        val rest = s.substring(4)
        val coords = rest.substringBefore('?').substringBefore(';')
        val parts = coords.split(',').map { it.trim() }
        if (parts.size < 2) return null
        val lat = parts[0].toDoubleOrNull() ?: return null
        val lon = parts[1].toDoubleOrNull() ?: return null
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        val alt = parts.getOrNull(2)?.toDoubleOrNull()
        val q = query(rest.substringAfter('?', ""))
        return ParsedContent.Geo(lat, lon, alt, q["q"]?.ifEmpty { null })
    }

    // ---- contacts -------------------------------------------------------------------------

    private class Property(val name: String, val params: Map<String, String>, val value: String)

    private fun contentLines(s: String): List<Property> {
        // Unfold RFC 6350/5545 continuation lines and quoted-printable soft breaks.
        val raw = s.replace("\r\n", "\n").replace('\r', '\n')
        val physical = raw.split('\n')
        val logical = ArrayList<String>()
        for (line in physical) {
            if ((line.startsWith(" ") || line.startsWith("\t")) && logical.isNotEmpty()) {
                logical[logical.size - 1] = logical.last() + line.substring(1)
            } else if (logical.isNotEmpty() && logical.last().endsWith("=") && logical.last().contains("QUOTED-PRINTABLE", ignoreCase = true)) {
                logical[logical.size - 1] = logical.last().dropLast(1) + line
            } else {
                logical += line
            }
        }
        val out = ArrayList<Property>()
        for (line in logical) {
            val colon = indexOfUnquoted(line, ':')
            if (colon <= 0) continue
            val head = line.substring(0, colon).split(';')
            val name = head[0].substringAfterLast('.').uppercase()
            val params = HashMap<String, String>()
            for (p in head.drop(1)) {
                val eq = p.indexOf('=')
                if (eq > 0) params[p.substring(0, eq).uppercase()] = p.substring(eq + 1).trim('"') else params[p.uppercase()] = ""
            }
            var value = line.substring(colon + 1)
            if (params["ENCODING"].equals("QUOTED-PRINTABLE", true) || "QUOTED-PRINTABLE" in params) {
                value = decodeQuotedPrintable(value, params["CHARSET"])
            }
            out += Property(name, params, value)
        }
        return out
    }

    private fun indexOfUnquoted(s: String, ch: Char): Int {
        var quoted = false
        for (i in s.indices) {
            val c = s[i]
            if (c == '"') quoted = !quoted
            if (c == ch && !quoted) return i
        }
        return -1
    }

    private fun decodeQuotedPrintable(v: String, charset: String?): String {
        val out = java.io.ByteArrayOutputStream()
        var i = 0
        while (i < v.length) {
            val c = v[i]
            if (c == '=' && i + 2 < v.length && isHex(v[i + 1]) && isHex(v[i + 2])) {
                out.write(v.substring(i + 1, i + 3).toInt(16))
                i += 3
            } else {
                val b = c.toString().toByteArray(Charsets.UTF_8)
                out.write(b, 0, b.size)
                i++
            }
        }
        val cs = runCatching { charset?.let { java.nio.charset.Charset.forName(it) } }.getOrNull() ?: Charsets.UTF_8
        return String(out.toByteArray(), cs)
    }

    private fun isHex(c: Char): Boolean = c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'

    /** Splits a vCard/iCalendar value on unescaped [sep] and unescapes each component. */
    private fun components(value: String, sep: Char = ';'): List<String> {
        val out = ArrayList<String>()
        val sb = StringBuilder()
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c == '\\' && i + 1 < value.length) {
                sb.append('\\').append(value[i + 1])
                i += 2
                continue
            }
            if (c == sep) {
                out += unescapeText(sb.toString())
                sb.setLength(0)
            } else {
                sb.append(c)
            }
            i++
        }
        out += unescapeText(sb.toString())
        return out
    }

    private fun unescapeText(v: String): String {
        if (v.indexOf('\\') < 0) return v
        val sb = StringBuilder(v.length)
        var i = 0
        while (i < v.length) {
            val c = v[i]
            if (c == '\\' && i + 1 < v.length) {
                when (val n = v[i + 1]) {
                    'n', 'N' -> sb.append('\n')
                    else -> sb.append(n)
                }
                i += 2
            } else {
                sb.append(c)
                i++
            }
        }
        return sb.toString()
    }

    private fun vcard(s: String): ParsedContent.Contact {
        var fn: String? = null
        var n: String? = null
        var org: String? = null
        var title: String? = null
        var address: String? = null
        var note: String? = null
        val phones = ArrayList<String>()
        val emails = ArrayList<String>()
        val urls = ArrayList<String>()
        for (p in contentLines(s)) {
            val v = p.value
            when (p.name) {
                "FN" -> fn = unescapeText(v).trim().ifEmpty { null }
                "N" -> {
                    val c = components(v).map { it.trim() }
                    // family;given;additional;prefix;suffix
                    n = listOf(c.getOrNull(3), c.getOrNull(1), c.getOrNull(2), c.getOrNull(0), c.getOrNull(4))
                        .filter { !it.isNullOrEmpty() }.joinToString(" ").ifEmpty { null }
                }
                "ORG" -> org = components(v).map { it.trim() }.filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null }
                "TITLE" -> title = unescapeText(v).trim().ifEmpty { null }
                "TEL" -> unescapeText(v).trim().removePrefix("tel:").removePrefix("TEL:").takeIf { it.isNotEmpty() }?.let { phones += it }
                "EMAIL" -> unescapeText(v).trim().removePrefix("mailto:").takeIf { it.isNotEmpty() }?.let { emails += it }
                "URL" -> unescapeText(v).trim().takeIf { it.isNotEmpty() }?.let { urls += it }
                "ADR" -> if (address == null) {
                    address = components(v).map { it.trim().replace('\n', ' ') }.filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null }
                }
                "NOTE" -> note = unescapeText(v).trim().ifEmpty { null }
            }
        }
        return ParsedContent.Contact(fn ?: n, org, title, phones, emails, urls, address, note, "vcard")
    }

    private fun mecard(s: String): ParsedContent.Contact {
        val fields = meCardFields(s.substring(7))
        var name: String? = null
        var org: String? = null
        var title: String? = null
        var address: String? = null
        var note: String? = null
        val phones = ArrayList<String>()
        val emails = ArrayList<String>()
        val urls = ArrayList<String>()
        for ((key, value) in fields) {
            val v = value.trim()
            if (v.isEmpty()) continue
            when (key.uppercase()) {
                "N" -> name = if (v.contains(',')) v.split(',').map { it.trim() }.filter { it.isNotEmpty() }.reversed().joinToString(" ") else v
                "ORG" -> org = v
                "TITLE" -> title = v
                "TEL", "TEL-AV" -> phones += v
                "EMAIL" -> emails += v
                "URL" -> urls += v
                "ADR" -> address = v.split(',').map { it.trim() }.filter { it.isNotEmpty() }.joinToString(", ")
                "NOTE", "MEMO" -> note = v
                "NICKNAME" -> if (name == null) name = v
            }
        }
        return ParsedContent.Contact(name, org, title, phones, emails, urls, address, note, "mecard")
    }

    /**
     * Splits MeCard-style `KEY:value;KEY:value;;` bodies (MECARD, MATMSG, MEBKM, WIFI) and
     * resolves backslash escapes (`\;`, `\,`, `\:`, `\\`, `\"`).
     */
    internal fun meCardFields(body: String): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        val key = StringBuilder()
        val value = StringBuilder()
        var inKey = true
        var i = 0
        while (i < body.length) {
            val c = body[i]
            when {
                c == '\\' && i + 1 < body.length -> {
                    (if (inKey) key else value).append(body[i + 1])
                    i += 2
                    continue
                }
                c == ':' && inKey -> inKey = false
                c == ';' -> {
                    if (key.isNotEmpty()) out += key.toString().trim() to value.toString()
                    key.setLength(0)
                    value.setLength(0)
                    inKey = true
                }
                else -> (if (inKey) key else value).append(c)
            }
            i++
        }
        if (key.isNotEmpty() && !inKey) out += key.toString().trim() to value.toString()
        return out
    }

    // ---- events ---------------------------------------------------------------------------

    private fun event(s: String): ParsedContent.Event {
        var inEvent = !s.contains("BEGIN:VEVENT", ignoreCase = true)
        var summary: String? = null
        var start: String? = null
        var end: String? = null
        var location: String? = null
        var description: String? = null
        for (p in contentLines(s)) {
            if (p.name == "BEGIN" && p.value.equals("VEVENT", true)) {
                inEvent = true
                continue
            }
            if (p.name == "END" && p.value.equals("VEVENT", true)) break
            if (!inEvent) continue
            when (p.name) {
                "SUMMARY" -> summary = unescapeText(p.value).trim().ifEmpty { null }
                "DTSTART" -> start = icalDate(p.value.trim())
                "DTEND" -> end = icalDate(p.value.trim())
                "LOCATION" -> location = unescapeText(p.value).trim().ifEmpty { null }
                "DESCRIPTION" -> description = unescapeText(p.value).trim().ifEmpty { null }
            }
        }
        return ParsedContent.Event(summary, start, end, location, description)
    }

    /** `20250101` -> `2025-01-01`; `20250101T090000Z` -> `2025-01-01T09:00:00Z`; others unchanged. */
    internal fun icalDate(v: String): String? {
        if (v.isEmpty()) return null
        val m = Regex("^(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2})?(Z)?)?$").matchEntire(v) ?: return v
        val (y, mo, d, h, mi, sec, z) = m.destructured
        val date = "$y-$mo-$d"
        if (h.isEmpty()) return date
        return date + "T" + h + ":" + mi + ":" + sec.ifEmpty { "00" } + z
    }

    // ---- payments -------------------------------------------------------------------------

    private fun epc(s: String): ParsedContent.Payment? {
        val lines = s.split("\r\n", "\n")
        if (lines.size < 7 || lines[0] != "BCD") return null
        val id = lines.getOrNull(3)?.trim().orEmpty()
        if (id != "SCT" && id != "INST") return null
        val bic = lines.getOrNull(4)?.trim().orEmpty().ifEmpty { null }
        val name = lines.getOrNull(5)?.trim().orEmpty().ifEmpty { null }
        val iban = lines.getOrNull(6)?.trim()?.replace(" ", "").orEmpty().ifEmpty { null } ?: return null
        val amountField = lines.getOrNull(7)?.trim().orEmpty()
        var currency: String? = null
        var amount: Double? = null
        if (amountField.isNotEmpty()) {
            val m = Regex("^([A-Z]{3})?\\s*([0-9]+(?:[.,][0-9]{1,2})?)$").matchEntire(amountField)
            if (m != null) {
                currency = m.groupValues[1].ifEmpty { "EUR" }
                amount = m.groupValues[2].replace(',', '.').toDoubleOrNull()
            }
        }
        val structured = lines.getOrNull(9)?.trim().orEmpty()
        val text = lines.getOrNull(10)?.trim().orEmpty()
        val reference = structured.ifEmpty { text }.ifEmpty { null }
        return ParsedContent.Payment("epc", null, name, iban, bic, amount, currency ?: "EUR", reference)
    }

    private fun crypto(s: String, scheme: String, currency: String?): ParsedContent.Payment {
        val rest = s.substringAfter(':').removePrefix("//")
        val address = rest.substringBefore('?').ifEmpty { null }
        val q = query(rest.substringAfter('?', ""))
        return ParsedContent.Payment(
            scheme = scheme,
            address = address,
            name = q["label"],
            amount = q["amount"]?.toDoubleOrNull(),
            currency = currency,
            reference = q["message"],
        )
    }

    private fun ethereum(s: String): ParsedContent.Payment {
        // EIP-681: ethereum:[pay-]<address>[@<chainId>][/<function>][?value=<wei>&...]
        val rest = s.substringAfter(':').removePrefix("pay-")
        val address = rest.substringBefore('?').substringBefore('/').substringBefore('@').ifEmpty { null }
        val q = query(rest.substringAfter('?', ""))
        val wei = q["value"]?.let { v -> runCatching { java.math.BigDecimal(v) }.getOrNull() }
        val amount = wei?.movePointLeft(18)?.toDouble() ?: q["amount"]?.toDoubleOrNull()
        return ParsedContent.Payment("ethereum", address, q["label"], amount = amount, currency = "ETH", reference = q["message"])
    }

    private fun upi(s: String): ParsedContent.Payment {
        val q = query(s.substringAfter('?', ""))
        return ParsedContent.Payment(
            scheme = "upi",
            address = q["pa"],
            name = q["pn"],
            amount = q["am"]?.toDoubleOrNull(),
            currency = q["cu"] ?: "INR",
            reference = q["tr"] ?: q["tn"],
        )
    }

    /** Parses `a=1&b=2` with percent-decoding (`+` as space). Keys are lower-cased; first wins. */
    private fun query(q: String): Map<String, String> {
        if (q.isEmpty()) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (pair in q.split('&')) {
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val k = GS1.percentDecode(if (eq < 0) pair else pair.substring(0, eq), plusIsSpace = true).lowercase()
            val v = if (eq < 0) "" else GS1.percentDecode(pair.substring(eq + 1), plusIsSpace = true)
            out.putIfAbsent(k, v)
        }
        return out
    }
}
