package dev.qrgen

/** What kind of payload a barcode carries (SPEC §2 `contentType`). */
public enum class ContentType(public val id: String) {
    TEXT("text"),
    BINARY("binary"),
    GS1("gs1"),
    ISO15434("iso15434"),
    MIXED("mixed"),
    UNKNOWN_ECI("unknown-eci"),
    ;

    override fun toString(): String = id

    public companion object {
        /** Looks up a content type by SPEC id; unknown ids map to [TEXT]. */
        @JvmStatic
        public fun fromId(id: String): ContentType = entries.firstOrNull { it.id == id } ?: TEXT
    }
}

/**
 * A decoded barcode (SPEC §2). The same shape is returned on every QRGen platform.
 *
 * @property data decoded text. GS1 data is given in HRI form, `"(01)09501101530003(17)250101"`.
 * @property symbology what was read.
 * @property rawBytes raw payload bytes when the engine provides them (may be empty).
 * @property contentType payload classification.
 * @property isGS1 `true` when the payload is a GS1 element string.
 * @property location corners in pixel coordinates of the source frame or image.
 * @property frameSize size of the (upright) frame or image the location refers to.
 * @property orientation rotation of the code in the frame, in degrees.
 * @property ecLevel error-correction level when known, else `""`.
 * @property symbologyIdentifier AIM identifier (`"]Q1"`, `"]C1"`, ...) when known, else `""`.
 * @property timestamp time of detection, ms since the epoch.
 */
public class Barcode @JvmOverloads constructor(
    public val data: String,
    public val symbology: Symbology,
    rawBytes: ByteArray = ByteArray(0),
    public val contentType: ContentType = ContentType.TEXT,
    public val isGS1: Boolean = false,
    public val location: Quad = Quad.ZERO,
    public val frameSize: Size = Size.ZERO,
    public val orientation: Int = 0,
    public val ecLevel: String = "",
    public val symbologyIdentifier: String = "",
    public val timestamp: Long = System.currentTimeMillis(),
) {
    private val bytes: ByteArray = rawBytes.copyOf()

    /** Raw payload bytes (a defensive copy). */
    public val rawBytes: ByteArray get() = bytes.copyOf()

    /** Display name of [symbology], for example `"QR Code"`. */
    public val symbologyName: String get() = symbology.displayName

    /** [rawBytes] as base64, as used in the JSON form. */
    public val rawBytesBase64: String get() = Base64Codec.encode(bytes)

    /** Key used for de-duplication and tracking: symbology plus data. */
    public val key: String get() = symbology.id + '\u0000' + data

    /** Parses [data] into a typed [ParsedContent] (URL, Wi-Fi, vCard, GS1, AAMVA, ...). */
    public fun parse(): ParsedContent = ContentParser.parse(this)

    /** Returns a copy with some fields replaced. */
    @JvmOverloads
    public fun copy(
        data: String = this.data,
        symbology: Symbology = this.symbology,
        rawBytes: ByteArray = this.bytes,
        contentType: ContentType = this.contentType,
        isGS1: Boolean = this.isGS1,
        location: Quad = this.location,
        frameSize: Size = this.frameSize,
        orientation: Int = this.orientation,
        ecLevel: String = this.ecLevel,
        symbologyIdentifier: String = this.symbologyIdentifier,
        timestamp: Long = this.timestamp,
    ): Barcode = Barcode(
        data, symbology, rawBytes, contentType, isGS1, location, frameSize, orientation, ecLevel,
        symbologyIdentifier, timestamp,
    )

    /** The SPEC §2 shape as an ordered map (for bridges and custom serializers). */
    public fun toMap(): Map<String, Any?> = linkedMapOf(
        "data" to data,
        "symbology" to symbology.id,
        "symbologyName" to symbologyName,
        "rawBytes" to rawBytesBase64,
        "contentType" to contentType.id,
        "isGS1" to isGS1,
        "location" to location.toMap(),
        "frameSize" to frameSize.toMap(),
        "orientation" to orientation,
        "ecLevel" to ecLevel,
        "symbologyIdentifier" to symbologyIdentifier,
        "timestamp" to timestamp,
    )

    /** The SPEC §2 JSON representation. */
    public fun toJson(): String = Json.stringify(toMap())

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Barcode) return false
        return data == other.data && symbology == other.symbology && bytes.contentEquals(other.bytes) &&
            contentType == other.contentType && isGS1 == other.isGS1 && location == other.location &&
            frameSize == other.frameSize && orientation == other.orientation && ecLevel == other.ecLevel &&
            symbologyIdentifier == other.symbologyIdentifier && timestamp == other.timestamp
    }

    override fun hashCode(): Int {
        var h = data.hashCode()
        h = 31 * h + symbology.hashCode()
        h = 31 * h + bytes.contentHashCode()
        h = 31 * h + contentType.hashCode()
        h = 31 * h + isGS1.hashCode()
        h = 31 * h + location.hashCode()
        h = 31 * h + frameSize.hashCode()
        h = 31 * h + orientation
        h = 31 * h + ecLevel.hashCode()
        h = 31 * h + symbologyIdentifier.hashCode()
        h = 31 * h + timestamp.hashCode()
        return h
    }

    override fun toString(): String =
        "Barcode(symbology=${symbology.id}, data=$data, contentType=${contentType.id}, isGS1=$isGS1, " +
            "rawBytes=${bytes.size} bytes, location=$location, frameSize=$frameSize, timestamp=$timestamp)"
}

/**
 * A barcode followed across frames in batch mode (SPEC §4 `track` event):
 * `TrackedBarcode = Barcode & { id, firstSeen, lastSeen, count }`.
 *
 * @property id stable identifier for as long as the code stays tracked.
 * @property barcode the latest detection.
 * @property firstSeen time the track was created (ms since epoch).
 * @property lastSeen time of the latest detection (ms since epoch).
 * @property count number of frames the code was detected in.
 */
public data class TrackedBarcode(
    public val id: Int,
    public val barcode: Barcode,
    public val firstSeen: Long,
    public val lastSeen: Long,
    public val count: Int,
) {
    public val data: String get() = barcode.data
    public val symbology: Symbology get() = barcode.symbology
    public val location: Quad get() = barcode.location

    /** The barcode fields plus `id`, `firstSeen`, `lastSeen` and `count`. */
    public fun toMap(): Map<String, Any?> = LinkedHashMap(barcode.toMap()).apply {
        put("id", id)
        put("firstSeen", firstSeen)
        put("lastSeen", lastSeen)
        put("count", count)
    }

    public fun toJson(): String = Json.stringify(toMap())
}
