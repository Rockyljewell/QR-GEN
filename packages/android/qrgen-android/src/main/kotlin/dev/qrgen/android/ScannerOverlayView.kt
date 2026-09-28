// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import android.animation.TimeInterpolator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.SystemClock
import android.text.TextPaint
import android.text.TextUtils
import android.util.TypedValue
import android.view.View
import android.view.animation.DecelerateInterpolator
import androidx.annotation.ColorInt
import androidx.core.graphics.ColorUtils
import dev.qrgen.FrameTransform
import dev.qrgen.Quad
import dev.qrgen.ScanArea
import dev.qrgen.ScannerOptions
import dev.qrgen.Size
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Draws the viewfinder (rounded corner brackets or an aiming line), outlines of detected codes
 * mapped from frame to view coordinates, and a success pill after each scan.
 */
internal class ScannerOverlayView(context: Context) : View(context) {
    private val dp = resources.displayMetrics.density

    @ColorInt
    var accentColor: Int = DEFAULT_ACCENT
        set(value) {
            field = value
            updatePaints()
            invalidate()
        }

    var viewfinder: ScannerOptions.Viewfinder = ScannerOptions.Viewfinder.FRAME
        set(value) {
            field = value
            invalidate()
        }

    /** Scan area normalized to this view. */
    var scanArea: ScanArea = ScanArea.FULL
        set(value) {
            field = value
            invalidate()
        }

    var dimBackground: Boolean = true
        set(value) {
            field = value
            invalidate()
        }

    var showHighlights: Boolean = true
    var showToast: Boolean = true

    private var highlights: List<Quad> = emptyList()
    private var highlightAt = 0L
    private var toastText: String? = null
    private var toastAt = 0L

    private val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SCRIM }
    private val bracketPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 4f * dp
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * dp
        strokeCap = Paint.Cap.ROUND
    }
    private val highlightFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val highlightStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f * dp
        strokeJoin = Paint.Join.ROUND
    }
    private val toastBackground = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = TOAST_BACKGROUND }
    private val toastIcon = Paint(Paint.ANTI_ALIAS_FLAG)
    private val toastCheck = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f * dp
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = TOAST_CHECK
    }
    private val toastTextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 15f, resources.displayMetrics)
    }
    private val path = Path()
    private val rect = RectF()
    private val arc = RectF()
    private val fade: TimeInterpolator = DecelerateInterpolator()

    init {
        updatePaints()
        accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    private fun updatePaints() {
        bracketPaint.color = accentColor
        linePaint.color = accentColor
        highlightStroke.color = accentColor
        highlightFill.color = ColorUtils.setAlphaComponent(accentColor, 0x4D)
        toastIcon.color = accentColor
    }

    /**
     * Outlines [quads] (frame pixels of an upright [frame]). Frames without detections keep the
     * previous outlines until they expire, which avoids flicker when a frame misses a code.
     */
    fun showDetections(quads: List<Quad>, frame: Size, mirrored: Boolean, fill: Boolean) {
        if (!showHighlights) return
        val transform = FrameTransform(
            frame.width, frame.height, width, height,
            if (fill) FrameTransform.ScaleType.FILL_CENTER else FrameTransform.ScaleType.FIT_CENTER,
            mirrored,
        )
        val mapped = if (transform.isValid) quads.filter { !it.isEmpty }.map(transform::frameToView) else emptyList()
        if (mapped.isEmpty()) return
        highlights = mapped
        highlightAt = SystemClock.uptimeMillis()
        postInvalidateOnAnimation()
    }

    fun clearDetections() {
        highlights = emptyList()
        invalidate()
    }

    /** Shows the success pill; [announcement] is spoken by accessibility services. */
    fun showToast(text: String, announcement: String = text) {
        contentDescription = announcement
        if (!showToast) return
        toastText = text
        toastAt = SystemClock.uptimeMillis()
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = SystemClock.uptimeMillis()
        var animating = false
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        if (viewfinder != ScannerOptions.Viewfinder.NONE) {
            viewfinderRect(w, h, rect)
            val radius = CORNER_RADIUS_DP * dp
            if (dimBackground) {
                path.reset()
                path.fillType = Path.FillType.EVEN_ODD
                path.addRect(0f, 0f, w, h, Path.Direction.CW)
                path.addRoundRect(rect, radius, radius, Path.Direction.CW)
                canvas.drawPath(path, scrimPaint)
            }
            if (viewfinder == ScannerOptions.Viewfinder.FRAME) {
                drawBrackets(canvas, rect, radius)
            } else {
                // Aiming line with a slow pulse.
                val phase = (now % LINE_PERIOD_MS).toFloat() / LINE_PERIOD_MS
                linePaint.alpha = (255 * (0.6f + 0.4f * (0.5f + 0.5f * sin(2 * PI * phase).toFloat()))).toInt()
                val inset = 12f * dp
                canvas.drawLine(rect.left + inset, rect.centerY(), rect.right - inset, rect.centerY(), linePaint)
                animating = true
            }
        }

        if (highlights.isNotEmpty()) {
            val age = now - highlightAt
            if (age < HIGHLIGHT_MS) {
                for (q in highlights) {
                    path.reset()
                    path.fillType = Path.FillType.WINDING
                    path.moveTo(q.topLeft.x, q.topLeft.y)
                    path.lineTo(q.topRight.x, q.topRight.y)
                    path.lineTo(q.bottomRight.x, q.bottomRight.y)
                    path.lineTo(q.bottomLeft.x, q.bottomLeft.y)
                    path.close()
                    canvas.drawPath(path, highlightFill)
                    canvas.drawPath(path, highlightStroke)
                }
                animating = true
            } else {
                highlights = emptyList()
            }
        }

        val text = toastText
        if (text != null) {
            val age = now - toastAt
            if (age < TOAST_MS) {
                val alpha = when {
                    age < TOAST_FADE_MS -> fade.getInterpolation(age.toFloat() / TOAST_FADE_MS)
                    age > TOAST_MS - TOAST_FADE_MS -> (TOAST_MS - age).toFloat() / TOAST_FADE_MS
                    else -> 1f
                }
                drawToast(canvas, text, w, h, alpha.coerceIn(0f, 1f), age)
                animating = true
            } else {
                toastText = null
            }
        }

        if (animating) postInvalidateOnAnimation()
    }

    /** The on-screen viewfinder: the scan area, or a default centered shape for the full frame. */
    private fun viewfinderRect(w: Float, h: Float, out: RectF) {
        if (!scanArea.isFull) {
            out.set(scanArea.x * w, scanArea.y * h, scanArea.right * w, scanArea.bottom * h)
            return
        }
        if (viewfinder == ScannerOptions.Viewfinder.LINE) {
            val fw = w * 0.84f
            val fh = min(h * 0.26f, fw * 0.5f)
            out.set((w - fw) / 2f, (h - fh) / 2f, (w + fw) / 2f, (h + fh) / 2f)
        } else {
            val side = min(w, h) * 0.68f
            out.set((w - side) / 2f, (h - side) / 2f, (w + side) / 2f, (h + side) / 2f)
        }
    }

    private fun drawBrackets(canvas: Canvas, r: RectF, cornerRadius: Float) {
        val arm = (min(r.width(), r.height()) * 0.18f).coerceIn(20f * dp, 44f * dp)
        val rad = min(cornerRadius, arm * 0.7f)
        val d = rad * 2f
        path.reset()
        path.fillType = Path.FillType.WINDING
        // top-left
        path.moveTo(r.left, r.top + arm)
        path.lineTo(r.left, r.top + rad)
        arc.set(r.left, r.top, r.left + d, r.top + d)
        path.arcTo(arc, 180f, 90f, false)
        path.lineTo(r.left + arm, r.top)
        // top-right
        path.moveTo(r.right - arm, r.top)
        path.lineTo(r.right - rad, r.top)
        arc.set(r.right - d, r.top, r.right, r.top + d)
        path.arcTo(arc, 270f, 90f, false)
        path.lineTo(r.right, r.top + arm)
        // bottom-right
        path.moveTo(r.right, r.bottom - arm)
        path.lineTo(r.right, r.bottom - rad)
        arc.set(r.right - d, r.bottom - d, r.right, r.bottom)
        path.arcTo(arc, 0f, 90f, false)
        path.lineTo(r.right - arm, r.bottom)
        // bottom-left
        path.moveTo(r.left + arm, r.bottom)
        path.lineTo(r.left + rad, r.bottom)
        arc.set(r.left, r.bottom - d, r.left + d, r.bottom)
        path.arcTo(arc, 90f, 90f, false)
        path.lineTo(r.left, r.bottom - arm)
        canvas.drawPath(path, bracketPaint)
    }

    private fun drawToast(canvas: Canvas, text: String, w: Float, h: Float, alpha: Float, age: Long) {
        val padH = 16f * dp
        val padV = 10f * dp
        val icon = 20f * dp
        val gap = 10f * dp
        val maxWidth = w - 32f * dp
        val maxText = max(0f, maxWidth - padH * 2 - icon - gap)
        val shown = TextUtils.ellipsize(text, toastTextPaint, maxText, TextUtils.TruncateAt.END).toString()
        val textWidth = toastTextPaint.measureText(shown)
        val fm = toastTextPaint.fontMetrics
        val contentHeight = max(icon, fm.descent - fm.ascent)
        val pillW = padH * 2 + icon + gap + textWidth
        val pillH = padV * 2 + contentHeight
        // Slide up slightly while fading in.
        val lift = (1f - fade.getInterpolation((age.toFloat() / TOAST_FADE_MS).coerceAtMost(1f))) * 8f * dp
        val left = (w - pillW) / 2f
        val top = h - pillH - TOAST_BOTTOM_DP * dp + lift
        rect.set(left, top, left + pillW, top + pillH)
        val a = (alpha * 255).toInt()
        toastBackground.alpha = (Color.alpha(TOAST_BACKGROUND) * alpha).toInt()
        canvas.drawRoundRect(rect, pillH / 2f, pillH / 2f, toastBackground)
        val cx = left + padH + icon / 2f
        val cy = top + pillH / 2f
        toastIcon.alpha = a
        canvas.drawCircle(cx, cy, icon / 2f, toastIcon)
        toastCheck.alpha = a
        path.reset()
        path.moveTo(cx - icon * 0.22f, cy + icon * 0.02f)
        path.lineTo(cx - icon * 0.05f, cy + icon * 0.18f)
        path.lineTo(cx + icon * 0.24f, cy - icon * 0.16f)
        canvas.drawPath(path, toastCheck)
        toastTextPaint.alpha = a
        val baseline = cy - (fm.ascent + fm.descent) / 2f
        canvas.drawText(shown, left + padH + icon + gap, baseline, toastTextPaint)
    }

    internal companion object {
        /** QRGen teal. */
        @ColorInt
        const val DEFAULT_ACCENT: Int = 0xFF2EC1CE.toInt()
        private const val SCRIM = 0x66000000
        private const val TOAST_BACKGROUND = 0xE61B1F24.toInt()
        private const val TOAST_CHECK = 0xFF0B2A2E.toInt()
        private const val CORNER_RADIUS_DP = 18f
        private const val HIGHLIGHT_MS = 400L
        private const val TOAST_MS = 1800L
        private const val TOAST_FADE_MS = 220L
        private const val TOAST_BOTTOM_DP = 48f
        private const val LINE_PERIOD_MS = 1600L
    }
}
