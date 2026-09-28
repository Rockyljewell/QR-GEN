// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A point in pixel coordinates. */
public data class Point(public val x: Float, public val y: Float) {
    /** Euclidean distance to [other]. */
    public fun distanceTo(other: Point): Float {
        val dx = x - other.x
        val dy = y - other.y
        return sqrt(dx * dx + dy * dy)
    }

    internal fun toMap(): Map<String, Any?> = linkedMapOf("x" to x, "y" to y)

    public companion object {
        @JvmField
        public val ZERO: Point = Point(0f, 0f)
    }
}

/** Width and height in pixels. */
public data class Size(public val width: Int, public val height: Int) {
    /** `true` when either side is zero or negative (unknown size). */
    public val isEmpty: Boolean get() = width <= 0 || height <= 0

    internal fun toMap(): Map<String, Any?> = linkedMapOf("width" to width, "height" to height)

    public companion object {
        @JvmField
        public val ZERO: Size = Size(0, 0)
    }
}

/** An axis-aligned rectangle in pixel coordinates. */
public data class BoundingBox(
    public val left: Float,
    public val top: Float,
    public val right: Float,
    public val bottom: Float,
) {
    public val width: Float get() = right - left
    public val height: Float get() = bottom - top
    public val area: Float get() = if (width <= 0f || height <= 0f) 0f else width * height
    public val center: Point get() = Point((left + right) / 2f, (top + bottom) / 2f)
    public val isEmpty: Boolean get() = width <= 0f || height <= 0f

    /** `true` if ([x], [y]) lies inside this box (edges included). */
    public fun contains(x: Float, y: Float): Boolean = x >= left && x <= right && y >= top && y <= bottom

    /** Area of the intersection with [other] (0 when disjoint). */
    public fun intersectionArea(other: BoundingBox): Float {
        val w = min(right, other.right) - max(left, other.left)
        val h = min(bottom, other.bottom) - max(top, other.top)
        return if (w <= 0f || h <= 0f) 0f else w * h
    }

    /** Intersection over union with [other], in `0..1`. */
    public fun intersectionOverUnion(other: BoundingBox): Float {
        val inter = intersectionArea(other)
        if (inter <= 0f) return 0f
        val union = area + other.area - inter
        return if (union <= 0f) 0f else inter / union
    }
}

/**
 * The four corners of a detected code, in pixel coordinates of the source frame or image.
 * Corners follow the symbol's own orientation: [topLeft] is the symbol's top-left corner
 * even when the code is rotated in the frame.
 */
public data class Quad(
    public val topLeft: Point,
    public val topRight: Point,
    public val bottomRight: Point,
    public val bottomLeft: Point,
) {
    /** The corners in order: top-left, top-right, bottom-right, bottom-left. */
    public val points: List<Point> get() = listOf(topLeft, topRight, bottomRight, bottomLeft)

    /** Mean of the four corners. */
    public val center: Point
        get() = Point(
            (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4f,
            (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4f,
        )

    /** Smallest axis-aligned box containing all four corners. */
    public val boundingBox: BoundingBox
        get() {
            val xs = floatArrayOf(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x)
            val ys = floatArrayOf(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y)
            return BoundingBox(xs.min(), ys.min(), xs.max(), ys.max())
        }

    /** Polygon area (shoelace formula). */
    public val area: Float
        get() {
            val p = points
            var sum = 0f
            for (i in p.indices) {
                val a = p[i]
                val b = p[(i + 1) % p.size]
                sum += a.x * b.y - b.x * a.y
            }
            return abs(sum) / 2f
        }

    /** `true` when all corners are at the origin (location unknown). */
    public val isEmpty: Boolean get() = points.all { it.x == 0f && it.y == 0f }

    /**
     * Rotation of the symbol in degrees (`0..359`, clockwise in screen coordinates),
     * derived from the top edge.
     */
    public val orientation: Int
        get() {
            val dx = (topRight.x - topLeft.x).toDouble()
            val dy = (topRight.y - topLeft.y).toDouble()
            if (dx == 0.0 && dy == 0.0) return 0
            val deg = Math.toDegrees(kotlin.math.atan2(dy, dx))
            return ((Math.round(deg).toInt() % 360) + 360) % 360
        }

    /** Returns a new quad with every corner passed through [transform]. */
    public fun map(transform: (Point) -> Point): Quad =
        Quad(transform(topLeft), transform(topRight), transform(bottomRight), transform(bottomLeft))

    /** Intersection over union of the bounding boxes. */
    public fun overlap(other: Quad): Float = boundingBox.intersectionOverUnion(other.boundingBox)

    internal fun toMap(): Map<String, Any?> = linkedMapOf(
        "topLeft" to topLeft.toMap(),
        "topRight" to topRight.toMap(),
        "bottomRight" to bottomRight.toMap(),
        "bottomLeft" to bottomLeft.toMap(),
    )

    public companion object {
        @JvmField
        public val ZERO: Quad = Quad(Point.ZERO, Point.ZERO, Point.ZERO, Point.ZERO)

        /** A quad covering the axis-aligned rectangle. */
        @JvmStatic
        public fun fromRect(left: Float, top: Float, right: Float, bottom: Float): Quad = Quad(
            Point(left, top),
            Point(right, top),
            Point(right, bottom),
            Point(left, bottom),
        )
    }
}

/**
 * A region of interest normalized to `0..1` (SPEC §4 `scanArea`). `x`/`y` are the top-left
 * corner. On Android the area is relative to the visible preview (what the user sees); when
 * no preview is attached it is relative to the camera frame.
 */
public data class ScanArea(
    public val x: Float,
    public val y: Float,
    public val width: Float,
    public val height: Float,
) {
    init {
        require(x in 0f..1f && y in 0f..1f) { "scanArea x/y must be in 0..1 (was $x, $y)" }
        require(width > 0f && height > 0f && x + width <= 1.0001f && y + height <= 1.0001f) {
            "scanArea must have a positive size and fit in 0..1 (was $x, $y, $width, $height)"
        }
    }

    public val right: Float get() = x + width
    public val bottom: Float get() = y + height

    /** `true` when this area covers the whole frame. */
    public val isFull: Boolean get() = x <= 0f && y <= 0f && right >= 0.9999f && bottom >= 0.9999f

    /** `true` if the normalized point ([nx], [ny]) lies inside this area. */
    public fun contains(nx: Float, ny: Float): Boolean = nx >= x && nx <= right && ny >= y && ny <= bottom

    /** The area in pixels of a [frameWidth] x [frameHeight] frame. */
    public fun toBoundingBox(frameWidth: Int, frameHeight: Int): BoundingBox =
        BoundingBox(x * frameWidth, y * frameHeight, right * frameWidth, bottom * frameHeight)

    internal fun toMap(): Map<String, Any?> = linkedMapOf("x" to x, "y" to y, "width" to width, "height" to height)

    public companion object {
        /** The whole frame (default). */
        @JvmField
        public val FULL: ScanArea = ScanArea(0f, 0f, 1f, 1f)

        /** A centered area of the given normalized size. */
        @JvmStatic
        public fun centered(width: Float, height: Float): ScanArea =
            ScanArea((1f - width) / 2f, (1f - height) / 2f, width, height)
    }
}
