package dev.qrgen.android

import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_AZTEC
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_CODABAR
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_CODE_128
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_CODE_39
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_CODE_93
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_DATA_MATRIX
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_EAN_13
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_EAN_8
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_ITF
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_PDF417
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_UPC_A
import com.google.mlkit.vision.barcode.common.Barcode.FORMAT_UPC_E
import dev.qrgen.Symbology
import org.junit.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MlKitFormatsTest {
    @Test
    fun everySupportedSymbologyMapsToAFormat() {
        for (s in MlKitFormats.SUPPORTED) assertTrue(MlKitFormats.formatsFor(setOf(s)).isNotEmpty(), "no ML Kit format for ${s.id}")
        for (s in Symbology.entries.filter { it !in MlKitFormats.SUPPORTED }) {
            assertTrue(MlKitFormats.formatsFor(setOf(s)).isEmpty(), "${s.id} should be skipped")
        }
    }

    @Test
    fun formatsFollowTheSpecTable() {
        assertContentEquals(intArrayOf(FORMAT_QR_CODE), MlKitFormats.formatsFor(setOf(Symbology.QR)))
        assertContentEquals(intArrayOf(FORMAT_EAN_13), MlKitFormats.formatsFor(setOf(Symbology.ISBN)))
        assertContentEquals(intArrayOf(FORMAT_ITF), MlKitFormats.formatsFor(setOf(Symbology.ITF14)))
        assertContentEquals(
            intArrayOf(FORMAT_EAN_13, FORMAT_UPC_A).sortedArray(),
            MlKitFormats.formatsFor(setOf(Symbology.UPCA)),
        )
        val all = MlKitFormats.formatsFor(Symbology.ALL).toSet()
        assertEquals(
            setOf(
                FORMAT_QR_CODE, FORMAT_DATA_MATRIX, FORMAT_AZTEC, FORMAT_PDF417, FORMAT_EAN_13, FORMAT_EAN_8,
                FORMAT_UPC_A, FORMAT_UPC_E, FORMAT_CODE_128, FORMAT_CODE_39, FORMAT_CODE_93, FORMAT_CODABAR, FORMAT_ITF,
            ),
            all,
        )
        assertTrue(MlKitFormats.formatsFor(Symbology.resolve("micro-qr", "maxicode", "databar")).isEmpty())
    }

    @Test
    fun formatsMapBackToSymbologies() {
        assertEquals(Symbology.QR, MlKitFormats.symbologyOf(FORMAT_QR_CODE))
        assertEquals(Symbology.UPCA, MlKitFormats.symbologyOf(FORMAT_UPC_A))
        assertEquals(Symbology.ITF, MlKitFormats.symbologyOf(FORMAT_ITF))
        assertNull(MlKitFormats.symbologyOf(-12345))
        for (f in MlKitFormats.formatsFor(Symbology.ALL)) {
            val s = MlKitFormats.symbologyOf(f)
            assertTrue(s != null && s in MlKitFormats.SUPPORTED)
        }
    }
}
