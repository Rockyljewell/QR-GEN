/**
 * QRGen symbology ids, names, aliases and groups (SPEC section 1), plus the
 * mapping between QRGen ids and react-native-vision-camera code types.
 *
 * This module is pure TypeScript: it never imports react-native, so it can be
 * used (and unit tested) in Node.
 */

/** Every symbology id defined by the QRGen specification. */
export type SymbologyId =
  | 'qr'
  | 'micro-qr'
  | 'rmqr'
  | 'data-matrix'
  | 'aztec'
  | 'pdf417'
  | 'micro-pdf417'
  | 'maxicode'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'isbn'
  | 'code128'
  | 'code39'
  | 'code93'
  | 'codabar'
  | 'itf'
  | 'itf14'
  | 'databar'
  | 'databar-expanded'
  | 'databar-limited'
  | 'code32'
  | 'pzn'
  | 'telepen'
  | 'dx-film-edge';

/** Symbology group names accepted wherever a list of symbologies is accepted. */
export type SymbologyGroup = 'all' | 'linear' | '1d' | 'matrix' | '2d' | 'retail' | 'industrial' | 'gs1';

/** Static description of one symbology. */
export interface SymbologyInfo {
  /** QRGen id, for example `ean13`. */
  readonly id: SymbologyId;
  /** Human readable name, for example `EAN-13`. */
  readonly name: string;
  /** Extra spellings accepted as input (matched after normalization). */
  readonly aliases: readonly string[];
  /** `linear` (1D) or `matrix` (2D / stacked). */
  readonly kind: 'linear' | 'matrix';
}

/** All symbologies in canonical SPEC order. */
export const SYMBOLOGIES: readonly SymbologyInfo[] = [
  { id: 'qr', name: 'QR Code', aliases: ['qrcode'], kind: 'matrix' },
  { id: 'micro-qr', name: 'Micro QR Code', aliases: ['microqrcode'], kind: 'matrix' },
  { id: 'rmqr', name: 'rMQR Code', aliases: ['rmqrcode'], kind: 'matrix' },
  { id: 'data-matrix', name: 'Data Matrix', aliases: ['datamatrix', 'dm'], kind: 'matrix' },
  { id: 'aztec', name: 'Aztec', aliases: ['azteccode'], kind: 'matrix' },
  { id: 'pdf417', name: 'PDF417', aliases: ['compactpdf417'], kind: 'matrix' },
  { id: 'micro-pdf417', name: 'MicroPDF417', aliases: ['micropdf417'], kind: 'matrix' },
  { id: 'maxicode', name: 'MaxiCode', aliases: [], kind: 'matrix' },
  { id: 'ean13', name: 'EAN-13', aliases: ['ean', 'jan', 'gtin13'], kind: 'linear' },
  { id: 'ean8', name: 'EAN-8', aliases: ['gtin8'], kind: 'linear' },
  { id: 'upca', name: 'UPC-A', aliases: ['upc'], kind: 'linear' },
  { id: 'upce', name: 'UPC-E', aliases: [], kind: 'linear' },
  { id: 'isbn', name: 'ISBN', aliases: ['isbn13'], kind: 'linear' },
  { id: 'code128', name: 'Code 128', aliases: ['gs1128', 'ean128'], kind: 'linear' },
  { id: 'code39', name: 'Code 39', aliases: ['code3of9'], kind: 'linear' },
  { id: 'code93', name: 'Code 93', aliases: [], kind: 'linear' },
  { id: 'codabar', name: 'Codabar', aliases: ['nw7'], kind: 'linear' },
  { id: 'itf', name: 'Interleaved 2 of 5', aliases: ['interleaved2of5', 'i2of5'], kind: 'linear' },
  { id: 'itf14', name: 'ITF-14', aliases: [], kind: 'linear' },
  { id: 'databar', name: 'GS1 DataBar', aliases: ['rss14', 'databaromni'], kind: 'linear' },
  { id: 'databar-expanded', name: 'GS1 DataBar Expanded', aliases: ['rssexpanded'], kind: 'linear' },
  { id: 'databar-limited', name: 'GS1 DataBar Limited', aliases: ['rsslimited'], kind: 'linear' },
  { id: 'code32', name: 'Code 32 (Italian Pharmacode)', aliases: [], kind: 'linear' },
  { id: 'pzn', name: 'PZN', aliases: [], kind: 'linear' },
  { id: 'telepen', name: 'Telepen', aliases: [], kind: 'linear' },
  { id: 'dx-film-edge', name: 'DX Film Edge', aliases: [], kind: 'linear' },
];

/** All symbology ids in canonical SPEC order. */
export const SYMBOLOGY_IDS: readonly SymbologyId[] = SYMBOLOGIES.map((s) => s.id);

const LINEAR: readonly SymbologyId[] = [
  'ean13', 'ean8', 'upca', 'upce', 'isbn', 'code128', 'code39', 'code93', 'codabar', 'itf', 'itf14',
  'databar', 'databar-expanded', 'databar-limited', 'code32', 'pzn', 'telepen', 'dx-film-edge',
];
const MATRIX: readonly SymbologyId[] = [
  'qr', 'micro-qr', 'rmqr', 'data-matrix', 'aztec', 'pdf417', 'micro-pdf417', 'maxicode',
];

/** Group name to member ids (SPEC section 1). */
export const SYMBOLOGY_GROUPS: Readonly<Record<SymbologyGroup, readonly SymbologyId[]>> = {
  all: SYMBOLOGY_IDS,
  linear: LINEAR,
  '1d': LINEAR,
  matrix: MATRIX,
  '2d': MATRIX,
  retail: ['ean13', 'ean8', 'upca', 'upce', 'isbn', 'databar', 'databar-expanded', 'databar-limited'],
  industrial: ['code128', 'code39', 'code93', 'codabar', 'itf', 'itf14', 'data-matrix'],
  gs1: ['code128', 'data-matrix', 'qr', 'databar', 'databar-expanded', 'databar-limited'],
};

/**
 * Normalizes user input for matching: lowercase, then remove everything except
 * `[a-z0-9]`. `"QR-Code"` becomes `"qrcode"`.
 */
export function normalizeSymbologyKey(input: string): string {
  return String(input).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_ID = new Map<SymbologyId, SymbologyInfo>(SYMBOLOGIES.map((s) => [s.id, s]));
const ID_BY_KEY = new Map<string, SymbologyId>();
for (const s of SYMBOLOGIES) {
  ID_BY_KEY.set(normalizeSymbologyKey(s.id), s.id);
  for (const alias of s.aliases) ID_BY_KEY.set(normalizeSymbologyKey(alias), s.id);
}
const GROUP_BY_KEY = new Map<string, SymbologyGroup>(
  (Object.keys(SYMBOLOGY_GROUPS) as SymbologyGroup[]).map((g) => [normalizeSymbologyKey(g), g]),
);

/** Returns true when `value` is a canonical QRGen symbology id. */
export function isSymbologyId(value: unknown): value is SymbologyId {
  return typeof value === 'string' && BY_ID.has(value as SymbologyId);
}

/**
 * Resolves a single id or alias (case-insensitive, punctuation-insensitive) to
 * a canonical id. Returns `null` for groups and unknown input.
 *
 * @example resolveSymbology('QR-Code') // 'qr'
 */
export function resolveSymbology(input: string): SymbologyId | null {
  if (typeof input !== 'string') return null;
  return ID_BY_KEY.get(normalizeSymbologyKey(input)) ?? null;
}

/** Resolves a group name such as `"1D"` to its canonical group, or `null`. */
export function resolveSymbologyGroup(input: string): SymbologyGroup | null {
  if (typeof input !== 'string') return null;
  return GROUP_BY_KEY.get(normalizeSymbologyKey(input)) ?? null;
}

/**
 * Expands ids, aliases and groups into a de-duplicated list of canonical ids,
 * in order of first appearance. Unknown entries are dropped silently.
 * `undefined`, `null`, `""` or an empty list resolve to every id (`all`, the
 * SPEC default). A non-empty list made only of unknown entries resolves to
 * `[]`. A comma-separated string is accepted too.
 *
 * @example resolveSymbologies(['QR', 'retail']) // ['qr', 'ean13', 'ean8', ...]
 */
export function resolveSymbologies(input?: string | readonly string[] | null): SymbologyId[] {
  const list: readonly string[] =
    input == null ? [] : typeof input === 'string' ? input.split(',').filter((s) => s.trim() !== '') : input;
  if (list.length === 0) return [...SYMBOLOGY_IDS];
  const out: SymbologyId[] = [];
  const seen = new Set<SymbologyId>();
  const push = (id: SymbologyId) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const id = resolveSymbology(entry);
    if (id) {
      push(id);
      continue;
    }
    const group = resolveSymbologyGroup(entry);
    if (group) SYMBOLOGY_GROUPS[group].forEach(push);
  }
  return out;
}

/** Returns the static description of a symbology id. */
export function getSymbologyInfo(id: SymbologyId): SymbologyInfo {
  const info = BY_ID.get(id);
  if (!info) throw new TypeError(`Unknown QRGen symbology id: ${String(id)}`);
  return info;
}

/** Human readable name for an id or alias (`"ean-13"` gives `"EAN-13"`). Unknown input is returned as-is. */
export function symbologyName(id: string): string {
  const resolved = resolveSymbology(id);
  return resolved ? BY_ID.get(resolved)!.name : id;
}

/** True when every id in the list is a linear (1D) symbology. Used to pick the default viewfinder. */
export function isLinearOnly(ids: readonly SymbologyId[]): boolean {
  return ids.length > 0 && ids.every((id) => BY_ID.get(id)?.kind === 'linear');
}

/* ------------------------------------------------------------------------ */
/* react-native-vision-camera mapping                                       */
/* ------------------------------------------------------------------------ */

/**
 * Code types understood by react-native-vision-camera 4.x. Structurally
 * identical to vision-camera's own `CodeType`, declared here so this module
 * does not depend on the native package.
 */
export type VisionCameraCodeType =
  | 'code-128'
  | 'code-39'
  | 'code-93'
  | 'codabar'
  | 'gs1-data-bar'
  | 'gs1-data-bar-limited'
  | 'gs1-data-bar-expanded'
  | 'ean-13'
  | 'ean-8'
  | 'itf'
  | 'itf-14'
  | 'upc-e'
  | 'upc-a'
  | 'qr'
  | 'pdf-417'
  | 'aztec'
  | 'data-matrix';

/** Platform description used by the vision-camera mapping. */
export interface PlatformInfo {
  /** `Platform.OS` from react-native. */
  os: 'ios' | 'android' | string;
  /** `Platform.Version` (a string such as `"17.4"` on iOS, the API level on Android). */
  version?: string | number;
}

/**
 * Code types per QRGen id and platform. vision-camera uses ML Kit on Android
 * (no ITF-14 or DataBar, ITF-14 is read as ITF) and AVFoundation on iOS
 * (UPC-A and ISBN are read as EAN-13; Codabar and DataBar need iOS 15.4).
 */
const VISION_CAMERA_MAP: Readonly<Partial<Record<SymbologyId, { ios: VisionCameraCodeType[]; android: VisionCameraCodeType[] }>>> = {
  qr: { ios: ['qr'], android: ['qr'] },
  'data-matrix': { ios: ['data-matrix'], android: ['data-matrix'] },
  aztec: { ios: ['aztec'], android: ['aztec'] },
  pdf417: { ios: ['pdf-417'], android: ['pdf-417'] },
  ean13: { ios: ['ean-13'], android: ['ean-13'] },
  ean8: { ios: ['ean-8'], android: ['ean-8'] },
  upca: { ios: ['upc-a'], android: ['upc-a'] },
  upce: { ios: ['upc-e'], android: ['upc-e'] },
  isbn: { ios: ['ean-13'], android: ['ean-13'] },
  code128: { ios: ['code-128'], android: ['code-128'] },
  code39: { ios: ['code-39'], android: ['code-39'] },
  code93: { ios: ['code-93'], android: ['code-93'] },
  codabar: { ios: ['codabar'], android: ['codabar'] },
  itf: { ios: ['itf', 'itf-14'], android: ['itf'] },
  itf14: { ios: ['itf-14'], android: ['itf'] },
  databar: { ios: ['gs1-data-bar'], android: [] },
  'databar-expanded': { ios: ['gs1-data-bar-expanded'], android: [] },
  'databar-limited': { ios: ['gs1-data-bar-limited'], android: [] },
};

/** Code types that AVFoundation only offers from iOS 15.4. */
const IOS_15_4_TYPES: ReadonlySet<VisionCameraCodeType> = new Set([
  'codabar',
  'gs1-data-bar',
  'gs1-data-bar-limited',
  'gs1-data-bar-expanded',
]);

function iosAtLeast(version: string | number | undefined, major: number, minor: number): boolean {
  if (version == null || version === '') return true; // unknown: assume a current OS
  const [maj = 0, min = 0] = String(version).split('.').map((p) => parseInt(p, 10) || 0);
  return maj > major || (maj === major && min >= minor);
}

function platformTypes(id: SymbologyId, platform: PlatformInfo): VisionCameraCodeType[] {
  const entry = VISION_CAMERA_MAP[id];
  if (!entry) return [];
  if (platform.os === 'ios') {
    const modern = iosAtLeast(platform.version, 15, 4);
    return entry.ios.filter((t) => modern || !IOS_15_4_TYPES.has(t));
  }
  // Android and anything else: the ML Kit set.
  return entry.android;
}

/**
 * Maps QRGen ids, aliases or groups to the vision-camera code types for the
 * given platform. Ids that vision-camera cannot read on that platform are
 * dropped silently; the result is de-duplicated.
 *
 * @example toVisionCameraCodeTypes(['qr', 'upca'], { os: 'android' }) // ['qr', 'upc-a']
 */
export function toVisionCameraCodeTypes(
  symbologies: string | readonly string[] | null | undefined,
  platform: PlatformInfo,
): VisionCameraCodeType[] {
  const out = new Set<VisionCameraCodeType>();
  for (const id of resolveSymbologies(symbologies)) {
    for (const t of platformTypes(id, platform)) out.add(t);
  }
  return [...out];
}

/** The QRGen ids the vision-camera back end can read on the given platform. */
export function visionCameraSupportedSymbologies(platform: PlatformInfo): SymbologyId[] {
  return SYMBOLOGY_IDS.filter((id) => platformTypes(id, platform).length > 0);
}

const isDigits = (s: string) => /^[0-9]+$/.test(s);

/**
 * Converts a code reported by vision-camera back to a QRGen id and data,
 * restricted to the requested ids. Returns `null` when the code does not match
 * any requested id (for example an EAN-13 when only `upca` was requested, which
 * happens on iOS where UPC-A is scanned as EAN-13).
 *
 * - `ean-13` starting with `978`/`979` becomes `isbn` when requested.
 * - `ean-13` with a leading `0` becomes a 12 digit `upca` when requested.
 * - `itf` with 14 digits becomes `itf14` when requested.
 */
export function fromVisionCameraCode(
  type: string,
  value: string,
  requested: readonly SymbologyId[],
): { symbology: SymbologyId; data: string } | null {
  const want = new Set(requested);
  const pick = (symbology: SymbologyId, data: string = value) =>
    want.has(symbology) ? { symbology, data } : null;

  switch (type) {
    case 'ean-13': {
      const digits = isDigits(value);
      if (digits && value.length === 13 && (value.startsWith('978') || value.startsWith('979'))) {
        const isbn = pick('isbn');
        if (isbn) return isbn;
      }
      if (digits && value.length === 13 && value.startsWith('0')) {
        const upc = pick('upca', value.slice(1));
        if (upc) return upc;
      }
      return pick('ean13');
    }
    case 'upc-a':
      return pick('upca') ?? (isDigits(value) && value.length === 12 ? pick('ean13', `0${value}`) : null);
    case 'itf': {
      if (isDigits(value) && value.length === 14) {
        const itf14 = pick('itf14');
        if (itf14) return itf14;
      }
      return pick('itf');
    }
    case 'itf-14':
      return pick('itf14') ?? pick('itf');
    case 'ean-8':
      return pick('ean8');
    case 'upc-e':
      return pick('upce');
    case 'qr':
      return pick('qr');
    case 'data-matrix':
      return pick('data-matrix');
    case 'aztec':
      return pick('aztec');
    case 'pdf-417':
      return pick('pdf417');
    case 'code-128':
      return pick('code128');
    case 'code-39':
      return pick('code39');
    case 'code-93':
      return pick('code93');
    case 'codabar':
      return pick('codabar');
    case 'gs1-data-bar':
      return pick('databar');
    case 'gs1-data-bar-expanded':
      return pick('databar-expanded');
    case 'gs1-data-bar-limited':
      return pick('databar-limited');
    default:
      return null;
  }
}
