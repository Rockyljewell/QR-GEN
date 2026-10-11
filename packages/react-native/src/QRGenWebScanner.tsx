// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
/**
 * `QRGenWebScanner`: zero-native-setup scanner that runs the hosted QRGen
 * embed page inside react-native-webview and talks to it over the SPEC
 * section 5 bridge.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, Text, View, Vibration, type StyleProp, type ViewStyle } from 'react-native';
import { buildEmbedUrl, parseEmbedMessage, type EmbedCommand } from './embed';
import { createQRGenError } from './errors';
import { WebScannerTransport } from './webScannerTransport';
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
  const live = useRef(true);
  const transportRef = useRef<WebScannerTransport | null>(null);
  if (!transportRef.current) transportRef.current = new WebScannerTransport(script => {
    const web = webRef.current;
    if (!web) return false;
    web.injectJavaScript(script);
    return true;
  });
  const transport = transportRef.current;
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

  const sendCommand = useCallback((command: EmbedCommand) => transport.send(command), [transport]);
  const invalidate = useCallback(() => {
    transport.reset();
  }, [transport]);

  const active = (props.isActive ?? true) && appActive;
  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    live.current = true;
    transport.activate();
    return () => { live.current = false; transport.deactivate(); };
  }, [transport]);

  // A committed source/remount invalidates all old admission attempts.
  useLayoutEffect(invalidate, [url, mountKey, invalidate]);

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
      if (!live.current) return true;
      if (transport.receive(event.nativeEvent.data)) return true;
      const message = parseEmbedMessage(event.nativeEvent.data);
      if (!message) return;
      const p = latest.current;
      switch (message.type) {
        case 'ready': {
          const epoch = transport.epoch;
          if (!activeRef.current && !transport.has('stop') && !transport.has('start')) transport.send({ type: 'stop' });
          if (torchRef.current !== urlTorch.current && !transport.has('torch')) transport.send({ type: 'torch', value: torchRef.current });
          if (!transport.ready() || !live.current || transport.epoch !== epoch) return;
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
    [transport],
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
        invalidate();
        webRef.current?.reload();
      },
    }),
    [sendCommand, invalidate],
  );

  const onLoadError = useCallback(
    (event: { nativeEvent: { description?: string } }) => {
      transport.failed();
      emitError('engine-load-failed', `Could not load the QRGen embed page: ${event.nativeEvent.description ?? 'unknown error'}`);
    },
    [emitError, transport],
  );
  const onHttpError = useCallback(
    (event: { nativeEvent: { statusCode: number } }) => {
      transport.failed();
      emitError('engine-load-failed', `The QRGen embed page returned HTTP ${event.nativeEvent.statusCode}.`);
    },
    [emitError, transport],
  );
  // iOS: the WebContent process was killed (memory pressure). Reload it.
  const onContentProcessDidTerminate = useCallback(() => {
    invalidate();
    webRef.current?.reload();
  }, [invalidate]);
  // Android: the renderer died. Remount instead of crashing the app.
  const onRenderProcessGone = useCallback(() => {
    invalidate();
    setMountKey((k) => k + 1);
  }, [invalidate]);

  const advanced = props.webViewProps;
  const compose = <Event,>(internal: (event: Event) => boolean | void, name: string) => (event: Event) => {
    if (!live.current) return;
    const consumed = internal(event);
    if (consumed === true || !live.current) return;
    const callback = latest.current.webViewProps?.[name];
    if (typeof callback === 'function') callback(event);
  };

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
          {...advanced}
          onMessage={compose(onMessage, 'onMessage')}
          onLoadStart={compose(invalidate, 'onLoadStart')}
          onLoadEnd={compose(() => transport.loaded(), 'onLoadEnd')}
          onError={compose(onLoadError, 'onError')}
          onHttpError={compose(onHttpError, 'onHttpError')}
          onContentProcessDidTerminate={compose(onContentProcessDidTerminate, 'onContentProcessDidTerminate')}
          onRenderProcessGone={compose(onRenderProcessGone, 'onRenderProcessGone')}
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
