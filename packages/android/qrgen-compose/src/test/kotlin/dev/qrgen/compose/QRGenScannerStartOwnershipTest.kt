// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.compose

import android.Manifest
import android.content.Context
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
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode

/**
 * Actual public controller, permission check, lifecycle binding and error callback.
 * Only provider acquisition is a boundary stub: no camera or ML Kit is started.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PendingCameraProviderShadow::class, PendingCameraProviderCompanionShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class QRGenScannerStartOwnershipTest {
    @Before
    fun grantCameraAndResetProviderRequests() {
        PendingCameraProviderShadow.requests = 0
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.CAMERA)
        assertTrue(QRGen.hasCameraPermission(RuntimeEnvironment.getApplication()))
        assertFalse(QRGen.supportedSymbologies().contains(Symbology.MICRO_QR))
    }

    @Test
    fun unsupportedWarningCallbackCanStopStartup() {
        val scanner = QRGenScanner(RuntimeEnvironment.getApplication(), unsupportedOptions())
        var errors = 0
        scanner.onError { error ->
            assertEquals(ErrorCode.UNSUPPORTED, error.code)
            errors++
            scanner.stop()
        }
        try {
            scanner.bind(StartedOwner())
            assertEquals(1, errors)
            assertEquals(QRGenScanner.State.STOPPED, scanner.state)
            assertEquals("cancelled startup must not request a provider", 0, PendingCameraProviderShadow.requests)
        } finally {
            scanner.release()
        }
    }

    @Test
    fun unsupportedWarningCallbackCanReleaseStartup() {
        val scanner = QRGenScanner(RuntimeEnvironment.getApplication(), unsupportedOptions())
        var errors = 0
        scanner.onError { error ->
            assertEquals(ErrorCode.UNSUPPORTED, error.code)
            errors++
            scanner.release()
        }
        try {
            scanner.bind(StartedOwner())
            assertEquals(1, errors)
            assertEquals(QRGenScanner.State.RELEASED, scanner.state)
            assertEquals("released startup must not request a provider", 0, PendingCameraProviderShadow.requests)
        } finally {
            scanner.release()
        }
    }

    @Test
    fun deniedPermissionCallbackReleaseRemainsReleasedControl() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.CAMERA)
        assertFalse(QRGen.hasCameraPermission(RuntimeEnvironment.getApplication()))
        val scanner = QRGenScanner(RuntimeEnvironment.getApplication(), supportedOptions())
        var errors = 0
        scanner.onError { error ->
            assertEquals(ErrorCode.CAMERA_PERMISSION_DENIED, error.code)
            errors++
            scanner.release()
        }
        try {
            scanner.bind(StartedOwner())
            assertEquals(1, errors)
            assertEquals(QRGenScanner.State.RELEASED, scanner.state)
            assertEquals(0, PendingCameraProviderShadow.requests)
        } finally {
            scanner.release()
        }
    }

    @Test
    fun ordinaryPermittedStartRequestsProviderControl() {
        val scanner = QRGenScanner(RuntimeEnvironment.getApplication(), supportedOptions())
        var errors = 0
        scanner.onError { errors++ }
        try {
            scanner.bind(StartedOwner())
            assertEquals(0, errors)
            assertEquals(QRGenScanner.State.STARTING, scanner.state)
            assertEquals(1, PendingCameraProviderShadow.requests)
        } finally {
            scanner.release()
        }
        assertEquals(QRGenScanner.State.RELEASED, scanner.state)
    }

    private fun unsupportedOptions() = ScannerOptions(symbologies = setOf(Symbology.MICRO_QR), beep = false, vibrate = false)
    private fun supportedOptions() = ScannerOptions(symbologies = setOf(Symbology.QR), beep = false, vibrate = false)

    private class StartedOwner : LifecycleOwner {
        private val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry
        init { registry.currentState = Lifecycle.State.STARTED }
    }
}

/** Unresolved acquisition makes the cancellation assertion independent of camera availability. */
@Implements(value = ProcessCameraProvider::class, isInAndroidSdk = false)
class PendingCameraProviderShadow {
    companion object {
        @JvmField var requests: Int = 0

        @JvmStatic
        @Implementation
        @Suppress("UNUSED_PARAMETER")
        fun getInstance(context: Context): ListenableFuture<ProcessCameraProvider> {
            return request()
        }

        fun request(): ListenableFuture<ProcessCameraProvider> {
            requests++
            return object : ListenableFuture<ProcessCameraProvider> {
                override fun addListener(listener: Runnable, executor: Executor) = Unit
                override fun cancel(mayInterruptIfRunning: Boolean): Boolean = false
                override fun isCancelled(): Boolean = false
                override fun isDone(): Boolean = false
                override fun get(): ProcessCameraProvider = throw IllegalStateException("test provider remains pending")
                override fun get(timeout: Long, unit: TimeUnit): ProcessCameraProvider = throw TimeoutException("test provider remains pending")
            }
        }
    }
}

/** Kotlin callers can target the companion method instead of the Java static bridge. */
@Implements(className = "androidx.camera.lifecycle.ProcessCameraProvider\$Companion", isInAndroidSdk = false)
class PendingCameraProviderCompanionShadow {
    @Implementation
    @Suppress("UNUSED_PARAMETER")
    fun getInstance(context: Context): ListenableFuture<ProcessCameraProvider> = PendingCameraProviderShadow.request()
}
