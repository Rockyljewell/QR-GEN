package dev.qrgen.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.annotation.ColorInt
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Task
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import dev.qrgen.Barcode
import dev.qrgen.ErrorCode
import dev.qrgen.FrameTransform
import dev.qrgen.GenerateOptions
import dev.qrgen.Generator
import dev.qrgen.QRGEN_VERSION
import dev.qrgen.QRGenException
import dev.qrgen.Symbology
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Entry point for the QRGen Android SDK: permission helper, still-image scanning and
 * generation. For live camera scanning use [QRGenScanner] or [QRGenScannerView].
 */
public object QRGen {
    /** SDK version. */
    public const val VERSION: String = QRGEN_VERSION

    /** The runtime permission the camera scanner needs. */
    public const val CAMERA_PERMISSION: String = Manifest.permission.CAMERA

    /** `true` when the app holds the camera permission. */
    @JvmStatic
    public fun hasCameraPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED

    /** Symbologies the Android scanner (ML Kit) can read. Other requested ids are skipped. */
    @JvmStatic
    public fun supportedSymbologies(): Set<Symbology> = MlKitFormats.SUPPORTED

    /** Symbologies [Generator] can write. */
    @JvmStatic
    public fun supportedGeneratorSymbologies(): Set<Symbology> = Generator.SUPPORTED

    /**
     * Scans a still image. Locations are in [bitmap] pixels. ([context] is not needed for
     * bitmaps; it is accepted for symmetry with the [Uri] overload and other platforms.)
     *
     * @throws QRGenException `unsupported` when none of [symbologies] can be read on Android,
     *   `engine-load-failed` / `unknown` when ML Kit fails.
     */
    @Suppress("UNUSED_PARAMETER")
    public suspend fun scanImage(
        context: Context,
        bitmap: Bitmap,
        symbologies: Set<Symbology> = Symbology.ALL,
    ): List<Barcode> = process(InputImage.fromBitmap(bitmap, 0), symbologies)

    /**
     * Scans an image file or content URI (gallery pick, share intent, camera capture). EXIF
     * rotation is applied; locations are in pixels of the upright image.
     *
     * @throws java.io.IOException when the image cannot be read.
     * @throws QRGenException see the [Bitmap] overload.
     */
    public suspend fun scanImage(
        context: Context,
        uri: Uri,
        symbologies: Set<Symbology> = Symbology.ALL,
    ): List<Barcode> {
        val app = context.applicationContext
        val image = withContext(Dispatchers.IO) { InputImage.fromFilePath(app, uri) }
        return process(image, symbologies)
    }

    /** Callback flavour of [scanImage] for Java callers. The callback runs on the main thread. */
    @JvmStatic
    @JvmOverloads
    public fun scanImageAsync(
        context: Context,
        bitmap: Bitmap,
        symbologies: Set<Symbology> = Symbology.ALL,
        callback: ImageScanCallback,
    ) {
        launchScan(callback) { scanImage(context, bitmap, symbologies) }
    }

    /** Callback flavour of [scanImage] for Java callers. The callback runs on the main thread. */
    @JvmStatic
    @JvmOverloads
    public fun scanImageAsync(
        context: Context,
        uri: Uri,
        symbologies: Set<Symbology> = Symbology.ALL,
        callback: ImageScanCallback,
    ) {
        launchScan(callback) { scanImage(context, uri, symbologies) }
    }

    /**
     * Generates a code as a [Bitmap] (see [Generator] for supported symbologies and options).
     *
     * @param scale pixels per module.
     */
    @JvmStatic
    @JvmOverloads
    public fun generateBitmap(
        data: String,
        symbology: Symbology = Symbology.QR,
        options: GenerateOptions = GenerateOptions(),
        scale: Int = 8,
        @ColorInt foreground: Int = Color.BLACK,
        @ColorInt background: Int = Color.WHITE,
    ): Bitmap = Generator.generate(data, symbology, options).toBitmap(scale, foreground, background)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private fun launchScan(callback: ImageScanCallback, block: suspend () -> List<Barcode>) {
        scope.launch {
            val result = try {
                Result.success(block())
            } catch (e: QRGenException) {
                Result.failure(e)
            } catch (e: Exception) {
                Result.failure(QRGenException(ErrorCode.UNKNOWN, e.message ?: e.toString(), e))
            }
            val error = result.exceptionOrNull() as QRGenException?
            callback.onResult(result.getOrNull(), error)
        }
    }

    private suspend fun process(image: InputImage, symbologies: Set<Symbology>): List<Barcode> {
        val formats = MlKitFormats.formatsFor(symbologies)
        if (formats.isEmpty()) {
            throw QRGenException(
                ErrorCode.UNSUPPORTED,
                "None of the requested symbologies can be read on Android: ${symbologies.joinToString(", ") { it.id }}",
            )
        }
        val size = FrameTransform.uprightSize(image.width, image.height, image.rotationDegrees)
        val scanner = BarcodeScanning.getClient(MlKitFormats.options(formats))
        try {
            val results = scanner.process(image).await()
            val timestamp = System.currentTimeMillis()
            return results.mapNotNull { BarcodeMapper.map(it, size, symbologies, timestamp) }
        } catch (e: MlKitException) {
            val code = if (e.errorCode == MlKitException.UNAVAILABLE) ErrorCode.ENGINE_LOAD_FAILED else ErrorCode.UNKNOWN
            throw QRGenException(code, e.message ?: "ML Kit barcode scanning failed", e)
        } finally {
            scanner.close()
        }
    }
}

/** Suspends until the Play Services task completes. */
internal suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnCompleteListener(DirectExecutor) { task ->
        val e = task.exception
        when {
            e != null -> cont.resumeWithException(e)
            task.isCanceled -> cont.cancel()
            else -> cont.resume(task.result)
        }
    }
}

private object DirectExecutor : java.util.concurrent.Executor {
    override fun execute(command: Runnable) = command.run()
}
