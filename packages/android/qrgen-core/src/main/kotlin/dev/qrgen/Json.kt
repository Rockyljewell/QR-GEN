package dev.qrgen

/**
 * Minimal JSON writer used by the `toJson()` methods. It supports `null`, strings, booleans,
 * numbers, maps with string keys, collections and arrays, which is all the QRGen models
 * need, and keeps the core free of JSON library dependencies.
 */
public object Json {
    /** Serializes [value] (a map, list, string, number, boolean or `null`) to compact JSON. */
    @JvmStatic
    public fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(sb: StringBuilder, value: Any?) {
        when (value) {
            null -> sb.append("null")
            is String -> writeString(sb, value)
            is Boolean -> sb.append(if (value) "true" else "false")
            is Int, is Long, is Short, is Byte -> sb.append(value.toString())
            is Float -> writeNumber(sb, value.toDouble())
            is Double -> writeNumber(sb, value)
            is Number -> writeNumber(sb, value.toDouble())
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, v) in value) {
                    if (!first) sb.append(',')
                    first = false
                    writeString(sb, k.toString())
                    sb.append(':')
                    write(sb, v)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (v in value) {
                    if (!first) sb.append(',')
                    first = false
                    write(sb, v)
                }
                sb.append(']')
            }
            is Array<*> -> write(sb, value.asList())
            is Enum<*> -> writeString(sb, value.toString())
            else -> writeString(sb, value.toString())
        }
    }

    private fun writeNumber(sb: StringBuilder, d: Double) {
        when {
            d.isNaN() || d.isInfinite() -> sb.append("null")
            d == Math.rint(d) && kotlin.math.abs(d) < 1e15 -> sb.append(d.toLong().toString())
            else -> {
                // Float values arrive widened to Double; print the shortest float form when exact.
                val f = d.toFloat()
                if (f.toDouble() == d) sb.append(f.toString()) else sb.append(d.toString())
            }
        }
    }

    private fun writeString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c < ' ' || c == ' ' || c == ' ') {
                    sb.append("\\u")
                    val hex = Integer.toHexString(c.code)
                    repeat(4 - hex.length) { sb.append('0') }
                    sb.append(hex)
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
    }
}

/** RFC 4648 base64 (standard alphabet, padded). `java.util.Base64` needs Android API 26. */
internal object Base64Codec {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    fun encode(bytes: ByteArray): String {
        val sb = StringBuilder((bytes.size + 2) / 3 * 4)
        var i = 0
        while (i + 2 < bytes.size) {
            val n = (bytes[i].toInt() and 0xFF shl 16) or (bytes[i + 1].toInt() and 0xFF shl 8) or (bytes[i + 2].toInt() and 0xFF)
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63])
                .append(ALPHABET[n shr 6 and 63]).append(ALPHABET[n and 63])
            i += 3
        }
        val rest = bytes.size - i
        if (rest == 1) {
            val n = bytes[i].toInt() and 0xFF shl 16
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63]).append("==")
        } else if (rest == 2) {
            val n = (bytes[i].toInt() and 0xFF shl 16) or (bytes[i + 1].toInt() and 0xFF shl 8)
            sb.append(ALPHABET[n shr 18 and 63]).append(ALPHABET[n shr 12 and 63]).append(ALPHABET[n shr 6 and 63]).append('=')
        }
        return sb.toString()
    }

    fun decode(text: String): ByteArray {
        val clean = text.filter { !it.isWhitespace() && it != '=' }
        val out = java.io.ByteArrayOutputStream(clean.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (c in clean) {
            val v = when (c) {
                '-' -> 62
                '_' -> 63
                else -> ALPHABET.indexOf(c)
            }
            require(v >= 0) { "Invalid base64 character '$c'" }
            buffer = (buffer shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write(buffer shr bits and 0xFF)
            }
        }
        return out.toByteArray()
    }
}
