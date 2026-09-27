/**
 * Symbology ids shared by every QRGen SDK (see docs/SPEC.md §1).
 */
export type Symbology =
  | "qr"
  | "micro-qr"
  | "rmqr"
  | "data-matrix"
  | "aztec"
  | "pdf417"
  | "micro-pdf417"
  | "maxicode"
  | "ean13"
  | "ean8"
  | "upca"
  | "upce"
  | "isbn"
  | "code128"
  | "code39"
  | "code93"
  | "codabar"
  | "itf"
  | "itf14"
  | "databar"
  | "databar-expanded"
  | "databar-limited"
  | "code32"
  | "pzn"
  | "telepen"
  | "dx-film-edge";

export type SymbologyGroup = "all" | "linear" | "1d" | "matrix" | "2d" | "retail" | "industrial" | "gs1";

/** Anything accepted where a list of symbologies is expected. */
export type SymbologyInput = Symbology | SymbologyGroup | (string & {});

export interface SymbologyInfo {
  id: Symbology;
  name: string;
  kind: "linear" | "matrix";
  /** zxing-cpp formats used when reading. */
  read: string[];
  /** zxing-cpp format used when writing, if the symbology can be generated. */
  write?: string;
  aliases: string[];
  /** Short example payload for generators and docs. */
  example: string;
}

export const SYMBOLOGIES: readonly SymbologyInfo[] = [
  { id: "qr", name: "QR Code", kind: "matrix", read: ["QRCodeModel1", "QRCodeModel2"], write: "QRCode", aliases: ["qrcode"], example: "https://rockyljewell.github.io/QR-GEN/" },
  { id: "micro-qr", name: "Micro QR Code", kind: "matrix", read: ["MicroQRCode"], write: "MicroQRCode", aliases: ["microqrcode"], example: "QRGEN" },
  { id: "rmqr", name: "rMQR Code", kind: "matrix", read: ["RMQRCode"], write: "RMQRCode", aliases: ["rmqrcode"], example: "QRGEN-RMQR" },
  { id: "data-matrix", name: "Data Matrix", kind: "matrix", read: ["DataMatrix"], write: "DataMatrix", aliases: ["datamatrix", "dm"], example: "QRGen Data Matrix" },
  { id: "aztec", name: "Aztec", kind: "matrix", read: ["AztecCode", "AztecRune"], write: "AztecCode", aliases: ["azteccode", "aztecrune"], example: "QRGen Aztec" },
  { id: "pdf417", name: "PDF417", kind: "matrix", read: ["PDF417", "CompactPDF417"], write: "PDF417", aliases: ["compactpdf417", "pdf"], example: "QRGen PDF417 sample" },
  { id: "micro-pdf417", name: "MicroPDF417", kind: "matrix", read: ["MicroPDF417"], write: "MicroPDF417", aliases: ["micropdf417", "micropdf"], example: "QRGEN" },
  { id: "maxicode", name: "MaxiCode", kind: "matrix", read: ["MaxiCode"], write: "MaxiCode", aliases: [], example: "QRGen MaxiCode" },
  { id: "ean13", name: "EAN-13", kind: "linear", read: ["EAN13"], write: "EAN13", aliases: ["ean", "jan", "gtin13", "ean13"], example: "5901234123457" },
  { id: "ean8", name: "EAN-8", kind: "linear", read: ["EAN8"], write: "EAN8", aliases: ["gtin8"], example: "96385074" },
  { id: "upca", name: "UPC-A", kind: "linear", read: ["UPCA"], write: "UPCA", aliases: ["upc", "gtin12"], example: "036000291452" },
  { id: "upce", name: "UPC-E", kind: "linear", read: ["UPCE"], write: "UPCE", aliases: [], example: "01234565" },
  { id: "isbn", name: "ISBN", kind: "linear", read: ["ISBN", "EAN13"], write: "ISBN", aliases: ["isbn13", "bookland"], example: "9780306406157" },
  { id: "code128", name: "Code 128", kind: "linear", read: ["Code128"], write: "Code128", aliases: ["gs1128", "ean128", "ucc128"], example: "QRGEN-128" },
  { id: "code39", name: "Code 39", kind: "linear", read: ["Code39", "Code39Std", "Code39Ext"], write: "Code39", aliases: ["code3of9", "code39std", "code39ext", "code39extended"], example: "QRGEN39" },
  { id: "code93", name: "Code 93", kind: "linear", read: ["Code93"], write: "Code93", aliases: [], example: "QRGEN93" },
  { id: "codabar", name: "Codabar", kind: "linear", read: ["Codabar"], write: "Codabar", aliases: ["nw7", "code2of7"], example: "A40156B" },
  { id: "itf", name: "Interleaved 2 of 5", kind: "linear", read: ["ITF"], write: "ITF", aliases: ["interleaved2of5", "i2of5", "i25"], example: "12345678" },
  { id: "itf14", name: "ITF-14", kind: "linear", read: ["ITF14", "ITF"], write: "ITF", aliases: ["gtin14"], example: "15400141288763" },
  { id: "databar", name: "GS1 DataBar", kind: "linear", read: ["DataBar", "DataBarOmni", "DataBarStk", "DataBarStkOmni"], write: "DataBar", aliases: ["rss14", "databaromni", "gs1databar", "rss"], example: "(01)09521234543213" },
  { id: "databar-expanded", name: "GS1 DataBar Expanded", kind: "linear", read: ["DataBarExp", "DataBarExpStk"], write: "DataBarExp", aliases: ["rssexpanded", "databarexp", "gs1databarexpanded"], example: "(01)09521234543213(3103)000123" },
  { id: "databar-limited", name: "GS1 DataBar Limited", kind: "linear", read: ["DataBarLtd"], write: "DataBarLtd", aliases: ["rsslimited", "databarltd", "gs1databarlimited"], example: "(01)09521234543213" },
  { id: "code32", name: "Code 32", kind: "linear", read: ["Code32"], write: "Code32", aliases: ["italianpharmacode", "pharmacode32"], example: "01234567" },
  { id: "pzn", name: "PZN", kind: "linear", read: ["PZN"], write: "PZN", aliases: ["pharmazentralnummer"], example: "1234562" },
  { id: "telepen", name: "Telepen", kind: "linear", read: ["Telepen", "TelepenAlpha", "TelepenNumeric"], write: "Telepen", aliases: ["telepenalpha", "telepennumeric"], example: "QRGEN" },
  { id: "dx-film-edge", name: "DX Film Edge", kind: "linear", read: ["DXFilmEdge"], write: "DXFilmEdge", aliases: ["dxfilmedge"], example: "77-4" },
];

const BY_ID = new Map<Symbology, SymbologyInfo>(SYMBOLOGIES.map((s) => [s.id, s]));

export const ALL_SYMBOLOGIES: readonly Symbology[] = SYMBOLOGIES.map((s) => s.id);

export const SYMBOLOGY_GROUPS: Readonly<Record<SymbologyGroup, readonly Symbology[]>> = {
  all: ALL_SYMBOLOGIES,
  linear: SYMBOLOGIES.filter((s) => s.kind === "linear").map((s) => s.id),
  "1d": SYMBOLOGIES.filter((s) => s.kind === "linear").map((s) => s.id),
  matrix: SYMBOLOGIES.filter((s) => s.kind === "matrix").map((s) => s.id),
  "2d": SYMBOLOGIES.filter((s) => s.kind === "matrix").map((s) => s.id),
  retail: ["ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited"],
  industrial: ["code128", "code39", "code93", "codabar", "itf", "itf14", "data-matrix"],
  gs1: ["code128", "data-matrix", "qr", "databar", "databar-expanded", "databar-limited"],
};

/** Lowercase and strip everything but [a-z0-9]. */
export function normalizeName(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const LOOKUP = new Map<string, Symbology>();
for (const s of SYMBOLOGIES) {
  LOOKUP.set(normalizeName(s.id), s.id);
  LOOKUP.set(normalizeName(s.name), s.id);
  for (const a of s.aliases) LOOKUP.set(normalizeName(a), s.id);
  for (const f of s.read) if (!LOOKUP.has(normalizeName(f))) LOOKUP.set(normalizeName(f), s.id);
}

const GROUP_LOOKUP = new Map<string, SymbologyGroup>(
  (Object.keys(SYMBOLOGY_GROUPS) as SymbologyGroup[]).map((g) => [normalizeName(g), g]),
);
GROUP_LOOKUP.set("any", "all");
GROUP_LOOKUP.set("everything", "all");
GROUP_LOOKUP.set("onedimensional", "linear");
GROUP_LOOKUP.set("twodimensional", "matrix");

/** Resolve a single name or alias to a symbology id, or `undefined`. */
export function toSymbology(name: string): Symbology | undefined {
  return LOOKUP.get(normalizeName(name));
}

/**
 * Resolve ids, aliases and groups into a de-duplicated list of symbology ids.
 * Accepts arrays or comma/space separated strings. Unknown names are ignored.
 * An empty or missing input resolves to every symbology.
 */
export function resolveSymbologies(input?: SymbologyInput | readonly SymbologyInput[] | null): Symbology[] {
  const names = input == null ? [] : Array.isArray(input) ? input : String(input).split(/[\s,;|]+/);
  const out = new Set<Symbology>();
  for (const raw of names) {
    if (!raw) continue;
    const key = normalizeName(raw);
    if (!key) continue;
    const group = GROUP_LOOKUP.get(key);
    if (group) {
      for (const id of SYMBOLOGY_GROUPS[group]) out.add(id);
      continue;
    }
    const id = LOOKUP.get(key);
    if (id) out.add(id);
  }
  if (out.size === 0 && names.filter(Boolean).length === 0) return [...ALL_SYMBOLOGIES];
  return [...out];
}

export function symbologyInfo(id: Symbology): SymbologyInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`Unknown symbology: ${id}`);
  return info;
}

export function symbologyName(id: Symbology): string {
  return BY_ID.get(id)?.name ?? id;
}

/** zxing-cpp reader formats for a set of symbologies. */
export function toZXingReadFormats(ids: readonly Symbology[]): string[] {
  if (ids.length === ALL_SYMBOLOGIES.length) return [];
  const formats = new Set<string>();
  for (const id of ids) for (const f of symbologyInfo(id).read) formats.add(f);
  return [...formats];
}

/** Map a zxing-cpp result format (e.g. "EAN13", "MicroQRCode") to a symbology id. */
export function fromZXingFormat(format: string): Symbology | undefined {
  for (const s of SYMBOLOGIES) if (s.read.includes(format)) return s.id;
  return toSymbology(format);
}

/** Symbologies that can be generated. */
export const WRITABLE_SYMBOLOGIES: readonly Symbology[] = SYMBOLOGIES.filter((s) => s.write).map((s) => s.id);
