// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import com.google.mlkit.vision.barcode.BarcodeScannerOptions
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
import java.util.Collections
import java.util.EnumSet

/** Maps QRGen symbologies to ML Kit `Barcode.FORMAT_*` values (SPEC §1, ML Kit column). */
internal object MlKitFormats {
    val SUPPORTED: Set<Symbology> = Collections.unmodifiableSet(
        EnumSet.of(
            Symbology.QR, Symbology.DATA_MATRIX, Symbology.AZTEC, Symbology.PDF417,
            Symbology.EAN13, Symbology.EAN8, Symbology.UPCA, Symbology.UPCE, Symbology.ISBN,
            Symbology.CODE128, Symbology.CODE39, Symbology.CODE93, Symbology.CODABAR,
            Symbology.ITF, Symbology.ITF14,
        ),
    )

    /**
     * ML Kit formats to enable for one symbology. EAN-13 and UPC-A enable each other because
     * ML Kit may report a UPC-A symbol as either; [Symbology.refine] sorts the result out.
     */
    private fun formatsOf(symbology: Symbology): IntArray = when (symbology) {
        Symbology.QR -> intArrayOf(FORMAT_QR_CODE)
        Symbology.DATA_MATRIX -> intArrayOf(FORMAT_DATA_MATRIX)
        Symbology.AZTEC -> intArrayOf(FORMAT_AZTEC)
        Symbology.PDF417 -> intArrayOf(FORMAT_PDF417)
        Symbology.EAN13 -> intArrayOf(FORMAT_EAN_13, FORMAT_UPC_A)
        Symbology.ISBN -> intArrayOf(FORMAT_EAN_13)
        Symbology.UPCA -> intArrayOf(FORMAT_UPC_A, FORMAT_EAN_13)
        Symbology.UPCE -> intArrayOf(FORMAT_UPC_E)
        Symbology.EAN8 -> intArrayOf(FORMAT_EAN_8)
        Symbology.CODE128 -> intArrayOf(FORMAT_CODE_128)
        Symbology.CODE39 -> intArrayOf(FORMAT_CODE_39)
        Symbology.CODE93 -> intArrayOf(FORMAT_CODE_93)
        Symbology.CODABAR -> intArrayOf(FORMAT_CODABAR)
        Symbology.ITF, Symbology.ITF14 -> intArrayOf(FORMAT_ITF)
        else -> IntArray(0)
    }

    /** Sorted, distinct ML Kit formats for [symbologies] (empty when none is supported). */
    fun formatsFor(symbologies: Set<Symbology>): IntArray {
        val out = java.util.TreeSet<Int>()
        for (s in symbologies) for (f in formatsOf(s)) out += f
        return out.toIntArray()
    }

    fun options(formats: IntArray): BarcodeScannerOptions {
        require(formats.isNotEmpty()) { "no formats" }
        return BarcodeScannerOptions.Builder()
            .setBarcodeFormats(formats[0], *formats.copyOfRange(1, formats.size))
            .build()
    }

    /** The QRGen symbology for an ML Kit format, before [Symbology.refine]. */
    fun symbologyOf(format: Int): Symbology? = when (format) {
        FORMAT_QR_CODE -> Symbology.QR
        FORMAT_DATA_MATRIX -> Symbology.DATA_MATRIX
        FORMAT_AZTEC -> Symbology.AZTEC
        FORMAT_PDF417 -> Symbology.PDF417
        FORMAT_EAN_13 -> Symbology.EAN13
        FORMAT_EAN_8 -> Symbology.EAN8
        FORMAT_UPC_A -> Symbology.UPCA
        FORMAT_UPC_E -> Symbology.UPCE
        FORMAT_CODE_128 -> Symbology.CODE128
        FORMAT_CODE_39 -> Symbology.CODE39
        FORMAT_CODE_93 -> Symbology.CODE93
        FORMAT_CODABAR -> Symbology.CODABAR
        FORMAT_ITF -> Symbology.ITF
        else -> null
    }
}
