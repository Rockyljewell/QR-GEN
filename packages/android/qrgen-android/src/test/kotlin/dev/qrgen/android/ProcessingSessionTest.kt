// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.android

import dev.qrgen.Barcode
import dev.qrgen.ScanArea
import dev.qrgen.ScannerOptions
import dev.qrgen.Symbology
import dev.qrgen.TrackedBarcode
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProcessingSessionTest {
    private val code = Barcode("same product", Symbology.QR)
    private val options = ScannerOptions(duplicateFilter = -1)

    private fun deliver(
        session: ProcessingSession,
        frame: ProcessingSession.Frame,
        now: Long = 0,
        sourceIsCurrent: () -> Boolean = { true },
        onFrame: (List<TrackedBarcode>?) -> Unit = {},
        onTrack: (List<TrackedBarcode>) -> Unit = {},
        onSingleScan: () -> Unit = {},
        onScan: (List<Barcode>) -> Unit = {},
    ) = session.deliver(frame, listOf(code), now, sourceIsCurrent, onFrame, onTrack, onSingleScan, onScan)

    @Test
    fun aQueuedResultIsRejectedWhilePausedAndAfterResumeWithoutConsumingOnceOnlyHistory() {
        val session = ProcessingSession(options)
        val queued = session.capture()!!
        session.pause()
        assertNull(session.capture())
        var scans = 0
        deliver(session, queued, onScan = { scans++ })
        session.resume()
        deliver(session, queued, onScan = { scans++ })
        assertEquals(0, scans)
        deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
        assertEquals(1, scans)
    }

    @Test
    fun everyScanSettingChangeInvalidatesTheCapturedOptionsSnapshot() {
        val changed = listOf(
            options.copy(symbologies = setOf(Symbology.CODE128)),
            options.copy(scanArea = ScanArea.centered(0.5f, 0.5f)),
            options.copy(maxResults = 2),
            options.copy(mode = ScannerOptions.Mode.BATCH),
            options.copy(duplicateFilter = 0),
        )
        for (next in changed) {
            val session = ProcessingSession(options)
            val old = session.capture()!!
            session.updateOptions(next)
            assertFalse(session.isCurrent(old), "changed scan setting: $next")
            assertEquals(options, old.options, "a task retains the settings it actually decoded with")
            assertEquals(next, session.capture()!!.options)
            var scans = 0
            deliver(session, old, onScan = { scans++ })
            assertEquals(0, scans)
            deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
            assertEquals(1, scans, "discarded work did not consume duplicate history")
        }
    }

    @Test
    fun feedbackAndTorchChangesKeepTheCurrentProcessingEpoch() {
        val session = ProcessingSession(options)
        val old = session.capture()!!
        session.updateOptions(options.copy(beep = false, vibrate = false, torch = true))
        assertTrue(session.isCurrent(old))
    }

    @Test
    fun previewGeometryChangesRejectOldWorkBeforeItUpdatesTracks() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.BATCH))
        val old = session.capture()!!
        session.invalidate()
        var callbacks = 0
        deliver(session, old, onFrame = { callbacks++ }, onTrack = { callbacks++ }, onScan = { callbacks++ })
        assertEquals(0, callbacks)
        assertTrue(session.tracked.isEmpty())
    }

    @Test
    fun continuousFrameCallbackCanPauseWithoutLosingTheFirstScanAfterResume() {
        val session = ProcessingSession(options)
        var scans = 0
        deliver(session, session.capture()!!, onFrame = { session.pause() }, onScan = { scans++ })
        assertEquals(0, scans)
        session.resume()
        deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
        assertEquals(1, scans)
    }

    @Test
    fun singleFrameCallbackCanReconfigureBeforeTheScanAndTheNextCurrentFrameStillReports() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.SINGLE))
        var scans = 0
        var autoPauses = 0
        deliver(session, session.capture()!!,
            onFrame = { session.updateOptions(session.options.copy(maxResults = 2)) },
            onSingleScan = { autoPauses++ },
            onScan = { scans++ },
        )
        assertEquals(0, scans)
        assertEquals(0, autoPauses)
        deliver(session, session.capture()!!, now = 1,
            onSingleScan = { autoPauses++ }, onScan = { scans++ },
        )
        assertEquals(1, scans)
        assertEquals(1, autoPauses)
        assertNull(session.capture(), "an accepted single scan pauses subsequent analysis")
    }

    @Test
    fun batchTrackCallbackCanPauseAndResumeWithoutLosingTracksOrThePendingFirstScan() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.BATCH))
        var scans = 0
        deliver(session, session.capture()!!, onTrack = { session.pause() }, onScan = { scans++ })
        assertEquals(0, scans)
        val id = session.tracked.single().id
        assertEquals(1, session.tracked.single().count)
        session.resume()
        deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
        assertEquals(1, scans)
        assertEquals(id, session.tracked.single().id, "ordinary pause preserves spatial ownership")
        assertEquals(2, session.tracked.single().count)
        deliver(session, session.capture()!!, now = 2, onScan = { scans++ })
        assertEquals(1, scans, "a delivered batch addition is not re-reported")
    }

    @Test
    fun batchFrameCallbackCanCancelBeforeTrackingDeliveryAndRetainItsPendingScan() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.BATCH))
        var tracks = 0
        var scans = 0
        deliver(session, session.capture()!!,
            onFrame = { session.pause() }, onTrack = { tracks++ }, onScan = { scans++ },
        )
        assertEquals(0, tracks)
        assertEquals(0, scans)
        session.resume()
        deliver(session, session.capture()!!, now = 1, onTrack = { tracks++ }, onScan = { scans++ })
        assertEquals(1, tracks)
        assertEquals(1, scans)
    }

    @Test
    fun aTrackCallbackSwitchingTheSourceStopsTheOldScanAndNewSourceGetsANewTrackId() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.BATCH))
        var currentSource = true
        var scans = 0
        var oldId = 0
        deliver(session, session.capture()!!,
            sourceIsCurrent = { currentSource },
            onTrack = { tracked ->
                oldId = tracked.single().id
                currentSource = false
                session.reset(resetDuplicates = false, resumeAnalysis = true)
            },
            onScan = { scans++ },
        )
        assertEquals(0, scans)
        assertTrue(session.tracked.isEmpty())
        deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
        assertEquals(1, scans)
        assertNotEquals(oldId, session.tracked.single().id)
    }

    @Test
    fun aSingleScanCallbackCanResumeAndChangeModeWithoutAnOldPauseOverridingIt() {
        val session = ProcessingSession(options.copy(mode = ScannerOptions.Mode.SINGLE))
        val queued = session.capture()!!
        var scans = 0
        deliver(session, queued, onScan = {
            scans++
            session.updateOptions(session.options.copy(mode = ScannerOptions.Mode.CONTINUOUS))
            session.resume()
        })
        assertEquals(1, scans)
        assertTrue(session.capture() != null)
        deliver(session, queued, now = 1, onScan = { scans++ })
        assertEquals(1, scans, "the older task cannot masquerade as continuous output")
    }

    @Test
    fun aDeliveredScanRemainsSuppressedAcrossPauseAndCameraChangesUntilExplicitRestart() {
        val session = ProcessingSession(options)
        var scans = 0
        deliver(session, session.capture()!!, onScan = { scans++ })
        session.pause()
        session.resume()
        deliver(session, session.capture()!!, now = 1, onScan = { scans++ })
        session.reset(resetDuplicates = false, resumeAnalysis = true)
        deliver(session, session.capture()!!, now = 2, onScan = { scans++ })
        assertEquals(1, scans)
        session.reset(resetDuplicates = true, resumeAnalysis = true)
        deliver(session, session.capture()!!, now = 3, onScan = { scans++ })
        assertEquals(2, scans)
    }
}
