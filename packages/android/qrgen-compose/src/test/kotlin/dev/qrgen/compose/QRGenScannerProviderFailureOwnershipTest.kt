// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.compose

import android.Manifest
import android.content.Context
import android.os.Looper
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.common.util.concurrent.ListenableFuture
import dev.qrgen.ErrorCode
import dev.qrgen.ScannerOptions
import dev.qrgen.Symbology
import dev.qrgen.android.QRGen
import dev.qrgen.android.QRGenScanner
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Actual public scanner lifecycle; only the provider future is controlled. No camera/ML Kit. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PendingCameraProviderShadow::class, PendingCameraProviderCompanionShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class QRGenScannerProviderFailureOwnershipTest {
    private lateinit var providerFuture: ControlledProviderFailureFuture

    @Before fun grantPermissionAndResetFuture() {
        PendingCameraProviderShadow.requests = 0
        PendingCameraProviderShadow.futureOverride = null
        providerFuture = ControlledProviderFailureFuture()
        PendingCameraProviderShadow.futureOverride = providerFuture
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.CAMERA)
        assertTrue(QRGen.hasCameraPermission(RuntimeEnvironment.getApplication()))
    }

    @After fun clearProviderOverride() {
        PendingCameraProviderShadow.futureOverride = null
    }

    @Test fun stoppedStartupDoesNotReportLateProviderFailure() = probe("stop", 0, QRGenScanner.State.STOPPED)
    @Test fun currentStartupReportsProviderFailureControl() = probe("current", 1, QRGenScanner.State.STOPPED)
    @Test fun releasedStartupDoesNotReportLateProviderFailureControl() = probe("release", 0, QRGenScanner.State.RELEASED)
    @Test fun restartedStartupStillOwnsCoalescedProviderFailureControl() = probe("restart", 1, QRGenScanner.State.STOPPED)

    private fun probe(action: String, expectedErrors: Int, expectedState: QRGenScanner.State) {
        val scanner = QRGenScanner(RuntimeEnvironment.getApplication(), ScannerOptions(
            symbologies = setOf(Symbology.QR), beep = false, vibrate = false,
        ))
        val owner = StartedProviderOwner()
        val errors = mutableListOf<ErrorCode>()
        var scans = 0
        var tracks = 0
        var ready = 0
        scanner.onError { errors.add(it.code) }
        scanner.onScan { scans++ }
        scanner.onTrack { tracks++ }
        scanner.onReady { ready++ }
        val future = providerFuture
        try {
            scanner.bind(owner)
            assertEquals(QRGenScanner.State.STARTING, scanner.state)
            assertEquals(1, PendingCameraProviderShadow.requests)
            assertEquals(1, future.pendingListeners)
            assertTrue(errors.isEmpty())
            when (action) {
                "stop" -> scanner.stop()
                "release" -> scanner.release()
                "restart" -> { scanner.stop(); scanner.start() }
            }
            val beforeFailure = scanner.state
            assertEquals(if (action == "stop") QRGenScanner.State.STOPPED else if (action == "release") QRGenScanner.State.RELEASED else QRGenScanner.State.STARTING, beforeFailure)
            assertEquals("Restart must share the still-pending global provider operation", 1, PendingCameraProviderShadow.requests)
            future.fail()
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            val observedState = scanner.state
            println("ANDROID_PROVIDER_FAILURE_RECEIPT {\"action\":\"$action\",\"beforeFailure\":\"$beforeFailure\",\"afterFailure\":\"$observedState\",\"errors\":${errors.size},\"errorCodes\":\"${errors.joinToString()}\",\"expectedErrors\":$expectedErrors,\"providerRequests\":${PendingCameraProviderShadow.requests},\"listenerDeliveries\":${future.listenerDeliveries},\"getCalls\":${future.getCalls}}")
            assertTrue(future.isDone())
            assertEquals(1, future.listenerDeliveries)
            assertEquals(0, future.pendingListeners)
            assertEquals(0, future.pendingExecutions)
            assertEquals(0, scans)
            assertEquals(0, tracks)
            assertEquals(0, ready)
            assertEquals(expectedState, observedState)
            assertEquals(List(expectedErrors) { ErrorCode.CAMERA_NOT_FOUND }, errors)
        } finally {
            // Every path uses the real controller/lifecycle cleanup, even a semantic failure.
            if (!future.isDone()) future.fail()
            scanner.release()
            owner.destroy()
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            assertEquals(QRGenScanner.State.RELEASED, scanner.state)
            assertTrue(future.isDone())
            assertEquals(0, future.pendingListeners)
            assertEquals(0, future.pendingExecutions)
        }
    }
}

private class StartedProviderOwner : LifecycleOwner {
    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry
    init { registry.currentState = Lifecycle.State.STARTED }
    fun destroy() { registry.currentState = Lifecycle.State.DESTROYED }
}

/** A normal future-failure contract: the real acquisition listener runs on its supplied executor. */
class ControlledProviderFailureFuture : ListenableFuture<ProcessCameraProvider> {
    private val listeners = mutableListOf<Pair<Runnable, Executor>>()
    private var failed = false
    var listenerDeliveries = 0
        private set
    var pendingExecutions = 0
        private set
    var getCalls = 0
        private set
    val pendingListeners: Int get() = listeners.size

    override fun addListener(listener: Runnable, executor: Executor) {
        check(!failed) { "Fixture registration must precede controlled completion" }
        listeners.add(listener to executor)
    }

    fun fail() {
        check(!failed) { "Provider future settled twice" }
        failed = true
        val pending = listeners.toList()
        listeners.clear()
        for ((listener, executor) in pending) {
            pendingExecutions++
            executor.execute {
                pendingExecutions--
                listenerDeliveries++
                listener.run()
            }
        }
    }

    override fun cancel(mayInterruptIfRunning: Boolean): Boolean = false
    override fun isCancelled(): Boolean = false
    override fun isDone(): Boolean = failed
    override fun get(): ProcessCameraProvider {
        check(failed) { "Native listener read the provider before completion" }
        getCalls++
        throw ExecutionException(IllegalStateException("controlled camera-provider initialization failure"))
    }
    override fun get(timeout: Long, unit: TimeUnit): ProcessCameraProvider {
        if (!failed) throw TimeoutException("Provider is deliberately pending")
        return get()
    }
}
