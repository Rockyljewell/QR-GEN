// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.ClockSource
import dev.qrgen.ScannerOptions
import dev.qrgen.Size
import dev.qrgen.Symbology
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class CapturedClockForwardingTest {
    @Test fun packetKeepsAcquisitionClockWhenDeliveryIsDelayed() {
        var elapsed = 0L
        var reads = 0
        val source = ClockSource { reads++; elapsed }
        val first = source.sample(1_800_000_000_000L)
        elapsed = 100
        val second = source.sample(first.timestamp + 60000)
        elapsed = 60000 // Simulated queue delay must not become report age.
        val session = ProcessingSession(ScannerOptions(duplicateFilter = 1000))
        var scans = 0
        for (clock in listOf(first, second)) {
            session.deliver(session.capture()!!, listOf(Barcode("same", Symbology.QR, timestamp = clock.timestamp)), clock,
                { true }, {}, {}, {}, { scans++ })
        }
        assertEquals(1, scans)
        assertEquals(2, reads, "Delivery must not sample either clock again")
        val event = QRGenScanner.FrameEvent(emptyList(), null, Size(640, 480), false, true, second)
        assertSame(second, event.clock)
        assertEquals(first.timestamp + 60000, second.timestamp)
        assertEquals(100L, second.elapsedMillis)
    }
}
