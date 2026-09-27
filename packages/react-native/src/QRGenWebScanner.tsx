/**
 * `QRGenWebScanner`: zero-native-setup scanner that runs the hosted QRGen
 * embed page inside react-native-webview and talks to it over the SPEC
 * section 5 bridge.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, Text, View, Vibration, type StyleProp, type ViewStyle } from 'react-native';
import { buildCommandScript, buildEmbedUrl, parseEmbedMessage, type EmbedCommand } from './embed';
import { createQRGenError } from './errors';
import type { Barcode, QRGenError, QRGenErrorCode, ScannerOptions, TrackedBarcode } from './types';

declare const require: (id: string) => unknown;

type WebViewModule = typeof import('react-native-webview');
type WebViewComponent = WebViewModule['WebView'];
type WebViewInstance = InstanceType<WebViewComponent>;

let webViewCache: { component: WebViewComponent | null } | undefined;

/** Loads react-native-webview lazily; `null` when it is not installed. */
export function loadWebView(): WebViewComponent | null {
  if (!webViewCache) {
    try {
      const mod = require('react-native-webview') as WebViewModule;
      webViewCache = { component: mod.WebView ?? (mod as unknown as { default: WebViewComponent }).default ?? null };
    } catch {
      webViewCache = { component: null };
    }
  }
  return webViewCache.component;
}

/** True when react-native-webview is installed. */
export function isWebViewAvailable(): boolean {
  return loadWebView() !== null;
}

/** Props of {@link QRGenWebScanner}. */
export interface QRGenWebScannerProps extends ScannerOptions {
  /** Embed page URL. Default `https://rockyljewell.github.io/QR-GEN/embed/`; set it to self-host. */
  embedUrl?: string;
  /** Run the camera. Set it to `false` when the screen is not visible. Default `true`. */
  isActive?: boolean;
  /** Called with newly scanned codes. */
  onScan?: (barcodes: Barcode[]) => void;
  /** Batch mode: called with every tracked code. */
  onTrack?: (tracked: TrackedBarcode[]) => void;
  /** Called with `{ code, message }` errors from the page or the host. */
  onError?: (error: QRGenError) => void;
  /** Called when the embed page reports `ready`. */
  onReady?: () => void;
  /** Rendered instead of the WebView when it cannot run (permission denied, react-native-webview missing). */
  fallback?: React.ReactNode;
  /** Extra props forwarded to the underlying `<WebView>` (advanced). */
  webViewProps?: Record<string, unknown>;
  style?: StyleProp<ViewStyle>;
}

/** Imperative handle of {@link QRGenWebScanner}. */
export interface QRGenWebScannerHandle {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setTorch(on: boolean): void;
  /** Sends any SPEC section 5 command. */
  sendCommand(command: EmbedCommand): void;
  /** Reloads the embed page. */
  reload(): void;
}

type PermissionState = 'unknown' | 'granted' | 'denied';

function Placeholder({ text }: { text: string | null }) {
  return <View style={styles.placeholder}>{text ? <Text style={styles.placeholderText}>{text}</Text> : null}</View>;
}

/**
 * Scanner that needs no native QRGen code: it loads the hosted embed page in a
 * WebView (camera through `getUserMedia`, decoding with the QRGen WebAssembly
 * engine) and forwards its events. Requires `react-native-webview`.
 *
 * @example
 * <QRGenWebScanner style={{ flex: 1 }} symbologies={['qr']} mode="single" onScan={(c) => alert(c[0].data)} />
 */
export const QRGenWebScanner = forwardRef<QRGenWebScannerHandle, QRGenWebScannerProps>(function QRGenWebScanner(props, ref) {
  const WebView = loadWebView();
  const latest = useRef(props);
  latest.current = props;

  const webRef = useRef<WebViewInstance | null>(null);
  const readyRef = useRef(false);
  const pending = useRef<EmbedCommand[]>([]);
  const [permission, setPermission] = useState<PermissionState>(Platform.OS === 'android' ? 'unknown' : 'granted');
  const [failure, setFailure] = useState<QRGenError | null>(null);
  const [mountKey, setMountKey] = useState(0);
  const [appActive, setAppActive] = useState<boolean>(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');

  const emitError = useCallback((code: QRGenErrorCode, message?: string) => {
    const err = createQRGenError(code, message);
    latest.current.onError?.(err);
    return err;
  }, []);

  // react-native-webview is missing.
  useEffect(() => {
    if (!WebView) {
      setFailure(emitError('engine-load-failed', 'react-native-webview is not installed. Run `npx expo install react-native-webview` or `npm install react-native-webview`.'));
    }
  }, [WebView, emitError]);

  // Android: the app needs the CAMERA runtime permission before the page can call getUserMedia.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    (async () => {
      try {
        const cameraPermission = PermissionsAndroid.PERMISSIONS.CAMERA;
        const granted =
          (await PermissionsAndroid.check(cameraPermission)) ||
          (await PermissionsAndroid.request(cameraPermission)) === PermissionsAndroid.RESULTS.GRANTED;
        if (cancelled) return;
        setPermission(granted ? 'granted' : 'denied');
        if (!granted) setFailure(emitError('camera-permission-denied', 'Camera permission was denied. Enable it in Settings to scan.'));
      } catch (e) {
        if (cancelled) return;
        setPermission('denied');
        setFailure(emitError('camera-permission-denied', e instanceof Error ? e.message : undefined));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [emitError]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Options -> URL. The torch is excluded from the dependencies: changing it sends a command instead of reloading.
  const torch = props.torch ?? false;
  const torchRef = useRef(torch);
  torchRef.current = torch;
  const urlTorch = useRef(torch);
  const symbologyKey = props.symbologies ? props.symbologies.join(',') : '';
  const scanAreaKey = props.scanArea ? JSON.stringify(props.scanArea) : '';
  const url = useMemo(() => {
    const p = latest.current;
    urlTorch.current = torchRef.current;
    return buildEmbedUrl(p.embedUrl, {
      symbologies: p.symbologies,
      mode: p.mode,
      duplicateFilter: p.duplicateFilter,
      beep: p.beep,
      // Vibration is done natively (navigator.vibrate is not available in iOS WKWebView).
      vibrate: false,
      camera: p.camera,
      torch: torchRef.current,
      viewfinder: p.viewfinder,
      scanArea: p.scanArea,
      maxResults: p.maxResults,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.embedUrl, symbologyKey, props.mode, props.duplicateFilter, props.beep, props.camera, props.viewfinder, scanAreaKey, props.maxResults]);

  const inject = useCallback((command: EmbedCommand) => {
    webRef.current?.injectJavaScript(buildCommandScript(command));
  }, []);

  const sendCommand = useCallback(
    (command: EmbedCommand) => {
      if (readyRef.current && webRef.current) {
        inject(command);
      } else {
        // Keep only the latest command of each type until the page is ready.
        pending.current = pending.current.filter((c) => c.type !== command.type).concat(command);
      }
    },
    [inject],
  );

  const active = (props.isActive ?? true) && appActive;
  const activeRef = useRef(active);
  activeRef.current = active;

  // A new URL (or a remount) loads a new page: wait for its `ready`.
  useEffect(() => {
    readyRef.current = false;
  }, [url, mountKey]);

  // isActive / app state -> start/stop.
  const firstActive = useRef(true);
  useEffect(() => {
    if (firstActive.current) {
      firstActive.current = false;
      if (active) return; // the page starts on its own
    }
    sendCommand({ type: active ? 'start' : 'stop' });
  }, [active, sendCommand]);

  // Torch prop -> command.
  const firstTorch = useRef(true);
  useEffect(() => {
    if (firstTorch.current) {
      firstTorch.current = false;
      return;
    }
    sendCommand({ type: 'torch', value: torch });
  }, [torch, sendCommand]);

  const onMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      const message = parseEmbedMessage(event.nativeEvent.data);
      if (!message) return;
      const p = latest.current;
      switch (message.type) {
        case 'ready': {
          readyRef.current = true;
          const queued = pending.current;
          pending.current = [];
          if (!activeRef.current && !queued.some((c) => c.type === 'stop' || c.type === 'start')) queued.push({ type: 'stop' });
          if (torchRef.current !== urlTorch.current && !queued.some((c) => c.type === 'torch')) queued.push({ type: 'torch', value: torchRef.current });
          queued.forEach(inject);
          setFailure(null);
          p.onReady?.();
          break;
        }
        case 'scan':
          if (message.barcodes.length === 0) break;
          if (p.vibrate !== false) {
            try {
              Vibration.vibrate(50);
            } catch {
              // No vibrator or missing VIBRATE permission.
            }
          }
          p.onScan?.(message.barcodes);
          break;
        case 'track':
          p.onTrack?.(message.tracked);
          break;
        case 'error':
          p.onError?.(message.error);
          break;
      }
    },
    [inject],
  );

  useImperativeHandle(
    ref,
    () => ({
      start: () => sendCommand({ type: 'start' }),
      stop: () => sendCommand({ type: 'stop' }),
      pause: () => sendCommand({ type: 'pause' }),
      resume: () => sendCommand({ type: 'resume' }),
      setTorch: (on: boolean) => {
        torchRef.current = on;
        sendCommand({ type: 'torch', value: on });
      },
      sendCommand,
      reload: () => {
        readyRef.current = false;
        webRef.current?.reload();
      },
    }),
    [sendCommand],
  );

  const onLoadError = useCallback(
    (event: { nativeEvent: { description?: string } }) => {
      emitError('engine-load-failed', `Could not load the QRGen embed page: ${event.nativeEvent.description ?? 'unknown error'}`);
    },
    [emitError],
  );
  const onHttpError = useCallback(
    (event: { nativeEvent: { statusCode: number } }) => {
      emitError('engine-load-failed', `The QRGen embed page returned HTTP ${event.nativeEvent.statusCode}.`);
    },
    [emitError],
  );
  // iOS: the WebContent process was killed (memory pressure). Reload it.
  const onContentProcessDidTerminate = useCallback(() => {
    readyRef.current = false;
    webRef.current?.reload();
  }, []);
  // Android: the renderer died. Remount instead of crashing the app.
  const onRenderProcessGone = useCallback(() => {
    readyRef.current = false;
    setMountKey((k) => k + 1);
  }, []);

  const canRender = WebView != null && permission === 'granted';

  return (
    <View style={[styles.container, props.style]}>
      {canRender && WebView ? (
        <WebView
          key={mountKey}
          ref={webRef}
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          mediaCapturePermissionGrantType="grant"
          allowsBackForwardNavigationGestures={false}
          bounces={false}
          scrollEnabled={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          onMessage={onMessage}
          onError={onLoadError}
          onHttpError={onHttpError}
          onContentProcessDidTerminate={onContentProcessDidTerminate}
          onRenderProcessGone={onRenderProcessGone}
          {...props.webViewProps}
        />
      ) : (
        props.fallback ?? <Placeholder text={failure ? failure.message : null} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  placeholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0B0F14',
  },
  placeholderText: {
    color: '#E5E7EB',
    fontSize: 15,
    textAlign: 'center',
  },
});
