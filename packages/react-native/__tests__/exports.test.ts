// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * Loads the package entry point against the react-native mock to make sure the
 * public surface exists and that importing it never requires the native
 * vision-camera module (which is missing here, as in Expo Go).
 */
import * as sdk from '../src/index';
import { setBeepHandler } from '../src/feedback';
import { playScanFeedback } from '../src/feedback';
import { vibrateCalls } from '../__mocks__/react-native';

describe('package entry point', () => {
  it('exports the public API', () => {
    for (const name of [
      'QRGenScanner',
      'QRGenWebScanner',
      'ScannerOverlay',
      'setBeepHandler',
      'resolveSymbologies',
      'toVisionCameraCodeTypes',
      'DuplicateFilter',
      'BarcodeTracker',
      'ScanSession',
      'parseEmbedMessage',
      'buildEmbedUrl',
      'buildCommandScript',
      'DEFAULT_EMBED_URL',
      'QRGEN_ACCENT_COLOR',
      'DEFAULT_SCANNER_OPTIONS',
      'supportedSymbologies',
    ]) {
      expect(sdk).toHaveProperty(name);
    }
    expect(sdk.QRGEN_ACCENT_COLOR).toBe('#2EC1CE');
  });

  it('reports vision-camera as unavailable without its native module', () => {
    expect(sdk.isVisionCameraAvailable()).toBe(false);
  });

  it('reports the supported symbologies for the mocked platform (iOS 17.4)', () => {
    expect(sdk.supportedSymbologies()).toContain('itf14');
    expect(sdk.supportedSymbologies()).toContain('databar');
  });
});

describe('scan feedback', () => {
  afterEach(() => setBeepHandler(null));

  it('vibrates and calls the registered beep', () => {
    const beep = jest.fn();
    setBeepHandler(beep);
    const before = vibrateCalls.length;
    playScanFeedback(true, true);
    expect(beep).toHaveBeenCalledTimes(1);
    expect(vibrateCalls.length).toBe(before + 1);
  });

  it('prefers a function prop, respects false, and swallows errors', () => {
    const registered = jest.fn();
    setBeepHandler(registered);
    const own = jest.fn(() => {
      throw new Error('no audio');
    });
    const before = vibrateCalls.length;
    expect(() => playScanFeedback(own, false)).not.toThrow();
    expect(own).toHaveBeenCalled();
    expect(registered).not.toHaveBeenCalled();
    playScanFeedback(false, false);
    expect(registered).not.toHaveBeenCalled();
    expect(vibrateCalls.length).toBe(before);
  });
});
