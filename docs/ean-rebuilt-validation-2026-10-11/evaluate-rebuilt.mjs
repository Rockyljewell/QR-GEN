// Artifact-only release/baseline/candidate comparison. No builds or repo writes.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir, cpus, platform } from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const parent = resolve(here, "..");
const packageRoot = resolve(process.env.QRGEN_EAN_REVIEW_PACKAGE_DIR ?? (existsSync(join(parent, "frozen-raster-manifest.json")) ? parent : join(parent, "review-package")));
const requested = resolve(process.env.QRGEN_REPRO_DEPENDENCY_ROOT ?? process.cwd());
const sdkRoot = existsSync(join(requested, "packages/sdk/package.json")) ? join(requested, "packages/sdk") : requested;
const repoRoot = sdkRoot.endsWith(join("packages", "sdk")) ? resolve(sdkRoot, "../..") : sdkRoot;
const req = createRequire(join(sdkRoot, "package.json"));
const sharp = req("sharp"), { PNG } = req("pngjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse((path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path)).toString("utf8").replace(/^\uFEFF/, ""));
const cache = resolve(process.env.QRGEN_EAN_STUDY_CACHE_DIR ?? join(tmpdir(), "qrgen-ean-study-5bdcab8035-315"));
const uniformPackage = resolve(process.env.QRGEN_EAN_UNIFORM_PACKAGE_DIR ?? join(repoRoot, "docs/ean-uniform-policy-study-2026-10-11"));
const output = resolve(process.env.QRGEN_EAN_REBUILT_OUTPUT_DIR ?? join(tmpdir(), "qrgen-ean-rebuilt-" + Date.now()));
const isWithin = (root, target) => { const r = relative(root, target); return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep)); };
for (const protectedRoot of [packageRoot, here, sdkRoot, repoRoot]) if (isWithin(protectedRoot, output)) throw Error("Output must be outside review package and repository: " + output);
for (const name of ["evaluation-plan.json", "baseline-conformance.jsonl", "candidate-comparison.jsonl", "summary.json"]) if (existsSync(join(output, name))) throw Error("Use a fresh output directory; existing evidence is immutable: " + output);
mkdirSync(join(output, "prepared-fixtures"), { recursive: true });
const flags = new Set(process.argv.slice(2));
for (const flag of flags) if (!["--prepare-only", "--sanity-only", "--baseline-only", "--harness-self-check"].includes(flag)) throw Error("Unknown option " + flag);
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const pinnedCpp = "2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4";
const releasedWasmSha = "aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931";
const photoPath = join(packageRoot, "frozen-raster-manifest.json"), generatedPath = join(packageRoot, "generated-manifest.json");
const photo = readJson(photoPath), generated = readJson(generatedPath);
if (photo.cases.length !== 157 || generated.cases.length !== 156) throw Error("Expected frozen 157 source photos and 156 thin/control rasters");
const chrome = resolve(process.env.QRGEN_EAN_CHROME_PNG ?? join(packageRoot, "../ean-browser-diagnostic-2026-10-11/fixtures/ean13-2-07-full.png"));
if (!existsSync(chrome)) throw Error("Exact Chrome supplement is required; set QRGEN_EAN_CHROME_PNG");

const items = [];
for (const c of photo.cases) for (const r of c.rasters) items.push({ id: c.id, group: r.pipeline, truth: c.truth, path: join(cache, r.local ?? c.localImage), fileSha256: r.pngSha256 ?? c.sourceSha256, rgbaSha256: r.pixelsSha256, loadType: r.pipeline === "original-RGBA-white-sRGB" ? "original" : "png", core: true, photo: true });
for (const r of photo.supplement.rasters) items.push({ id: photo.supplement.id, group: "actual-Chrome-supplement", truth: photo.supplement.truth, path: chrome, fileSha256: r.pngSha256 ?? photo.supplement.sourceSha256, rgbaSha256: r.pixelsSha256, loadType: "png", core: true, photo: true });
for (const c of generated.cases) items.push({ id: c.id, group: c.kind === "control" ? "generated-no-code" : "generated-positive", truth: c.expected, path: join(cache, "generated", c.local), fileSha256: c.sha256, rgbaSha256: c.rgbaSha256, loadType: "png", core: true });
if (items.length !== 471) throw Error("Frozen 471-raster core changed");

// The additional eight real negatives retain the published uniform-study identities.
const negativeManifestPath = join(uniformPackage, "negative-manifest.json");
const uniformFrozenPath = join(uniformPackage, "frozen-inputs.json.gz");
const negativeManifest = readJson(negativeManifestPath), uniformFrozen = readJson(uniformFrozenPath);
const negatives = uniformFrozen.items.filter((i) => ["real-negative-original", "real-negative-derived"].includes(i.group));
if (negatives.length !== 8) throw Error("All eight frozen real no-code rasters are required");
for (const c of negatives) {
  const n = negativeManifest.cases.find((n) => n.id === c.id && n.negative === true);
  if (!n || n.image.sha256 !== c.fileSha256) throw Error("Negative oracle/file identity changed: " + c.id);
  items.push({ id: c.id, group: c.group, truth: null, path: join(cache, "uniform-negative", n.image.local), fileSha256: n.image.sha256, rgbaSha256: c.inputRgbaSha256, loadType: c.group === "real-negative-derived" ? "negative-derived" : "original", core: true, negativeOracle: n.groundTruth });
}
if (items.length !== 479) throw Error("Full frozen corpus must have 479 rasters");

async function load(item) {
  const bytes = readFileSync(item.path);
  if (sha(bytes) !== item.fileSha256) throw Error("File hash mismatch: " + item.group + "/" + item.id);
  let p;
  if (item.loadType === "png") { const image = PNG.sync.read(bytes); p = { width: image.width, height: image.height, data: image.data }; }
  else if (item.loadType === "original") { const { data, info } = await sharp(bytes).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true }); p = { width: info.width, height: info.height, data }; }
  else if (item.loadType === "negative-derived") {
    const { data, info } = await sharp(bytes).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").resize({ width: 640, height: 480, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
    const left = Math.floor((640 - info.width) / 2), top = Math.floor((480 - info.height) / 2), rgba = Buffer.alloc(640 * 480 * 4);
    for (let i = 0; i < 640 * 480; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 214; rgba[i * 4 + 3] = 255; }
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const j = (y * info.width + x) * 3, Y = Math.round(16 + (65.738 * data[j] + 129.057 * data[j + 1] + 25.064 * data[j + 2]) / 255), v = Math.max(0, Math.min(255, Math.round((Y - 16) * 255 / 219))), k = ((y + top) * 640 + x + left) * 4; rgba[k] = rgba[k + 1] = rgba[k + 2] = v; }
    p = { width: 640, height: 480, data: rgba };
  } else throw Error("Unknown raster load type " + item.loadType);
  if (sha(p.data) !== item.rgbaSha256) throw Error("Frozen pixel hash mismatch: " + item.group + "/" + item.id);
  return p;
}
// Fail on a missing/mismatched input before any measured reader execution.
for (let i = 0; i < items.length; i++) { const p = await load(items[i]); items[i].width = p.width; items[i].height = p.height; }

const sdkModulePath = resolve(process.env.QRGEN_EAN_SDK_MODULE ?? join(sdkRoot, "dist/node.js"));
if (!existsSync(sdkModulePath)) throw Error("Existing built SDK is required for fixture preparation; set QRGEN_EAN_SDK_MODULE. This runner does not build it.");
const sdk = await import(pathToFileURL(sdkModulePath).href);
if (typeof sdk.generatePNG !== "function" || typeof sdk.generate !== "function" || !Array.isArray(sdk.SYMBOLOGIES)) throw Error("Built SDK lacks required fixture-generation exports");
async function addPng(id, bytes, extra = {}) {
  const p = PNG.sync.read(bytes), path = join(output, "prepared-fixtures", id + ".png");
  writeFileSync(path, bytes);
  const item = { id, group: "focused-generated", truth: null, path, fileSha256: sha(bytes), rgbaSha256: sha(p.data), width: p.width, height: p.height, loadType: "png", ...extra };
  items.push(item); return item;
}
const focusGenerated = [];
for (const c of [
  { id: "clean-leading-zero-ean13", data: "0036000291452", symbology: "ean13", coreText: "0036000291452", families: ["EAN13", "UPCA"] },
  { id: "clean-upca", data: "036000291452", symbology: "upca", coreText: "0036000291452", families: ["EAN13", "UPCA"] },
  { id: "clean-upce", data: "01234565", symbology: "upce", coreText: "0012345000065", families: ["UPCE"] },
  { id: "clean-ean8", data: "96385074", symbology: "ean8", coreText: "96385074", families: ["EAN8"] },
  { id: "clean-ean13-addon2", data: "9780804816632+12", symbology: "ean13", coreText: "9780804816632", addon: "12", families: ["EAN13"] },
  { id: "clean-ean13-addon5", data: "9780804816632+51234", symbology: "ean13", coreText: "9780804816632", addon: "51234", families: ["EAN13"] },
]) focusGenerated.push(await addPng(c.id, await sdk.generatePNG(c.data, { symbology: c.symbology, scale: 4 }), { expectedTargets: [{ text: c.coreText, addon: c.addon ?? null, families: c.families }], preparation: c }));

async function composite(images) {
  const decoded = images.map((bytes) => PNG.sync.read(bytes)), width = decoded.reduce((s, p) => s + p.width, 0) + (decoded.length + 1) * 20, height = Math.max(...decoded.map((p) => p.height)) + 40;
  const p = new PNG({ width, height }); p.data.fill(255); let offset = 20;
  for (const image of decoded) { PNG.bitblt(image, p, 0, 0, image.width, image.height, offset, 20); offset += image.width + 20; }
  return PNG.sync.write(p);
}
const qrText = "QRGEN-EAN-MIXED-CONTROL", qrPng = await sdk.generatePNG(qrText, { symbology: "qr", scale: 4 });
focusGenerated.push(await addPng("mixed-clean-ean13-upca-qr", await composite([await sdk.generatePNG("9780804816632", { symbology: "ean13", scale: 4 }), await sdk.generatePNG("036000291452", { symbology: "upca", scale: 4 }), qrPng]), { expectedTargets: [{ text: "9780804816632", addon: null, families: ["EAN13"] }, { text: "0036000291452", addon: null, families: ["EAN13", "UPCA"] }, { text: qrText, families: ["QRCode"], nonEAN: true }], preparation: { kind: "white padded side-by-side composite", quietPaddingPx: 20 } }));
focusGenerated.push(await addPng("chrome07-with-qr", await composite([readFileSync(chrome), qrPng]), { expectedTargets: [{ text: "9780804816632", addon: null, families: ["EAN13"], unknownAddon: true }, { text: qrText, families: ["QRCode"], nonEAN: true }], preparation: { kind: "derived mixed-family composite; padding changes histogram and is not the original Chrome raster", chromeSha256: sha(readFileSync(chrome)), quietPaddingPx: 20 } }));

// Predeclared malformed-checksum symbol; its invalid checksum is the oracle.
const validMatrix = (await sdk.generate("9780804816632", { symbology: "ean13", scale: 1, margin: false })).matrix;
if (validMatrix.width !== 95) throw Error("Expected exact 95-module EAN13 matrix for checksum-error control");
const invalid = new PNG({ width: (95 + 11 + 7) * 4, height: validMatrix.height * 4 + 8 }); invalid.data.fill(255);
const wrongCheckBits = "1000010"; // R encoding of digit3; this payload requires digit2.
for (let y = 0; y < validMatrix.height; y++) for (let x = 0; x < 95; x++) {
  const dark = x >= 85 && x < 92 ? wrongCheckBits[x - 85] === "1" : validMatrix.modules[y * 95 + x] !== 0;
  if (dark) for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { const k = (((y * 4 + yy + 4) * invalid.width) + (x + 11) * 4 + xx) * 4; invalid.data[k] = invalid.data[k + 1] = invalid.data[k + 2] = 0; }
}
const invalidChecksum = await addPng("synthetic-ean13-invalid-checksum", PNG.sync.write(invalid), { group: "synthetic-checksum-error", expectedTargets: [], preparation: { sourcePayload: "9780804816632", renderedPayload: "9780804816633", replacedModules: [85, 92], symbolValidity: "checksum-invalid", scale: 4 } });

const syntheticNegatives = [];
for (const kind of ["fixed-seed-noise", "horizontal-stripes", "vertical-stripes", "checkerboard", "gradient"]) {
  const p = new PNG({ width: 640, height: 480 }); let seed = 0x35719;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; const v = kind === "fixed-seed-noise" ? seed >>> 24 : kind === "horizontal-stripes" ? (Math.floor(y / 6) % 2) * 255 : kind === "vertical-stripes" ? (Math.floor(x / 3) % 2) * 255 : kind === "checkerboard" ? ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 255 : Math.round(x * 255 / (p.width - 1)), k = (y * p.width + x) * 4; p.data[k] = p.data[k + 1] = p.data[k + 2] = v; p.data[k + 3] = 255; }
  syntheticNegatives.push(await addPng("synthetic-no-code-" + kind, PNG.sync.write(p), { group: "synthetic-adversarial-no-code", expectedTargets: [], preparation: { kind, seed: kind === "fixed-seed-noise" ? 0x35719 : null, generator: "xorshift32 high byte; fixed stripe/checker widths and linear gradient", width: 640, height: 480 } }));
}

const matrixItems = [];
for (const symbology of ["qr", "data-matrix", "pdf417", "ean13", "code128", "databar"]) {
  const s = sdk.SYMBOLOGIES.find((s) => s.id === symbology); if (!s || !Array.isArray(s.read)) throw Error("Missing SDK symbology metadata " + symbology);
  for (const rotate of [0, 90, 180, 270]) for (const variant of [{ name: "normal", foreground: "#000000", background: "#ffffff" }, { name: "lower-contrast", foreground: "#555555", background: "#bbbbbb" }, { name: "inverted", foreground: "#ffffff", background: "#000000" }]) {
    const { name, ...colors } = variant, data = s.example, prep = { symbology, data, rotate, scale: 4, gs1: data.startsWith("("), ...colors };
    matrixItems.push(await addPng("matrix-" + symbology + "-" + rotate + "-" + name, await sdk.generatePNG(data, prep), { group: "generated-72-format-matrix", truth: data, expectedTargets: [{ text: data, families: s.read, nonEAN: symbology !== "ean13" }], matrix: { symbology, rotate, variant: name, formats: s.read }, preparation: prep }));
  }
}
if (matrixItems.length !== 72 || focusGenerated.length !== 8 || syntheticNegatives.length !== 5) throw Error("Predeclared fixture counts changed");

const profiles = [];
const base = { formats: ["EAN13"], tryRotate: true, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 255, minLineCount: 2, returnErrors: false, eanAddOnSymbol: "Ignore", textMode: "HRI", binarizer: "LocalAverage" };
const addProfile = (item, arm, options, mode = "raw") => profiles.push({ id: String(profiles.length), itemKey: item.group + "/" + item.id, arm, mode, options: { ...base, ...options } });
for (const item of items.filter((i) => i.core)) for (const tryHarder of [false, true]) for (const tryDownscale of [false, true]) addProfile(item, "full-frozen-corpus", { tryHarder, tryDownscale });
const focusedPhotos = items.filter((i) => i.photo && ["ean13-2-07", "ean13-1-35", photo.supplement.id].includes(i.id));
if (focusedPhotos.length !== 5) throw Error("All five known-case original/derived/Chrome focus rasters are required");
const formatSets = { EAN13: ["EAN13"], UPCA: ["UPCA"], mixed: ["EAN13", "UPCA", "EAN8", "UPCE", "QRCode", "Code128"], all: [] };
for (const item of [...focusedPhotos, ...focusGenerated]) for (const tryHarder of [false, true]) for (const tryDownscale of [false, true]) for (const maxNumberOfSymbols of [1, 2, 255]) for (const [formatLabel, formats] of Object.entries(formatSets)) for (const eanAddOnSymbol of ["Ignore", "Read", "Require"]) addProfile(item, "focused-limits-formats-addons", { tryHarder, tryDownscale, maxNumberOfSymbols, formats, eanAddOnSymbol, formatLabel });
for (const tryHarder of [false, true]) for (const tryDownscale of [false, true]) for (const maxNumberOfSymbols of [1, 255]) for (const returnErrors of [false, true]) addProfile(invalidChecksum, "checksum-error-semantics", { tryHarder, tryDownscale, maxNumberOfSymbols, returnErrors });
for (const item of syntheticNegatives) for (const tryHarder of [false, true]) for (const tryDownscale of [false, true]) for (const formats of [["EAN13"], []]) addProfile(item, "broader-no-code-controls", { tryHarder, tryDownscale, formats });
for (const item of matrixItems) for (const mode of ["raw", "sdk-style-raster-inversion"]) addProfile(item, "generated-72-format-matrix", { formats: item.matrix.formats, tryHarder: true, tryDownscale: true, tryInvert: true }, mode);
const selectedProfiles = flags.has("--sanity-only") ? profiles.filter((p) => p.arm === "full-frozen-corpus" && focusedPhotos.some((i) => p.itemKey === i.group + "/" + i.id) || p.arm === "focused-limits-formats-addons" && p.itemKey.endsWith("/clean-leading-zero-ean13") && p.options.maxNumberOfSymbols === 255 && p.options.formatLabel === "EAN13" && p.options.eanAddOnSymbol === "Ignore") : profiles;
const plan = { schemaVersion: 1, preparedAt: new Date().toISOString(), scope: flags.has("--sanity-only") ? "Bounded baseline-only sanity subset; not full corpus or candidate validation" : "Actual released315 versus independently rebuilt baseline, followed only on baseline conformance by actual rebuilt candidate. Non-exhaustive matrix: full479 core across fast/hard and downscale off/on at max255/EAN13; focused controls vary limits/formats/addons; raw72 and separately modelled SDK-style inversion72.", harnessSelfCheck: flags.has("--harness-self-check"), options: [...flags], node: process.version, platform: platform(), cpu: cpus()[0]?.model, pinnedCppCommit: pinnedCpp, scopeCounts: { frozenCoreItems: 479, focusedOriginalDerivedChromeItems: 5, focusedGeneratedItems: 8, invalidChecksumItems: 1, additionalSyntheticNoCodeItems: 5, matrixItems: 72, totalPreparedItems: items.length, selectedProfiles: selectedProfiles.length, plannedReaderCallsWithoutFallback: selectedProfiles.length * (flags.has("--sanity-only") || flags.has("--baseline-only") ? 2 : 3), fullProfiles: profiles.length }, manifestHashes: { photo: sha(readFileSync(photoPath)), generated: sha(readFileSync(generatedPath)), uniformFrozen: sha(readFileSync(uniformFrozenPath)), negativeManifest: sha(readFileSync(negativeManifestPath)) }, generator: { sdkModuleSha256: sha(readFileSync(sdkModulePath)), sdkPackage: readJson(join(sdkRoot, "package.json")).version }, runnerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), limitations: ["Development fixtures inherited from the same engine family, not population or Scandit parity evidence.", "One timed warm call per profile/engine, sequential release then baseline then candidate; timings are descriptive and not an unbiased performance benchmark.", "Raw engines retain unsupported inverted formats. The separate SDK-style arm models the same bounded explicit inversion policy for every engine and is not execution of the product SDK with a replaced dependency.", "Full limits/formats/addons/downscale cross product is focused, not applied to every photo.", "No output-subset invariant is assumed; candidate can alter scheduling and later searches. Newly appearing values and lost baseline targets are recorded.", "Package/source/defaults are never modified; missing inputs/hash mismatches fail instead of shrinking scope."], items: items.map((i) => ({ ...i, path: i.path })), profiles: selectedProfiles };
write("evaluation-plan.json", plan);
if (flags.has("--prepare-only")) { write("summary.json", { status: "prepared-only", actualDecoderEvaluation: false, ...plan.scopeCounts }); console.log(JSON.stringify({ status: "prepared-only", output, ...plan.scopeCounts })); process.exit(0); }

function requiredEnv(name) { const value = process.env[name]; if (!value) throw Error("Required environment variable missing: " + name); const path = resolve(value); if (!existsSync(path)) throw Error("Required engine input missing: " + path); return path; }
const releaseResolved = req.resolve("zxing-wasm/reader"), releaseES = resolve(dirname(releaseResolved), "../../es/reader/index.js");
const releaseModule = existsSync(releaseES) ? releaseES : releaseResolved;
const paths = { released315: { module: releaseModule, wasm: req.resolve("zxing-wasm/reader/zxing_reader.wasm") }, baseline: { module: requiredEnv("QRGEN_EAN_BASELINE_MODULE"), wasm: requiredEnv("QRGEN_EAN_BASELINE_WASM") } };
if (!flags.has("--baseline-only") && !flags.has("--sanity-only")) paths.candidate = { module: requiredEnv("QRGEN_EAN_CANDIDATE_MODULE"), wasm: requiredEnv("QRGEN_EAN_CANDIDATE_WASM") };
if (!flags.has("--harness-self-check") && new Set(Object.values(paths).map((p) => p.module)).size !== Object.keys(paths).length) throw Error("Engine wrappers must have independent paths; use --harness-self-check only for a labelled harness test");
const engines = {};
function fingerprintTree(root) {
  const files = [];
  function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) { const child = join(path, entry.name); if (entry.isDirectory()) walk(child); else if (entry.isFile()) { const bytes = readFileSync(child); files.push({ path: relative(root, child).split(sep).join("/"), bytes: bytes.length, sha256: sha(bytes) }); } else throw Error("Unexpected non-file in retained wrapper graph: " + child); } }
  walk(root); return { root, fileCount: files.length, manifestSha256: sha(JSON.stringify(files)), files };
}
const retainedGraphs = {};
for (const [name, p] of Object.entries(paths)) {
  if (flags.has("--harness-self-check") && p.module.includes(join("dist", "cjs"))) throw Error("Harness self-check requires ES wrappers; CommonJS import queries may share a singleton");
  const namespace = await import(pathToFileURL(p.module).href + "?qrgen-ean-engine=" + name);
  const reader = namespace.readBarcodes ? namespace : namespace.default;
  if (reader.ZXING_WASM_VERSION !== "3.1.5" || reader.ZXING_CPP_COMMIT !== pinnedCpp) throw Error("Unexpected engine metadata: " + name);
  const wasm = readFileSync(p.wasm);
  if (name === "released315" && sha(wasm) !== releasedWasmSha) throw Error("Expected exact released315 WASM hash");
  await reader.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true });
  const graph = fingerprintTree(resolve(dirname(p.module), "..")); retainedGraphs[name] = graph;
  const artifactRoot = resolve(dirname(p.module), "../../.."), rawGlue = join(artifactRoot, "matched-emscripten-glue.js"), provenance = join(artifactRoot, "download-provenance.json");
  if (name !== "released315" && !flags.has("--harness-self-check") && !existsSync(rawGlue)) throw Error("Matched raw Emscripten glue is required for rebuilt artifact: " + name);
  engines[name] = { reader, evidence: { modulePath: p.module, wasmPath: p.wasm, moduleSha256: sha(readFileSync(p.module)), wasmSha256: sha(wasm), readerVersion: reader.ZXING_WASM_VERSION, cppCommit: reader.ZXING_CPP_COMMIT, matchesPublishedWasmBytes: sha(wasm) === releasedWasmSha, retainedDistGraphSha256: graph.manifestSha256, retainedDistGraphFileCount: graph.fileCount, matchedRawGlue: existsSync(rawGlue) ? { path: rawGlue, sha256: sha(readFileSync(rawGlue)) } : null, downloadProvenance: existsSync(provenance) ? { path: provenance, sha256: sha(readFileSync(provenance)) } : null } };
  await reader.readBarcodes({ width: 3, height: 3, data: new Uint8ClampedArray(36).fill(255) }, { ...base, tryHarder: true });
}
if (new Set(Object.values(engines).map((e) => e.reader.prepareZXingModule)).size !== Object.keys(engines).length) throw Error("Wrapper module instances are not independent");
write("engine-inputs.json", { harnessSelfCheck: plan.harnessSelfCheck, engines: Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, v.evidence])) });
write("retained-dist-graph-fingerprints.json", retainedGraphs);

const nativeInvert = new Set(["QRCode", "QRCodeModel1", "QRCodeModel2", "MicroQRCode", "RMQRCode", "DataMatrix", "Aztec", "AztecCode", "AztecRune"]);
const plainError = (error) => error === undefined || error === null ? null : typeof error === "string" ? error : Object.fromEntries(Object.keys(error).sort().map((key) => [key, error[key]]));
function simplify(r) { return { text: r.text, format: r.format, bytesHex: Buffer.from(r.bytes ?? []).toString("hex"), contentType: r.contentType, lineCount: r.lineCount, isValid: r.isValid, error: plainError(r.error), position: r.position, orientation: r.orientation, ecLevel: r.ecLevel, symbologyIdentifier: r.symbologyIdentifier, isMirrored: !!r.isMirrored, isInverted: !!r.isInverted, extra: r.extra ?? null }; }
function sameDetection(a, b) {
  if (a.format !== b.format || a.text !== b.text || a.bytesHex !== b.bytesHex) return false;
  const box = (r) => { const points = Object.values(r.position), xs = points.map((p) => p.x), ys = points.map((p) => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  const x = box(a), y = box(b), intersection = Math.max(0, Math.min(x[2], y[2]) - Math.max(x[0], y[0])) * Math.max(0, Math.min(x[3], y[3]) - Math.max(x[1], y[1])), union = (x[2] - x[0]) * (x[3] - x[1]) + (y[2] - y[0]) * (y[3] - y[1]) - intersection;
  return union > 0 ? intersection / union >= 0.5 : x.every((v, i) => Math.abs(v - y[i]) <= 1);
}
async function decode(engine, image, profile) {
  const start = performance.now(); const { formatLabel, ...options } = profile.options;
  try {
    const results = (await engine.reader.readBarcodes(image, options)).map(simplify); let calls = 1;
    if (profile.mode === "sdk-style-raster-inversion") {
      const formats = (options.formats.length ? options.formats : engine.reader.READABLE_BARCODE_FORMATS).filter((f) => !nativeInvert.has(f));
      if (options.tryInvert && formats.length && results.length < options.maxNumberOfSymbols) {
        const data = new Uint8ClampedArray(image.data.length);
        for (let i = 0; i < data.length; i += 4) { data[i] = 255 - image.data[i]; data[i + 1] = 255 - image.data[i + 1]; data[i + 2] = 255 - image.data[i + 2]; data[i + 3] = image.data[i + 3]; }
        const extra = (await engine.reader.readBarcodes({ width: image.width, height: image.height, data }, { ...options, formats, tryInvert: false })).filter((r) => r.isValid).map(simplify); calls++;
        for (const r of extra) { r.isInverted = !r.isInverted; if (!results.some((old) => sameDetection(old, r))) results.push(r); if (results.length >= options.maxNumberOfSymbols) break; }
      }
    }
    return { results, error: null, readerCalls: calls, warmDecodeMs: performance.now() - start };
  } catch (error) { return { results: [], error: String(error), readerCalls: null, warmDecodeMs: performance.now() - start }; }
}
const canonical = (run) => JSON.stringify({ error: run.error, results: [...run.results].sort((a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; }) });
const same = (a, b) => canonical(a) === canonical(b);
function allowedTargets(item, profile) {
  const targets = item.expectedTargets ?? (item.truth === null ? [] : [{ text: item.truth, families: ["EAN13"], unknownAddon: !!item.photo }]);
  const formats = profile.options.formats;
  return targets.filter((t) => !formats.length || t.families.some((f) => formats.includes(f))).flatMap((t) => t.nonEAN || profile.options.eanAddOnSymbol === "Ignore" ? [{ ...t, match: (s) => s === t.text }] : profile.options.eanAddOnSymbol === "Require" ? t.addon ? [{ ...t, match: (s) => s === t.text + t.addon }] : t.unknownAddon ? [{ ...t, match: (s) => s.startsWith(t.text) && /^\d{2}(\d{3})?$/.test(s.slice(t.text.length)) }] : [] : [{ ...t, match: (s) => s === t.text || t.addon && s === t.text + t.addon || t.unknownAddon && s.startsWith(t.text) && /^\d{2}(\d{3})?$/.test(s.slice(t.text.length)) }]);
}
function outcome(item, profile, run) {
  const expected = allowedTargets(item, profile), valid = run.results.filter((r) => r.isValid), target = valid.filter((r) => expected.some((e) => e.match(r.text))), other = valid.filter((r) => !expected.some((e) => e.match(r.text)));
  return { status: run.error ? "engine-error" : target.length ? other.length ? "target-plus-nontarget-or-companion" : "target-only" : valid.length ? item.truth === null && !item.expectedTargets?.length ? "unexpected-control-output" : "nontarget-or-companion-only" : "empty", targetTexts: [...new Set(target.map((r) => r.text))], nonTargetTexts: [...new Set(other.map((r) => r.text))], confirmedFalse07Present: valid.some((r) => r.text.startsWith("0798884816632")), confirmedFalse35Present: valid.some((r) => r.text.startsWith("7034759003930")), invalidResultCount: run.results.filter((r) => !r.isValid).length };
}

const byItem = new Map(items.map((i) => [i.group + "/" + i.id, i])), byItemProfiles = new Map();
for (const profile of selectedProfiles) { const list = byItemProfiles.get(profile.itemKey) ?? []; list.push(profile); byItemProfiles.set(profile.itemKey, list); }
const baselineRecords = new Map(), conformance = [], latency = { released315: [], baseline: [], candidate: [] };
let processed = 0;
for (const [key, groupProfiles] of byItemProfiles) {
  const item = byItem.get(key), image = await load(item);
  for (const profile of groupProfiles) {
    const release = await decode(engines.released315, image, profile), baseline = await decode(engines.baseline, image, profile);
    latency.released315.push(release.warmDecodeMs); latency.baseline.push(baseline.warmDecodeMs);
    const equivalent = same(release, baseline), record = { profileId: profile.id, itemKey: key, arm: profile.arm, mode: profile.mode, options: profile.options, equivalent, orderedEquivalent: JSON.stringify(release.results) === JSON.stringify(baseline.results) && release.error === baseline.error, released315: release, baseline, releasedOutcome: outcome(item, profile, release), baselineOutcome: outcome(item, profile, baseline) };
    appendFileSync(join(output, "baseline-conformance.jsonl"), JSON.stringify(record) + "\n"); baselineRecords.set(profile.id, record); if (!equivalent || release.error || baseline.error) conformance.push(record);
  }
  processed++; if (processed % 25 === 0) console.log(JSON.stringify({ phase: "baseline-conformance", items: processed, totalItems: byItemProfiles.size, profiles: baselineRecords.size, mismatches: conformance.length }));
}
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const describeTime = (values) => ({ n: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: values.length ? Math.max(...values) : null });
const baseSummary = { harnessSelfCheck: plan.harnessSelfCheck, scope: plan.scope, recordedAt: new Date().toISOString(), planSha256: sha(readFileSync(join(output, "evaluation-plan.json"))), engines: Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, v.evidence])), counts: plan.scopeCounts, baselineProfiles: baselineRecords.size, baselineConformanceMismatches: conformance.length, orderedBaselineDifferences: [...baselineRecords.values()].filter((r) => !r.orderedEquivalent).length, baselineDifferenceProfiles: conformance.map((r) => ({ profileId: r.profileId, itemKey: r.itemKey, arm: r.arm, mode: r.mode })), timingLimitations: plan.limitations.filter((s) => s.includes("tim")), warmTiming: { released315: describeTime(latency.released315), baseline: describeTime(latency.baseline) } };
if (conformance.length) { write("summary.json", { ...baseSummary, status: "baseline-conformance-failed", candidateEvaluationPerformed: false }); console.log(JSON.stringify({ status: "baseline-conformance-failed", profiles: baselineRecords.size, mismatches: conformance.length, output })); process.exitCode = 1; }
else if (!engines.candidate) { write("summary.json", { ...baseSummary, status: flags.has("--sanity-only") ? "baseline-sanity-passed" : "full-baseline-passed", candidateEvaluationPerformed: false }); console.log(JSON.stringify({ status: "baseline-only-passed", profiles: baselineRecords.size, output })); }
else {
  const changes = [], lostTargets = [], introducedControls = [], known = [], arms = {}; let candidateProfiles = 0, candidateErrors = 0, candidateCalls = 0;
  processed = 0;
  for (const [key, groupProfiles] of byItemProfiles) {
    const item = byItem.get(key), image = await load(item);
    for (const profile of groupProfiles) {
      const before = baselineRecords.get(profile.id), candidate = await decode(engines.candidate, image, profile), after = outcome(item, profile, candidate), prior = before.baselineOutcome;
      latency.candidate.push(candidate.warmDecodeMs); candidateProfiles++; candidateErrors += !!candidate.error; candidateCalls += candidate.readerCalls ?? 0;
      const change = { profileId: profile.id, itemKey: key, arm: profile.arm, mode: profile.mode, options: profile.options, equivalent: same(before.baseline, candidate), baselineOutcome: prior, candidateOutcome: after, baseline: before.baseline, candidate, newPayloads: candidate.results.filter((r) => !before.baseline.results.some((b) => b.text === r.text)).map((r) => r.text), lostTargetTexts: prior.targetTexts.filter((t) => !after.targetTexts.includes(t)) };
      appendFileSync(join(output, "candidate-comparison.jsonl"), JSON.stringify(change) + "\n");
      if (!change.equivalent) changes.push(change); if (change.lostTargetTexts.length) lostTargets.push(change); if (!before.baseline.results.some((r) => r.isValid) && after.status === "unexpected-control-output") introducedControls.push(change);
      if (["ean13-2-07", "ean13-1-35", photo.supplement.id].includes(item.id)) known.push(change);
      const arm = arms[profile.arm + "/" + profile.mode] ??= { profiles: 0, changed: 0, lostTargetProfiles: 0, baselineTargetProfiles: 0, candidateTargetProfiles: 0, baselineControlOutput: 0, candidateControlOutput: 0, baselineKnownFalse07: 0, candidateKnownFalse07: 0, baselineKnownFalse35: 0, candidateKnownFalse35: 0, candidateErrors: 0 };
      arm.profiles++; arm.changed += !change.equivalent; arm.lostTargetProfiles += !!change.lostTargetTexts.length; arm.baselineTargetProfiles += !!prior.targetTexts.length; arm.candidateTargetProfiles += !!after.targetTexts.length; arm.baselineControlOutput += prior.status === "unexpected-control-output"; arm.candidateControlOutput += after.status === "unexpected-control-output"; arm.baselineKnownFalse07 += prior.confirmedFalse07Present; arm.candidateKnownFalse07 += after.confirmedFalse07Present; arm.baselineKnownFalse35 += prior.confirmedFalse35Present; arm.candidateKnownFalse35 += after.confirmedFalse35Present; arm.candidateErrors += !!candidate.error;
    }
    processed++; if (processed % 25 === 0) console.log(JSON.stringify({ phase: "candidate-comparison", items: processed, totalItems: byItemProfiles.size, profiles: candidateProfiles, changed: changes.length, lostTargetProfiles: lostTargets.length }));
  }
  write("changed-profiles.json", changes); write("known-case-profiles.json", known);
  const summary = { ...baseSummary, status: plan.harnessSelfCheck ? "harness-self-check-completed-not-candidate-evidence" : "actual-candidate-comparison-completed", candidateEvaluationPerformed: true, candidateProfiles, candidateReaderCalls: candidateCalls, candidateErrors, changedProfiles: changes.length, lostTargetProfiles: lostTargets.map((r) => ({ profileId: r.profileId, itemKey: r.itemKey, texts: r.lostTargetTexts })), introducedNoCodeOutputProfiles: introducedControls.map((r) => ({ profileId: r.profileId, itemKey: r.itemKey, texts: r.candidateOutcome.nonTargetTexts })), arms, warmTiming: { ...baseSummary.warmTiming, candidate: describeTime(latency.candidate) }, productionApproval: false, limitations: plan.limitations };
  write("summary.json", summary); console.log(JSON.stringify({ status: summary.status, profiles: candidateProfiles, changedProfiles: changes.length, lostTargetProfiles: lostTargets.length, introducedNoCodeOutputProfiles: introducedControls.length, candidateErrors, output }));
  if (candidateErrors || lostTargets.length || introducedControls.length) process.exitCode = 1;
}
