// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import dev.qrgen.FrameTransform
import dev.qrgen.Size
import dev.qrgen.Symbology
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import com.google.mlkit.vision.barcode.common.Barcode as MlKitBarcode

/**
 * CameraX analyzer that runs ML Kit on every frame (one at a time, with
 * `STRATEGY_KEEP_ONLY_LATEST`). Every [ImageProxy] is closed exactly once, after ML Kit is done
 * with it or immediately when the frame is skipped.
 *
 * [executor] must be the analysis executor (a single thread): the ML Kit client is created,
 * used and closed only there.
 */
internal class BarcodeAnalyzer(
    private val executor: Executor,
    private val onFrame: (barcodes: List<MlKitBarcode>, frame: Size, timestamp: Long) -> Unit,
    private val onFailure: (Exception) -> Unit,
) : ImageAnalysis.Analyzer {

    /** When `true`, frames are closed without analysis (preview keeps running). */
    @Volatile
    var paused: Boolean = false

    /** The requested symbologies; the ML Kit client is recreated when the formats change. */
    @Volatile
    var symbologies: Set<Symbology> = Symbology.ALL

    private val closed = AtomicBoolean(false)
    private var client: BarcodeScanner? = null
    private var clientFormats: IntArray? = null

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(image: ImageProxy) {
        if (paused || closed.get()) {
            image.close()
            return
        }
        val media = image.image
        if (media == null) {
            image.close()
            return
        }
        var handedOff = false
        try {
            val scanner = clientFor(symbologies)
            if (scanner == null) return
            val rotation = image.imageInfo.rotationDegrees
            val frame = FrameTransform.uprightSize(image.width, image.height, rotation)
            val timestamp = System.currentTimeMillis()
            val input = InputImage.fromMediaImage(media, rotation)
            scanner.process(input)
                .addOnSuccessListener(executor) { list -> if (!closed.get() && !paused) onFrame(list, frame, timestamp) }
                .addOnFailureListener(executor) { e -> if (!closed.get()) onFailure(e) }
                .addOnCompleteListener(executor) { image.close() }
            handedOff = true
        } catch (e: Exception) {
            onFailure(e)
        } finally {
            if (!handedOff) image.close()
        }
    }

    private fun clientFor(requested: Set<Symbology>): BarcodeScanner? {
        val formats = MlKitFormats.formatsFor(requested)
        if (formats.isEmpty()) return null
        val current = client
        if (current != null && formats.contentEquals(clientFormats)) return current
        current?.close()
        return BarcodeScanning.getClient(MlKitFormats.options(formats)).also {
            client = it
            clientFormats = formats
        }
    }

    /** Stops analysis and releases the ML Kit client on the analysis thread. Idempotent. */
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        executor.execute {
            client?.close()
            client = null
            clientFormats = null
        }
    }
}

/**
 * Wraps an executor so work submitted after shutdown still runs (inline). ML Kit completion
 * callbacks close ImageProxy instances, so they must never be dropped.
 */
internal class NeverRejectExecutor(private val delegate: Executor) : Executor {
    override fun execute(command: Runnable) {
        try {
            delegate.execute(command)
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            command.run()
        }
    }
}
