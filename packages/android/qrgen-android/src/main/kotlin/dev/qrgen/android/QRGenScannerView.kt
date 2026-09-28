// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import android.content.Context
import android.util.AttributeSet
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.ColorInt
import androidx.annotation.MainThread
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import dev.qrgen.Barcode
import dev.qrgen.ScannerOptions
import dev.qrgen.Symbology

/**
 * Drop-in scanner UI: a CameraX [PreviewView] plus an overlay with a rounded corner-bracket
 * viewfinder (or an aiming line for 1D codes), outlines of detected codes, and a success pill.
 *
 * ```kotlin
 * val view = findViewById<QRGenScannerView>(R.id.scanner)
 * view.options = ScannerOptions(symbologies = Symbology.resolve("qr", "retail"))
 * view.onScan { barcodes -> Log.i("scan", barcodes.first().data) }
 * view.bind(this) // Activity, Fragment.viewLifecycleOwner, ...
 * ```
 *
 * Optional XML attributes (`app:` namespace): `qrgen_accentColor`, `qrgen_viewfinder`
 * (`auto|frame|line|none`), `qrgen_symbologies` (`"qr,retail"`), `qrgen_mode`
 * (`single|continuous|batch`), `qrgen_beep`, `qrgen_vibrate`, `qrgen_showToast`,
 * `qrgen_showHighlights`, `qrgen_dimBackground`.
 *
 * All methods must be called on the main thread; listeners run on the main thread.
 */
public class QRGenScannerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {

    /** The camera preview. Its scale type (default `FILL_CENTER`) is honoured by the overlay. */
    public val previewView: PreviewView = PreviewView(context).apply {
        scaleType = PreviewView.ScaleType.FILL_CENTER
        contentDescription = context.getString(R.string.qrgen_scanner_description)
    }

    private val overlay = ScannerOverlayView(context)
    private var controller: QRGenScanner? = null
    private var pendingOptions: ScannerOptions = ScannerOptions()

    private var scanListener: OnScanListener? = null
    private var trackListener: OnTrackListener? = null
    private var errorListener: OnErrorListener? = null
    private var readyListener: OnReadyListener? = null

    /** Builds the text of the success pill. Default: the data of a single code, or a count. */
    public var toastText: (List<Barcode>) -> String = { barcodes ->
        if (barcodes.size == 1) barcodes[0].data.replace('\n', ' ')
        else resources.getQuantityString(R.plurals.qrgen_scanned_many, barcodes.size, barcodes.size)
    }

    init {
        addView(previewView, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        addView(overlay, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (attrs != null) readAttributes(context, attrs, defStyleAttr)
        applyOverlayOptions(pendingOptions)
    }

    private fun readAttributes(context: Context, attrs: AttributeSet, defStyleAttr: Int) {
        val a = context.obtainStyledAttributes(attrs, R.styleable.QRGenScannerView, defStyleAttr, 0)
        try {
            overlay.accentColor = a.getColor(R.styleable.QRGenScannerView_qrgen_accentColor, ScannerOverlayView.DEFAULT_ACCENT)
            overlay.showToast = a.getBoolean(R.styleable.QRGenScannerView_qrgen_showToast, true)
            overlay.showHighlights = a.getBoolean(R.styleable.QRGenScannerView_qrgen_showHighlights, true)
            overlay.dimBackground = a.getBoolean(R.styleable.QRGenScannerView_qrgen_dimBackground, true)
            var o = pendingOptions
            a.getString(R.styleable.QRGenScannerView_qrgen_symbologies)?.let { o = o.copy(symbologies = Symbology.resolve(listOf(it))) }
            if (a.hasValue(R.styleable.QRGenScannerView_qrgen_mode)) {
                o = o.copy(mode = ScannerOptions.Mode.entries[a.getInt(R.styleable.QRGenScannerView_qrgen_mode, 1).coerceIn(0, 2)])
            }
            o = o.copy(
                beep = a.getBoolean(R.styleable.QRGenScannerView_qrgen_beep, o.beep),
                vibrate = a.getBoolean(R.styleable.QRGenScannerView_qrgen_vibrate, o.vibrate),
            )
            when (a.getInt(R.styleable.QRGenScannerView_qrgen_viewfinder, 0)) {
                1 -> o = o.copy(viewfinder = ScannerOptions.Viewfinder.FRAME)
                2 -> o = o.copy(viewfinder = ScannerOptions.Viewfinder.LINE)
                3 -> o = o.copy(viewfinder = ScannerOptions.Viewfinder.NONE)
            }
            pendingOptions = o
        } finally {
            a.recycle()
        }
    }

    /**
     * Scanner options (SPEC §4). Can be changed at any time, before or after [bind]. Reading
     * returns the last options set here, including changes made through [setTorch] and
     * [switchCamera].
     */
    public var options: ScannerOptions
        get() = pendingOptions
        @MainThread set(value) {
            pendingOptions = value
            controller?.options = value
            applyOverlayOptions(value)
        }

    /** Accent color of the viewfinder, highlights and pill icon. Default teal `#2EC1CE`. */
    @get:ColorInt
    public var accentColor: Int
        get() = overlay.accentColor
        set(@ColorInt value) {
            overlay.accentColor = value
        }

    /** Show the success pill after a scan. */
    public var showToast: Boolean
        get() = overlay.showToast
        set(value) {
            overlay.showToast = value
        }

    /** Outline detected codes. */
    public var showHighlights: Boolean
        get() = overlay.showHighlights
        set(value) {
            overlay.showHighlights = value
            if (!value) overlay.clearDetections()
        }

    /** Dim the preview outside the viewfinder. */
    public var dimBackground: Boolean
        get() = overlay.dimBackground
        set(value) {
            overlay.dimBackground = value
        }

    /** The scanner controller, available after [bind] (for torch, zoom, state, ...). */
    public val scanner: QRGenScanner? get() = controller

    /**
     * Starts the camera for [lifecycleOwner] (an Activity, `Fragment.viewLifecycleOwner`, ...).
     * The scanner stops with the owner and is released when it is destroyed; calling [bind]
     * again later creates a fresh scanner.
     */
    @MainThread
    public fun bind(lifecycleOwner: LifecycleOwner): QRGenScanner {
        val existing = controller?.takeIf { it.state != QRGenScanner.State.RELEASED }
        val c = existing ?: QRGenScanner(context, pendingOptions).also {
            controller = it
            wire(it)
        }
        c.bind(lifecycleOwner, previewView)
        return c
    }

    private fun wire(c: QRGenScanner) {
        c.onScan { barcodes ->
            val text = toastText(barcodes)
            overlay.showToast(text, context.getString(R.string.qrgen_scanned_one, text))
            scanListener?.onScan(barcodes)
        }
        c.onTrack { tracked -> trackListener?.onTrack(tracked) }
        c.onError { error -> errorListener?.onError(error) }
        c.onReady { readyListener?.onReady() }
        c.frameListener = { event ->
            val quads = event.tracked?.map { it.location } ?: event.barcodes.map { it.location }
            overlay.showDetections(quads, event.frameSize, event.mirrored, event.fill)
        }
    }

    private fun applyOverlayOptions(o: ScannerOptions) {
        overlay.viewfinder = o.resolvedViewfinder
        overlay.scanArea = o.scanArea
    }

    /** Listener for scanned codes. */
    public fun onScan(listener: OnScanListener?): QRGenScannerView = apply { scanListener = listener }

    /** Listener for batch-mode tracks. */
    public fun onTrack(listener: OnTrackListener?): QRGenScannerView = apply { trackListener = listener }

    /** Listener for errors (permission, camera, engine). */
    public fun onError(listener: OnErrorListener?): QRGenScannerView = apply { errorListener = listener }

    /** Listener for the camera being ready. */
    public fun onReady(listener: OnReadyListener?): QRGenScannerView = apply { readyListener = listener }

    /** See [QRGenScanner.start]. */
    @MainThread
    public fun start() {
        controller?.start()
    }

    /** See [QRGenScanner.stop]. */
    @MainThread
    public fun stop() {
        controller?.stop()
        overlay.clearDetections()
    }

    /** See [QRGenScanner.pause]. */
    @MainThread
    public fun pause() {
        controller?.pause()
    }

    /** See [QRGenScanner.resume]. */
    @MainThread
    public fun resume() {
        controller?.resume()
    }

    /** See [QRGenScanner.setTorch]. The choice is kept in [options]. */
    @MainThread
    public fun setTorch(enabled: Boolean): Boolean {
        pendingOptions = pendingOptions.copy(torch = enabled)
        return controller?.setTorch(enabled) ?: false
    }

    /** Switches between the back and front camera (updates [options]). */
    @MainThread
    public fun switchCamera() {
        val o = pendingOptions
        options = o.copy(
            camera = if (o.camera == ScannerOptions.Camera.BACK) ScannerOptions.Camera.FRONT else ScannerOptions.Camera.BACK,
            cameraId = null,
        )
    }

    /** See [QRGenScanner.setZoomRatio]. */
    @MainThread
    public fun setZoomRatio(ratio: Float) {
        controller?.setZoomRatio(ratio)
    }

    /** Releases the scanner now instead of waiting for the lifecycle to be destroyed. */
    @MainThread
    public fun release() {
        controller?.release()
        controller = null
        overlay.clearDetections()
    }
}
