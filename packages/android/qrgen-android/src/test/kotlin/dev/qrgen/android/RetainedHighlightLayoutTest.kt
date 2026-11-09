// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import android.Manifest
import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Looper
import android.os.SystemClock
import android.view.View
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import dev.qrgen.Barcode
import dev.qrgen.ClockSample
import dev.qrgen.Point
import dev.qrgen.Quad
import dev.qrgen.ScannerOptions
import dev.qrgen.Size
import dev.qrgen.Symbology
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Duration
import kotlin.math.abs
import kotlin.math.max
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowSystemClock

/**
 * Real bound QRGenScannerView -> frameListener -> ScannerOverlayView -> bitmap pixels.
 * The accepted overlay event and uptime are controlled; no camera/provider/MLKit is run.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
class RetainedHighlightLayoutTest {
    private class CapabilityUnavailable(message: String) : RuntimeException(message)

    private class Owner : LifecycleOwner {
        private val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry
        fun start() { registry.currentState = Lifecycle.State.STARTED }
        fun destroy() { registry.currentState = Lifecycle.State.DESTROYED }
    }

    private data class Edges(val left: Double, val top: Double, val right: Double, val bottom: Double) {
        fun toMap(): Map<String, Double> = linkedMapOf("left" to left, "top" to top, "right" to right, "bottom" to bottom)
        fun difference(other: Edges): Double = max(max(abs(left - other.left), abs(top - other.top)),
            max(abs(right - other.right), abs(bottom - other.bottom)))
    }

    private data class Snapshot(val details: Map<String, Any?>, val pixels: Int, val bounds: Edges?)

    private class Pixels(private val output: File) {
        var created = 0
        var recycled = 0

        fun draw(view: QRGenScannerView, name: String, relativeUptime: Long, frames: Int): Snapshot {
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            created++
            try {
                bitmap.eraseColor(Color.TRANSPARENT)
                view.draw(Canvas(bitmap))
                val pixels = IntArray(view.width * view.height)
                bitmap.getPixels(pixels, 0, view.width, 0, 0, view.width, view.height)
                var left = view.width
                var top = view.height
                var right = -1
                var bottom = -1
                var count = 0
                for (y in 0 until view.height) {
                    for (x in 0 until view.width) {
                        val color = pixels[y * view.width + x]
                        if (Color.alpha(color) >= 250 && abs(Color.red(color) - 46) <= 8 &&
                            abs(Color.green(color) - 193) <= 8 && abs(Color.blue(color) - 206) <= 8) {
                            count++
                            left = minOf(left, x); top = minOf(top, y)
                            right = maxOf(right, x); bottom = maxOf(bottom, y)
                        }
                    }
                }
                val bounds = if (count == 0) null else Edges(left.toDouble(), top.toDouble(), (right + 1).toDouble(), (bottom + 1).toDouble())
                val file = File(output, "$name.png")
                file.outputStream().use { stream ->
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) { "PNG compression failed" }
                }
                val bytes = ByteBuffer.allocate(pixels.size * 4)
                pixels.forEach { bytes.putInt(it) }
                val overlay = (0 until view.childCount).map { view.getChildAt(it) }.filterIsInstance<ScannerOverlayView>().single()
                return Snapshot(linkedMapOf(
                    "stage" to name, "relativeUptime" to relativeUptime, "frameEvents" to frames,
                    "viewWidth" to view.width, "viewHeight" to view.height,
                    "previewWidth" to view.previewView.width, "previewHeight" to view.previewView.height,
                    "overlayWidth" to overlay.width, "overlayHeight" to overlay.height,
                    "attachedToWindow" to view.isAttachedToWindow, "accentPixelCount" to count,
                    "bounds" to bounds?.toMap(), "pngFile" to file.name,
                    "pngSHA256" to digest(file.readBytes()), "argbSHA256" to digest(bytes.array()),
                ), count, bounds)
            } finally {
                bitmap.recycle()
                if (bitmap.isRecycled) recycled++
            }
        }
    }

    private fun layout(view: QRGenScannerView, width: Int, height: Int) {
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, width, height)
    }

    // Independent cover arithmetic for the frozen source rectangle; no production transform helper.
    private fun expected(width: Int, height: Int, density: Float): Edges {
        val scale = max(width / 390.0, height / 844.0)
        val x = (width - 390.0 * scale) / 2
        val y = (height - 844.0 * scale) / 2
        val halfStroke = 3.0 * density / 2
        return Edges(240 * scale + x - halfStroke, 540 * scale + y - halfStroke,
            320 * scale + x + halfStroke, 620 * scale + y + halfStroke)
    }

    private fun matches(snapshot: Snapshot, expected: Edges): Boolean =
        snapshot.pixels >= 20 && snapshot.bounds?.difference(expected)?.let { it <= 2.0 } == true

    @Test
    fun retainedOutlineUsesCurrentLayoutWithoutAnotherFrameAndKeepsItsOriginalDeadline() {
        val output = File("build/test-results/testDebugUnitTest/retained-layout").canonicalFile
        check(output.mkdirs() || output.isDirectory)
        val checks = mutableListOf<Map<String, Any?>>()
        val captures = mutableListOf<Map<String, Any?>>()
        val errors = mutableListOf<String>()
        val states = mutableListOf<String>()
        var ready = 0
        var scans = 0
        var tracks = 0
        var frames = 0
        var phase = "complete"
        val harnessErrors = mutableListOf<String>()
        val inconclusiveReasons = mutableListOf<String>()
        var view: QRGenScannerView? = null
        var controller: QRGenScanner? = null
        var owner: Owner? = null
        var cleanupComplete = false
        val pixels = Pixels(output)
        fun record(name: String, kind: String, passed: Boolean, details: Map<String, Any?>) {
            checks.add(linkedMapOf("name" to name, "kind" to kind, "passed" to passed, "details" to details))
        }
        try {
            if (Looper.myLooper() !== Looper.getMainLooper()) throw CapabilityUnavailable("Test is not on the main looper")
            val application: Application = RuntimeEnvironment.getApplication()
            Shadows.shadowOf(application).denyPermissions(Manifest.permission.CAMERA)
            if (QRGen.hasCameraPermission(application)) throw CapabilityUnavailable("Camera permission was not denied")
            val currentOwner = Owner().also { owner = it; it.start() }
            val currentView = QRGenScannerView(application).also { view = it }
            currentView.options = ScannerOptions(mode = ScannerOptions.Mode.CONTINUOUS, beep = false, vibrate = false,
                viewfinder = ScannerOptions.Viewfinder.NONE)
            currentView.showToast = false
            currentView.dimBackground = false
            currentView.onError { errors.add(it.code.id) }
            currentView.onReady { ready++ }
            currentView.onScan { scans++ }
            currentView.onTrack { tracks++ }
            layout(currentView, 390, 844)
            val currentController = currentView.bind(currentOwner).also { controller = it }
            states.add(currentController.state.name)
            if (currentController.state != QRGenScanner.State.STOPPED || errors != listOf("camera-permission-denied") ||
                ready != 0 || scans != 0 || tracks != 0 || currentController.frameListener == null) {
                throw CapabilityUnavailable("Denied-permission bind did not retain the real wired no-camera controller")
            }
            val origin = SystemClock.uptimeMillis()
            fun at(relative: Long) {
                val advance = origin + relative - SystemClock.uptimeMillis()
                check(advance >= 0) { "Controlled uptime moved unexpectedly" }
                ShadowSystemClock.advanceBy(Duration.ofMillis(advance))
                check(SystemClock.uptimeMillis() - origin == relative)
            }
            fun capture(name: String): Snapshot = pixels.draw(currentView, name, SystemClock.uptimeMillis() - origin, frames)
                .also { captures.add(it.details) }
            fun frame() {
                val barcode = Barcode("ANDROID-LAYOUT-A", Symbology.QR,
                    location = Quad(Point(240f, 540f), Point(320f, 540f), Point(320f, 620f), Point(240f, 620f)),
                    frameSize = Size(390, 844), timestamp = 1_700_000_000_000)
                frames++
                currentController.frameListener?.invoke(QRGenScanner.FrameEvent(
                    listOf(barcode), null, Size(390, 844), false, true, ClockSample.manual(barcode.timestamp),
                )) ?: error("Real view frame listener was released")
            }
            val blank = capture("blank")
            frame()
            val initial = capture("initial")
            val oldExpected = expected(390, 844, currentView.resources.displayMetrics.density)
            val newExpected = expected(400, 860, currentView.resources.displayMetrics.density)
            val capable = blank.pixels == 0 && matches(initial, oldExpected) && oldExpected.difference(newExpected) > 8
            record("native_bitmap_capability", "capability", capable, linkedMapOf(
                "blankAccentPixels" to blank.pixels, "initial" to initial.details,
                "expectedOld" to oldExpected.toMap(), "expectedNew" to newExpected.toMap(),
                "oldVsNewMaxEdgeDifference" to oldExpected.difference(newExpected), "tolerancePixels" to 2,
            ))
            if (!capable) throw CapabilityUnavailable("Actual initial bitmap rendering/independent geometry capability failed")
            record("initial_projection_matches_source", "control", true, initial.details)

            at(100)
            layout(currentView, 400, 860)
            val resized = capture("resized-no-frame")
            val target = matches(resized, newExpected)
            record("retained_highlight_reprojects_on_layout", "target", target, linkedMapOf(
                "capture" to resized.details, "expected" to newExpected.toMap(), "oldExpected" to oldExpected.toMap(),
                "onlyOneFrame" to (frames == 1), "newLayout" to (currentView.width == 400 && currentView.height == 860),
            ))
            at(399)
            val beforeDeadline = capture("before-400")
            at(400)
            val expired = capture("expired-400")
            record("original_highlight_expires_at_400ms", "control",
                beforeDeadline.pixels >= 20 && expired.pixels == 0 && frames == 1,
                linkedMapOf("before" to beforeDeadline.details, "expired" to expired.details))
            frame()
            val recovered = capture("fresh-recovery")
            record("fresh_frame_recovers_resized_projection", "control", matches(recovered, newExpected) && frames == 2,
                linkedMapOf("capture" to recovered.details, "expected" to newExpected.toMap()))
            currentView.start()
            states.add(currentController.state.name)
            val sourceCleared = capture("public-restart-clear")
            record("public_restart_source_clear_removes_highlight", "control",
                sourceCleared.pixels == 0 && errors == listOf("camera-permission-denied", "camera-permission-denied") &&
                    currentController.state == QRGenScanner.State.STOPPED && frames == 2,
                sourceCleared.details)
            frame()
            val beforeStop = capture("before-public-stop")
            currentView.stop()
            states.add(currentController.state.name)
            val stopped = capture("public-stop")
            record("public_stop_removes_highlight", "control",
                matches(beforeStop, newExpected) && stopped.pixels == 0 && frames == 3 &&
                    currentController.state == QRGenScanner.State.STOPPED,
                linkedMapOf("before" to beforeStop.details, "stopped" to stopped.details))
            if (ready != 0 || scans != 0 || tracks != 0 || QRGen.hasCameraPermission(application)) {
                throw CapabilityUnavailable("Unexpected public scan/track/ready callback or camera permission")
            }
        } catch (error: CapabilityUnavailable) {
            phase = "harness-inconclusive"
            inconclusiveReasons.add(error.message ?: "Unsupported native rendering/setup")
        } catch (error: Throwable) {
            phase = "harness-error"
            harnessErrors.add(error.javaClass.name + ": " + error.message)
        } finally {
            try {
                view?.release()
                owner?.destroy()
                cleanupComplete = controller?.state == QRGenScanner.State.RELEASED && view?.scanner == null &&
                    pixels.created == pixels.recycled
                controller?.let { states.add(it.state.name) }
                if (!cleanupComplete) harnessErrors.add("Controller/view/bitmap cleanup did not complete")
            } catch (error: Throwable) {
                harnessErrors.add("Cleanup " + error.javaClass.name + ": " + error.message)
            }
        }
        if (harnessErrors.isNotEmpty()) phase = "harness-error"
        val target = checks.singleOrNull { it["kind"] == "target" }?.get("passed") == true
        val controls = checks.filter { it["kind"] != "target" }.all { it["passed"] == true }
        val receipt = linkedMapOf<String, Any?>(
            "schemaVersion" to 1, "phase" to phase, "pass" to (phase == "complete" && checks.size == 7 && controls && target),
            "checks" to checks, "captures" to captures, "skippedCases" to 0,
            "harnessErrors" to harnessErrors, "inconclusiveReasons" to inconclusiveReasons,
            "cleanupComplete" to cleanupComplete, "bitmapsCreated" to pixels.created, "bitmapsRecycled" to pixels.recycled,
            "scannerStates" to states, "publicErrors" to errors,
            "readyCallbacks" to ready, "scanCallbacks" to scans, "trackCallbacks" to tracks, "controlledFrameEvents" to frames,
            "physicalCameraClaim" to false, "nativePreviewClaim" to false, "providerOrDecoderClaim" to false,
            "scope" to "Actual detached Android View.measure/layout/draw with native-graphics software bitmaps; controlled frameListener input and uptime. No CameraX/MLKit admission, camera/provider/driver, native-preview pixels, phone or vendor-parity claim.",
        )
        val json = JSONObject(receipt).toString()
        File(output, "receipt.json").writeText(json + "\n", Charsets.UTF_8)
        println("ANDROID_RETAINED_LAYOUT_JSON $json")
        assertTrue("ANDROID_RETAINED_LAYOUT_HARNESS phase=$phase", phase == "complete" && cleanupComplete)
        assertTrue("ANDROID_RETAINED_LAYOUT_CONTROLS", checks.size == 7 && controls)
        assertTrue("ANDROID_RETAINED_LAYOUT_REPROJECTED", target)
    }

    private companion object {
        fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
