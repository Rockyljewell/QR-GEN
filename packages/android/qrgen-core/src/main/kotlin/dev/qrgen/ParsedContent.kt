package dev.qrgen

/**
 * Typed interpretation of a barcode payload (SPEC §3.1), produced by [ContentParser].
 * [type] is the SPEC type id; [toMap]/[toJson] give the SPEC JSON shape (optional fields
 * that are absent are omitted).
 */
public sealed class ParsedContent {
    /** SPEC type id: `url`, `gs1-digital-link`, `email`, `phone`, `sms`, `wifi`, `geo`, `contact`, `event`, `payment`, `product`, `gs1`, `aamva` or `text`. */
    public abstract val type: String

    protected abstract fun fields(): Map<String, Any?>

    /** SPEC JSON shape as a map: `type` plus the type's fields. */
    public fun toMap(): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("type" to type)
        for ((k, v) in fields()) if (v != null) map[k] = v
        return map
    }

    public fun toJson(): String = Json.stringify(toMap())

    /** A web or other URI link. */
    public data class Url(public val url: String) : ParsedContent() {
        override val type: String get() = "url"
        override fun fields(): Map<String, Any?> = mapOf("url" to url)
    }

    /** A GS1 Digital Link URL with its decoded GS1 data. */
    public data class Gs1DigitalLink(public val url: String, public val gs1: Gs1Result) : ParsedContent() {
        override val type: String get() = "gs1-digital-link"
        override fun fields(): Map<String, Any?> = linkedMapOf("url" to url, "gs1" to gs1.toMap())
    }

    /** An e-mail (`mailto:`, `MATMSG:` or a bare address). */
    public data class Email(public val to: String, public val subject: String? = null, public val body: String? = null) : ParsedContent() {
        override val type: String get() = "email"
        override fun fields(): Map<String, Any?> = linkedMapOf("to" to to, "subject" to subject, "body" to body)
    }

    /** A phone number (`tel:`). */
    public data class Phone(public val number: String) : ParsedContent() {
        override val type: String get() = "phone"
        override fun fields(): Map<String, Any?> = mapOf("number" to number)
    }

    /** A text message (`sms:`, `smsto:`, `mms:`). */
    public data class Sms(public val number: String, public val body: String? = null) : ParsedContent() {
        override val type: String get() = "sms"
        override fun fields(): Map<String, Any?> = linkedMapOf("number" to number, "body" to body)
    }

    /** Wi-Fi network credentials (`WIFI:`). [security] is `WPA`, `WEP`, `SAE`, `nopass`, ... */
    public data class Wifi(
        public val ssid: String,
        public val password: String?,
        public val security: String,
        public val hidden: Boolean,
    ) : ParsedContent() {
        override val type: String get() = "wifi"
        override fun fields(): Map<String, Any?> =
            linkedMapOf("ssid" to ssid, "password" to password, "security" to security, "hidden" to hidden)
    }

    /** A location (`geo:`). */
    public data class Geo(
        public val latitude: Double,
        public val longitude: Double,
        public val altitude: Double? = null,
        public val query: String? = null,
    ) : ParsedContent() {
        override val type: String get() = "geo"
        override fun fields(): Map<String, Any?> =
            linkedMapOf("latitude" to latitude, "longitude" to longitude, "altitude" to altitude, "query" to query)
    }

    /** A contact card. [format] is `vcard` or `mecard`. */
    public data class Contact(
        public val name: String? = null,
        public val organization: String? = null,
        public val title: String? = null,
        public val phones: List<String> = emptyList(),
        public val emails: List<String> = emptyList(),
        public val urls: List<String> = emptyList(),
        public val address: String? = null,
        public val note: String? = null,
        public val format: String,
    ) : ParsedContent() {
        override val type: String get() = "contact"
        override fun fields(): Map<String, Any?> = linkedMapOf(
            "name" to name, "organization" to organization, "title" to title, "phones" to phones,
            "emails" to emails, "urls" to urls, "address" to address, "note" to note, "format" to format,
        )
    }

    /** A calendar event (`BEGIN:VEVENT`). Dates are ISO 8601 when they could be converted. */
    public data class Event(
        public val summary: String? = null,
        public val start: String? = null,
        public val end: String? = null,
        public val location: String? = null,
        public val description: String? = null,
    ) : ParsedContent() {
        override val type: String get() = "event"
        override fun fields(): Map<String, Any?> = linkedMapOf(
            "summary" to summary, "start" to start, "end" to end, "location" to location, "description" to description,
        )
    }

    /**
     * A payment request. [scheme] is `epc` (SEPA "BCD" QR), `bitcoin`, `ethereum`, `upi` or
     * `other`. [amount] is in major units of [currency] (ETH for Ethereum, converted from wei).
     */
    public data class Payment(
        public val scheme: String,
        public val address: String? = null,
        public val name: String? = null,
        public val iban: String? = null,
        public val bic: String? = null,
        public val amount: Double? = null,
        public val currency: String? = null,
        public val reference: String? = null,
    ) : ParsedContent() {
        override val type: String get() = "payment"
        override fun fields(): Map<String, Any?> = linkedMapOf(
            "scheme" to scheme, "address" to address, "name" to name, "iban" to iban, "bic" to bic,
            "amount" to amount, "currency" to currency, "reference" to reference,
        )
    }

    /**
     * A retail product code. [gtin] is the 14-digit, zero-padded GTIN; [kind] is `ean13`,
     * `ean8`, `upca`, `upce`, `isbn` or `gtin14`.
     */
    public data class Product(public val gtin: String, public val kind: String, public val checksumValid: Boolean) : ParsedContent() {
        override val type: String get() = "product"
        override fun fields(): Map<String, Any?> = linkedMapOf("gtin" to gtin, "kind" to kind, "checksumValid" to checksumValid)
    }

    /** GS1 element string data. */
    public data class Gs1(public val gs1: Gs1Result) : ParsedContent() {
        override val type: String get() = "gs1"
        override fun fields(): Map<String, Any?> = mapOf("gs1" to gs1.toMap())
    }

    /** A driver license / ID card payload. */
    public data class Aamva(public val aamva: AamvaResult) : ParsedContent() {
        override val type: String get() = "aamva"
        override fun fields(): Map<String, Any?> = mapOf("aamva" to aamva.toMap())
    }

    /** Anything else. */
    public data class Text(public val text: String) : ParsedContent() {
        override val type: String get() = "text"
        override fun fields(): Map<String, Any?> = mapOf("text" to text)
    }
}
