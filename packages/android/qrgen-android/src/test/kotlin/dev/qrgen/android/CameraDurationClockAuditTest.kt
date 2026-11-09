// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.BarcodeTracker
import dev.qrgen.DuplicateFilter
import dev.qrgen.ScannerOptions
import dev.qrgen.Symbology
import dev.qrgen.TrackedBarcode
import org.junit.Assume.assumeTrue
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Actual ProcessingSession/core logic with controlled camera timestamp values and real JVM
 * elapsed time. This does not change System.currentTimeMillis or acquire a native camera.
 */
class CameraDurationClockAuditTest {
    private val epoch = 1_800_000_000_000L
    private fun code(timestamp: Long) = Barcode("android-clock-control", Symbology.QR, timestamp = timestamp)

    private class Events {
        val scans = mutableListOf<List<Barcode>>()
        val tracks = mutableListOf<List<TrackedBarcode>>()
        fun feed(session: ProcessingSession, barcodes: List<Barcode>, timestamp: Long) {
            session.deliver(
                frame = session.capture()!!, barcodes = barcodes, timestamp = timestamp,
                sourceIsCurrent = { true }, onFrame = {}, onTrack = { tracks.add(it.toList()) },
                onSingleScan = {}, onScan = { scans.add(it.toList()) },
            )
        }
    }

    private fun duplicateCase(name: String, waitMs: Long, correction: Long, expectedScans: Int) {
        val session = ProcessingSession(ScannerOptions(mode = ScannerOptions.Mode.CONTINUOUS, duplicateFilter = 1000))
        val events = Events()
        try {
            val started = System.nanoTime()
            events.feed(session, listOf(code(epoch)), epoch)
            assertEquals(1, events.scans.size)
            if (waitMs > 0) Thread.sleep(waitMs)
            val elapsedMs = (System.nanoTime() - started) / 1_000_000
            if (waitMs == 0L) assumeTrue("Forward control exceeded its 1000 ms window: $elapsedMs", elapsedMs < 1000)
            else assertTrue(elapsedMs >= waitMs)
            val cameraTimestamp = epoch + elapsedMs + correction
            events.feed(session, listOf(code(cameraTimestamp)), cameraTimestamp)
            val deliveredElapsedMs = (System.nanoTime() - started) / 1_000_000
            if (waitMs == 0L) assumeTrue("Forward delivery exceeded its 1000 ms window: $deliveredElapsedMs", deliveredElapsedMs < 1000)
            assertEquals(epoch, events.scans.first().single().timestamp)
            println("ANDROID_DURATION_RECEIPT {\"case\":\"$name\",\"actualElapsedMs\":$elapsedMs,\"deliveredElapsedMs\":$deliveredElapsedMs,\"simulatedCameraTimestamp\":$cameraTimestamp,\"correctionMs\":$correction,\"scans\":${events.scans.size},\"expectedScans\":$expectedScans}")
            assertEquals(expectedScans, events.scans.size)
            if (expectedScans == 2) assertEquals(cameraTimestamp, events.scans.last().single().timestamp)
        } finally {
            session.reset(resetDuplicates = true, resumeAnalysis = true)
            assertTrue(session.tracked.isEmpty())
        }
    }

    private fun expiryCase(name: String, waitMs: Long, correction: Long, expectedTracks: Int) {
        val session = ProcessingSession(ScannerOptions(mode = ScannerOptions.Mode.BATCH, duplicateFilter = 1000))
        val events = Events()
        try {
            val started = System.nanoTime()
            events.feed(session, listOf(code(epoch)), epoch)
            val first = session.tracked.single()
            assertEquals(epoch, first.firstSeen)
            assertEquals(epoch, first.lastSeen)
            if (waitMs > 0) Thread.sleep(waitMs)
            val elapsedMs = (System.nanoTime() - started) / 1_000_000
            if (waitMs == 0L) assumeTrue("Forward control exceeded its 500 ms timeout: $elapsedMs", elapsedMs < 500)
            else assertTrue(elapsedMs >= waitMs)
            val cameraTimestamp = epoch + elapsedMs + correction
            events.feed(session, emptyList(), cameraTimestamp)
            val deliveredElapsedMs = (System.nanoTime() - started) / 1_000_000
            if (waitMs == 0L) assumeTrue("Forward delivery exceeded its 500 ms timeout: $deliveredElapsedMs", deliveredElapsedMs < 500)
            assertEquals(2, events.tracks.size)
            assertEquals(epoch, first.barcode.timestamp)
            assertEquals(epoch, first.lastSeen)
            println("ANDROID_DURATION_RECEIPT {\"case\":\"$name\",\"actualElapsedMs\":$elapsedMs,\"deliveredElapsedMs\":$deliveredElapsedMs,\"simulatedCameraTimestamp\":$cameraTimestamp,\"correctionMs\":$correction,\"tracks\":${session.tracked.size},\"expectedTracks\":$expectedTracks,\"firstId\":${first.id},\"firstSeen\":${first.firstSeen},\"lastSeen\":${first.lastSeen}}")
            assertEquals(expectedTracks, session.tracked.size)
            if (expectedTracks == 1) assertEquals(first, session.tracked.single())
        } finally {
            session.reset(resetDuplicates = true, resumeAnalysis = true)
            assertTrue(session.tracked.isEmpty())
        }
    }

    @Test fun backwardCameraTimestampMustNotExtendDuplicateWindow() = duplicateCase("duplicate-backward", 1200, -60000, 2)
    @Test fun forwardCameraTimestampMustNotShortenDuplicateWindow() = duplicateCase("duplicate-forward", 0, 60000, 1)
    @Test fun backwardCameraTimestampMustNotRetainExpiredTrack() = expiryCase("expiry-backward", 600, -60000, 0)
    @Test fun forwardCameraTimestampMustNotExpireRecentTrack() = expiryCase("expiry-forward", 0, 60000, 1)
    @Test fun ordinaryDuplicateWindowControl() = duplicateCase("duplicate-ordinary", 1200, 0, 2)
    @Test fun ordinaryUnseenExpiryControl() = expiryCase("expiry-ordinary", 600, 0, 0)

    @Test fun publicExplicitDuplicateTimesKeepTheirNumericMeaning() {
        val barcode = code(epoch)
        val filter = DuplicateFilter(1000)
        assertTrue(filter.accept(barcode, 0))
        assertEquals(false, filter.accept(barcode, 999))
        assertTrue(filter.accept(barcode, 1000))
        assertEquals(epoch, barcode.timestamp)
        filter.reset()
        assertTrue(filter.accept(barcode, 0))
    }

    @Test fun publicExplicitTrackerTimesAndMetadataKeepTheirNumericMeaning() {
        val barcode = code(epoch)
        val tracker = BarcodeTracker()
        val first = tracker.update(listOf(barcode), 0).tracked.single()
        assertEquals(listOf(first), tracker.update(emptyList(), 500).tracked)
        val returned = tracker.update(listOf(barcode), 501)
        assertEquals(listOf(first), returned.removed)
        val fresh = returned.added.single()
        assertNotEquals(first.id, fresh.id)
        assertEquals(0L, first.firstSeen)
        assertEquals(0L, first.lastSeen)
        assertEquals(501L, fresh.firstSeen)
        assertEquals(501L, fresh.lastSeen)
        assertEquals(epoch, first.barcode.timestamp)
        assertEquals(epoch, fresh.barcode.timestamp)
        tracker.reset()
        assertTrue(tracker.tracked.isEmpty())
    }
}