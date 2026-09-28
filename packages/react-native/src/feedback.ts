// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Scan feedback: vibration through React Native's `Vibration` API and an
 * optional, app-provided beep.
 *
 * React Native has no built-in way to play a sound, and QRGen does not add a
 * hard dependency on a sound library. Register a player once with
 * {@link setBeepHandler} (for example with `expo-audio` or
 * `react-native-sound`), or pass a function as the `beep` prop.
 */
import { Vibration } from 'react-native';

/** A function that plays the scan sound. */
export type BeepHandler = () => void | Promise<void>;

let defaultBeep: BeepHandler | null = null;

/**
 * Registers the sound played when `beep` is `true` (the default). Pass `null`
 * to unregister. Without a handler, `beep={true}` is a silent no-op.
 *
 * @example
 * import { createAudioPlayer } from 'expo-audio';
 * const player = createAudioPlayer(require('./beep.mp3'));
 * setBeepHandler(() => { player.seekTo(0); player.play(); });
 */
export function setBeepHandler(handler: BeepHandler | null): void {
  defaultBeep = handler;
}

/** Plays the scan feedback. Errors from the beep handler are swallowed. */
export function playScanFeedback(beep: boolean | BeepHandler | undefined, vibrate: boolean | undefined): void {
  const handler = typeof beep === 'function' ? beep : beep === false ? null : defaultBeep;
  if (handler) {
    try {
      const result = handler();
      if (result && typeof (result as Promise<void>).catch === 'function') (result as Promise<void>).catch(() => undefined);
    } catch {
      // A failing sound must never break scanning.
    }
  }
  if (vibrate !== false) {
    try {
      Vibration.vibrate(50);
    } catch {
      // Missing VIBRATE permission on Android, or no vibrator.
    }
  }
}
