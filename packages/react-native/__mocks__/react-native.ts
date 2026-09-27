/**
 * Minimal react-native stand-in for Node tests. Only what the package imports
 * at module load is provided; the components are not rendered in tests.
 */
const noop = () => undefined;

export const Platform = {
  OS: 'ios' as 'ios' | 'android',
  Version: '17.4' as string | number,
  select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined {
    return spec.ios ?? spec.default;
  },
};

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';

class AnimatedValue {
  constructor(public value: number) {}
  setValue(v: number) {
    this.value = v;
  }
}
const animation = { start: noop, stop: noop };
export const Animated = {
  View: 'Animated.View',
  Value: AnimatedValue,
  timing: () => animation,
  sequence: () => animation,
  parallel: () => animation,
  loop: () => animation,
  delay: () => animation,
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => ({ remove: noop }),
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
};

export const Linking = { openSettings: () => Promise.resolve() };

export const PermissionsAndroid = {
  PERMISSIONS: { CAMERA: 'android.permission.CAMERA' },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
  check: () => Promise.resolve(true),
  request: () => Promise.resolve('granted'),
};

export const vibrateCalls: unknown[] = [];
export const Vibration = {
  vibrate: (pattern?: unknown) => {
    vibrateCalls.push(pattern);
  },
  cancel: noop,
};

export const NativeModules: Record<string, unknown> = {};
