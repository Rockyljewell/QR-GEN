// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.BarcodeTracker
import dev.qrgen.DuplicateFilter
import dev.qrgen.Symbology
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SourceSessionTest {
    private val code = Barcode("same product", Symbology.QR)

    @Test
    fun switchingSourceClearsTracksBeforeAnEmptyFrameAndGivesTheSamePayloadANewId() {
        val session = SourceSession()
        val tracker = BarcodeTracker()
        val sourceA = session.capture()
        session.runIfCurrent(sourceA) { tracker.update(listOf(code), now = 0) }
        val oldId = tracker.tracked.single().id

        val sourceB = session.advance { tracker.reset() }
        assertTrue(tracker.tracked.isEmpty(), "cleared before the new source supplies any frame")
        session.runIfCurrent(sourceB) { tracker.update(emptyList(), now = 1) }
        assertTrue(tracker.tracked.isEmpty(), "an empty first frame cannot revive source A")
        session.runIfCurrent(sourceB) { tracker.update(listOf(code), now = 2) }
        assertNotEquals(oldId, tracker.tracked.single().id)
        assertEquals(1, tracker.tracked.single().count)
        assertEquals(2L, tracker.tracked.single().firstSeen)
    }

    @Test
    fun delayedResultsCannotRestoreTracksOrConsumeDuplicateHistoryAfterSwitching() {
        val session = SourceSession()
        val tracker = BarcodeTracker()
        val duplicates = DuplicateFilter(-1)
        val sourceA = session.capture()
        val sourceB = session.advance { tracker.reset() }

        assertFalse(session.runIfCurrent(sourceA) {
            tracker.update(listOf(code), now = 0)
            duplicates.filter(listOf(code), now = 0)
        })
        assertTrue(tracker.tracked.isEmpty())
        session.runIfCurrent(sourceB) {
            assertEquals(listOf(code), duplicates.filter(listOf(code), now = 1))
        }
    }

    @Test
    fun aQueuedOldSourceCallbackIsRejectedEvenAfterItsFrameWasAccepted() {
        val session = SourceSession()
        val sourceA = session.capture()
        var queued: (() -> Unit)? = null
        var delivered = false
        session.runIfCurrent(sourceA) {
            queued = { session.runIfCurrent(sourceA) { delivered = true } }
        }
        session.advance { }
        queued!!()
        assertFalse(delivered)
    }

    @Test
    fun aListenerStoppingOnClearCannotScheduleAnotherClearEvent() {
        val session = SourceSession()
        var source = session.capture()
        assertFalse(session.takeTrackClear(source), "an initial empty source needs no clear event")
        assertTrue(session.recordTrackDelivery(source, hasTracks = true))
        source = session.advance { }
        var clears = 0
        fun deliverClear() {
            if (!session.takeTrackClear(source)) return
            clears++
            // onTrack(emptyList()) { scanner.stop() } invalidates the source again.
            source = session.advance { }
            if (session.hasPublishedTracks()) deliverClear()
        }
        deliverClear()
        assertEquals(1, clears)
        assertFalse(session.hasPublishedTracks())
    }

    @Test
    fun repeatedSourceChangesPreserveOnePendingClearForTheCurrentGeneration() {
        val session = SourceSession()
        val sourceA = session.capture()
        session.recordTrackDelivery(sourceA, hasTracks = true)
        val sourceB = session.advance { }
        val sourceC = session.advance { }
        assertFalse(session.takeTrackClear(sourceB), "a stale queued clear is not delivered")
        assertTrue(session.hasPublishedTracks(), "the listener still holds source A tracks")
        assertTrue(session.takeTrackClear(sourceC))
        assertFalse(session.takeTrackClear(sourceC), "cleared exactly once")
    }

    @Test
    fun spatialResetPreservesDuplicateHistoryUntilAnExplicitNewScanningSession() {
        val session = SourceSession()
        val tracker = BarcodeTracker()
        val duplicates = DuplicateFilter(-1)
        session.runIfCurrent(session.capture()) {
            tracker.update(listOf(code), now = 0)
            assertEquals(listOf(code), duplicates.filter(listOf(code), now = 0))
        }
        val sourceB = session.advance { tracker.reset() }
        session.runIfCurrent(sourceB) {
            assertTrue(duplicates.filter(listOf(code), now = 1).isEmpty())
        }
        val restarted = session.advance {
            tracker.reset()
            duplicates.reset()
        }
        session.runIfCurrent(restarted) {
            assertEquals(listOf(code), duplicates.filter(listOf(code), now = 2))
        }
    }

    @Test
    fun switchingWaitsForAnAcceptedMutationThenResetsItAtomically() {
        val session = SourceSession()
        val tracker = BarcodeTracker()
        val sourceA = session.capture()
        val accepted = CountDownLatch(1)
        val finishMutation = CountDownLatch(1)
        val switching = CountDownLatch(1)
        val switched = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>(null)
        val analysis = Thread {
            try {
                session.runIfCurrent(sourceA) {
                    accepted.countDown()
                    check(finishMutation.await(5, TimeUnit.SECONDS))
                    tracker.update(listOf(code), now = 0)
                }
            } catch (e: Throwable) {
                failure.set(e)
            }
        }
        val main = Thread {
            try {
                switching.countDown()
                session.advance { tracker.reset() }
                switched.countDown()
            } catch (e: Throwable) {
                failure.set(e)
            }
        }
        analysis.start()
        try {
            assertTrue(accepted.await(5, TimeUnit.SECONDS))
            main.start()
            assertTrue(switching.await(5, TimeUnit.SECONDS))
            assertFalse(switched.await(50, TimeUnit.MILLISECONDS), "cannot reset while an accepted mutation owns the state")
        } finally {
            finishMutation.countDown()
            analysis.join(5_000)
            if (main.state != Thread.State.NEW) main.join(5_000)
        }
        failure.get()?.let { throw it }
        assertFalse(analysis.isAlive)
        assertFalse(main.isAlive)
        assertTrue(tracker.tracked.isEmpty())
        assertFalse(session.isCurrent(sourceA))
    }
}
