// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.BarcodeTracker
import dev.qrgen.DuplicateFilter
import dev.qrgen.ScannerOptions
import dev.qrgen.TrackedBarcode

/**
 * A decode keeps the options and processing epoch present when ML Kit accepted its image.
 * Camera ownership is independent: pausing or changing scan settings rejects queued output
 * without clearing the spatial tracks of the current camera.
 *
 * Capture/epoch operations are thread-safe. Delivery and result-state resets run on main;
 * no application callback is invoked while the epoch lock is held.
 */
internal class ProcessingSession(initialOptions: ScannerOptions) {
    data class Frame(val epoch: Long, val options: ScannerOptions)

    private val lock = Any()
    private var epoch = 0L
    private var paused = false
    private var currentOptions = initialOptions
    private val duplicateFilter = DuplicateFilter(initialOptions.duplicateFilter)
    private val tracker = BarcodeTracker()
    private val pendingBatchScans = HashSet<Int>()
    private var singleShotDone = false

    val options: ScannerOptions get() = synchronized(lock) { currentOptions }

    val tracked: List<TrackedBarcode> get() = tracker.tracked

    fun capture(): Frame? = synchronized(lock) {
        if (paused) null else Frame(epoch, currentOptions)
    }

    fun isCurrent(frame: Frame): Boolean = synchronized(lock) {
        !paused && frame.epoch == epoch
    }

    fun updateOptions(value: ScannerOptions) = synchronized(lock) {
        val old = currentOptions
        if (old.symbologies != value.symbologies || old.mode != value.mode ||
            old.scanArea != value.scanArea || old.resolvedMaxResults != value.resolvedMaxResults ||
            old.duplicateFilter != value.duplicateFilter
        ) epoch++
        currentOptions = value
        duplicateFilter.windowMs = value.duplicateFilter
    }

    fun pause() = synchronized(lock) {
        epoch++
        paused = true
    }

    fun resume() = synchronized(lock) {
        epoch++
        paused = false
        singleShotDone = false
    }

    /** Reject work mapped against old preview geometry without resetting spatial tracks. */
    fun invalidate(change: () -> Unit = {}) = synchronized(lock) {
        epoch++
        change()
    }

    fun reset(resetDuplicates: Boolean, resumeAnalysis: Boolean) = synchronized(lock) {
        epoch++
        tracker.reset()
        pendingBatchScans.clear()
        singleShotDone = false
        if (resetDuplicates) duplicateFilter.reset()
        if (resumeAnalysis) paused = false
    }

    /**
     * Commits only admitted main-thread output. Every preceding callback can pause, stop or
     * reconfigure the scanner, so duplicate history is consumed immediately before onScan.
     * Batch additions stay pending when an earlier callback cancels the scan stage.
     * onSingleScan only updates internal paused/state flags; it must not invoke user code.
     */
    fun deliver(
        frame: Frame,
        barcodes: List<Barcode>,
        timestamp: Long,
        sourceIsCurrent: () -> Boolean,
        onFrame: (List<TrackedBarcode>?) -> Unit,
        onTrack: (List<TrackedBarcode>) -> Unit,
        onSingleScan: () -> Unit,
        onScan: (List<Barcode>) -> Unit,
    ) {
        fun current(): Boolean = sourceIsCurrent() && isCurrent(frame)
        if (!current()) return
        when (frame.options.mode) {
            ScannerOptions.Mode.BATCH -> {
                val update = tracker.update(barcodes, timestamp)
                pendingBatchScans.addAll(update.added.map { it.id })
                pendingBatchScans.retainAll(update.tracked.map { it.id }.toSet())
                onFrame(update.tracked)
                if (!current()) return
                onTrack(update.tracked)
                if (!current()) return
                val observed = barcodes.map { it.key }.toSet()
                val candidates = update.tracked.filter { it.id in pendingBatchScans && it.barcode.key in observed }
                val fresh = duplicateFilter.filter(candidates.map { it.barcode }, timestamp)
                pendingBatchScans.removeAll(candidates.map { it.id }.toSet())
                if (fresh.isNotEmpty()) onScan(fresh)
            }
            ScannerOptions.Mode.SINGLE -> {
                onFrame(null)
                if (!current() || singleShotDone) return
                val fresh = duplicateFilter.filter(barcodes, timestamp)
                if (fresh.isEmpty()) return
                singleShotDone = true
                // Auto-pause is part of accepting this scan. It cancels every other queued frame.
                pause()
                onSingleScan()
                onScan(fresh)
            }
            ScannerOptions.Mode.CONTINUOUS -> {
                onFrame(null)
                if (!current()) return
                val fresh = duplicateFilter.filter(barcodes, timestamp)
                if (fresh.isNotEmpty()) onScan(fresh)
            }
        }
    }
}
