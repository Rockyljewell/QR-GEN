// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

package dev.qrgen.compose

import android.Manifest
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.referentialEqualityPolicy
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.qrgen.Barcode
import dev.qrgen.ErrorCode
import dev.qrgen.QRGenException
import dev.qrgen.ScannerOptions
import dev.qrgen.TrackedBarcode
import dev.qrgen.android.QRGen
import dev.qrgen.android.QRGenScannerView
import dev.qrgen.android.QRGenScanner as QRGenScannerController
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Real composition, AndroidView, scanner view and controller; no camera or decoder is started. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@LooperMode(LooperMode.Mode.PAUSED)
class QRGenScannerOwnershipTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var mounted: Inputs? = null

    @Before
    fun denyCameraBeforeScannerConstruction() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).denyPermissions(Manifest.permission.CAMERA)
        assertFalse(QRGen.hasCameraPermission(compose.activity))
    }

    @After
    fun removeAnyRemainingScanner() {
        mounted?.let { inputs ->
            compose.runOnIdle { inputs.visible.value = false }
            compose.waitForIdle()
        }
    }

    @Test
    fun ownerReplacementReleasesOldControllerAndFollowsNewOwner() {
        val firstOwner = TestOwner()
        val secondOwner = TestOwner()
        val state = QRGenScannerState()
        val inputs = Inputs(firstOwner, state)
        mount(inputs)
        val firstController = compose.runOnIdle { currentController(state) }
        val firstView = compose.runOnIdle { currentView() }

        compose.runOnIdle {
            secondOwner.start()
            inputs.owner.value = secondOwner
        }
        compose.runOnIdle {
            assertSame(secondOwner, inputs.observedOwner)
            val replacement = currentController(state)
            assertNotSame(firstController, replacement)
            assertNotSame(firstView, currentView())
            assertEquals(QRGenScannerController.State.RELEASED, firstController.state)
            assertNull(firstView.scanner)
            assertSame(currentView(), attachedView(state))

            firstOwner.destroy()
            assertEquals(QRGenScannerController.State.STOPPED, replacement.state)

            // A stale old-view detach must not reset the newly attached state's controls.
            // This is a direct boundary check, not a claim that Compose releases in this order.
            state.pause()
            state.detach(firstView)
            assertSame(replacement, state.scanner)
            assertTrue(state.isPaused)
            state.resume()

            secondOwner.destroy()
            assertEquals(QRGenScannerController.State.RELEASED, replacement.state)
        }
    }

    @Test
    fun stateReplacementDetachesOldStateAndAttachesNewState() {
        val firstState = QRGenScannerState()
        val secondState = QRGenScannerState()
        val inputs = Inputs(TestOwner(), firstState)
        mount(inputs)
        val firstController = compose.runOnIdle {
            firstState.pause()
            currentController(firstState)
        }

        compose.runOnIdle { inputs.state.value = secondState }
        compose.runOnIdle {
            val replacement = currentController(secondState)
            assertNotSame(firstController, replacement)
            assertEquals(QRGenScannerController.State.RELEASED, firstController.state)
            assertNull(firstState.scanner)
            assertNull(attachedView(firstState))
            assertFalse(firstState.isPaused)
            assertSame(currentView(), attachedView(secondState))
            assertFalse(secondState.isPaused)
        }
    }

    @Test
    fun removingCompositionReleasesViewControllerAndStateAttachment() {
        val owner = TestOwner()
        val state = QRGenScannerState()
        val inputs = Inputs(owner, state)
        mount(inputs)
        val controller = compose.runOnIdle { currentController(state) }
        val view = compose.runOnIdle { currentView() }

        compose.runOnIdle {
            state.pause()
            inputs.visible.value = false
        }
        compose.runOnIdle {
            assertEquals(QRGenScannerController.State.RELEASED, controller.state)
            assertNull(view.scanner)
            assertNull(state.scanner)
            assertNull(attachedView(state))
            assertFalse(state.isPaused)
            assertTrue(scannerViews(compose.activity.window.decorView).isEmpty())
            assertNoCameraResources(controller)
            owner.destroy()
            assertEquals(QRGenScannerController.State.RELEASED, controller.state)
        }
    }

    @Test
    fun ordinaryOptionsAppearanceAndCallbacksKeepTheController() {
        val state = QRGenScannerState()
        val inputs = Inputs(TestOwner(), state)
        val oldErrors = mutableListOf<ErrorCode>()
        val newErrors = mutableListOf<ErrorCode>()
        inputs.onError.value = { oldErrors += it.code }
        mount(inputs)
        val controller = compose.runOnIdle { currentController(state) }
        val view = compose.runOnIdle { currentView() }
        val before = compose.runOnIdle {
            assertEquals(listOf(ErrorCode.CAMERA_PERMISSION_DENIED), oldErrors)
            oldErrors.size
        }

        compose.runOnIdle {
            inputs.options.value = inputs.options.value.copy(
                duplicateFilter = 777L,
                maxResults = 3,
                viewfinder = ScannerOptions.Viewfinder.NONE,
            )
            inputs.accent.value = Color(0xFF123456)
            inputs.showToast.value = false
            inputs.onScan.value = { _: List<Barcode> -> }
            inputs.onTrack.value = { _: List<TrackedBarcode> -> }
            inputs.onError.value = { newErrors += it.code }
        }
        compose.runOnIdle {
            assertSame(controller, currentController(state))
            assertSame(view, currentView())
            assertEquals(inputs.options.value, controller.options)
            assertEquals(inputs.options.value, view.options)
            assertEquals(inputs.accent.value.toArgb(), view.accentColor)
            assertFalse(view.showToast)

            // Exercise the real controller -> view -> Compose error callback forwarding.
            controller.start()
            assertEquals(before, oldErrors.size)
            assertEquals(listOf(ErrorCode.CAMERA_PERMISSION_DENIED), newErrors)
            assertEquals(QRGenScannerController.State.STOPPED, controller.state)
            assertNoCameraResources(controller)
        }
    }

    @Test
    fun distinctEqualOwnersStillReplaceWhenTheLocalExposesTheNewReference() {
        val firstOwner = TestOwner(equalGroup = 7)
        val secondOwner = TestOwner(equalGroup = 7)
        assertNotSame(firstOwner, secondOwner)
        assertEquals(firstOwner, secondOwner)
        val state = QRGenScannerState()
        val inputs = Inputs(firstOwner, state)
        // Static locals using ordinary `provides` may retain structurally equal values.
        // Computed provision exposes the actual reference so this tests the scanner key.
        mount(inputs, computedOwner = true)
        val firstController = compose.runOnIdle { currentController(state) }

        compose.runOnIdle {
            secondOwner.start()
            inputs.owner.value = secondOwner
        }
        compose.runOnIdle {
            assertSame(secondOwner, inputs.observedOwner)
            val replacement = currentController(state)
            assertNotSame(firstController, replacement)
            assertEquals(QRGenScannerController.State.RELEASED, firstController.state)
            firstOwner.destroy()
            assertEquals(QRGenScannerController.State.STOPPED, replacement.state)
            secondOwner.destroy()
            assertEquals(QRGenScannerController.State.RELEASED, replacement.state)
        }
    }

    @Test
    fun simultaneousOwnerAndStateReplacementReleasesTheOldBinding() {
        val firstOwner = TestOwner()
        val secondOwner = TestOwner()
        val firstState = QRGenScannerState()
        val secondState = QRGenScannerState()
        val inputs = Inputs(firstOwner, firstState)
        mount(inputs)
        val firstController = compose.runOnIdle { currentController(firstState) }

        compose.runOnIdle {
            secondOwner.start()
            inputs.owner.value = secondOwner
            inputs.state.value = secondState
        }
        compose.runOnIdle {
            val replacement = currentController(secondState)
            assertNotSame(firstController, replacement)
            assertEquals(QRGenScannerController.State.RELEASED, firstController.state)
            assertNull(attachedView(firstState))
            assertNull(firstState.scanner)
            assertSame(currentView(), attachedView(secondState))
            firstOwner.destroy()
            assertEquals(QRGenScannerController.State.STOPPED, replacement.state)
        }
    }

    private fun mount(inputs: Inputs, computedOwner: Boolean = false) {
        mounted = inputs
        compose.runOnUiThread { inputs.owner.value.start() }
        compose.setContent {
            val ownerValue = if (computedOwner) {
                LocalLifecycleOwner providesComputed { inputs.owner.value }
            } else {
                LocalLifecycleOwner provides inputs.owner.value
            }
            CompositionLocalProvider(ownerValue) {
                val observed = LocalLifecycleOwner.current
                SideEffect { inputs.observedOwner = observed }
                if (inputs.visible.value) {
                    QRGenScanner(
                        options = inputs.options.value,
                        onScan = inputs.onScan.value,
                        onError = inputs.onError.value,
                        onTrack = inputs.onTrack.value,
                        state = inputs.state.value,
                        accentColor = inputs.accent.value,
                        showToast = inputs.showToast.value,
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun currentController(state: QRGenScannerState): QRGenScannerController {
        val attached = state.scanner
        assertNotNull("State must attach to the current real scanner view", attached)
        val controller = requireNotNull(attached)
        assertSame(controller, currentView().scanner)
        assertEquals(QRGenScannerController.State.STOPPED, controller.state)
        assertNoCameraResources(controller)
        return controller
    }

    private fun currentView(): QRGenScannerView = scannerViews(compose.activity.window.decorView).single()

    private fun scannerViews(view: View): List<QRGenScannerView> {
        if (view is QRGenScannerView) return listOf(view)
        if (view !is ViewGroup) return emptyList()
        return (0 until view.childCount).flatMap { scannerViews(view.getChildAt(it)) }
    }

    // Observation only: public `scanner == null` cannot distinguish a retained released view.
    private fun attachedView(state: QRGenScannerState): QRGenScannerView? {
        val field = QRGenScannerState::class.java.getDeclaredField("view")
        field.isAccessible = true
        return field.get(state) as QRGenScannerView?
    }

    // Observe the real denied-permission branch; no fake CameraX/ML Kit/controller objects.
    private fun assertNoCameraResources(controller: QRGenScannerController) {
        for (name in listOf("cameraProvider", "camera", "preview", "analysis", "analysisExecutor", "analyzer")) {
            val field = QRGenScannerController::class.java.getDeclaredField(name)
            field.isAccessible = true
            assertNull("Denied camera must not allocate $name", field.get(controller))
        }
    }

    private class Inputs(owner: TestOwner, state: QRGenScannerState) {
        val owner = mutableStateOf(owner, referentialEqualityPolicy())
        val state = mutableStateOf(state, referentialEqualityPolicy())
        val visible = mutableStateOf(true)
        val options = mutableStateOf(ScannerOptions(beep = false, vibrate = false))
        val accent = mutableStateOf(QRGenDefaults.AccentColor)
        val showToast = mutableStateOf(true)
        val onScan = mutableStateOf<(List<Barcode>) -> Unit>({}, referentialEqualityPolicy())
        val onError = mutableStateOf<(QRGenException) -> Unit>({}, referentialEqualityPolicy())
        val onTrack = mutableStateOf<((List<TrackedBarcode>) -> Unit)?>({}, referentialEqualityPolicy())
        var observedOwner: LifecycleOwner? = null
    }

    private class TestOwner(private val equalGroup: Int? = null) : LifecycleOwner {
        private val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry

        fun start() { registry.currentState = Lifecycle.State.STARTED }
        fun destroy() { registry.currentState = Lifecycle.State.DESTROYED }

        override fun equals(other: Any?): Boolean =
            if (equalGroup == null) this === other
            else other is TestOwner && other.equalGroup == equalGroup

        override fun hashCode(): Int = equalGroup ?: System.identityHashCode(this)
    }
}
