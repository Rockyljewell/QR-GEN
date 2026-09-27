import {
  generate,
  parseAAMVA,
  parseContent,
  scanImage,
  SYMBOLOGIES,
  WRITABLE_SYMBOLOGIES,
  type Barcode,
  type ParsedContent,
  type Symbology,
} from "qrgen-sdk";
import "qrgen-sdk/elements";
import type { QRGenScannerElement } from "qrgen-sdk/elements";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props as { class?: string };
  if (cls) node.className = cls;
  Object.assign(node, rest);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const AAMVA_SAMPLE =
  "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\nDBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\nDAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tabs = $$<HTMLAnchorElement>(".demo-tabs [data-panel]");
const panels = $$<HTMLElement>("[data-panel-id]");
function showPanel(id: string, push = false): void {
  if (!panels.some((p) => p.dataset.panelId === id)) id = "camera";
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.panel === id)));
  panels.forEach((p) => (p.hidden = p.dataset.panelId !== id));
  if (id !== "camera") scanner.stop();
  if (id === "generate") void renderGenerator();
  if (push) history.replaceState(null, "", `#${id}`);
}
tabs.forEach((t) =>
  t.addEventListener("click", (e) => {
    e.preventDefault();
    showPanel(t.dataset.panel!, true);
  }),
);
window.addEventListener("hashchange", () => showPanel(location.hash.slice(1)));

// ---------------------------------------------------------------------------
// Camera scanner
// ---------------------------------------------------------------------------
const scanner = $<QRGenScannerElement>("#demo-scanner");
const resultsList = $("[data-results]");
const empty = $("[data-empty]");
const countEl = $("[data-count]");
const engineLine = $("[data-engine-line]");
type Mode = "single" | "continuous" | "batch" | "id";
let mode: Mode = "continuous";
let selected = new Set<Symbology>(SYMBOLOGIES.map((s) => s.id));
const results: { barcode: Barcode; at: Date }[] = [];

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dl(entries: [string, string | number | boolean | undefined | null][]): HTMLDListElement {
  const list = el("dl");
  for (const [k, v] of entries) {
    if (v === undefined || v === null || v === "") continue;
    list.append(el("dt", { textContent: k }), el("dd", { textContent: String(v) }));
  }
  return list;
}

function renderAamva(data: string): HTMLElement | null {
  const id = parseAAMVA(data);
  if (!id) return null;
  const badge = (text: string, cls: string) => el("span", { class: `badge ${cls}`, textContent: text });
  return el(
    "div",
    { class: "id-card" },
    el("div", { class: "id-name", textContent: id.fullName || "Unknown name" }),
    el(
      "div",
      { class: "id-badges" },
      id.isUnder21 === false ? badge("21+ verified", "ok") : id.isUnder21 ? badge("Under 21", "warn") : null,
      id.isExpired === false ? badge("Not expired", "ok") : id.isExpired ? badge("Expired", "warn") : null,
      badge(id.documentType === "ID" ? "ID card" : "Driver license", "guide"),
    ),
    dl([
      ["Date of birth", id.dateOfBirth],
      ["Age", id.age],
      ["Expires", id.expiryDate],
      ["Document #", id.documentNumber],
      ["Sex", id.sex],
      ["Address", [id.street, id.city, id.state, id.postalCode].filter(Boolean).join(", ")],
      ["Issuer", `${id.state || ""} ${id.country} · IIN ${id.issuerId}`],
    ]),
  );
}

function renderParsed(p: ParsedContent, raw: string): HTMLElement | null {
  const wrap = el("div", { class: "r-parsed" });
  const kind = (label: string) => el("span", { class: "r-kind", textContent: label });
  const actions = el("div", { class: "r-actions" });
  switch (p.type) {
    case "url":
      wrap.append(kind("Link"));
      actions.append(el("a", { href: p.url, target: "_blank", rel: "noopener nofollow", textContent: "Open link" }));
      break;
    case "gs1-digital-link":
    case "gs1": {
      wrap.append(kind(p.type === "gs1" ? "GS1 element string" : "GS1 Digital Link"));
      wrap.append(dl(p.gs1.elements.map((e) => [`(${e.ai}) ${e.title}`, e.date ?? (e.number !== undefined ? `${e.number}${e.iso ? ` [${e.iso}]` : ""}` : e.value)])));
      if (p.type === "gs1-digital-link") actions.append(el("a", { href: p.url, target: "_blank", rel: "noopener nofollow", textContent: "Open link" }));
      break;
    }
    case "wifi":
      wrap.append(kind("Wi-Fi network"), dl([["SSID", p.ssid], ["Password", p.password], ["Security", p.security], ["Hidden", p.hidden ? "yes" : undefined]]));
      break;
    case "email":
      wrap.append(kind("Email"), dl([["To", p.to], ["Subject", p.subject], ["Body", p.body]]));
      actions.append(el("a", { href: `mailto:${p.to}`, textContent: "Compose" }));
      break;
    case "phone":
      wrap.append(kind("Phone number"), dl([["Number", p.number]]));
      actions.append(el("a", { href: `tel:${p.number}`, textContent: "Call" }));
      break;
    case "sms":
      wrap.append(kind("SMS"), dl([["To", p.number], ["Message", p.body]]));
      break;
    case "geo":
      wrap.append(kind("Location"), dl([["Latitude", p.latitude], ["Longitude", p.longitude], ["Query", p.query]]));
      actions.append(el("a", { href: `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=16/${p.latitude}/${p.longitude}`, target: "_blank", rel: "noopener", textContent: "Open map" }));
      break;
    case "contact":
      wrap.append(kind(p.format === "vcard" ? "Contact (vCard)" : "Contact (MECARD)"), dl([["Name", p.name], ["Organization", p.organization], ["Phone", p.phones.join(", ")], ["Email", p.emails.join(", ")], ["Web", p.urls.join(", ")], ["Address", p.address]]));
      break;
    case "event":
      wrap.append(kind("Calendar event"), dl([["Summary", p.summary], ["Starts", p.start], ["Ends", p.end], ["Location", p.location]]));
      break;
    case "payment":
      wrap.append(kind(`Payment (${p.scheme.toUpperCase()})`), dl([["Payee", p.name], ["Account", p.iban ?? p.address], ["BIC", p.bic], ["Amount", p.amount !== undefined ? `${p.amount} ${p.currency ?? ""}` : undefined], ["Reference", p.reference]]));
      break;
    case "product":
      wrap.append(kind(`Product (${p.kind.toUpperCase()})`), dl([["GTIN-14", p.gtin], ["Check digit", p.checksumValid ? "valid" : "invalid"]]));
      actions.append(el("a", { href: `https://www.google.com/search?q=${encodeURIComponent(raw)}`, target: "_blank", rel: "noopener", textContent: "Look up" }));
      break;
    case "aamva": {
      const card = renderAamva(raw);
      if (card) wrap.append(kind("Driver license / ID"), card);
      break;
    }
    default:
      return null;
  }
  if (actions.childElementCount) wrap.append(actions);
  return wrap;
}

function resultItem(b: Barcode, at: Date, idMode = false): HTMLLIElement {
  const li = el("li", { class: "result-item" });
  const copyBtn = el("button", { type: "button", textContent: "Copy" });
  copyBtn.dataset.copy = b.data;
  li.append(
    el("div", { class: "r-top" }, el("span", { class: "r-sym", textContent: b.symbologyName }), b.isGS1 ? el("span", { class: "badge", textContent: "GS1" }) : null, el("span", { class: "r-time", textContent: fmtTime(at) })),
  );
  if (idMode) {
    const card = renderAamva(b.data);
    if (card) {
      li.append(card);
      return li;
    }
    li.append(el("p", { class: "r-data", textContent: "This PDF417 is not an AAMVA driver license barcode." }));
  }
  const content = parseContent(b.data, { symbology: b.symbology });
  const parsed = renderParsed(content, b.data);
  const pre = el("pre", { class: "r-data", textContent: b.data.length > 2000 ? `${b.data.slice(0, 2000)}…` : b.data });
  if (b.data.length > 160 || content.type === "aamva") {
    if (parsed) li.append(parsed);
    li.append(el("details", { class: "r-raw" }, el("summary", { textContent: `Raw data (${b.data.length} characters)` }), pre));
  } else {
    li.append(pre);
    if (parsed) li.append(parsed);
  }
  const actions = parsed?.querySelector(".r-actions") ?? li.appendChild(el("div", { class: "r-actions" }));
  actions.prepend(copyBtn);
  return li;
}

function updateResultsUi(): void {
  countEl.textContent = String(results.length);
  empty.hidden = results.length > 0;
  $$<HTMLButtonElement>(".results-actions button").forEach((b) => (b.disabled = results.length === 0));
}

function addResults(barcodes: Barcode[]): void {
  const at = new Date();
  for (const b of barcodes) {
    results.unshift({ barcode: b, at });
    resultsList.prepend(resultItem(b, at, mode === "id"));
  }
  while (results.length > 200) {
    results.pop();
    resultsList.lastElementChild?.remove();
  }
  updateResultsUi();
}

scanner.addEventListener("scan", (e) => addResults((e as CustomEvent<{ barcodes: Barcode[] }>).detail.barcodes));
scanner.addEventListener("ready", (e) => {
  const engine = (e as CustomEvent<{ engine: string }>).detail.engine;
  engineLine.dataset.engine = engine === "worker" ? "Web Worker" : "main thread";
});
scanner.addEventListener("error", (e) => {
  engineLine.textContent = `Error: ${(e as unknown as CustomEvent<{ message: string }>).detail.message}`;
});
setInterval(() => {
  const s = scanner.scanner;
  if (!s || s.state !== "scanning") {
    if (s?.state === "paused") engineLine.textContent = "Paused";
    else if (!engineLine.textContent?.startsWith("Error")) engineLine.textContent = `Engine idle · ${selected.size} symbologies enabled`;
    return;
  }
  const v = s.video;
  engineLine.textContent = `${engineLine.dataset.engine ?? "Engine"} · ${v.videoWidth}×${v.videoHeight} · ${s.stats.decodeMs.toFixed(1)} ms/frame · ${s.stats.fps} fps · ${selected.size} symbologies`;
}, 1000);

// Modes
const modeButtons = $$<HTMLButtonElement>("[data-mode]");
function setMode(next: Mode): void {
  mode = next;
  modeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === next)));
  if (next === "id") {
    scanner.setAttribute("symbologies", "pdf417");
    scanner.setAttribute("mode", "single");
    scanner.setAttribute("viewfinder", "line");
    scanner.setAttribute("hint", "Scan the PDF417 barcode on the back of a US or Canadian driver license");
  } else {
    scanner.setAttribute("symbologies", [...selected].join(","));
    scanner.setAttribute("mode", next);
    scanner.removeAttribute("viewfinder");
    scanner.removeAttribute("hint");
  }
  const dup = $<HTMLSelectElement>('[data-opt="duplicate-filter"]');
  if (next === "batch") scanner.setAttribute("duplicate-filter", "-1");
  else scanner.setAttribute("duplicate-filter", dup.value);
}
modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode as Mode)));

// Symbology settings
const symGrid = $("[data-sym-grid]");
for (const s of SYMBOLOGIES) {
  const input = el("input", { type: "checkbox", checked: true, value: s.id });
  symGrid.append(el("label", {}, input, s.name));
}
function applySymbologies(): void {
  selected = new Set($$<HTMLInputElement>("input", symGrid).filter((i) => i.checked).map((i) => i.value as Symbology));
  if (selected.size === 0) {
    selected.add("qr");
    ($<HTMLInputElement>('input[value="qr"]', symGrid)).checked = true;
  }
  if (mode !== "id") scanner.setAttribute("symbologies", [...selected].join(","));
}
symGrid.addEventListener("change", applySymbologies);
const PRESETS: Record<string, Symbology[] | "all"> = {
  all: "all",
  "2d": SYMBOLOGIES.filter((s) => s.kind === "matrix").map((s) => s.id),
  retail: ["ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited"],
  industrial: ["code128", "code39", "code93", "codabar", "itf", "itf14", "data-matrix"],
  qr: ["qr"],
};
$$<HTMLButtonElement>("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const preset = PRESETS[b.dataset.preset!]!;
    $$<HTMLInputElement>("input", symGrid).forEach((i) => (i.checked = preset === "all" || preset.includes(i.value as Symbology)));
    applySymbologies();
  }),
);
$$<HTMLInputElement | HTMLSelectElement>("[data-opt]").forEach((input) =>
  input.addEventListener("change", () => {
    const name = input.dataset.opt!;
    const value = input instanceof HTMLInputElement && input.type === "checkbox" ? String(input.checked) : input.value;
    if (name === "duplicate-filter" && mode === "batch") return;
    scanner.setAttribute(name, value);
  }),
);

// Result actions
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
$('[data-action="clear"]').addEventListener("click", () => {
  results.length = 0;
  resultsList.replaceChildren();
  updateResultsUi();
});
$('[data-action="copy-all"]').addEventListener("click", async (e) => {
  const text = results.map((r) => `${r.barcode.symbologyName}\t${r.barcode.data}`).join("\n");
  await navigator.clipboard.writeText(text).catch(() => undefined);
  const span = (e.currentTarget as HTMLElement).querySelector("span")!;
  span.textContent = "Copied";
  setTimeout(() => (span.textContent = "Copy"), 1500);
});
$('[data-action="csv"]').addEventListener("click", () => {
  const rows = [["time", "symbology", "data", "gs1"], ...results.map((r) => [r.at.toISOString(), r.barcode.symbology, r.barcode.data, String(r.barcode.isGS1)])];
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `qrgen-scans-${Date.now()}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------------------
// Image scanning
// ---------------------------------------------------------------------------
const dropzone = $<HTMLLabelElement>("[data-dropzone]");
const fileInput = $<HTMLInputElement>("[data-file]");
const stage = $("[data-stage]");
const stageCanvas = $<HTMLCanvasElement>("[data-stage-canvas]");
const imgResults = $("[data-img-results]");
const imgEmpty = $("[data-img-empty]");
const imgCount = $("[data-img-count]");
const imgTime = $("[data-img-time]");

async function codeBitmap(data: string, symbology: string, scale: number, gs1 = false): Promise<ImageBitmap> {
  const g = await generate(data, { symbology, scale, gs1 });
  return createImageBitmap(g.png!);
}

async function sampleCanvas(kind: string): Promise<HTMLCanvasElement> {
  const c = el("canvas", { width: 1000, height: 640 });
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#e9edf2";
  ctx.fillRect(0, 0, c.width, c.height);
  const card = (x: number, y: number, w: number, h: number, fill = "#fff") => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
  };
  const text = (t: string, x: number, y: number, size = 22, weight = 600, color = "#111") => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    ctx.fillText(t, x, y);
  };
  if (kind === "label") {
    card(60, 60, 880, 520);
    text("QRGEN ORGANIC", 100, 130, 20, 700, "#1f7f8c");
    text("Oat Milk, Barista Edition", 100, 175, 34, 800);
    text("1 L · Best before 31 Dec 2027", 100, 215, 20, 500, "#555");
    ctx.drawImage(await codeBitmap("5901234123457", "ean13", 4), 100, 280);
    ctx.drawImage(await codeBitmap("https://rockyljewell.github.io/QR-GEN/", "qr", 7), 660, 250);
    text("$2.49", 100, 540, 40, 800, "#b0271f");
  } else if (kind === "parcel") {
    card(60, 40, 880, 560);
    text("SHIP TO: QRGEN WAREHOUSE 3, 10001 NEW YORK", 100, 100, 22, 700);
    text("PARCEL 1 OF 1 · 4.2 KG", 100, 136, 18, 500, "#555");
    ctx.drawImage(await codeBitmap("(00)095011015300000018(420)10001", "code128", 2, true), 90, 170);
    ctx.drawImage(await codeBitmap("1Z999AA10123456784", "code128", 2), 90, 390);
    ctx.drawImage(await codeBitmap("(01)09501101530003(10)LOT4815(3103)004200", "data-matrix", 7, true), 730, 330);
  } else if (kind === "license") {
    card(80, 70, 840, 500, "#f4f1e8");
    text("SAMPLE · NOT A REAL DOCUMENT", 120, 130, 20, 800, "#8a5300");
    ctx.drawImage(await codeBitmap(AAMVA_SAMPLE, "pdf417", 3), 120, 170);
    text("Back of a US driver license (AAMVA PDF417)", 120, 540, 18, 500, "#555");
  } else {
    const codes: [string, string, number, boolean?][] = [
      ["https://rockyljewell.github.io/QR-GEN/", "qr", 4],
      ["(01)09501101530003(17)271231", "data-matrix", 5, true],
      ["QRGen Aztec", "aztec", 5],
      ["5901234123457", "ean13", 2],
      ["QRGEN-128", "code128", 2],
      ["QRGen PDF417", "pdf417", 2],
      ["036000291452", "upca", 2],
      ["QRG39", "code39", 2],
      ["96385074", "ean8", 2],
      ["12345678", "itf", 2],
      ["(01)09521234543213", "databar", 2],
      ["WIFI:S:QRGen;T:WPA;P:scan;;", "qr", 4],
    ];
    c.width = 1200;
    c.height = 840;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < codes.length; i++) {
      const [d, s, sc, gs1] = codes[i]!;
      const bmp = await codeBitmap(d, s, sc, gs1);
      const col = i % 4;
      const row = Math.floor(i / 4);
      const k = Math.min(1, 250 / bmp.width, 230 / bmp.height);
      const w = Math.round(bmp.width * k);
      const h = Math.round(bmp.height * k);
      ctx.drawImage(bmp, 30 + col * 290 + (260 - w) / 2, 30 + row * 270 + (240 - h) / 2, w, h);
    }
  }
  return c;
}

function drawStage(source: CanvasImageSource, w: number, h: number, barcodes: Barcode[]): void {
  stage.hidden = false;
  stageCanvas.width = w;
  stageCanvas.height = h;
  const ctx = stageCanvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);
  const lw = Math.max(3, Math.round(Math.max(w, h) / 300));
  for (const b of barcodes) {
    const q = b.location;
    let pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
    // Linear codes decode to a line; give the highlight some height.
    const hgt = Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y);
    if (hgt < 12) pts = [
      { x: q.topLeft.x, y: q.topLeft.y - 20 }, { x: q.topRight.x, y: q.topRight.y - 20 },
      { x: q.bottomRight.x, y: q.bottomRight.y + 20 }, { x: q.bottomLeft.x, y: q.bottomLeft.y + 20 },
    ];
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(92, 201, 214, 0.22)";
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#3db1c0";
    ctx.stroke();
  }
}

async function scanAndShow(source: HTMLCanvasElement | File | Blob): Promise<void> {
  imgResults.replaceChildren();
  imgTime.textContent = "Scanning…";
  const t0 = performance.now();
  let barcodes: Barcode[] = [];
  try {
    barcodes = await scanImage(source, { symbologies: "all" });
  } catch (err) {
    imgTime.textContent = err instanceof Error ? err.message : String(err);
    return;
  }
  const ms = performance.now() - t0;
  if (source instanceof HTMLCanvasElement) drawStage(source, source.width, source.height, barcodes);
  else {
    const bmp = await createImageBitmap(source);
    drawStage(bmp, bmp.width, bmp.height, barcodes);
  }
  imgCount.textContent = String(barcodes.length);
  imgTime.textContent = `${ms.toFixed(0)} ms`;
  imgEmpty.hidden = barcodes.length > 0;
  if (!barcodes.length) imgEmpty.innerHTML = "<p>No barcode found. Try a sharper or larger image.</p>";
  const at = new Date();
  for (const b of barcodes) imgResults.append(resultItem(b, at));
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void scanAndShow(f);
  fileInput.value = "";
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) void scanAndShow(f);
});
document.addEventListener("paste", (e) => {
  if ($<HTMLElement>('[data-panel-id="image"]').hidden) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const f = item?.getAsFile();
  if (f) void scanAndShow(f);
});
$$<HTMLButtonElement>("[data-sample]").forEach((b) => b.addEventListener("click", async () => void scanAndShow(await sampleCanvas(b.dataset.sample!))));

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
const form = $<HTMLFormElement>("[data-gen-form]");
const symSelect = $<HTMLSelectElement>("[data-gen-symbology]");
const dataInput = $<HTMLTextAreaElement>("[data-gen-data]");
const preview = $("[data-gen-preview]");
const meta = $("[data-gen-meta]");
const errorBox = $("[data-gen-error]");
const snippet = $("[data-gen-snippet]");
let lastSvg = "";
let lastPng: Blob | null = null;
let snippetKind = "js";

const groups: [string, (s: (typeof SYMBOLOGIES)[number]) => boolean][] = [
  ["2D codes", (s) => s.kind === "matrix"],
  ["Linear codes", (s) => s.kind === "linear"],
];
for (const [label, test] of groups) {
  const og = el("optgroup", { label });
  for (const s of SYMBOLOGIES.filter((x) => WRITABLE_SYMBOLOGIES.includes(x.id) && test(x))) og.append(el("option", { value: s.id, textContent: s.name }));
  symSelect.append(og);
}
symSelect.value = "qr";
symSelect.addEventListener("change", () => {
  const info = SYMBOLOGIES.find((s) => s.id === symSelect.value)!;
  dataInput.value = info.example;
  const gs1 = form.elements.namedItem("gs1") as HTMLInputElement;
  gs1.checked = info.example.startsWith("(");
  (form.elements.namedItem("hrt") as HTMLInputElement).checked = info.kind === "linear";
  void renderGenerator();
});

function genOptions() {
  const f = form.elements;
  const v = (n: string) => (f.namedItem(n) as HTMLInputElement).value;
  const c = (n: string) => (f.namedItem(n) as HTMLInputElement).checked;
  return {
    symbology: symSelect.value,
    ecLevel: v("ecLevel") || undefined,
    scale: Math.max(1, Math.min(20, Number(v("scale")) || 4)),
    foreground: v("foreground"),
    background: c("transparent") ? "transparent" : v("background"),
    margin: c("margin"),
    hrt: c("hrt"),
    gs1: c("gs1"),
  };
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

function renderSnippet(): void {
  const o = genOptions();
  const data = dataInput.value;
  const opts: string[] = [`symbology: "${o.symbology}"`];
  if (o.ecLevel) opts.push(`ecLevel: "${o.ecLevel}"`);
  if (o.gs1) opts.push("gs1: true");
  if (o.hrt) opts.push("hrt: true");
  if (!o.margin) opts.push("margin: false");
  if (o.scale !== 4) opts.push(`scale: ${o.scale}`);
  if (o.foreground !== "#000000") opts.push(`foreground: "${o.foreground}"`);
  if (o.background !== "#ffffff") opts.push(`background: "${o.background}"`);
  const base = "https://your-qrgen-server";
  const qs = new URLSearchParams({ data, symbology: o.symbology, format: "svg", ...(o.gs1 ? { gs1: "true" } : {}), ...(o.ecLevel ? { ecLevel: o.ecLevel } : {}) });
  const code: Record<string, string> = {
    js: `import { generate } from "qrgen-sdk";\n\nconst { svg, png } = await generate(${jsString(data)}, {\n  ${opts.join(",\n  ")},\n});\ndocument.querySelector("#code").innerHTML = svg;`,
    html: `<script type="module" src="https://rockyljewell.github.io/QR-GEN/sdk/qrgen.js"></script>\n\n<qrgen-barcode\n  value=${jsString(data)}\n  symbology="${o.symbology}"${o.ecLevel ? `\n  ec-level="${o.ecLevel}"` : ""}${o.gs1 ? "\n  gs1" : ""}${o.hrt ? "\n  hrt" : ""}\n  style="width: 240px"\n></qrgen-barcode>`,
    cli: `npx qrgen generate ${jsString(data)} --symbology ${o.symbology}${o.ecLevel ? ` --ec ${o.ecLevel}` : ""}${o.gs1 ? " --gs1" : ""}${o.hrt ? " --hrt" : ""} -o code.svg`,
    rest: `# docker run -p 8080:8080 ghcr.io/rockyljewell/qr-gen\ncurl "${base}/v1/generate?${qs.toString()}" -o code.svg`,
  };
  snippet.textContent = code[snippetKind]!;
}

let genSeq = 0;
async function renderGenerator(): Promise<void> {
  const seq = ++genSeq;
  const o = genOptions();
  renderSnippet();
  try {
    const out = await generate(dataInput.value, o);
    if (seq !== genSeq) return;
    errorBox.hidden = true;
    lastSvg = out.svg;
    lastPng = out.png;
    preview.innerHTML = out.svg;
    const svg = preview.querySelector("svg");
    if (svg) {
      const w = Number(svg.getAttribute("width"));
      const h = Number(svg.getAttribute("height"));
      const k = Math.min(1, 460 / Math.max(w, h));
      svg.setAttribute("width", String(Math.round(w * k)));
      svg.setAttribute("height", String(Math.round(h * k)));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `${o.symbology} barcode`);
    }
    meta.textContent = `${SYMBOLOGIES.find((s) => s.id === out.symbology)?.name} · ${out.matrix.width}×${out.matrix.height} modules · SVG ${(out.svg.length / 1024).toFixed(1)} KB`;
  } catch (err) {
    if (seq !== genSeq) return;
    errorBox.hidden = false;
    errorBox.textContent = err instanceof Error ? err.message : String(err);
  }
}
let genTimer: ReturnType<typeof setTimeout> | undefined;
form.addEventListener("input", (e) => {
  if (e.target === symSelect) return;
  clearTimeout(genTimer);
  genTimer = setTimeout(() => void renderGenerator(), 120);
});
$$<HTMLButtonElement>("[data-snippet]").forEach((b) =>
  b.addEventListener("click", () => {
    snippetKind = b.dataset.snippet!;
    $$("[data-snippet]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderSnippet();
  }),
);
function download(blob: Blob, name: string): void {
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('[data-gen="svg"]').addEventListener("click", () => lastSvg && download(new Blob([lastSvg], { type: "image/svg+xml" }), `qrgen-${symSelect.value}.svg`));
$('[data-gen="png"]').addEventListener("click", () => lastPng && download(lastPng, `qrgen-${symSelect.value}.png`));
$('[data-gen="copy-svg"]').addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(lastSvg).catch(() => undefined);
  const span = (e.currentTarget as HTMLElement).querySelector("span")!;
  span.textContent = "Copied";
  setTimeout(() => (span.textContent = "Copy SVG"), 1500);
});
$('[data-gen="test"]').addEventListener("click", async () => {
  if (!lastPng) return;
  const found = await scanImage(lastPng);
  meta.textContent = found.length ? `Scanned back: ${found[0]!.symbologyName} → ${found[0]!.data.slice(0, 80)}` : "Could not scan it back (try a larger module size or darker colors).";
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
updateResultsUi();
showPanel(location.hash.slice(1) || "camera");
