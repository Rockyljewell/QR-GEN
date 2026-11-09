// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assumptions.assumeTrue
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ClockSampleTest {
    private val epoch = 1_800_000_000_000L
    private val code = Barcode("clock-sample", Symbology.QR, timestamp = epoch)

    @Test fun `paired clock corrections preserve elapsed ages and epoch snapshots`() {
        for ((elapsedStep, wallStep) in listOf(2000L to -60000L, 100L to 60000L)) {
            var elapsed = 100L
            val source = ClockSource { elapsed }
            val filter = DuplicateFilter(1000)
            val tracker = BarcodeTracker()
            val firstClock = source.sample(epoch)
            assertTrue(filter.acceptAt(code, firstClock))
            val first = tracker.updateAt(listOf(code), firstClock).tracked.single()
            elapsed += elapsedStep
            val second = source.sample(epoch + elapsedStep + wallStep)
            assertEquals(elapsedStep >= 1000, filter.acceptAt(code, second))
            assertEquals(if (elapsedStep > 500) 0 else 1, tracker.updateAt(emptyList(), second).tracked.size)
            assertEquals(epoch, first.firstSeen)
            assertEquals(epoch, first.lastSeen)
            assertEquals(epoch, first.barcode.timestamp)
            assertEquals(100L, firstClock.elapsedMillis)
        }
    }

    @Test fun `full manual range retains millisecond boundaries at both Long limits`() {
        for (base in listOf(Long.MIN_VALUE, Long.MAX_VALUE - 1000)) {
            val filter = DuplicateFilter(1000)
            assertTrue(filter.acceptAt(code, ClockSample.manual(base)))
            assertFalse(filter.acceptAt(code, ClockSample.manual(base + 999)))
            assertTrue(filter.acceptAt(code, ClockSample.manual(base + 1000)))
            val tracker = BarcodeTracker()
            val first = tracker.updateAt(listOf(code), ClockSample.manual(base)).tracked.single()
            assertEquals(listOf(first), tracker.updateAt(emptyList(), ClockSample.manual(base + 500)).tracked)
            assertEquals(listOf(first), tracker.updateAt(emptyList(), ClockSample.manual(base + 501)).removed)
            assertEquals(base, first.firstSeen)
            assertEquals(epoch, first.barcode.timestamp)
        }
    }

    @Test fun `overflow in either direction never wraps an age comparison`() {
        val filter = DuplicateFilter(1000)
        assertTrue(filter.acceptAt(code, ClockSample.manual(Long.MIN_VALUE)))
        assertTrue(filter.acceptAt(code, ClockSample.manual(Long.MAX_VALUE)))
        assertFalse(filter.acceptAt(code, ClockSample.manual(Long.MIN_VALUE)))
        val tracker = BarcodeTracker(maxAgeMs = Long.MAX_VALUE)
        tracker.updateAt(listOf(code), ClockSample.manual(Long.MIN_VALUE))
        assertEquals(1, tracker.updateAt(emptyList(), ClockSample.manual(Long.MAX_VALUE)).removed.size)
    }

    @Test fun `extreme cross-basis rebases preserve exact ages`() {
        val source = ClockSource { 10L }
        val old = BarcodeTracker(maxAgeMs = Long.MAX_VALUE)
        old.updateAt(listOf(code), ClockSample.manual(Long.MIN_VALUE))
        assertEquals(1, old.updateAt(emptyList(), source.sample(Long.MAX_VALUE)).removed.size)
        val future = BarcodeTracker()
        val first = future.updateAt(listOf(code), ClockSample.manual(Long.MAX_VALUE)).tracked.single()
        assertEquals(listOf(first), future.updateAt(emptyList(), source.sample(Long.MIN_VALUE)).tracked)
        assertEquals(Long.MAX_VALUE, first.lastSeen)
    }

    @Test fun `basis transitions rebase once without retiming metadata`() {
        var elapsed = 100L
        val source = ClockSource { elapsed }
        val filter = DuplicateFilter(1000)
        val tracker = BarcodeTracker()
        assertTrue(filter.accept(code, epoch))
        val first = tracker.update(listOf(code), epoch).tracked.single()
        assertFalse(filter.acceptAt(code, source.sample(epoch + 500)))
        assertEquals(listOf(first), tracker.updateAt(emptyList(), source.sample(epoch + 500)).tracked)
        elapsed += 500
        assertTrue(filter.acceptAt(code, source.sample(epoch - 60000)))
        assertEquals(listOf(first), tracker.updateAt(emptyList(), source.sample(epoch - 60000)).removed)
        assertEquals(epoch, first.firstSeen)
        assertEquals(epoch, first.lastSeen)
        val back = DuplicateFilter(1000)
        assertTrue(back.acceptAt(code, source.sample(epoch)))
        assertFalse(back.accept(code, 0))
        assertFalse(back.accept(code, epoch + 999))
        assertTrue(back.accept(code, epoch + 1000))
    }

    @Test fun `once-per-session retains more than the pruning threshold`() {
        val filter = DuplicateFilter(-1)
        repeat(258) { assertTrue(filter.accept(Barcode("unique-$it", Symbology.QR), it.toLong())) }
        assertEquals(258, filter.size)
        assertFalse(filter.accept(Barcode("unique-0", Symbology.QR), 10000))
        assertFalse(filter.accept(Barcode("unique-257", Symbology.QR), 10000))
        filter.reset()
        assertTrue(filter.accept(Barcode("unique-0", Symbology.QR), 10000))
    }

    @Test fun `automatic legacy defaults use elapsed time and retain epoch metadata`() {
        val filter = DuplicateFilter(100)
        val tracker = BarcodeTracker(maxAgeMs = 100)
        val before = System.currentTimeMillis()
        assertTrue(filter.accept(code))
        val first = tracker.update(listOf(code)).tracked.single()
        val started = System.nanoTime()
        Thread.sleep(130)
        val elapsed = (System.nanoTime() - started) / 1_000_000
        assumeTrue(elapsed >= 100, "Real elapsed calibration invalid: $elapsed")
        assertTrue(filter.accept(code))
        assertEquals(listOf(first), tracker.update(emptyList()).removed)
        assertTrue(first.firstSeen in before..System.currentTimeMillis())
        assertEquals(epoch, first.barcode.timestamp)
    }

    @Test fun `reserved legacy MIN selects automatic time while manualAt preserves MIN`() {
        val before = System.currentTimeMillis()
        val automatic = BarcodeTracker().update(listOf(code), Long.MIN_VALUE).tracked.single()
        assertTrue(automatic.firstSeen in before..System.currentTimeMillis())
        val manual = BarcodeTracker().updateAt(listOf(code), ClockSample.manual(Long.MIN_VALUE)).tracked.single()
        assertEquals(Long.MIN_VALUE, manual.firstSeen)
        assertEquals(Long.MIN_VALUE, manual.lastSeen)
    }
}
