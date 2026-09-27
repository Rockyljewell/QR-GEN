/**
 * Embed bridge helpers (SPEC section 5): URL building, message parsing and
 * host-to-page commands for the hosted WebView scanner. Pure TypeScript.
 */
import { normalizeBarcode, normalizeTrackedBarcode } from './barcode';
import { createQRGenError } from './errors';
import type { Barcode, QRGenError, ScannerOptions, TrackedBarcode } from './types';

/** The hosted embed page. Override it to self-host. */
export const DEFAULT_EMBED_URL = 'https://rockyljewell.github.io/QR-GEN/embed/';

/** Envelope `source` of page-to-host messages. */
export const EMBED_SOURCE = 'qrgen';

/** Envelope `source` of host-to-page `postMessage` commands. */
export const EMBED_HOST_SOURCE = 'qrgen-host';

/** A parsed page-to-host message. */
export type EmbedMessage =
  | { type: 'ready'; version: number }
  | { type: 'scan'; version: number; barcodes: Barcode[] }
  | { type: 'track'; version: number; tracked: TrackedBarcode[] }
  | { type: 'error'; version: number; error: QRGenError };

/** A host-to-page command. */
export type EmbedCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'torch'; value: boolean };

const flag = (b: boolean) => (b ? '1' : '0');

/**
 * Builds the embed URL with SPEC section 4 options in the query string. Lists
 * are comma-separated, booleans are `1`/`0`, `scanArea` is `x,y,width,height`.
 * Only options that are set are written, so the page defaults apply otherwise.
 * An existing query string or hash on `baseUrl` is preserved.
 *
 * @example buildEmbedUrl(undefined, { symbologies: ['qr', 'ean13'], mode: 'single' })
 * // 'https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single'
 */
export function buildEmbedUrl(baseUrl: string | undefined | null, options: ScannerOptions = {}): string {
  const base = baseUrl && baseUrl.length > 0 ? baseUrl : DEFAULT_EMBED_URL;
  const hashIndex = base.indexOf('#');
  const hash = hashIndex >= 0 ? base.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? base.slice(0, hashIndex) : base;

  const params: string[] = [];
  const add = (key: string, value: string) => params.push(`${key}=${value}`);
  const enc = encodeURIComponent;

  if (options.symbologies && options.symbologies.length > 0) {
    const list = options.symbologies.map((s) => String(s).trim()).filter((s) => s.length > 0);
    if (list.length > 0) add('symbologies', list.map(enc).join(','));
  }
  if (options.mode) add('mode', enc(options.mode));
  if (typeof options.duplicateFilter === 'number' && Number.isFinite(options.duplicateFilter)) {
    add('duplicateFilter', String(Math.round(options.duplicateFilter)));
  }
  if (typeof options.beep === 'boolean') add('beep', flag(options.beep));
  if (typeof options.vibrate === 'boolean') add('vibrate', flag(options.vibrate));
  if (options.camera) add('camera', enc(options.camera));
  if (typeof options.torch === 'boolean') add('torch', flag(options.torch));
  if (options.viewfinder) add('viewfinder', enc(options.viewfinder));
  if (options.scanArea) {
    const { x, y, width, height } = options.scanArea;
    if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      add('scanArea', [x, y, width, height].map((n) => String(n)).join(','));
    }
  }
  if (typeof options.maxResults === 'number' && options.maxResults > 0) add('maxResults', String(Math.floor(options.maxResults)));

  if (params.length === 0) return base;
  const separator = withoutHash.includes('?') ? (/[?&]$/.test(withoutHash) ? '' : '&') : '?';
  return `${withoutHash}${separator}${params.join('&')}${hash}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses a page-to-host message. Accepts the JSON string posted by the page
 * (what `react-native-webview` delivers in `event.nativeEvent.data`) or an
 * already parsed object. Returns `null` for anything that is not a valid
 * `source: "qrgen"` envelope, so unrelated messages can be ignored safely.
 * Invalid barcodes inside a valid envelope are skipped.
 */
export function parseEmbedMessage(raw: unknown): EmbedMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObject(value) || value.source !== EMBED_SOURCE || typeof value.type !== 'string') return null;
  const version = typeof value.version === 'number' ? value.version : 1;
  switch (value.type) {
    case 'ready':
      return { type: 'ready', version };
    case 'scan': {
      const list = Array.isArray(value.barcodes) ? value.barcodes : [];
      const barcodes = list.map(normalizeBarcode).filter((b): b is Barcode => b !== null);
      return { type: 'scan', version, barcodes };
    }
    case 'track': {
      const list = Array.isArray(value.tracked) ? value.tracked : [];
      const tracked = list.map(normalizeTrackedBarcode).filter((b): b is TrackedBarcode => b !== null);
      return { type: 'track', version, tracked };
    }
    case 'error':
      return {
        type: 'error',
        version,
        error: createQRGenError(typeof value.code === 'string' ? value.code : 'unknown', typeof value.message === 'string' ? value.message : undefined),
      };
    default:
      return null;
  }
}

/**
 * JavaScript to run in the page (for `injectJavaScript`) that sends a command.
 * Ends with `true;` as react-native-webview requires.
 */
export function buildCommandScript(command: EmbedCommand): string {
  return `window.qrgen && window.qrgen.command(${JSON.stringify(command)}); true;`;
}

/** The `postMessage` form of a command: `{ source: "qrgen-host", ...command }`. */
export function buildCommandMessage(command: EmbedCommand): string {
  return JSON.stringify({ source: EMBED_HOST_SOURCE, ...command });
}
