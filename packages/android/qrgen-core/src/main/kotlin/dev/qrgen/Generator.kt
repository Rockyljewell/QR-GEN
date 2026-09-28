// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.WriterException
import com.google.zxing.common.BitMatrix
import com.google.zxing.datamatrix.encoder.DefaultPlacement
import com.google.zxing.datamatrix.encoder.ErrorCorrection
import com.google.zxing.datamatrix.encoder.SymbolInfo
import com.google.zxing.datamatrix.encoder.SymbolShapeHint
import com.google.zxing.pdf417.encoder.PDF417
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.ByteArrayOutputStream
import java.util.BitSet
import java.util.EnumMap
import java.util.zip.CRC32
import java.util.zip.Deflater

/**
 * Options for [Generator] (SPEC §7).
 *
 * @property ecLevel error correction. QR: `L`, `M` (default), `Q`, `H`. Aztec: a percentage
 *   (`"23"`) or `L`/`M`/`Q`/`H` = 10/23/36/50 %. PDF417: `0`–`8` or `L`/`M`/`Q`/`H` = 1/2/4/6
 *   (default 2). Ignored by other symbologies.
 * @property margin add the symbology's quiet zone (QR 4 modules, Data Matrix/Aztec/PDF417 2,
 *   linear codes 10).
 * @property quietZone custom quiet zone in modules; overrides the default when [margin] is on.
 * @property gs1 treat [Generator.generate]'s data as GS1 (HRI `(01)...` or raw) and encode it
 *   with FNC1 (GS1 QR, GS1 DataMatrix, GS1-128).
 * @property barHeight height of linear codes in modules (default 70 for EAN/UPC, 50 otherwise).
 * @property scale pixels per module for [GeneratedCode.toSvg] / [GeneratedCode.toPng].
 * @property foreground bar color (`#RGB` or `#RRGGBB`).
 * @property background background color (`#RGB`, `#RRGGBB`, or `transparent`).
 * @property hrt print the human readable text under linear codes in SVG output.
 * @property charset character set for 2D codes; defaults to ISO-8859-1 when the text fits and
 *   UTF-8 (with ECI) otherwise.
 */
public data class GenerateOptions @JvmOverloads constructor(
    public val ecLevel: String? = null,
    public val margin: Boolean = true,
    public val quietZone: Int? = null,
    public val gs1: Boolean = false,
    public val barHeight: Int? = null,
    public val scale: Int = 4,
    public val foreground: String = "#000000",
    public val background: String = "#FFFFFF",
    public val hrt: Boolean = false,
    public val charset: String? = null,
) {
    init {
        require(scale >= 1) { "scale must be >= 1" }
        require(quietZone == null || quietZone >= 0) { "quietZone must be >= 0" }
        require(barHeight == null || barHeight >= 1) { "barHeight must be >= 1" }
    }
}

/**
 * A generated symbol as a module grid (`true` = dark), including the quiet zone.
 * Render it with [toSvg], [toPng], [toBitMatrix] or [toBooleanGrid]; on Android,
 * `dev.qrgen.android.toBitmap()` turns it into a `Bitmap`.
 */
public class GeneratedCode internal constructor(
    /** The data as encoded (retail codes include their check digit). */
    public val text: String,
    public val symbology: Symbology,
    /** Width in modules, quiet zone included. */
    public val width: Int,
    /** Height in modules, quiet zone included. */
    public val height: Int,
    private val bits: BitSet,
    /** The error correction actually used (`"M"`, `"23%"`, `"2"`), or `""`. */
    public val ecLevel: String,
    /** Quiet zone in modules on each side. */
    public val quietZone: Int,
    private val options: GenerateOptions,
) {
    /** `true` for 1D codes. */
    public val isLinear: Boolean get() = symbology.isLinear

    /** `true` if the module at ([x], [y]) is dark. */
    public operator fun get(x: Int, y: Int): Boolean {
        if (x < 0 || y < 0 || x >= width || y >= height) return false
        return bits[y * width + x]
    }

    /** The grid as rows of booleans (`grid[y][x]`). */
    public fun toBooleanGrid(): Array<BooleanArray> = Array(height) { y -> BooleanArray(width) { x -> this[x, y] } }

    /** The grid as a ZXing [BitMatrix] (1 pixel per module). */
    public fun toBitMatrix(): BitMatrix {
        val m = BitMatrix(width, height)
        for (y in 0 until height) for (x in 0 until width) if (this[x, y]) m.set(x, y)
        return m
    }

    /** Renders an SVG document. Colors and [hrt] default to the generation options. */
    @JvmOverloads
    public fun toSvg(
        scale: Int = options.scale,
        foreground: String = options.foreground,
        background: String = options.background,
        hrt: Boolean = options.hrt,
    ): String {
        val s = scale.coerceAtLeast(1)
        val textHeight = if (hrt && isLinear) 12 else 0
        val vbW = width
        val vbH = height + textHeight
        val sb = StringBuilder(256 + width * 8)
        sb.append("<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"").append(vbW * s)
            .append("\" height=\"").append(vbH * s).append("\" viewBox=\"0 0 ").append(vbW).append(' ').append(vbH)
            .append("\" shape-rendering=\"crispEdges\">")
        if (!isTransparent(background)) {
            sb.append("<rect width=\"").append(vbW).append("\" height=\"").append(vbH).append("\" fill=\"")
                .append(xml(background)).append("\"/>")
        }
        sb.append("<path fill=\"").append(xml(foreground)).append("\" d=\"")
        if (isLinear) {
            val top = (0 until height).firstOrNull { y -> (0 until width).any { x -> this[x, y] } } ?: 0
            val barRows = (top until height).takeWhile { y -> (0 until width).any { x -> this[x, y] } }.count()
            runs(top) { x, w -> sb.append('M').append(x).append(' ').append(top).append('h').append(w).append('v').append(barRows).append('h').append(-w).append('z') }
        } else {
            for (y in 0 until height) {
                runs(y) { x, w -> sb.append('M').append(x).append(' ').append(y).append('h').append(w).append("v1h").append(-w).append('z') }
            }
        }
        sb.append("\"/>")
        if (textHeight > 0) {
            sb.append("<text x=\"").append(vbW / 2.0).append("\" y=\"").append(height + 10)
                .append("\" font-family=\"ui-monospace,Menlo,Consolas,monospace\" font-size=\"10\" text-anchor=\"middle\" fill=\"")
                .append(xml(foreground)).append("\">").append(xml(text)).append("</text>")
        }
        sb.append("</svg>")
        return sb.toString()
    }

    /** Renders a 1-bit palette PNG with [scale] pixels per module. */
    @JvmOverloads
    public fun toPng(
        scale: Int = options.scale,
        foreground: String = options.foreground,
        background: String = options.background,
    ): ByteArray {
        val s = scale.coerceAtLeast(1)
        val w = width * s
        val h = height * s
        val rowBytes = (w + 7) / 8
        val raw = ByteArray((rowBytes + 1) * h)
        for (y in 0 until h) {
            val off = y * (rowBytes + 1)
            raw[off] = 0 // filter: none
            val my = y / s
            for (x in 0 until w) {
                if (this[x / s, my]) {
                    val i = off + 1 + (x ushr 3)
                    raw[i] = (raw[i].toInt() or (0x80 ushr (x and 7))).toByte()
                }
            }
        }
        val bg = parseColor(background)
        val fg = parseColor(foreground)
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 0x0D, 0x0A, 0x1A, 0x0A))
        val ihdr = ByteArrayOutputStream().apply {
            writeInt(w); writeInt(h)
            write(1) // bit depth
            write(3) // color type: palette
            write(0); write(0); write(0)
        }
        chunk(out, "IHDR", ihdr.toByteArray())
        chunk(out, "PLTE", byteArrayOf(bg[0], bg[1], bg[2], fg[0], fg[1], fg[2]))
        if (isTransparent(background)) chunk(out, "tRNS", byteArrayOf(0, 0xFF.toByte()))
        val deflater = Deflater(Deflater.BEST_COMPRESSION)
        try {
            deflater.setInput(raw)
            deflater.finish()
            val compressed = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (!deflater.finished()) {
                val n = deflater.deflate(buf)
                compressed.write(buf, 0, n)
            }
            chunk(out, "IDAT", compressed.toByteArray())
        } finally {
            deflater.end()
        }
        chunk(out, "IEND", ByteArray(0))
        return out.toByteArray()
    }

    /** Invokes [block] with (x, width) for every run of dark modules in row [y]. */
    private inline fun runs(y: Int, block: (Int, Int) -> Unit) {
        var x = 0
        while (x < width) {
            if (this[x, y]) {
                val start = x
                while (x < width && this[x, y]) x++
                block(start, x - start)
            } else {
                x++
            }
        }
    }

    override fun toString(): String = "GeneratedCode(${symbology.id}, ${width}x$height modules, text=$text)"

    private companion object {
        fun isTransparent(color: String) = color.equals("transparent", true) || color.equals("none", true)

        fun xml(s: String): String = buildString(s.length) {
            for (c in s) when (c) {
                '<' -> append("&lt;")
                '>' -> append("&gt;")
                '&' -> append("&amp;")
                '"' -> append("&quot;")
                '\'' -> append("&apos;")
                else -> if (c < ' ' && c != '\t' && c != '\n' && c != '\r') append('?') else append(c)
            }
        }

        fun parseColor(color: String): ByteArray {
            val c = color.trim().lowercase()
            val hex = when {
                isTransparent(c) -> "ffffff"
                c == "black" -> "000000"
                c == "white" -> "ffffff"
                c.startsWith("#") && c.length == 4 -> c.substring(1).map { "$it$it" }.joinToString("")
                c.startsWith("#") && (c.length == 7 || c.length == 9) -> c.substring(1, 7)
                else -> throw IllegalArgumentException("Unsupported color '$color' (use #RGB or #RRGGBB)")
            }
            require(hex.all { it in '0'..'9' || it in 'a'..'f' }) { "Unsupported color '$color'" }
            return ByteArray(3) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
        }

        fun ByteArrayOutputStream.writeInt(v: Int) {
            write(v ushr 24 and 0xFF); write(v ushr 16 and 0xFF); write(v ushr 8 and 0xFF); write(v and 0xFF)
        }

        fun chunk(out: ByteArrayOutputStream, type: String, data: ByteArray) {
            out.writeInt(data.size)
            val typeBytes = type.toByteArray(Charsets.US_ASCII)
            out.write(typeBytes)
            out.write(data)
            val crc = CRC32()
            crc.update(typeBytes)
            crc.update(data)
            out.writeInt(crc.value.toInt())
        }
    }
}

/**
 * Barcode generator (SPEC §7) backed by ZXing core. Supported: qr, data-matrix, aztec, pdf417,
 * code128, code39, code93, codabar, ean13, ean8, upca, upce, itf, itf14 and isbn. Other
 * symbologies throw [UnsupportedSymbologyException] (use the QRGen REST API for them).
 *
 * ```kotlin
 * val svg = Generator.generate("https://example.com").toSvg()
 * val label = Generator.generate("(01)09501101530003(10)ABC", Symbology.CODE128, GenerateOptions(gs1 = true))
 * ```
 */
public object Generator {
    /** Symbologies this generator can write. */
    @JvmField
    public val SUPPORTED: Set<Symbology> = java.util.Collections.unmodifiableSet(
        java.util.EnumSet.of(
            Symbology.QR, Symbology.DATA_MATRIX, Symbology.AZTEC, Symbology.PDF417,
            Symbology.CODE128, Symbology.CODE39, Symbology.CODE93, Symbology.CODABAR,
            Symbology.EAN13, Symbology.EAN8, Symbology.UPCA, Symbology.UPCE,
            Symbology.ITF, Symbology.ITF14, Symbology.ISBN,
        ),
    )

    private val RETAIL = setOf(Symbology.EAN13, Symbology.EAN8, Symbology.UPCA, Symbology.UPCE, Symbology.ISBN)

    /** `true` if [symbology] can be generated. */
    @JvmStatic
    public fun isSupported(symbology: Symbology): Boolean = symbology in SUPPORTED

    /**
     * Encodes [data] as [symbology].
     *
     * @throws UnsupportedSymbologyException when the symbology cannot be generated.
     * @throws IllegalArgumentException when [data] cannot be encoded (for example letters in EAN-13).
     */
    @JvmStatic
    @JvmOverloads
    public fun generate(data: String, symbology: Symbology = Symbology.QR, options: GenerateOptions = GenerateOptions()): GeneratedCode {
        if (symbology !in SUPPORTED) throw UnsupportedSymbologyException(symbology, "generation")
        require(data.isNotEmpty()) { "data must not be empty" }
        return try {
            encode(data, symbology, options)
        } catch (e: WriterException) {
            throw IllegalArgumentException("Cannot encode '$data' as ${symbology.id}: ${e.message}", e)
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("Cannot encode '$data' as ${symbology.id}: ${e.message}", e)
        } catch (e: ArrayIndexOutOfBoundsException) {
            throw IllegalArgumentException("Cannot encode '$data' as ${symbology.id}: data too long", e)
        }
    }

    /** Encodes [data] as the symbology named by [symbology] (an id or alias from SPEC §1). */
    @JvmStatic
    @JvmOverloads
    public fun generate(data: String, symbology: String, options: GenerateOptions = GenerateOptions()): GeneratedCode {
        val s = Symbology.fromName(symbology) ?: throw IllegalArgumentException("Unknown symbology '$symbology'")
        return generate(data, s, options)
    }

    /** Shortcut for `generate(...).toSvg()`. */
    @JvmStatic
    @JvmOverloads
    public fun svg(data: String, symbology: Symbology = Symbology.QR, options: GenerateOptions = GenerateOptions()): String =
        generate(data, symbology, options).toSvg()

    /** Shortcut for `generate(...).toPng()`. */
    @JvmStatic
    @JvmOverloads
    public fun png(data: String, symbology: Symbology = Symbology.QR, options: GenerateOptions = GenerateOptions()): ByteArray =
        generate(data, symbology, options).toPng()

    private fun encode(data: String, symbology: Symbology, o: GenerateOptions): GeneratedCode {
        if (o.gs1 && symbology !in setOf(Symbology.QR, Symbology.DATA_MATRIX, Symbology.CODE128)) {
            throw IllegalArgumentException("gs1 encoding is supported for qr, data-matrix and code128")
        }
        val hints = EnumMap<EncodeHintType, Any>(EncodeHintType::class.java)
        hints[EncodeHintType.MARGIN] = 0
        var contents = data
        var text = data
        var ec = ""
        if (o.gs1) {
            contents = GS1.toElementString(data) ?: throw IllegalArgumentException("not a GS1 element string")
            text = GS1.parse(data)?.toHri() ?: data
        }
        val charset = o.charset ?: if (java.nio.charset.StandardCharsets.ISO_8859_1.newEncoder().canEncode(contents)) null else "UTF-8"
        val format: BarcodeFormat
        when (symbology) {
            Symbology.QR -> {
                format = BarcodeFormat.QR_CODE
                val level = when (o.ecLevel?.trim()?.uppercase()) {
                    null, "", "M" -> ErrorCorrectionLevel.M
                    "L" -> ErrorCorrectionLevel.L
                    "Q" -> ErrorCorrectionLevel.Q
                    "H" -> ErrorCorrectionLevel.H
                    else -> throw IllegalArgumentException("QR ecLevel must be L, M, Q or H")
                }
                hints[EncodeHintType.ERROR_CORRECTION] = level
                ec = level.name
                if (charset != null) hints[EncodeHintType.CHARACTER_SET] = charset
                if (o.gs1) hints[EncodeHintType.GS1_FORMAT] = true
            }
            Symbology.DATA_MATRIX -> {
                // ZXing 3.5.4's MinimalEncoder drops the C40/Text unlatch before padding when
                // GS1_FORMAT prepends FNC1, which corrupts some symbols; GS1 data is plain ASCII,
                // so encode it ourselves (FNC1 + ASCII/digit-pair codewords).
                if (o.gs1) return build(text, symbology, gs1DataMatrix(contents), ec, o)
                format = BarcodeFormat.DATA_MATRIX
                hints[EncodeHintType.DATA_MATRIX_SHAPE] = SymbolShapeHint.FORCE_SQUARE
                if (o.gs1 || charset != null) hints[EncodeHintType.DATA_MATRIX_COMPACT] = true
                if (charset != null) hints[EncodeHintType.CHARACTER_SET] = charset
                if (o.gs1) hints[EncodeHintType.GS1_FORMAT] = true
            }
            Symbology.AZTEC -> {
                format = BarcodeFormat.AZTEC
                val percent = when (val l = o.ecLevel?.trim()?.uppercase()) {
                    null, "", "M" -> 23
                    "L" -> 10
                    "Q" -> 36
                    "H" -> 50
                    else -> l.removeSuffix("%").toIntOrNull()?.takeIf { it in 5..95 }
                        ?: throw IllegalArgumentException("Aztec ecLevel must be a percentage (5-95) or L/M/Q/H")
                }
                hints[EncodeHintType.ERROR_CORRECTION] = percent
                ec = "$percent%"
                if (charset != null) hints[EncodeHintType.CHARACTER_SET] = charset
            }
            Symbology.PDF417 -> {
                val level = when (val l = o.ecLevel?.trim()?.uppercase()) {
                    null, "", "M" -> 2
                    "L" -> 1
                    "Q" -> 4
                    "H" -> 6
                    else -> l.toIntOrNull()?.takeIf { it in 0..8 } ?: throw IllegalArgumentException("PDF417 ecLevel must be 0-8 or L/M/Q/H")
                }
                val grid = pdf417(contents, level, charset)
                return build(text, symbology, grid, level.toString(), o)
            }
            Symbology.CODE128 -> {
                format = BarcodeFormat.CODE_128
                if (o.gs1) contents = FNC1 + contents.replace(GS1.GS, FNC1)
            }
            Symbology.CODE39 -> format = BarcodeFormat.CODE_39
            Symbology.CODE93 -> format = BarcodeFormat.CODE_93
            Symbology.CODABAR -> format = BarcodeFormat.CODABAR
            Symbology.EAN13, Symbology.ISBN -> {
                format = BarcodeFormat.EAN_13
                contents = withCheckDigit(contents, 13, symbology)
                if (symbology == Symbology.ISBN) {
                    require(contents.startsWith("978") || contents.startsWith("979")) { "ISBN must start with 978 or 979" }
                }
                text = contents
            }
            Symbology.EAN8 -> {
                format = BarcodeFormat.EAN_8
                contents = withCheckDigit(contents, 8, symbology)
                text = contents
            }
            Symbology.UPCA -> {
                format = BarcodeFormat.UPC_A
                contents = withCheckDigit(contents, 12, symbology)
                text = contents
            }
            Symbology.UPCE -> {
                format = BarcodeFormat.UPC_E
                require(contents.all { it in '0'..'9' } && contents.length in 7..8) { "UPC-E needs 7 or 8 digits" }
                require(contents[0] == '0' || contents[0] == '1') { "UPC-E number system must be 0 or 1" }
                if (contents.length == 7) {
                    val upca = Gtin.upceToUpca(contents + "0") ?: throw IllegalArgumentException("invalid UPC-E")
                    contents += Gtin.checkDigit(upca.dropLast(1))
                }
                text = contents
            }
            Symbology.ITF -> {
                format = BarcodeFormat.ITF
                require(contents.all { it in '0'..'9' } && contents.length % 2 == 0) { "ITF needs an even number of digits" }
            }
            Symbology.ITF14 -> {
                format = BarcodeFormat.ITF
                contents = withCheckDigit(contents, 14, symbology)
                text = contents
            }
            else -> throw UnsupportedSymbologyException(symbology, "generation")
        }
        val matrix = MultiFormatWriter().encode(contents, format, 0, if (symbology.isLinear) 1 else 0, hints)
        return build(text, symbology, matrixToGrid(matrix), ec, o)
    }

    private const val FNC1 = 'ñ'

    private fun withCheckDigit(digits: String, length: Int, symbology: Symbology): String {
        require(digits.all { it in '0'..'9' }) { "${symbology.displayName} accepts digits only" }
        return when (digits.length) {
            length - 1 -> digits + Gtin.checkDigit(digits)
            length -> {
                require(Gtin.isValid(digits)) { "invalid check digit" }
                digits
            }
            else -> throw IllegalArgumentException("${symbology.displayName} needs ${length - 1} or $length digits")
        }
    }

    private fun matrixToGrid(m: BitMatrix): Array<BooleanArray> = Array(m.height) { y -> BooleanArray(m.width) { x -> m[x, y] } }

    private fun pdf417(contents: String, level: Int, charset: String?): Array<BooleanArray> {
        val encoder = PDF417()
        if (charset != null) encoder.setEncoding(java.nio.charset.Charset.forName(charset))
        encoder.generateBarcodeLogic(contents, level, false)
        val scaled = encoder.barcodeMatrix.getScaledMatrix(1, PDF417_ROW_HEIGHT)
        // BarcodeMatrix stores rows bottom-up; flip back to top-down (as PDF417Writer does).
        return Array(scaled.size) { y -> val row = scaled[scaled.size - 1 - y]; BooleanArray(row.size) { x -> row[x].toInt() == 1 } }
    }

    private const val PDF417_ROW_HEIGHT = 3

    /** GS1 DataMatrix: FNC1 in first position, ASCII encodation with digit pairs, FNC1 separators. */
    private fun gs1DataMatrix(elementString: String): Array<BooleanArray> {
        val cw = StringBuilder()
        cw.append(DM_FNC1.toChar())
        var i = 0
        val s = elementString
        while (i < s.length) {
            val c = s[i]
            when {
                c == GS1.GS -> {
                    cw.append(DM_FNC1.toChar())
                    i++
                }
                c in '0'..'9' && i + 1 < s.length && s[i + 1] in '0'..'9' -> {
                    cw.append((130 + (c - '0') * 10 + (s[i + 1] - '0')).toChar())
                    i += 2
                }
                c.code < 128 -> {
                    cw.append((c.code + 1).toChar())
                    i++
                }
                else -> throw IllegalArgumentException("GS1 data must be ASCII")
            }
        }
        val info = SymbolInfo.lookup(cw.length, SymbolShapeHint.FORCE_SQUARE, null, null, true)
        val capacity = info.dataCapacity
        if (cw.length < capacity) cw.append(129.toChar())
        while (cw.length < capacity) {
            val r = 129 + (149 * (cw.length + 1)) % 253 + 1
            cw.append((if (r <= 254) r else r - 254).toChar())
        }
        val placement = DefaultPlacement(ErrorCorrection.encodeECC200(cw.toString(), info), info.symbolDataWidth, info.symbolDataHeight)
        placement.place()
        // Same layout as DataMatrixWriter.encodeLowLevel: finder and timing patterns per region.
        val out = Array(info.symbolHeight) { BooleanArray(info.symbolWidth) }
        var my = 0
        for (y in 0 until info.symbolDataHeight) {
            if (y % info.matrixHeight == 0) {
                for (x in 0 until info.symbolWidth) out[my][x] = x % 2 == 0
                my++
            }
            var mx = 0
            for (x in 0 until info.symbolDataWidth) {
                if (x % info.matrixWidth == 0) out[my][mx++] = true
                out[my][mx++] = placement.getBit(x, y)
                if (x % info.matrixWidth == info.matrixWidth - 1) out[my][mx++] = y % 2 == 0
            }
            my++
            if (y % info.matrixHeight == info.matrixHeight - 1) {
                for (x in 0 until info.symbolWidth) out[my][x] = true
                my++
            }
        }
        return out
    }

    private const val DM_FNC1 = 232

    private fun build(text: String, symbology: Symbology, grid: Array<BooleanArray>, ec: String, o: GenerateOptions): GeneratedCode {
        val defaultQuiet = when (symbology) {
            Symbology.QR -> 4
            Symbology.DATA_MATRIX, Symbology.AZTEC, Symbology.PDF417 -> 2
            else -> 10
        }
        val quiet = if (!o.margin) 0 else o.quietZone ?: defaultQuiet
        val codeH = grid.size
        val codeW = if (codeH == 0) 0 else grid[0].size
        return if (symbology.isLinear) {
            val barHeight = o.barHeight ?: if (symbology in RETAIL) 70 else 50
            val vPad = minOf(quiet, 5)
            val width = codeW + 2 * quiet
            val height = barHeight + 2 * vPad
            val bits = BitSet(width * height)
            val row = grid[0]
            for (y in vPad until vPad + barHeight) for (x in 0 until codeW) if (row[x]) bits.set(y * width + x + quiet)
            GeneratedCode(text, symbology, width, height, bits, ec, quiet, o)
        } else {
            val width = codeW + 2 * quiet
            val height = codeH + 2 * quiet
            val bits = BitSet(width * height)
            for (y in 0 until codeH) for (x in 0 until codeW) if (grid[y][x]) bits.set((y + quiet) * width + x + quiet)
            GeneratedCode(text, symbology, width, height, bits, ec, quiet, o)
        }
    }
}
