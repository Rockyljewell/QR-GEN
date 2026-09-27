package dev.qrgen

import kotlin.math.max
import kotlin.math.min

/**
 * Maps coordinates between an upright camera frame and a view that displays it scaled
 * with "fill center" (center crop, like CameraX `PreviewView.ScaleType.FILL_CENTER`) or
 * "fit center" (letterbox), optionally mirrored horizontally (front camera previews).
 *
 * Barcode locations are reported in frame pixels (SPEC §2); overlays use this class to
 * draw them on screen, and scanners use the inverse to turn an on-screen scan area into
 * a region of the frame.
 */
public class FrameTransform @JvmOverloads constructor(
    public val frameWidth: Int,
    public val frameHeight: Int,
    public val viewWidth: Int,
    public val viewHeight: Int,
    public val scaleType: ScaleType = ScaleType.FILL_CENTER,
    public val mirrored: Boolean = false,
) {
    /** How the frame is scaled into the view. */
    public enum class ScaleType {
        /** Scale uniformly so the frame covers the view, cropping the overflow (default). */
        FILL_CENTER,

        /** Scale uniformly so the whole frame fits in the view, letterboxing the rest. */
        FIT_CENTER,
    }

    /** Uniform scale factor from frame pixels to view pixels. */
    public val scale: Float

    /** Horizontal offset of the scaled frame inside the view (negative when cropped). */
    public val offsetX: Float

    /** Vertical offset of the scaled frame inside the view (negative when cropped). */
    public val offsetY: Float

    init {
        if (frameWidth <= 0 || frameHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
            scale = 1f
            offsetX = 0f
            offsetY = 0f
        } else {
            val sx = viewWidth.toFloat() / frameWidth
            val sy = viewHeight.toFloat() / frameHeight
            scale = if (scaleType == ScaleType.FILL_CENTER) max(sx, sy) else min(sx, sy)
            offsetX = (viewWidth - frameWidth * scale) / 2f
            offsetY = (viewHeight - frameHeight * scale) / 2f
        }
    }

    /** `true` when both sizes are known and the mapping is meaningful. */
    public val isValid: Boolean get() = frameWidth > 0 && frameHeight > 0 && viewWidth > 0 && viewHeight > 0

    /** Frame pixel to view pixel. */
    public fun frameToView(point: Point): Point {
        val x = point.x * scale + offsetX
        val y = point.y * scale + offsetY
        return Point(if (mirrored) viewWidth - x else x, y)
    }

    /** View pixel to frame pixel. */
    public fun viewToFrame(point: Point): Point {
        val vx = if (mirrored) viewWidth - point.x else point.x
        return Point((vx - offsetX) / scale, (point.y - offsetY) / scale)
    }

    /** Maps every corner of [quad] into view coordinates. */
    public fun frameToView(quad: Quad): Quad = quad.map(::frameToView)

    /** Maps a frame rectangle into view coordinates. */
    public fun frameToView(box: BoundingBox): BoundingBox =
        boxOf(frameToView(Point(box.left, box.top)), frameToView(Point(box.right, box.bottom)))

    /** Maps a view rectangle into frame coordinates. */
    public fun viewToFrame(box: BoundingBox): BoundingBox =
        boxOf(viewToFrame(Point(box.left, box.top)), viewToFrame(Point(box.right, box.bottom)))

    /** The part of the frame that is visible in the view, in frame pixels. */
    public val visibleFrameRegion: BoundingBox
        get() = clampToFrame(viewToFrame(BoundingBox(0f, 0f, viewWidth.toFloat(), viewHeight.toFloat())))

    /**
     * Converts a [ScanArea] normalized to the view into frame pixels (clamped to the frame).
     */
    public fun scanAreaToFrame(area: ScanArea): BoundingBox =
        clampToFrame(viewToFrame(area.toBoundingBox(viewWidth, viewHeight)))

    private fun clampToFrame(box: BoundingBox): BoundingBox = BoundingBox(
        box.left.coerceIn(0f, frameWidth.toFloat()),
        box.top.coerceIn(0f, frameHeight.toFloat()),
        box.right.coerceIn(0f, frameWidth.toFloat()),
        box.bottom.coerceIn(0f, frameHeight.toFloat()),
    )

    private fun boxOf(a: Point, b: Point): BoundingBox =
        BoundingBox(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))

    override fun toString(): String =
        "FrameTransform(frame=${frameWidth}x$frameHeight, view=${viewWidth}x$viewHeight, $scaleType, mirrored=$mirrored)"

    public companion object {
        /**
         * Maps a point from a sensor buffer of [bufferWidth] x [bufferHeight] into the upright
         * image obtained by rotating the buffer clockwise by [rotationDegrees] (0, 90, 180, 270),
         * the convention used by CameraX `ImageInfo.getRotationDegrees()`.
         */
        @JvmStatic
        public fun rotateToUpright(point: Point, rotationDegrees: Int, bufferWidth: Int, bufferHeight: Int): Point =
            when (((rotationDegrees % 360) + 360) % 360) {
                90 -> Point(bufferHeight - point.y, point.x)
                180 -> Point(bufferWidth - point.x, bufferHeight - point.y)
                270 -> Point(point.y, bufferWidth - point.x)
                else -> point
            }

        /** Size of the upright image for a buffer rotated clockwise by [rotationDegrees]. */
        @JvmStatic
        public fun uprightSize(bufferWidth: Int, bufferHeight: Int, rotationDegrees: Int): Size =
            if ((((rotationDegrees % 360) + 360) % 360) % 180 == 0) Size(bufferWidth, bufferHeight)
            else Size(bufferHeight, bufferWidth)
    }
}
