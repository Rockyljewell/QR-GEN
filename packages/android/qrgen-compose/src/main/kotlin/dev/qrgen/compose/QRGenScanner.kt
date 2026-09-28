// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.compose

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.qrgen.Barcode
import dev.qrgen.QRGenException
import dev.qrgen.ScannerOptions
import dev.qrgen.TrackedBarcode
import dev.qrgen.android.QRGenScannerView
import dev.qrgen.android.QRGenScanner as QRGenScannerController

/** Defaults for [QRGenScanner]. */
public object QRGenDefaults {
    /** QRGen teal, `#2EC1CE`. */
    public val AccentColor: Color = Color(0xFF2EC1CE)
}

/**
 * Controls a [QRGenScanner] composable: torch, pause/resume, camera switch and zoom.
 * Create it with [rememberQRGenScannerState].
 */
@Stable
public class QRGenScannerState internal constructor() {
    private var view: QRGenScannerView? = null

    /** `true` while the torch is on (as requested through [setTorch]). */
    public var isTorchOn: Boolean by mutableStateOf(false)
        private set

    /** Camera currently selected through [switchCamera], or `null` to follow the options. */
    public var camera: ScannerOptions.Camera? by mutableStateOf(null)
        private set

    // Torch requested through setTorch; overrides ScannerOptions.torch so recomposition with the
    // caller's (unchanged) options does not undo it.
    internal var torchOverride: Boolean? by mutableStateOf(null)

    /** `true` while analysis is paused through [pause]. */
    public var isPaused: Boolean by mutableStateOf(false)
        private set

    /** The underlying controller once the scanner is on screen, else `null`. */
    public val scanner: QRGenScannerController? get() = view?.scanner

    /** Turns the torch on or off; returns `false` when the camera has no torch. */
    public fun setTorch(enabled: Boolean): Boolean {
        torchOverride = enabled
        val ok = view?.setTorch(enabled) ?: false
        isTorchOn = ok && enabled
        return ok
    }

    /** Pauses analysis (the preview keeps running). */
    public fun pause() {
        view?.pause()
        isPaused = true
    }

    /** Resumes analysis, also after a single-mode scan. */
    public fun resume() {
        view?.resume()
        isPaused = false
    }

    /** Switches between the back and front camera. */
    public fun switchCamera() {
        val current = camera ?: view?.options?.camera ?: ScannerOptions.Camera.BACK
        camera = if (current == ScannerOptions.Camera.BACK) ScannerOptions.Camera.FRONT else ScannerOptions.Camera.BACK
        view?.switchCamera()
        isTorchOn = false
        torchOverride = null
    }

    /** Applies the state's torch and camera choices on top of the caller's options. */
    internal fun effective(options: ScannerOptions): ScannerOptions {
        val torch = torchOverride ?: options.torch
        val cam = camera
        return if (torch == options.torch && (cam == null || cam == options.camera)) options
        else options.copy(torch = torch, camera = cam ?: options.camera, cameraId = if (cam != null) null else options.cameraId)
    }

    /** Sets the zoom ratio (clamped to what the camera supports). */
    public fun setZoomRatio(ratio: Float) {
        view?.setZoomRatio(ratio)
    }

    internal fun attach(v: QRGenScannerView) {
        view = v
    }

    internal fun detach(v: QRGenScannerView) {
        if (view === v) view = null
        isTorchOn = false
        isPaused = false
    }
}

/** Remembers a [QRGenScannerState] across recompositions. */
@Composable
public fun rememberQRGenScannerState(): QRGenScannerState = remember { QRGenScannerState() }

/**
 * Full-bleed camera barcode scanner for Jetpack Compose (CameraX + ML Kit), with the QRGen
 * viewfinder, detection outlines and success pill.
 *
 * The composable does not request the camera permission; request it first (see README) or
 * handle `camera-permission-denied` in [onError]. The camera follows the current
 * `LocalLifecycleOwner` and is released when the composable leaves the composition.
 *
 * ```kotlin
 * QRGenScanner(
 *     options = ScannerOptions(symbologies = Symbology.resolve("qr", "retail")),
 *     onScan = { barcodes -> result = barcodes.first().data },
 *     onError = { error -> message = error.message },
 *     modifier = Modifier.fillMaxSize(),
 * )
 * ```
 *
 * @param options scanner options (SPEC §4); changes are applied live. Pass `ScannerOptions()`
 *   for the defaults.
 * @param onScan newly scanned codes (after the duplicate filter).
 * @param onError errors with SPEC codes (`camera-permission-denied`, `camera-not-found`, ...).
 * @param modifier layout modifier.
 * @param onTrack batch-mode tracks, every frame.
 * @param state torch / pause / zoom control.
 * @param accentColor viewfinder and highlight color.
 * @param showToast show the success pill after a scan.
 */
@Composable
public fun QRGenScanner(
    options: ScannerOptions,
    onScan: (List<Barcode>) -> Unit,
    onError: (QRGenException) -> Unit,
    modifier: Modifier = Modifier,
    onTrack: ((List<TrackedBarcode>) -> Unit)? = null,
    state: QRGenScannerState = rememberQRGenScannerState(),
    accentColor: Color = QRGenDefaults.AccentColor,
    showToast: Boolean = true,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val effectiveOptions = state.effective(options)
    val currentOnScan by rememberUpdatedState(onScan)
    val currentOnError by rememberUpdatedState(onError)
    val currentOnTrack by rememberUpdatedState(onTrack)

    AndroidView(
        factory = { context ->
            QRGenScannerView(context).apply {
                this.options = effectiveOptions
                this.accentColor = accentColor.toArgb()
                this.showToast = showToast
                onScan { currentOnScan(it) }
                onError { currentOnError(it) }
                onTrack { currentOnTrack?.invoke(it) }
                bind(lifecycleOwner)
                state.attach(this)
            }
        },
        modifier = modifier,
        onRelease = { view ->
            state.detach(view)
            view.release()
        },
        update = { view ->
            if (view.options != effectiveOptions) view.options = effectiveOptions
            view.accentColor = accentColor.toArgb()
            view.showToast = showToast
        },
    )
}
