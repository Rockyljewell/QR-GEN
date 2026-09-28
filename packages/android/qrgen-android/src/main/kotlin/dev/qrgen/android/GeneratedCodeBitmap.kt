// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

@file:JvmName("QRGenBitmaps")

package dev.qrgen.android

import android.graphics.Bitmap
import android.graphics.Color
import androidx.annotation.ColorInt
import androidx.core.graphics.createBitmap
import dev.qrgen.GeneratedCode

/**
 * Renders a [GeneratedCode] into an ARGB_8888 [Bitmap] with [scale] pixels per module.
 *
 * ```kotlin
 * imageView.setImageBitmap(Generator.generate("https://example.com").toBitmap(scale = 10))
 * ```
 */
@JvmOverloads
public fun GeneratedCode.toBitmap(
    scale: Int = 8,
    @ColorInt foreground: Int = Color.BLACK,
    @ColorInt background: Int = Color.WHITE,
): Bitmap {
    require(scale >= 1) { "scale must be >= 1" }
    val w = width * scale
    val h = height * scale
    val row = IntArray(w)
    val bitmap = createBitmap(w, h, Bitmap.Config.ARGB_8888)
    for (my in 0 until height) {
        for (mx in 0 until width) {
            val color = if (this[mx, my]) foreground else background
            row.fill(color, mx * scale, mx * scale + scale)
        }
        for (dy in 0 until scale) bitmap.setPixels(row, 0, w, 0, my * scale + dy, w, 1)
    }
    return bitmap
}
