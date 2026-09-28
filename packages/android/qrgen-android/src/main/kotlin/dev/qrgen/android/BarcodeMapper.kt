// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.ContentType
import dev.qrgen.GS1
import dev.qrgen.Point
import dev.qrgen.Quad
import dev.qrgen.Size
import dev.qrgen.Symbology
import com.google.mlkit.vision.barcode.common.Barcode as MlKitBarcode

/** Converts ML Kit results into SPEC §2 [Barcode]s. */
internal object BarcodeMapper {
    private const val ISO15434_HEADER = "[)>\u001e"

    /**
     * @param frame size of the upright frame or image the ML Kit coordinates refer to.
     * @return `null` when the result is not one of the [requested] symbologies.
     */
    fun map(ml: MlKitBarcode, frame: Size, requested: Set<Symbology>, timestamp: Long): Barcode? {
        val detected = MlKitFormats.symbologyOf(ml.format) ?: return null
        val raw: String? = ml.rawValue
        val bytes: ByteArray = ml.rawBytes ?: raw?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val decoded = raw ?: ml.displayValue ?: String(bytes, Charsets.ISO_8859_1)
        val refined = Symbology.refine(detected, decoded, requested) ?: return null
        val symbology = refined.symbology
        val gs1 = if (symbology.isGS1Capable) GS1.detect(refined.data, symbology) else null
        val contentType = when {
            gs1 != null -> ContentType.GS1
            raw == null && bytes.isNotEmpty() -> ContentType.BINARY
            refined.data.startsWith(ISO15434_HEADER) -> ContentType.ISO15434
            else -> ContentType.TEXT
        }
        val location = quadOf(ml)
        return Barcode(
            data = gs1?.toHri() ?: refined.data,
            symbology = symbology,
            rawBytes = bytes,
            contentType = contentType,
            isGS1 = gs1 != null,
            location = location,
            frameSize = frame,
            orientation = location.orientation,
            ecLevel = "",
            symbologyIdentifier = symbology.aimIdentifier(gs1 != null),
            timestamp = timestamp,
        )
    }

    /** ML Kit corner points are clockwise from the top-left corner of the symbol. */
    private fun quadOf(ml: MlKitBarcode): Quad {
        val pts = ml.cornerPoints
        if (pts != null && pts.size == 4) {
            return Quad(
                Point(pts[0].x.toFloat(), pts[0].y.toFloat()),
                Point(pts[1].x.toFloat(), pts[1].y.toFloat()),
                Point(pts[2].x.toFloat(), pts[2].y.toFloat()),
                Point(pts[3].x.toFloat(), pts[3].y.toFloat()),
            )
        }
        val box = ml.boundingBox ?: return Quad.ZERO
        return Quad.fromRect(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(), box.bottom.toFloat())
    }
}
