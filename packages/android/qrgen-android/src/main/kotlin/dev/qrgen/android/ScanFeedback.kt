package dev.qrgen.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.content.ContextCompat

/**
 * Beep (ToneGenerator) and haptic (Vibrator / VibratorManager) feedback. Main thread only.
 * The beep respects silent and vibrate ringer modes. Call [release] when done.
 */
internal class ScanFeedback(private val context: Context) {
    private var tone: ToneGenerator? = null
    private var toneUnavailable = false

    fun beep() {
        val audio = context.getSystemService(AudioManager::class.java)
        if (audio != null && audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
        val generator = tone ?: createTone() ?: return
        generator.startTone(ToneGenerator.TONE_PROP_BEEP, BEEP_MS)
    }

    private fun createTone(): ToneGenerator? {
        if (toneUnavailable) return null
        return try {
            ToneGenerator(AudioManager.STREAM_MUSIC, BEEP_VOLUME).also { tone = it }
        } catch (_: RuntimeException) {
            // Some devices refuse to create ToneGenerators (audio policy / too many instances).
            toneUnavailable = true
            null
        }
    }

    fun vibrate() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.VIBRATE) != PackageManager.PERMISSION_GRANTED) return
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        if (vibrator == null || !vibrator.hasVibrator()) return
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ->
                vibrator.vibrate(VibrationEffect.createOneShot(VIBRATE_MS, VibrationEffect.DEFAULT_AMPLITUDE))
            else ->
                @Suppress("DEPRECATION")
                vibrator.vibrate(VIBRATE_MS)
        }
    }

    fun release() {
        tone?.release()
        tone = null
    }

    private companion object {
        const val BEEP_MS = 120
        const val BEEP_VOLUME = 80
        const val VIBRATE_MS = 40L
    }
}
