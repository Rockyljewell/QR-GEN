package dev.qrgen

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.Result
import com.google.zxing.common.HybridBinarizer
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.util.stream.Stream
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GeneratorTest {
    companion object {
        @JvmStatic
        fun roundTrips(): Stream<Arguments> = Stream.of(
            Arguments.of(Symbology.QR, "https://rockyljewell.github.io/QR-GEN/?q=1", "https://rockyljewell.github.io/QR-GEN/?q=1", BarcodeFormat.QR_CODE),
            Arguments.of(Symbology.QR, "Grüße aus Köln – QRGen ✓", "Grüße aus Köln – QRGen ✓", BarcodeFormat.QR_CODE),
            Arguments.of(Symbology.DATA_MATRIX, "QRGen DataMatrix 12345", "QRGen DataMatrix 12345", BarcodeFormat.DATA_MATRIX),
            Arguments.of(Symbology.DATA_MATRIX, "Überprüfung ✓", "Überprüfung ✓", BarcodeFormat.DATA_MATRIX),
            Arguments.of(Symbology.AZTEC, "QRGen Aztec round trip", "QRGen Aztec round trip", BarcodeFormat.AZTEC),
            Arguments.of(Symbology.PDF417, "QRGen PDF417 round trip 1234567890", "QRGen PDF417 round trip 1234567890", BarcodeFormat.PDF_417),
            Arguments.of(Symbology.CODE128, "QRGen-128 test", "QRGen-128 test", BarcodeFormat.CODE_128),
            Arguments.of(Symbology.CODE39, "QRGEN-39", "QRGEN-39", BarcodeFormat.CODE_39),
            Arguments.of(Symbology.CODE93, "QRGEN-93", "QRGEN-93", BarcodeFormat.CODE_93),
            Arguments.of(Symbology.CODABAR, "31117013206375", "31117013206375", BarcodeFormat.CODABAR),
            Arguments.of(Symbology.EAN13, "590123412345", "5901234123457", BarcodeFormat.EAN_13),
            Arguments.of(Symbology.EAN13, "5901234123457", "5901234123457", BarcodeFormat.EAN_13),
            Arguments.of(Symbology.ISBN, "978030640615", "9780306406157", BarcodeFormat.EAN_13),
            Arguments.of(Symbology.EAN8, "9638507", "96385074", BarcodeFormat.EAN_8),
            Arguments.of(Symbology.UPCA, "03600029145", "036000291452", BarcodeFormat.UPC_A),
            Arguments.of(Symbology.UPCE, "0123456", "01234565", BarcodeFormat.UPC_E),
            Arguments.of(Symbology.UPCE, "01234565", "01234565", BarcodeFormat.UPC_E),
            Arguments.of(Symbology.ITF, "12345678901234", "12345678901234", BarcodeFormat.ITF),
            Arguments.of(Symbology.ITF14, "1001234567890", "10012345678902", BarcodeFormat.ITF),
        )

        /** Renders the module grid to pixels and decodes it with ZXing's MultiFormatReader. */
        fun decode(code: GeneratedCode, format: BarcodeFormat, scale: Int = 4, extraHints: Map<DecodeHintType, Any> = emptyMap()): Result {
            val border = 24
            val w = code.width * scale + border * 2
            val h = code.height * scale + border * 2
            val pixels = IntArray(w * h) { 0xFFFFFFFF.toInt() }
            for (y in 0 until code.height) for (x in 0 until code.width) {
                if (!code[x, y]) continue
                for (dy in 0 until scale) for (dx in 0 until scale) {
                    pixels[(border + y * scale + dy) * w + border + x * scale + dx] = 0xFF000000.toInt()
                }
            }
            val bitmap = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(w, h, pixels)))
            val hints = HashMap<DecodeHintType, Any>()
            hints[DecodeHintType.POSSIBLE_FORMATS] = listOf(format)
            hints[DecodeHintType.TRY_HARDER] = true
            hints[DecodeHintType.CHARACTER_SET] = "UTF-8"
            hints.putAll(extraHints)
            return MultiFormatReader().decode(bitmap, hints)
        }
    }

    @ParameterizedTest(name = "{0}: {1}")
    @MethodSource("roundTrips")
    fun `encode then decode with zxing`(symbology: Symbology, input: String, expected: String, format: BarcodeFormat) {
        val code = Generator.generate(input, symbology)
        val result = decode(code, format)
        assertEquals(format, result.barcodeFormat)
        assertEquals(expected, result.text)
        assertEquals(expected, code.text)
    }

    @Test
    fun `qr error correction levels and margins`() {
        for (level in listOf("L", "M", "Q", "H")) {
            val code = Generator.generate("level $level", Symbology.QR, GenerateOptions(ecLevel = level))
            assertEquals(level, code.ecLevel)
            assertEquals("level $level", decode(code, BarcodeFormat.QR_CODE).text)
        }
        val framed = Generator.generate("margin", Symbology.QR)
        val bare = Generator.generate("margin", Symbology.QR, GenerateOptions(margin = false))
        assertEquals(4, framed.quietZone)
        assertEquals(0, bare.quietZone)
        assertEquals(framed.width - 8, bare.width)
        assertTrue(bare[0, 0], "finder pattern starts at the corner without a margin")
        assertFalse(framed[0, 0])
        val wide = Generator.generate("margin", Symbology.QR, GenerateOptions(quietZone = 10))
        assertEquals(bare.width + 20, wide.width)
        assertEquals("21%", Generator.generate("x", Symbology.AZTEC, GenerateOptions(ecLevel = "21")).ecLevel)
        assertEquals("6", Generator.generate("x", Symbology.PDF417, GenerateOptions(ecLevel = "H")).ecLevel)
        assertEquals("Q", Generator.generate("x", "QRCode", GenerateOptions(ecLevel = "q")).ecLevel)
    }

    @Test
    fun `gs1 symbols round trip`() {
        val hri = "(01)09501101530003(17)250101(10)ABC123"
        val expected = mapOf("01" to "09501101530003", "17" to "250101", "10" to "ABC123")
        val gs1 = GenerateOptions(gs1 = true)

        val c128 = decode(Generator.generate(hri, Symbology.CODE128, gs1), BarcodeFormat.CODE_128, extraHints = mapOf(DecodeHintType.ASSUME_GS1 to true))
        assertTrue(c128.text.startsWith("]C1"))
        assertEquals(expected, GS1.parse(c128.text)?.values)

        val dm = decode(Generator.generate(hri, Symbology.DATA_MATRIX, gs1), BarcodeFormat.DATA_MATRIX)
        assertEquals(expected, GS1.parse(dm.text)?.values)

        val qr = decode(Generator.generate(hri, Symbology.QR, gs1), BarcodeFormat.QR_CODE)
        assertEquals(expected, GS1.parse(qr.text)?.values)

        assertEquals(hri, Generator.generate(hri, Symbology.CODE128, gs1).text)
        assertThrows<IllegalArgumentException> { Generator.generate(hri, Symbology.AZTEC, gs1) }
    }

    @Test
    fun `linear bar height and svg output`() {
        val code = Generator.generate("590123412345", Symbology.EAN13, GenerateOptions(barHeight = 40, hrt = true))
        assertEquals(40 + 10, code.height)
        assertTrue(code.isLinear)
        val svg = code.toSvg(scale = 2)
        assertTrue(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""))
        assertTrue(svg.contains("width=\"${code.width * 2}\""))
        assertTrue(svg.contains(">5901234123457</text>"))
        assertTrue(svg.endsWith("</svg>"))
        val qrSvg = generateSvg("hello & <world>", Symbology.QR, GenerateOptions(foreground = "#123", background = "transparent"))
        assertTrue(qrSvg.contains("fill=\"#123\""))
        assertFalse(qrSvg.contains("<rect"))
        val grid = Generator.generate("grid").toBooleanGrid()
        assertEquals(grid.size, grid[0].size)
        val matrix = Generator.generate("grid").toBitMatrix()
        assertEquals(grid.size, matrix.height)
    }

    @Test
    fun `png output is a valid png`() {
        val png = Generator.png("png test", Symbology.QR)
        assertEquals(listOf(0x89, 0x50, 0x4E, 0x47), png.take(4).map { it.toInt() and 0xFF })
        val code = Generator.generate("png test")
        val width = (png[16].toInt() and 0xFF shl 24) or (png[17].toInt() and 0xFF shl 16) or (png[18].toInt() and 0xFF shl 8) or (png[19].toInt() and 0xFF)
        assertEquals(code.width * 4, width)
        // Decode our PNG back with the JDK's ImageIO and then with ZXing.
        val image = javax.imageio.ImageIO.read(java.io.ByteArrayInputStream(png))
        assertEquals(code.width * 4, image.width)
        val pixels = image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
        val result = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(image.width, image.height, pixels))))
        assertEquals("png test", result.text)
        assertTrue(generatePng("transparent", options = GenerateOptions(background = "transparent")).size > 50)
    }

    @Test
    fun `invalid input and unsupported symbologies`() {
        val unsupported = assertThrows<UnsupportedSymbologyException> { Generator.generate("x", Symbology.MAXICODE) }
        assertEquals(ErrorCode.UNSUPPORTED, unsupported.code)
        for (s in Symbology.entries.filter { it !in Generator.SUPPORTED }) {
            assertThrows<UnsupportedSymbologyException> { Generator.generate("123", s) }
        }
        assertThrows<IllegalArgumentException> { Generator.generate("ABC", Symbology.EAN13) }
        assertThrows<IllegalArgumentException> { Generator.generate("5901234123458", Symbology.EAN13) }
        assertThrows<IllegalArgumentException> { Generator.generate("5901234123457", Symbology.ISBN) }
        assertThrows<IllegalArgumentException> { Generator.generate("123", Symbology.ITF) }
        assertThrows<IllegalArgumentException> { Generator.generate("", Symbology.QR) }
        assertThrows<IllegalArgumentException> { Generator.generate("x", "nope") }
        assertThrows<IllegalArgumentException> { Generator.generate("x", Symbology.QR, GenerateOptions(ecLevel = "Z")) }
        assertEquals(15, Generator.SUPPORTED.size)
    }
}
