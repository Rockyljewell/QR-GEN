package dev.qrgen.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.View
import androidx.annotation.MainThread
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfoUnavailableException
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.mlkit.common.MlKitException
import dev.qrgen.Barcode
import dev.qrgen.BarcodeTracker
import dev.qrgen.BoundingBox
import dev.qrgen.DuplicateFilter
import dev.qrgen.ErrorCode
import dev.qrgen.FrameTransform
import dev.qrgen.QRGenException
import dev.qrgen.ScanArea
import dev.qrgen.ScannerOptions
import dev.qrgen.Size
import dev.qrgen.TrackedBarcode
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import com.google.mlkit.vision.barcode.common.Barcode as MlKitBarcode

/**
 * Camera barcode scanner: CameraX preview + ML Kit analysis, with SPEC §4 options
 * (single / continuous / batch, duplicate filter, scan area, beep, vibrate, torch).
 *
 * ```kotlin
 * val scanner = QRGenScanner(context, ScannerOptions(symbologies = Symbology.resolve("qr", "retail")))
 *     .onScan { barcodes -> show(barcodes.first().data) }
 *     .onError { error -> log(error.code) }
 * scanner.bind(viewLifecycleOwner, previewView) // starts scanning
 * ```
 *
 * Threading: call every method on the main thread. Listeners are invoked on the main thread.
 * Frames are analysed on a private background thread.
 *
 * Lifecycle: [bind] ties the camera to a [LifecycleOwner]. The camera follows the owner
 * (it stops in the background and resumes in the foreground) and the scanner [release]s itself
 * when the owner is destroyed. Create a new scanner for a new owner, or call [release] yourself
 * when you are done earlier.
 */
public class QRGenScanner @JvmOverloads constructor(
    context: Context,
    options: ScannerOptions = ScannerOptions(),
) {
    /** Scanner state. */
    public enum class State {
        /** Created, not bound yet. */
        IDLE,

        /** Waiting for the camera. */
        STARTING,

        /** Camera bound and frames being analysed. */
        RUNNING,

        /** Preview running, analysis paused ([pause], or after the first scan in single mode). */
        PAUSED,

        /** Camera unbound ([stop], or an error). */
        STOPPED,

        /** Resources released; the instance can no longer be used. */
        RELEASED,
    }

    /** One analysed frame, for overlays. */
    internal class FrameEvent(
        val barcodes: List<Barcode>,
        val tracked: List<TrackedBarcode>?,
        val frameSize: Size,
        val mirrored: Boolean,
        val fill: Boolean,
    )

    private val appContext: Context = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var currentOptions: ScannerOptions = options

    private var lifecycleOwner: LifecycleOwner? = null
    private var previewView: PreviewView? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var providerPending = false
    private var camera: Camera? = null
    private var preview: Preview? = null
    private var analysis: ImageAnalysis? = null
    private var analysisExecutor: ExecutorService? = null
    private var analyzer: BarcodeAnalyzer? = null

    private val duplicateFilter = DuplicateFilter(options.duplicateFilter)
    private val tracker = BarcodeTracker()
    private val feedback = ScanFeedback(appContext)
    private val singleShotDone = AtomicBoolean(false)

    // Geometry of the preview, read on the analysis thread for the scan area.
    @Volatile private var viewWidth = 0
    @Volatile private var viewHeight = 0
    @Volatile private var fillScale = true
    @Volatile private var mirrored = false

    private var started = false
    private var released = false
    private var lastError: ErrorCode? = null
    @Volatile private var analysisErrorReported = false

    private var scanListener: OnScanListener? = null
    private var trackListener: OnTrackListener? = null
    private var errorListener: OnErrorListener? = null
    private var readyListener: OnReadyListener? = null

    /** Frame callback for [QRGenScannerView]'s overlay (main thread). */
    internal var frameListener: ((FrameEvent) -> Unit)? = null

    /** Current state. */
    public var state: State = State.IDLE
        private set

    /**
     * The scanner options. Setting them applies the change immediately: symbologies and the
     * duplicate filter update in place, a camera change rebinds, torch toggles.
     */
    public var options: ScannerOptions
        get() = currentOptions
        @MainThread set(value) {
            checkMainThread()
            val old = currentOptions
            currentOptions = value
            applyOptions(old, value)
        }

    /** Sets the listener for scanned codes (SPEC `scan`). Returns this scanner for chaining. */
    public fun onScan(listener: OnScanListener?): QRGenScanner = apply { scanListener = listener }

    /** Sets the batch-mode tracking listener (SPEC `track`). */
    public fun onTrack(listener: OnTrackListener?): QRGenScanner = apply { trackListener = listener }

    /** Sets the error listener (SPEC `error`). */
    public fun onError(listener: OnErrorListener?): QRGenScanner = apply { errorListener = listener }

    /** Sets the ready listener (SPEC `ready`). */
    public fun onReady(listener: OnReadyListener?): QRGenScanner = apply { readyListener = listener }

    private val lifecycleObserver = object : DefaultLifecycleObserver {
        override fun onDestroy(owner: LifecycleOwner) {
            release()
        }
    }

    private val layoutListener = View.OnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
        updateViewGeometry(v as PreviewView)
    }

    private val cameraStateObserver = Observer<CameraState> { cameraState ->
        val error = cameraState.error
        if (error == null) {
            if (cameraState.type == CameraState.Type.OPEN) lastError = null
            return@Observer
        }
        val code = when (error.code) {
            CameraState.ERROR_CAMERA_IN_USE, CameraState.ERROR_MAX_CAMERAS_IN_USE -> ErrorCode.CAMERA_IN_USE
            CameraState.ERROR_CAMERA_DISABLED -> ErrorCode.CAMERA_PERMISSION_DENIED
            else -> ErrorCode.UNKNOWN
        }
        val message = when (error.code) {
            CameraState.ERROR_CAMERA_IN_USE -> "The camera is in use by another app"
            CameraState.ERROR_MAX_CAMERAS_IN_USE -> "Too many cameras are open"
            CameraState.ERROR_CAMERA_DISABLED -> "The camera is disabled by device policy"
            CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "The camera is unavailable in Do Not Disturb mode"
            CameraState.ERROR_STREAM_CONFIG -> "The camera could not be configured"
            CameraState.ERROR_CAMERA_FATAL_ERROR -> "The camera stopped with a fatal error"
            else -> "Camera error ${error.code}"
        }
        emitError(code, message, error.cause, dedupe = true)
    }

    // ---- binding ----------------------------------------------------------------------------

    /**
     * Binds the camera to [lifecycleOwner] and starts scanning. With a [previewView] the camera
     * image is shown there; without one the scanner analyses frames headlessly (a custom UI can
     * draw [Barcode.location]s itself).
     *
     * If the camera permission is missing, `onError(camera-permission-denied)` is called; call
     * [start] again once it has been granted.
     */
    @MainThread
    @JvmOverloads
    public fun bind(lifecycleOwner: LifecycleOwner, previewView: PreviewView? = null) {
        checkMainThread()
        check(!released) { "This QRGenScanner was released; create a new one" }
        if (lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) return
        if (this.lifecycleOwner !== lifecycleOwner) {
            unbindUseCases()
            this.lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
            this.lifecycleOwner = lifecycleOwner
            lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
        }
        if (this.previewView !== previewView) {
            unbindUseCases()
            this.previewView?.removeOnLayoutChangeListener(layoutListener)
            this.previewView = previewView
            if (previewView != null) {
                previewView.addOnLayoutChangeListener(layoutListener)
                updateViewGeometry(previewView)
            } else {
                viewWidth = 0
                viewHeight = 0
            }
        }
        start()
    }

    /**
     * Starts (or restarts) scanning: binds the camera if needed, resumes analysis, and starts a
     * new session (the duplicate filter and batch tracks are reset). No-op before [bind].
     */
    @MainThread
    public fun start() {
        checkMainThread()
        if (released) return
        started = true
        singleShotDone.set(false)
        duplicateFilter.reset()
        tracker.reset()
        analyzer?.paused = false
        val owner = lifecycleOwner ?: return
        if (!QRGen.hasCameraPermission(appContext)) {
            state = State.STOPPED
            emitError(
                ErrorCode.CAMERA_PERMISSION_DENIED,
                "Camera permission not granted. Request ${QRGen.CAMERA_PERMISSION} and call start() again.",
            )
            return
        }
        warnIfNothingSupported(currentOptions)
        if (camera != null && analysis != null) {
            state = State.RUNNING
            return
        }
        state = State.STARTING
        withCameraProvider { provider -> bindUseCases(provider, owner) }
    }

    /** Stops the camera (unbinds preview and analysis). [start] binds it again. */
    @MainThread
    public fun stop() {
        checkMainThread()
        started = false
        unbindUseCases()
        if (!released) state = State.STOPPED
    }

    /** Pauses analysis; the preview keeps running. */
    @MainThread
    public fun pause() {
        checkMainThread()
        analyzer?.paused = true
        if (state == State.RUNNING) state = State.PAUSED
    }

    /** Resumes analysis after [pause] or after a single-mode scan. */
    @MainThread
    public fun resume() {
        checkMainThread()
        singleShotDone.set(false)
        analyzer?.paused = false
        if (state == State.PAUSED) state = State.RUNNING
    }

    /**
     * Turns the torch on or off. Returns `false` when there is no bound camera or it has no
     * flash unit. The choice is remembered in [options] and re-applied after rebinding.
     */
    @MainThread
    public fun setTorch(enabled: Boolean): Boolean {
        checkMainThread()
        currentOptions = currentOptions.copy(torch = enabled)
        return applyTorch(enabled)
    }

    /** `true` when the bound camera has a flash unit. */
    public val hasTorch: Boolean get() = camera?.cameraInfo?.hasFlashUnit() == true

    /** `true` when the torch is on. */
    public val isTorchOn: Boolean get() = camera?.cameraInfo?.torchState?.value == TorchState.ON

    /** Switches between the back and front camera (rebinding the camera). */
    @MainThread
    public fun switchCamera() {
        val o = currentOptions
        options = o.copy(
            camera = if (o.camera == ScannerOptions.Camera.BACK) ScannerOptions.Camera.FRONT else ScannerOptions.Camera.BACK,
            cameraId = null,
        )
    }

    /** Sets the zoom ratio, clamped to [minZoomRatio]..[maxZoomRatio]. */
    @MainThread
    public fun setZoomRatio(ratio: Float) {
        checkMainThread()
        val cam = camera ?: return
        val zoom = cam.cameraInfo.zoomState.value
        val clamped = if (zoom != null) ratio.coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio) else ratio
        cam.cameraControl.setZoomRatio(clamped)
    }

    /** Current zoom ratio (1 when unknown). */
    public val zoomRatio: Float get() = camera?.cameraInfo?.zoomState?.value?.zoomRatio ?: 1f

    /** Minimum zoom ratio of the bound camera (1 when unknown). */
    public val minZoomRatio: Float get() = camera?.cameraInfo?.zoomState?.value?.minZoomRatio ?: 1f

    /** Maximum zoom ratio of the bound camera (1 when unknown). */
    public val maxZoomRatio: Float get() = camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 1f

    /** `true` when the bound camera faces the user (previews are mirrored). */
    public val isFrontFacing: Boolean get() = mirrored

    /**
     * Unbinds the camera, closes the ML Kit scanner, shuts down the analysis thread and releases
     * the tone generator. Idempotent. Called automatically when the bound lifecycle is destroyed.
     */
    @MainThread
    public fun release() {
        if (released) return
        checkMainThread()
        stop()
        released = true
        state = State.RELEASED
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        previewView?.removeOnLayoutChangeListener(layoutListener)
        previewView = null
        analyzer?.close()
        analyzer = null
        analysisExecutor?.shutdown()
        analysisExecutor = null
        feedback.release()
        mainHandler.removeCallbacksAndMessages(null)
        scanListener = null
        trackListener = null
        errorListener = null
        readyListener = null
        frameListener = null
    }

    // ---- internals --------------------------------------------------------------------------

    private fun withCameraProvider(block: (ProcessCameraProvider) -> Unit) {
        cameraProvider?.let {
            block(it)
            return
        }
        if (providerPending) return
        providerPending = true
        val future = ProcessCameraProvider.getInstance(appContext)
        future.addListener({
            providerPending = false
            if (released) return@addListener
            val provider = try {
                future.get()
            } catch (e: Exception) {
                state = State.STOPPED
                emitError(ErrorCode.CAMERA_NOT_FOUND, "Could not initialise the camera: ${e.cause?.message ?: e.message}", e)
                return@addListener
            }
            cameraProvider = provider
            val owner = lifecycleOwner
            if (started && owner != null) bindUseCases(provider, owner)
        }, ContextCompat.getMainExecutor(appContext))
    }

    @OptIn(ExperimentalCamera2Interop::class)
    private fun cameraSelector(o: ScannerOptions): CameraSelector {
        val id = o.cameraId
        if (!id.isNullOrEmpty()) {
            return CameraSelector.Builder()
                .addCameraFilter { infos -> infos.filter { Camera2CameraInfo.from(it).cameraId == id } }
                .build()
        }
        return if (o.camera == ScannerOptions.Camera.FRONT) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    }

    private fun bindUseCases(provider: ProcessCameraProvider, owner: LifecycleOwner) {
        if (released || !started) return
        if (owner.lifecycle.currentState == Lifecycle.State.DESTROYED) return
        unbindUseCases()
        val opts = currentOptions
        val selector = cameraSelector(opts)
        val available = try {
            provider.hasCamera(selector)
        } catch (_: CameraInfoUnavailableException) {
            false
        }
        if (!available) {
            state = State.STOPPED
            val which = opts.cameraId?.let { "camera '$it'" } ?: "${opts.camera.id} camera"
            emitError(ErrorCode.CAMERA_NOT_FOUND, "No $which is available on this device")
            return
        }

        val rotation = previewView?.display?.rotation ?: Surface.ROTATION_0
        // Preview and analysis share the 4:3 sensor aspect ratio so frame coordinates map onto
        // the preview with a plain center-crop transform.
        val aspect = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
        val newPreview = previewView?.let { pv ->
            Preview.Builder()
                .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspect).build())
                .setTargetRotation(rotation)
                .build()
                .also { it.setSurfaceProvider(pv.surfaceProvider) }
        }
        val executor = analysisExecutor ?: Executors.newSingleThreadExecutor { r ->
            Thread(r, "qrgen-analysis").apply { isDaemon = true }
        }.also { analysisExecutor = it }
        val an = analyzer ?: BarcodeAnalyzer(NeverRejectExecutor(executor), ::onFrame, ::onAnalysisFailure).also { analyzer = it }
        an.symbologies = opts.symbologies
        val newAnalysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(aspect)
                    .setResolutionStrategy(
                        ResolutionStrategy(ANALYSIS_RESOLUTION, ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                    )
                    .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .setTargetRotation(rotation)
            .build()
        newAnalysis.setAnalyzer(executor, an)

        val useCases: Array<UseCase> = listOfNotNull<UseCase>(newPreview, newAnalysis).toTypedArray()
        val bound = try {
            provider.bindToLifecycle(owner, selector, *useCases)
        } catch (e: IllegalArgumentException) {
            newAnalysis.clearAnalyzer()
            state = State.STOPPED
            emitError(ErrorCode.CAMERA_NOT_FOUND, e.message ?: "No camera matches the selection", e)
            return
        } catch (e: IllegalStateException) {
            newAnalysis.clearAnalyzer()
            state = State.STOPPED
            emitError(ErrorCode.UNKNOWN, e.message ?: "Could not bind the camera", e)
            return
        }
        camera = bound
        preview = newPreview
        analysis = newAnalysis
        mirrored = bound.cameraInfo.lensFacing == CameraSelector.LENS_FACING_FRONT
        bound.cameraInfo.cameraState.observe(owner, cameraStateObserver)
        if (opts.torch) applyTorch(true)
        state = if (an.paused) State.PAUSED else State.RUNNING
        readyListener?.onReady()
    }

    private fun unbindUseCases() {
        camera?.cameraInfo?.cameraState?.removeObserver(cameraStateObserver)
        analysis?.clearAnalyzer()
        val useCases = listOfNotNull<UseCase>(preview, analysis)
        val provider = cameraProvider
        if (provider != null && useCases.isNotEmpty()) provider.unbind(*useCases.toTypedArray())
        camera = null
        preview = null
        analysis = null
    }

    private fun applyTorch(enabled: Boolean): Boolean {
        val cam = camera ?: return false
        if (!cam.cameraInfo.hasFlashUnit()) return false
        cam.cameraControl.enableTorch(enabled)
        return true
    }

    private fun applyOptions(old: ScannerOptions, new: ScannerOptions) {
        duplicateFilter.windowMs = new.duplicateFilter
        analyzer?.symbologies = new.symbologies
        if (old.symbologies != new.symbologies) warnIfNothingSupported(new)
        if (old.mode != new.mode) {
            tracker.reset()
            singleShotDone.set(false)
            analyzer?.paused = false
            if (state == State.PAUSED) state = State.RUNNING
        }
        val owner = lifecycleOwner
        if (old.camera != new.camera || old.cameraId != new.cameraId) {
            if (started && owner != null && !released) {
                val provider = cameraProvider
                if (provider != null) bindUseCases(provider, owner) else withCameraProvider { bindUseCases(it, owner) }
            }
        } else if (old.torch != new.torch) {
            applyTorch(new.torch)
        }
    }

    private fun warnIfNothingSupported(o: ScannerOptions) {
        if (MlKitFormats.formatsFor(o.symbologies).isEmpty()) {
            emitError(
                ErrorCode.UNSUPPORTED,
                "None of the requested symbologies can be read on Android: " +
                    o.symbologies.joinToString(", ") { it.id } +
                    ". Supported: " + MlKitFormats.SUPPORTED.joinToString(", ") { it.id },
            )
        }
    }

    private fun updateViewGeometry(view: PreviewView) {
        viewWidth = view.width
        viewHeight = view.height
        fillScale = when (view.scaleType) {
            PreviewView.ScaleType.FIT_CENTER, PreviewView.ScaleType.FIT_START, PreviewView.ScaleType.FIT_END -> false
            else -> true
        }
        view.display?.rotation?.let { r -> analysis?.targetRotation = r }
    }

    /** Scan area in frame pixels, or `null` for the whole frame. Analysis thread. */
    private fun regionOfInterest(area: ScanArea, frame: Size): BoundingBox? {
        if (area.isFull || frame.isEmpty) return null
        val w = viewWidth
        val h = viewHeight
        if (w <= 0 || h <= 0) return area.toBoundingBox(frame.width, frame.height)
        val scale = if (fillScale) FrameTransform.ScaleType.FILL_CENTER else FrameTransform.ScaleType.FIT_CENTER
        return FrameTransform(frame.width, frame.height, w, h, scale, mirrored).scanAreaToFrame(area)
    }

    /** ML Kit results for one frame. Runs on the analysis thread. */
    private fun onFrame(results: List<MlKitBarcode>, frame: Size, timestamp: Long) {
        analysisErrorReported = false
        val opts = currentOptions
        var barcodes = results.mapNotNull { BarcodeMapper.map(it, frame, opts.symbologies, timestamp) }
        val roi = regionOfInterest(opts.scanArea, frame)
        if (roi != null) {
            barcodes = barcodes.filter { b -> b.location.isEmpty || b.location.center.let { roi.contains(it.x, it.y) } }
        }
        val max = opts.resolvedMaxResults
        if (barcodes.size > max) {
            val cx = roi?.center?.x ?: (frame.width / 2f)
            val cy = roi?.center?.y ?: (frame.height / 2f)
            barcodes = barcodes.sortedBy { b ->
                val c = b.location.center
                (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy)
            }.take(max)
        }
        val mirror = mirrored
        val fill = fillScale
        when (opts.mode) {
            ScannerOptions.Mode.BATCH -> {
                val update = tracker.update(barcodes, timestamp)
                val fresh = duplicateFilter.filter(update.added.map { it.barcode }, timestamp)
                postToMain {
                    frameListener?.invoke(FrameEvent(barcodes, update.tracked, frame, mirror, fill))
                    trackListener?.onTrack(update.tracked)
                    if (fresh.isNotEmpty()) deliverScan(fresh)
                }
            }
            ScannerOptions.Mode.SINGLE -> {
                val fresh = if (singleShotDone.get()) emptyList() else duplicateFilter.filter(barcodes, timestamp)
                val report = fresh.isNotEmpty() && singleShotDone.compareAndSet(false, true)
                if (report) analyzer?.paused = true
                postToMain {
                    frameListener?.invoke(FrameEvent(barcodes, null, frame, mirror, fill))
                    if (report) {
                        if (state == State.RUNNING) state = State.PAUSED
                        deliverScan(fresh)
                    }
                }
            }
            ScannerOptions.Mode.CONTINUOUS -> {
                val fresh = duplicateFilter.filter(barcodes, timestamp)
                postToMain {
                    frameListener?.invoke(FrameEvent(barcodes, null, frame, mirror, fill))
                    if (fresh.isNotEmpty()) deliverScan(fresh)
                }
            }
        }
    }

    private fun onAnalysisFailure(e: Exception) {
        // Report the first failure of a streak only; analysis keeps running.
        if (analysisErrorReported) return
        analysisErrorReported = true
        val code = if (e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE) ErrorCode.ENGINE_LOAD_FAILED else ErrorCode.UNKNOWN
        postToMain { emitError(code, "Barcode analysis failed: ${e.message}", e) }
    }

    private fun deliverScan(barcodes: List<Barcode>) {
        val o = currentOptions
        if (o.beep) feedback.beep()
        if (o.vibrate) feedback.vibrate()
        scanListener?.onScan(barcodes)
    }

    private fun emitError(code: ErrorCode, message: String, cause: Throwable? = null, dedupe: Boolean = false) {
        if (dedupe && lastError == code) return
        lastError = code
        val error = QRGenException(code, message, cause)
        if (Looper.myLooper() == Looper.getMainLooper()) errorListener?.onError(error) else postToMain { errorListener?.onError(error) }
    }

    private fun postToMain(block: () -> Unit) {
        mainHandler.post { if (!released) block() }
    }

    private fun checkMainThread() {
        check(Looper.myLooper() == Looper.getMainLooper()) { "QRGenScanner must be used on the main thread" }
    }

    private companion object {
        /** 4:3 analysis resolution: enough for small 1D codes, cheap enough for 30 fps. */
        val ANALYSIS_RESOLUTION = android.util.Size(1280, 960)
    }
}
